// src/core/latex-parser/index.ts
export * from './ast'; // Assuming ast.ts exists and exports Node etc.
export * from './tokens';
export { Lexer } from './lexer';
export { Parser } from './parser';
export { toLatex } from './serializer';
export * from './zipper';

// Updated export block for incremental.ts
export {
    initialParse,
    updateParse
    // SourceStore removed from here
} from './incremental.ts';

// Add this specifically for the type/interface
export type {
    IncrementalParseState,
    SourceStore // Add SourceStore here
} from './incremental.ts';


// Example main parse function using the full pipeline (non-incremental for now via initialParse)
import { Lexer as InternalLexer } from './lexer'; // Renaming to avoid conflict if Lexer is re-exported
import { Parser as InternalParser } from './parser';// Renaming to avoid conflict if Parser is re-exported
import { Node as ASTNode } from './ast'; // Assuming ast.ts exports Node

export function parseFull(latexString: string): ASTNode {
    const lexer = new InternalLexer(latexString);
    const parser = new InternalParser(lexer);
    return parser.parse();
}