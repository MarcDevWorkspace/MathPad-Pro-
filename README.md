# MathPad Pro: A LaTeX-Based WYSIWYG Math Editor

**Version:** 0.1.0 (Alpha - Parser Core Stable, UI Under Development)
**License:** MIT
**Lead Developer (AI):** Gemini (via collaborative prompting with user)
**Project Goal:** To create a production-grade, mobile-first, offline-capable WYSIWYG math editor that uses LaTeX as its underlying document model, providing an intuitive user experience while retaining the power and formality of LaTeX.

## Overview

MathPad Pro aims to bridge the gap between the ease-of-use of WYSIWYG editors and the precision of LaTeX for mathematical and technical document creation, specifically tailored for phone formats. Users interact with a visual interface, and their actions are translated into valid LaTeX in the background. The rendered output is handled by MathJax.

This project represents a significant technical challenge, involving the development of a custom LaTeX parser, a sophisticated Abstract Syntax Tree (AST) manipulation layer (Zipper), and a complex rendering and interaction bridge for the WYSIWYG experience.

## Current State (as of 2025-05-23)

*   **Parser Core (TypeScript):**
    *   A robust, custom LaTeX parser has been developed and extensively tested.
    *   **Supported LaTeX Grammar (Math Mode):**
        *   Basic symbols, numbers, and text (e.g., `a`, `1`, `+`, `abc`).
        *   Grouped expressions: `{...}`.
        *   Fractions: `\frac{numerator}{denominator}`.
        *   Square roots: `\sqrt[index]{radicand}` (index is optional).
        *   Superscripts and Subscripts: `base^{superscript}`, `base_{subscript}`, including combined (`x^a_b`) and out-of-order parsing (`x_b^a`).
        *   Text environments: `\text{raw text with spaces}`, `\mathrm{...}`, etc. (captures raw text).
        *   Matrix environments: `\begin{matrix/pmatrix/bmatrix/vmatrix} ... & ... \\ ... \end{matrix}` with complex cell content.
    *   **Features:**
        *   Generates a detailed Abstract Syntax Tree (AST) with unique node IDs and source span information.
        *   Handles whitespace and comments correctly for math mode.
        *   Provides informative error messages with location data (line, column, offset).
        *   Unknown LaTeX commands are treated as symbolic nodes (`SymNode`).
    *   **Testing:** Successfully passes a comprehensive suite of 49 test cases covering valid syntax, edge cases, and expected error conditions.
*   **Serializer:** Converts the AST back into a canonical LaTeX string, including smart bracing for scripts.
*   **Zipper (`Zipper.ts`):** A functional immutable data structure for navigating and modifying the AST. Supports `up`, `down`, `left`, `right`, `replace`, `insert`, `delete`, and `modifySymNodeText`. Successfully passes its own test suite.
*   **Incremental Parsing Stub (`incremental.ts`):**
    *   `SourceStore` interface and a simple string-based implementation.
    *   `initialParse()` function successfully uses the parser core.
    *   `updateParse()` function is a stub that currently performs a full re-parse (fallback mechanism). True incremental parsing is a future task.
*   **`MathEditor.ts` (UI/Interaction - Initial Draft):**
    *   Basic class structure is in place.
    *   Initializes by parsing input LaTeX and setting up a Zipper.
    *   Contains a `renderAndMap` method that:
        *   Serializes the AST to LaTeX.
        *   Uses MathJax (via `tex2mml`, manual MML DOM modification for `data-ast-id` injection, then `mml2chtml` and MathJax document rendering) to display the math. This MML ID injection part is **highly experimental and the most complex part currently under development.**
        *   Aims to build a map from AST node IDs to rendered DOM elements.
    *   Basic `handleClick` logic to update the Zipper based on clicked elements (identified by `data-ast-id`).
    *   Basic `updateVisualCaretPosition` logic to show a DOM-based caret.
    *   Rudimentary `processKey` stubs for character input, backspace, and arrow keys.
    *   **Current Status:** Experimental. The core challenge is perfecting the `correlateAndAddIdsToMmlRecursive` function for robust AST-to-DOM mapping. Basic rendering and click-to-focus are the immediate next targets for stabilization.
*   **Build System & Testing:**
    *   `tsconfig.json` configured for modern ESM TypeScript.
    *   `package.json` with scripts for `esbuild` (bundling for browser) and `tsx` (running tests).
    *   `http-server` for serving the application locally.

## Project Philosophy & Heuristics

