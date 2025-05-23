# Changelog - MathPad Pro

## [0.1.0] - 2025-05-23 (Alpha - Parser Core Stabilized)

### Added

*   **Initial Project Scaffolding:**
    *   `package.json` with `esbuild` for bundling, `tsx` for testing, `http-server`.
    *   `tsconfig.json` for modern ESM TypeScript development.
    *   `public/index.html` as the main app shell.
    *   `public/style.css` with theming (light/dark) and basic layout.
    *   `public/mathjax-config.js` for MathJax v3 configuration, dispatches `mathjax-ready` event.
    *   `src/main.ts` as application entry point.
*   **Core LaTeX Parser (`src/core/latex-parser/`):**
    *   **AST (`ast.ts`):**
        *   Definitions for `Span`, `BaseNode`, and specific node types: `SeqNode`, `GroupNode`, `FracNode`, `SqrtNode`, `SupSubNode`, `SymNode`.
        *   Node constructors (`create<Type>Node`) with automatic unique ID generation and span assignment.
        *   `getNodeChildren` and `replaceNodeChild` utilities.
    *   **Tokenizer (`tokens.ts`, `lexer.ts`):**
        *   `TokKind` enum for all recognized tokens.
        *   `Token` interface with `text`, `span`, and `loc` (SourceLocation: offset, line, column).
        *   `Lexer` class that tokenizes LaTeX input string, handles commands, symbols, text, whitespace, comments, and provides location information.
    *   **Parser (`parser.ts`):**
        *   Recursive descent parser.
        *   Parses sequences, groups, fractions, square roots (with optional index), super/subscripts (combined and out-of-order).
        *   Skips whitespace and comments.
        *   Robust error reporting with token location.
        *   Handles unknown commands as `SymNode`s.
    *   **Serializer (`serializer.ts`):**
        *   `toLatex` function to convert AST back to LaTeX string.
        *   Includes "smart bracing" for superscripts/subscripts (e.g., `x^2` not `x^{2}`).
    *   **Zipper (`zipper.ts`):**
        *   Immutable AST navigator and editor.
        *   `Zipper` interface, `Crumb` types, `Path` type.
        *   Functions: `fromAST`, `toAST`, `up`, `down`, `left`, `right`, `replace`, `modifySymNodeText`, `insertRight`, `insertLeft`, `deleteNode`.
    *   **Incremental Parsing Stub (`incremental.ts`):**
        *   `SourceStore` interface and simple string-based implementation.
        *   `IncrementalParseState` interface.
        *   `initialParse()`: Parses full LaTeX string.
        *   `updateParse()`: Currently falls back to full re-parse.
    *   **Testing:**
        *   `test-parser.ts` with 49 diverse test cases. **All passing.**
        *   `test-zipper.ts` with 5 core test suites for navigation and modification. **All passing.**
*   **`MathEditor.ts` (Initial Draft - `src/editor/MathEditor.ts`):**
    *   Class structure for managing editor state and UI.
    *   Initialization waits for `mathjax-ready` event.
    *   `renderAndMap` method:
        *   Serializes AST to LaTeX.
        *   Outlines strategy for MathJax rendering pipeline including MML-based `data-ast-id` injection (highly experimental).
        *   Stubs for `correlateAndAddIdsToMmlRecursive` and `buildAstToDomMapFromDataAttributes`.
    *   `handleClick` method: Basic logic to find clicked AST node via `data-ast-id` (if present) and update Zipper.
    *   `updateVisualCaretPosition`: Basic logic to position a DOM caret.
    *   `processKey`: Rudimentary stubs for character input and navigation.
    *   Includes extensive `console.log` statements for debugging.

### Changed

*   **Project Setup:** Transitioned from `ts-node` with direct Node execution for tests to `tsx` for better ESM compatibility.
*   **Build Process:** Adopted `esbuild` for bundling the application for the browser.
*   **Parser (`parser.ts`):**
    *   Incorporated o4-mini's patch for robust `matrixEnv` cell parsing, fixing Test Case 8.
    *   Refined `term()` to correctly dispatch commands like `\alpha` to `symbolOrSupSub()`.
*   **AST (`ast.ts`):**
    *   `TextEnvNode` now uses `rawText: string` instead of `children: Node[]` for simpler and more accurate `\text{}` content handling.
    *   `generateNodeId` made module-private, constructors ensure unique IDs.
*   **Serializer (`serializer.ts`):**
    *   Adjusted for `TextEnvNode.rawText`.
    *   Enhanced "smart bracing" for `SupSubNode` to produce more natural LaTeX (e.g., `x^2` instead of `x^{{}}` for empty group arguments).
*   **Zipper (`zipper.ts`):**
    *   `toAST` method corrected to use AST constructors (`A.create<Type>Node`) instead of attempting to call a non-exported `A.generateNodeId`, resolving a `TypeError`.
    *   Refined span calculation in `toAST` for reconstructed sequence parents.
    *   Improved handling of `TextEnvNode` (with `rawText` model) in `toAST` and `up`/`down` to avoid inconsistencies, adding warnings if encountered.
    *   Updated `Crumb` types and related functions (`down`, `left`, `right`, `insert`, `delete`) to correctly handle `MatrixEnvNode` (whose children are rows) and `MatrixRowNode`.

### Fixed

*   **Critical Parser Bug (Test Case 8):** Matrix parsing failed for cells containing commands like `\alpha` or other complex structures. Fixed by o4-mini's patch and further refinement of `matrixEnv` logic in `parser.ts`.
*   **`\text{}` Space Handling:** `TextEnvNode` now correctly preserves spaces and all raw content.
*   **`TypeError` in `Zipper.toAST`:** Caused by incorrect attempt to call non-exported `generateNodeId`. Fixed by using AST constructors.
*   **ESM Execution Errors:** Resolved issues with running tests using `tsx` by ensuring correct `tsconfig.json` settings and (if needed by environment) explicit `.ts` extensions in imports.
*   **Initial `index.html` Content Loss:** Restored fuller UI structure from earlier mockups while integrating robust MathJax setup.

### Known Issues / To Be Addressed Next

*   **`MathEditor.ts` MML ID Correlation (`correlateAndAddIdsToMmlRecursive`):** This is the largest piece of incomplete logic. Needs systematic implementation for each AST node type to reliably map AST nodes to MathJax-rendered DOM elements.
*   **`MathEditor.ts` Caret Precision:** `calculateCharOffsetFromClick` and `updateVisualCaretPosition` are heuristic and need significant refinement for accurate, robust caret behavior.
*   **`MathEditor.ts` Editing Logic (`processKey`):** Only has very basic stubs. Full editing operations need to be implemented using the Zipper.
*   **`MathEditor.ts` AST Sync & Zipper Restoration:** After an edit, `processKey` currently does a full re-parse, and zipper focus restoration is naive (resets to root). This needs to be made efficient and user-friendly.
*   **True Incremental Parsing in `incremental.ts`:** `updateParse` is a fallback.

---