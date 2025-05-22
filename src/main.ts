// src/main.ts
import { MathEditor } from './editor/MathEditor';

document.addEventListener('DOMContentLoaded', () => {
    const editorContainer = document.getElementById('math-editor-container');
    if (editorContainer) {
        // Initial LaTeX content for the editor
        const initialLatex = "\\section{Introduction}\n\nLet's start with a classic: $e^{i\\pi} + 1 = 0$.\n\nAnd a fraction: \\frac{a^2+b_i}{c_k + d}\n\n\\text{Here is some text inside math mode.}\n\n\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}";
        
        try {
            new MathEditor('math-editor-container', initialLatex);
            console.log("MathEditor initialized.");
        } catch (e) {
            console.error("Failed to initialize MathEditor:", e);
            editorContainer.textContent = `Error initializing editor: ${e instanceof Error ? e.message : String(e)}`;
        }
    } else {
        console.error("Math editor container not found!");
    }
});