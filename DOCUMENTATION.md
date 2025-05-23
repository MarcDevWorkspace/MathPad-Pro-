# MathPad Pro - Technical Documentation

**Version:** 0.1.0 (Alpha)

This document provides a more in-depth technical overview of the MathPad Pro project, its architecture, core components, and the heuristics involved in its design.

## Table of Contents

1.  [Architecture Overview](#1-architecture-overview)
2.  [Core LaTeX Parser (`core/latex-parser/`)](#2-core-latex-parser)
    *   [2.1 Abstract Syntax Tree (`ast.ts`)](#21-abstract-syntax-tree-astts)
    *   [2.2 Tokenizer (`tokens.ts`, `lexer.ts`)](#22-tokenizer-tokensts-lexerts)
    *   [2.3 Parser (`parser.ts`)](#23-parser-parserts)
    *   [2.4 Serializer (`serializer.ts`)](#24-serializer-serializerts)
    *   [2.5 Zipper (`zipper.ts`)](#25-zipper-zipperts)
    *   [2.6 Incremental Parsing (`incremental.ts`)](#26-incremental-parsing-incrementalts)
3.  [Editor Logic (`editor/MathEditor.ts`)](#3-editor-logic-editormatheditorts)
    *   [3.1 Initialization and MathJax Readiness](#31-initialization-and-mathjax-readiness)
    *   [3.2 Rendering Pipeline (`renderAndMap`)](#32-rendering-pipeline-renderandmap)
    *   [3.3 AST to MML/DOM ID Correlation (`correlateAndAddIdsToMmlRecursive`)](#33-ast-to-mmldom-id-correlation)
    *   [3.4 User Interaction (`handleClick`, `calculateCharOffsetFromClick`)](#34-user-interaction)
    *   [3.5 Caret Management (`updateVisualCaretPosition`)](#35-caret-management)
    *   [3.6 Editing Operations (`processKey`)](#36-editing-operations-processkey)
4.  [Build and Test Workflow](#4-build-and-test-workflow)
5.  [Key Design Heuristics and Challenges](#5-key-design-heuristics-and-challenges)
6.  [Future Development Areas (Technical Deep Dive)](#6-future-development-areas)

---

## 1. Architecture Overview

MathPad Pro is architected with a clear separation of concerns:

*   **Core Parser Engine (`src/core/latex-parser/`):** This is the heart of the application. It's a self-contained TypeScript library responsible for understanding LaTeX math syntax.
    *   **Input:** LaTeX string.
    *   **Output:** An Abstract Syntax Tree (AST) representing the structure and content.
    *   **Operations:** Provides utilities to convert the AST back to LaTeX (serialization) and to navigate/modify the AST immutably (Zipper).
*   **Editor UI & Interaction Logic (`src/editor/MathEditor.ts`):** This TypeScript class orchestrates the user interface.
    *   Manages the current document state (AST + source string via `IncrementalParseState`).
    *   Uses the Core Parser Engine for parsing and serialization.
    *   Interacts with MathJax for rendering the LaTeX output.
    *   Handles user input (clicks, virtual keyboard) to update the AST (via the Zipper).
    *   Manages the visual caret.
*   **MathJax (External Library):** Used for high-quality rendering of LaTeX to HTML (CHTML) or SVG.
*   **Frontend Shell (`public/index.html`, `public/style.css`):** Provides the basic HTML structure, styling, and loads the application.

**Data Flow (Simplified):**

1.  **Initial Load:**
    *   `MathEditor` receives initial LaTeX.
    *   `initialParse` (from `incremental.ts`, using the parser core) converts LaTeX to AST.
    *   `MathEditor` stores this state.
2.  **Rendering:**
    *   `MathEditor` calls `toLatex` on the current AST.
    *   The LaTeX string is passed to `MathJax.tex2mml`.
    *   The resulting MML string is parsed into an XML DOM.
    *   `correlateAndAddIdsToMmlRecursive` traverses the AST and MML DOM, adding `data-ast-id` attributes to MML elements.
    *   The modified MML (as a string) is passed to `MathJax.mml2chtml` (or `mml2svg`).
    *   The resulting MathJax output node is appended to the DOM.
    *   MathJax finalizes rendering (`startup.document.render()`).
    *   `astNodeToDomElementsMap` is populated by querying for `data-ast-id`.
    *   Visual caret is positioned.
3.  **User Interaction (e.g., Click):**
    *   Click event on MathJax output.
    *   `handleClick` identifies the clicked DOM element and its `data-ast-id`.
    *   `findNodeAndPathByIdInAst` retrieves the corresponding AST node and its path.
    *   `Zipper` is updated to focus on this node/path.
    *   Visual caret is updated.
4.  **User Edit (e.g., Key Press):**
    *   `processKey` determines the intended edit.
    *   Uses `Zipper` functions (e.g., `zipperModifySymNodeText`, `zipperDeleteNode`) to create a new Zipper state reflecting the change.
    *   The AST is reconstructed from the new Zipper state (`zipperToAST`).
    *   This new AST is serialized back to LaTeX.
    *   `updateParse` is called with the old source and the new LaTeX (currently triggering a full re-parse, which generates a new AST with fresh IDs).
    *   `MathEditor` state is updated with the new AST and source.
    *   Zipper needs to be re-established on the new AST (this is a challenging step for UX).
    *   The rendering pipeline (`renderAndMap`) is triggered.

---

## 2. Core LaTeX Parser (`core/latex-parser/`)

### 2.1 Abstract Syntax Tree (`ast.ts`)

*   **Purpose:** Defines the structure of the parsed LaTeX. Each node represents a logical component of the math expression.
*   **`Span`:** `{ start: number, end: number }` representing the character offsets in the original source LaTeX string. Crucial for error reporting, incremental parsing, and mapping to source.
*   **`BaseNode`:** Interface with common properties: `kind: string`, `span: Span`, `id: string` (unique), `children?: Node[]` (optional generic access).
*   **Specific Node Types:**
    *   `SeqNode`: Represents a sequence of other nodes (e.g., content of a group, a matrix cell, or the root of the document). `children: Node[]`.
    *   `GroupNode`: Represents a LaTeX group `{...}`. `children: Node[]`.
    *   `FracNode`: `\frac{num}{den}`. Has `num: Node` and `den: Node`.
    *   `SqrtNode`: `\sqrt[idx]{rad}`. Has `rad: Node` and optional `idx?: Node`.
    *   `SupSubNode`: `base^{sup}_{sub}`. Has `base: Node`, optional `sup?: Node`, `sub?: Node`.
    *   `SymNode`: A terminal node for symbols, numbers, operators, or unparsed commands (e.g., `a`, `1`, `+`, `\alpha`, `\ ইত্যাদি`). `text: string`.
    *   `TextEnvNode`: For `\text{...}`, `\mathrm{...}`. Stores `command: string` (e.g., `"\text"`) and `rawText: string` (the content within braces, preserving spaces and all characters).
    *   `MatrixRowNode`: Represents a single row in a matrix. `children: Node[]` (each child is typically a `SeqNode` representing cell content).
    *   `MatrixEnvNode`: `\begin{env}...\end{env}`. Stores `environment: string` (e.g., "matrix", "pmatrix") and `rows: MatrixRowNode[]`.
*   **Constructors (`create<Type>Node`):** Factory functions for creating node instances. They automatically assign a unique `id` (using an internal `nodeIdCounter`) and take `span` and content-specific arguments.
*   **Utilities:**
    *   `getNodeChildren(node: Node): Node[]`: Provides a consistent way to get the "logical" children of any node type for traversal (e.g., for `MatrixEnvNode`, it returns the `rows`).
    *   `replaceNodeChild(parent: Node, oldChildId: string, newChild: Node): Node`: (Primarily for conceptual use by zipper if it were to directly build parents) Creates a new parent instance with a child replaced. Span updates are approximate.

### 2.2 Tokenizer (`tokens.ts`, `lexer.ts`)

*   **`tokens.ts`:**
    *   `SourceLocation`: `{ offset, line, column }`.
    *   `TokenSpan`: `{ start, end }` (offsets).
    *   `TokKind` (Enum): Defines all recognized token types (e.g., `LBrace`, `Command`, `Text`, `Ampersand`, `Whitespace`, `Comment`, `EOF`).
    *   `Token` (Interface): `{ kind: TokKind, text: string, span: TokenSpan, loc: { start: SourceLocation, end: SourceLocation } }`.
    *   `calculateSourceLocation`: Utility to convert a character offset to line/column, optimized with precomputed line starts.
*   **`lexer.ts` (`Lexer` class):**
    *   **Input:** LaTeX string.
    *   **Output:** A stream of `Token` objects via its `next()` method.
    *   **Functionality:**
        *   Tracks current position, line, and column. Pre-calculates line start offsets for efficient location reporting.
        *   Recognizes single-character tokens (`{`, `}`, `^`, `_`, `&`).
        *   Recognizes whitespace (`K.Whitespace`) and consolidates sequential whitespace.
        *   Recognizes comments (`%` to newline, as `K.Comment`).
        *   Handles backslash-initiated tokens:
            *   `\\` as `K.DoubleBackslash`.
            *   `\commandName` (alphabetic) as `K.Command` with `text: "\\commandName"`.
            *   `\symbol` (e.g., `\$`, `\{`) as `K.Command` with `text: "\\symbol"`.
            *   Lone `\` at EOF as `K.Backslash`.
        *   Default rule captures sequences of non-special, non-whitespace characters as `K.Text` (e.g., "abc", "123", "+=").
    *   **Heuristic:** The lexer aims to be relatively simple for math mode. It doesn't have complex state for different TeX modes (text vs. math) beyond what's needed for basic tokenization. Whitespace and comments are tokenized but typically skipped by the parser's `advanceToken()` method.

### 2.3 Parser (`parser.ts`)

*   **Input:** An instance of `Lexer`.
*   **Output:** An AST `Node` (specifically, the root `SeqNode`).
*   **Methodology:** Recursive Descent (Pratt-style elements for `symbolOrSupSub` handling operator precedence implicitly by structure).
*   **Key Methods:**
    *   `constructor(lex: Lexer)`: Initializes by getting the first significant token (skipping initial whitespace/comments).
    *   `advanceToken()`: Gets the next token from the lexer and skips `K.Whitespace` and `K.Comment`. Updates `lastConsumedTokenEndLoc`.
    *   `consume(expectedKind, errorMessage?)`: Checks if `this.look` is of `expectedKind`, consumes it (calls `advanceToken`), and returns it. Throws an error if kind mismatches. Variants `consumeCommand` and `consumeText` exist for more specific checks.
    *   `parse(): A.Node`: Entry point. Calls `sequence([K.EOF])` and sets the span for the root node.
    *   `sequence(stopTokens: K[]): A.Node`: Parses a sequence of terms until a token in `stopTokens` or `EOF` is encountered. Returns a `SeqNode`. Handles empty sequences with zero-width spans.
    *   `term(): A.Node`: Parses a single "term" in an expression. This is the main dispatch function based on `this.look.kind`:
        *   `K.Command`: Dispatches to specific handlers (`fraction`, `sqrt`, `textEnv`, `beginEnv`) if the command text matches. Otherwise, calls `symbolOrSupSub` (treating commands like `\alpha` as potential bases for scripts).
        *   `K.LBrace`: Calls `group()`.
        *   `K.Text`: Calls `symbolOrSupSub()`.
        *   Other unexpected tokens: Parsed as `SymNode`s (error recovery) or throws error.
    *   `group(): A.Node`: Parses `{ ... }` by consuming braces and calling `sequence` for the content.
    *   `symbolOrSupSub(): A.Node`: Parses a base (a symbol, command, or group) and then iteratively checks for and parses attached `^` (superscript) and `_` (subscript) arguments. Correctly handles `x^a_b` and `x_a^b`.
    *   `argument(): A.Node`: Parses an argument for commands like `\frac`, `\sqrt`, `^`, `_`. If not a braced group, it expects and consumes a single token (Command or Text) as a `SymNode`.
    *   `fraction()`, `sqrt()`, `textEnv()`, `beginEnv()`, `matrixEnv()`: Dedicated methods for parsing their respective LaTeX structures.
        *   `textEnv`: Now captures raw text content between braces, handling nested braces and advancing the lexer token by token using `this.lex.next()` to preserve all characters.
        *   `matrixEnv`: Uses o4-mini's patched inline loop for cell content parsing, which correctly stops at `&`, `\\`, or `\end` command. It handles row/cell construction and environment termination.
    *   `throwError(message)`: Centralized error reporting with location information.
*   **Spans:** Each AST node constructor is responsible for taking a `Span`. Parser methods calculate these spans based on the start/end tokens of the construct.
*   **Error Recovery (Basic):** Currently, the parser throws an error on unexpected syntax. More advanced recovery (e.g., creating "error nodes" and attempting to continue) is not implemented. The `noerrors` MathJax package helps at the rendering level.

### 2.4 Serializer (`serializer.ts`)

*   **Input:** An AST `Node`.
*   **Output:** A LaTeX string.
*   **`toLatex(node: A.Node): string`:** Recursively traverses the AST.
    *   `SeqNode`, `GroupNode`: Joins serialized children, wraps `GroupNode` content in `{}`. Handles empty groups as `{}`.
    *   `FracNode`, `SqrtNode`: Prepends `\frac`, `\sqrt` (with `[index]` if present) and serializes children.
    *   `SupSubNode`: Serializes base, then appends `^{sup}` and/or `_{sub}`. Includes "smart bracing" (omits braces for single-character, non-command scripts like `x^2` or `\alpha_i`).
    *   `SymNode`: Returns `node.text` directly.
    *   `TextEnvNode`: Returns `node.command + "{" + node.rawText + "}"`.
    *   `MatrixRowNode`: Joins serialized children (cells) with ` & `.
    *   `MatrixEnvNode`: Formats as `\begin{env}\n rows... \n\end{env}`, with rows joined by ` \\\\\n`.

### 2.5 Zipper (`zipper.ts`)

*   **Purpose:** Provides an immutable way to navigate and edit the AST.
*   **`Zipper` Interface:** `{ focus: A.Node, path: Path, charOffset?: number }`.
    *   `focus`: The currently selected AST node.
    *   `path`: An array of `Crumb` objects representing the path from the root to the parent of the focus.
    *   `charOffset`: For `SymNode` focus, the cursor position within its text.
*   **`Crumb` Type:** Defines different structures based on the parent node type to store siblings or parent context needed for upward navigation and reconstruction. Includes `seq_parent`, `frac_parent_num/den`, `sqrt_parent_rad/idx`, `spsb_parent_base/sup/sub`, and `mtrxenv_parent_row`.
*   **Key Functions:**
    *   `fromAST(rootNode)`: Creates a zipper focused on the root.
    *   `toAST(zipper)`: Reconstructs the full AST from the zipper's state, creating new node instances with fresh IDs.
    *   Navigation: `up()`, `down(childIndex)`, `downToFirstChild()`, `downToLastChild()`, `left()`, `right()`. These return new `Zipper` instances.
    *   Editing:
        *   `replace(zipper, newNode)`: Replaces the focused node.
        *   `modifySymNodeText(zipper, newText, newCharOffset?)`: Updates text of a `SymNode`.
        *   `insertRight(zipper, newNode)`, `insertLeft(zipper, newNode)`: Inserts sibling in sequence-like contexts.
        *   `deleteNode(zipper)`: Deletes the focused node, attempts to move focus intelligently (to sibling or parent). Replaces fixed children (like frac numerator) with empty placeholders.
*   **Immutability:** All operations return new `Zipper` instances. The original AST or Zipper is not modified.

### 2.6 Incremental Parsing (`incremental.ts`)

*   **Purpose:** To manage the document state (`source` text + `AST`) and efficiently update the AST after edits without full re-parse (long-term goal).
*   **`SourceStore` Interface:** Defines an immutable string store (`text`, `length`, `slice`, `replace`). A simple `StringSourceStore` class is provided.
*   **`IncrementalParseState` Interface:** `{ source: SourceStore, ast: A.Node }`.
*   **`initialParse(sourceText)`:** Creates initial state by parsing the full text. Includes basic `try...catch`.
*   **`updateParse(prevState, changeStart, oldEnd, insertedText)`:**
    *   **Current Status:** Fallback implementation. It updates the `SourceStore` with the text change, then performs a **full re-parse** of the entire new source string.
    *   Logs a warning about this fallback.
    *   Includes basic `try...catch`.
    *   **Future Goal:** Implement true incremental parsing by identifying dirty regions, re-lexing/re-parsing only those, and patching the AST. This is a highly complex task.

---

## 3. Editor Logic (`editor/MathEditor.ts`)

This class is the bridge between the parser core, MathJax, and user interactions. **It is currently in an initial, experimental stage.**

### 3.1 Initialization and MathJax Readiness

*   The `MathEditor` constructor takes a DOM container ID and initial LaTeX.
*   It sets up DOM elements for MathJax output and a visual caret.
*   Crucially, it now waits for a `mathjax-ready` custom event (dispatched from `mathjax-config.js`) before proceeding with parser initialization and initial rendering. This ensures MathJax is fully loaded and configured.

### 3.2 Rendering Pipeline (`renderAndMap`)

This asynchronous method is responsible for displaying the current AST.
1.  **AST to LaTeX:** Calls `toLatex(this.state.ast)`.
2.  **TeX to MML String:** Uses `MathJax.tex2mml()` to convert LaTeX to a MathML string.
3.  **MML DOM Parsing:** Uses `DOMParser` to parse the MML string into an XML Document.
4.  **MML ID Injection:** Calls `correlateAndAddIdsToMmlRecursive()` to traverse the editor's AST and the MML DOM simultaneously, attempting to add `data-ast-id="${node.id}"` attributes to corresponding MML elements. This is the **most complex and heuristic part** currently.
5.  **Modified MML to Output:** Serializes the modified MML DOM back to a string.
6.  **MathJax Conversion:** Passes the MML string with IDs to `MathJax.mml2chtml()` (or `mml2svg()`).
7.  **DOM Append & Render:** Appends the MathJax output node to `this.mathJaxOutputElement` and calls `MathJax.startup.document.render().promise` to finalize MathJax rendering.
8.  **Build DOM Map:** Calls `buildAstToDomMapFromDataAttributes()` to populate `this.astNodeToDomElementsMap` by querying for elements with `data-ast-id`.
9.  **Update Caret:** Calls `updateVisualCaretPosition()`.

### 3.3 AST to MML/DOM ID Correlation (`correlateAndAddIdsToMmlRecursive`)

*   **Challenge:** MathJax's TeX-to-MML conversion doesn't preserve arbitrary source IDs. The MML structure can also differ significantly from a direct LaTeX-to-AST mapping (e.g., inferred `<mrow>`s, operator forms).
*   **Current Strategy:**
    *   A recursive function that takes an `astNode` and an `mmlParentContext` (and an optional `currentMmlNodeHint`).
    *   It attempts to find the "next" relevant MML child element within `mmlParentContext` that should correspond to the current `astNode`. An `mmlElementIndexStack` is used to keep track of sibling indices within parent MML elements during traversal.
    *   If a match is heuristically determined (based on `astNode.kind` and expected `mmlElement.tagName` or structure), it sets `mmlElement.setAttribute('data-ast-id', astNode.id)`.
    *   It then recursively calls itself for children of the `astNode` and their corresponding MML child elements.
*   **Status:** This is highly experimental and requires careful, incremental implementation and testing for each AST node type by:
    1.  Observing the MML generated by MathJax for specific LaTeX constructs.
    2.  Writing correlation logic based on these observations.
    3.  Testing if `data-ast-id` attributes are correctly placed in the final rendered DOM.
*   **Heuristics Involved:** Matching AST `kind` to MML tag names (e.g., `FracNode` to `mfrac`), expected number of children, and sometimes structural patterns.

### 3.4 User Interaction (`handleClick`, `calculateCharOffsetFromClick`)

*   **`handleClick(event)`:**
    *   Attached to the `mathJaxOutputElement`.
    *   Traverses up from `event.target` to find an element with a `data-ast-id`.
    *   If found, uses `findNodeAndPathByIdInAst` (another recursive AST traversal helper) to get the `ASTNode` and its `Path`.
    *   Calls `calculateCharOffsetFromClick` if the focused node is a `SymNode`.
    *   Updates `this.zipper` with the new focus, path, and offset.
    *   Calls `updateVisualCaretPosition()`. (Does not trigger a full re-render on click, only caret update).
*   **`calculateCharOffsetFromClick(symNode, domElement, event)`:**
    *   Attempts to determine the character offset within a `SymNode`'s text based on click coordinates.
    *   Prioritizes using the browser's `document.createRange()` API on text nodes for precision.
    *   Has fallbacks for SVG's `getCharNumAtPosition` (if applicable) or a less accurate average character width heuristic.
    *   **Status:** Initial heuristics in place; needs significant testing and refinement for accuracy across different symbols, fonts, and MathJax output types (CHTML/SVG).

### 3.5 Caret Management (`updateVisualCaretPosition`)

*   Positions an absolute-positioned `<div>` (the `visualCaretElement`) based on the current `this.zipper` state.
*   Uses `this.astNodeToDomElementsMap` to find the DOM element for `this.zipper.focus.id`.
*   If focus is a `SymNode` with a `charOffset`, it attempts to use `document.createRange()` on the corresponding text node in the DOM to get precise coordinates for the caret.
*   Handles empty group/sequence placeholders by positioning the caret at their start.
*   Adjusts for scrolling within the `mathJaxOutputElement`.
*   **Status:** Basic implementation exists; precision (especially within `SymNode`s) and handling all edge cases (e.g., bidirectional text, complex MathJax structures for single symbols) are ongoing challenges.

### 3.6 Editing Operations (`processKey`)

*   **Purpose:** Public method to be called by the virtual keyboard or other input sources.
*   **Current Status:** A very basic stub.
    *   Handles simple character input by attempting `zipperModifySymNodeText` or placeholder logic for empty groups.
    *   Handles `Backspace` by calling `zipperModifySymNodeText` (delete char) or `zipperDeleteNode`.
    *   Handles `ArrowLeft`/`ArrowRight` with basic `charOffset` changes or simple `zipperLeft`/`zipperRight`/`zipperUp` calls.
*   **Synchronization Issue (Major TODO):**
    *   After an AST modification via the Zipper, the current `processKey` naively re-serializes the *entire* new AST (from `zipperToAST(this.zipper)`) and calls `updateParse` (which does a full re-parse). This is **highly inefficient** and **loses fine-grained cursor state** because the re-parse creates all new node IDs, making the old zipper invalid for precise focus restoration.
    *   **Critical Future Work:**
        1.  Implement true incremental `updateParse`.
        2.  Develop a strategy for `processKey` to either:
            *   Generate a "source patch" (start, end, newText) from the zipper operation to feed to a smarter `updateParse`.
            *   Have `updateParse` accept AST patches directly.
        3.  Implement robust zipper focus restoration after the AST is updated by `updateParse`. This might involve finding nodes by structural path similarity, content, or by mapping old IDs to new IDs during an incremental patch.

---

## 4. Build and Test Workflow

*   **TypeScript Configuration (`tsconfig.json`):** Configured for modern ESM (`ESNext` module/target, `NodeNext` resolution), strict type checking, and source maps. `ts-node` block is set up for ESM execution.
*   **Bundling (`package.json` scripts with `esbuild`):**
    *   `npm run dev`: Bundles `src/main.ts` into `public/dist/main.js` with sourcemaps and watches for changes.
    *   `npm run build`: Creates a minified production bundle.
*   **Serving (`http-server`):** `npm run serve` serves the `public` directory.
*   **Testing (`tsx`):**
    *   `npm run test:parser`: Runs extensive tests for the LaTeX parser and serializer.
    *   `npm run test:zipper`: Runs tests for the AST Zipper navigation and manipulation.
    *   **Current Test Status:** All 49 parser tests and all 5 conceptual zipper test suites are **PASSING**.

---

## 5. Key Design Heuristics and Challenges

*   **LaTeX Core:** The fundamental decision to use LaTeX as the internal model provides power but introduces the challenge of bridging its command-based nature with a WYSIWYG interface.
*   **Custom Parser Necessity:** Off-the-shelf LaTeX-to-HTML converters are insufficient for the required level of structural understanding, cursor logic, and fine-grained editing. A custom parser generating a detailed AST is essential.
*   **Immutability (AST & Zipper):** All AST manipulations via the Zipper produce new AST/Zipper instances. This simplifies state management and is crucial for features like undo/redo.
*   **Span Tracking:** Every AST node and token stores its start/end character offsets from the original source. This is vital for error reporting, future incremental parsing, and mapping selections back to source.
*   **AST-to-DOM Mapping:** The most significant current challenge for the WYSIWYG aspect. Reliably mapping AST nodes to MathJax-rendered DOM elements (and vice-versa for clicks) is complex due to MathJax's internal rendering pipeline and potential structural differences between a semantic AST and presentational MathML/HTML. The `data-ast-id` injection strategy is preferred.
*   **Caret Positioning:** Precise caret placement, especially within text/symbols and around complex structures, requires accurate DOM measurements and understanding of text metrics, which can be browser and MathJax output-dependent.
*   **Incremental Updates:** The current full re-parse on edit is a performance bottleneck for a live editor. True incremental parsing and rendering are critical long-term goals.
*   **Mobile-First UX:** While the core logic is platform-agnostic, future UI development for the virtual keyboard and editor interactions must prioritize touch interfaces and small screens.

---

## 6. Future Development Areas (Technical Deep Dive from Current State)

1.  **Robust MML ID Correlation (`correlateAndAddIdsToMmlRecursive`):**
    *   Systematically implement and test correlation for each AST node type (`SymNode` with various MML tags like `mi, mn, mo, mtext`; `FracNode` with `mfrac`; `SqrtNode` with `msqrt/mroot`; `SupSubNode` with `msup, msub, msubsup`; `MatrixEnvNode/RowNode` with `mtable, mtr, mtd`).
    *   This requires detailed inspection of MathJax's MML output for all supported LaTeX constructs.
    *   Handle cases where MathJax inserts inferred `<mrow>`s or other structural elements not directly present in our AST. The `mmlElementIndexStack` is a starting point for navigating these.

2.  **Precise Caret Logic (`calculateCharOffsetFromClick`, `updateVisualCaretPosition`):**
    *   Leverage browser APIs like `document.caretPositionFromPoint()` if available and suitable.
    *   For SVG output from MathJax, explore `SVGTextContentElement.getCharNumAtPosition()` and related methods for text metrics.
    *   For CHTML, robustly use `document.createRange()` to get bounding boxes of individual characters or inter-character positions.
    *   Handle selection of ranges, not just single caret positions.

3.  **Implement `MathEditor.processKey()` for Full Editing:**
    *   **Character Input:** Into `SymNode`, empty `GroupNode`s, between nodes in a `SeqNode`.
    *   **Backspace/Delete:** Character deletion, node deletion (e.g., deleting an empty `GroupNode` placeholder, deleting a whole fraction if caret is at a specific position).
    *   **Arrow Key Navigation:**
        *   Character-by-character within `SymNode`s and `TextEnvNode` raw text.
        *   Structural navigation: Jumping between numerator/denominator, into/out of square roots, between matrix cells, moving past entire scripts. This will heavily use `Zipper` functions.
    *   **Structure Insertion:**
        *   Typing `/` might create an empty `FracNode` and focus the numerator.
        *   Virtual keyboard button for `\sqrt` inserts `SqrtNode` and focuses radicand.
        *   Wrap selection: Selecting `ab` and pressing `(` might create `{(ab)}`.

4.  **Efficient AST Update & Zipper Restoration (Post-Edit):**
    *   Move away from full re-parse in `processKey`.
    *   **Strategy A (Source Patch + Incremental Parse):** Zipper operations generate a description of the source text change (start, oldEnd, newText). Feed this to a true incremental `updateParse`. `updateParse` patches the AST and returns info to map the old Zipper focus to a new focus.
    *   **Strategy B (Direct AST Patch + Minimal Re-Serialization/Re-Parse):** Zipper ops modify a *copy* of the AST directly. Then, re-serialize only the changed portion for rendering and potentially re-parse only a small surrounding fragment to fix local spans/IDs if necessary.
    *   Focus restoration after AST IDs change is a key challenge. Techniques might involve:
        *   Structural path matching.
        *   Mapping old IDs to new IDs during an incremental patch.
        *   Content-based heuristics.

5.  **Virtual Keyboard Implementation (`VirtualKeyboard.ts`).**

6.  **Undo/Redo Stack (using `IncrementalParseState` snapshots).**