*   **LaTeX as the Source of Truth:** The internal document model is fundamentally LaTeX. The WYSIWYG interface is a view/controller.
*   **Hidden Complexity:** Users should have an intuitive experience. The translation to/from LaTeX is a background process.
*   **Structure-Aware Editing:** The parser and zipper enable editing based on the logical structure of the math, not just as a flat text string.
*   **Mobile-First Design (Intended):** UI/UX decisions will prioritize phone usability.
*   **Immutability:** AST manipulations via the Zipper are immutable, facilitating state management (e.g., undo/redo).
*   **Incrementalism (Goal):** While `updateParse` is currently a full re-parse, the long-term goal for performance is true incremental lexing, parsing, and rendering.
*   **Robust Error Handling:** The parser aims to provide clear error messages. The editor should degrade gracefully.

## Getting Started / Running the Project

1.  **Prerequisites:**
    *   Node.js (v18+ recommended for ESM features)
    *   npm or yarn

2.  **Clone the Repository (if applicable)**

3.  **Install Dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```

4.  **Run Tests (Recommended):**
    *   Test the parser: `npm run test:parser`
    *   Test the zipper: `npm run test:zipper`

5.  **Run Development Server:**
    *   In one terminal, start the `esbuild` watcher and bundler:
        ```bash
        npm run dev
        ```
    *   In a second terminal, start the HTTP server:
        ```bash
        npm run serve
        ```
    *   Open the provided URL (usually `http://localhost:8080`) in your browser.

6.  **Build for Production:**
    ```bash
    npm run build
    ```
    This will create optimized files in `public/dist/`. These files can then be deployed to any static web hosting.

## Key Technologies

*   **TypeScript:** For type safety and robust code.
*   **LaTeX:** As the underlying document representation.
*   **MathJax v3:** For rendering LaTeX into beautiful, accessible mathematics in the browser.
*   **esbuild:** For fast TypeScript/JavaScript bundling.
*   **tsx:** For running TypeScript files directly (used for tests).
*   **HTML/CSS/JavaScript:** For the application shell and UI.
*   **(No specific UI framework like React/Vue/Svelte is used yet; current UI is vanilla JS/DOM manipulation within `MathEditor.ts`)**

## Future Roadmap (High-Level)

1.  **Stabilize `MathEditor.ts`:**
    *   **Perfect MML ID Injection:** Make `correlateAndAddIdsToMmlRecursive` robust for all supported AST nodes. This is the **highest immediate priority**.
    *   **Accurate Caret Positioning:** Improve `calculateCharOffsetFromClick` and `updateVisualCaretPosition` for precise caret behavior within and around all math structures.
    *   **Implement `processKey`:** Full handling for character input, backspace, delete, arrow key navigation (including structural navigation like moving between numerator/denominator), and basic structure insertion (e.g., typing `/` creates a fraction).
2.  **Built-in Virtual Keyboard:**
    *   Design and implement a context-aware virtual keyboard.
    *   Integrate keyboard actions with `MathEditor.ts`'s `processKey` or similar methods.
    *   Allow keyboard customization.
3.  **True Incremental Parsing (`updateParse`):**
    *   Implement efficient incremental lexing and parsing to avoid full re-parse on every keystroke. This will involve diffing, identifying minimal change regions, and patching the AST.
4.  **WYSIWYG Structural Commands:**
    *   UI for inserting LaTeX structural elements beyond just math (e.g., `\section`, `\itemize`) and integrating them into the AST and document model.
    *   This will require extending the parser beyond just math mode.
5.  **File Management:**
    *   Saving/loading documents (local storage, file system access if in an environment like Electron or PWA with file system APIs).
6.  **Undo/Redo:** Implement using snapshots of `IncrementalParseState` or command pattern.
7.  **Advanced Editing Features:**
    *   Text styling (size, color - potentially via custom commands or environments).
    *   Image insertion.
8.  **PDF/LaTeX Export:**
    *   Generate a complete LaTeX document string (including preamble).
    *   Integrate a client-side (WASM-based like Tectonic) or server-side LaTeX compilation process.
9.  **Mobile UI/UX Polish:** Refine all interactions for touchscreens.
10. **Offline Capability:** Service workers, local caching of assets.

## Contributing

This project is open source (MIT License). Contributions are welcome once the initial core is more stable. (Details on contribution guidelines to be added later).

## Acknowledgements

*   **o3-pro & o4-mini (Conceptual AI agents):** For providing foundational parser structure ideas and targeted patches that significantly accelerated development.
*   **MathJax Team:** For the incredible MathJax library.
*   The broader open-source community.