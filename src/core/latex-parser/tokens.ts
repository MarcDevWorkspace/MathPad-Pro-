// src/core/latex-parser/tokens.ts
export interface SourceLocation {
    offset: number;
    line: number;   // 1-indexed
    column: number; // 1-indexed
}

export interface TokenSpan {
    start: number; // offset
    end: number;   // offset
}

export enum TokKind {
  LBrace, RBrace, LBrack, RBrack, // {} []
  Backslash,                      // \ (lone, if not part of a command)
  Command,                        // \cmd, \alpha, \{, etc.
  Caret, Underscore,              // ^ _
  Ampersand, DoubleBackslash,     // & \\
  Text,                           // abc, 123, + (if not special)
  Whitespace,                     // spaces, tabs, newlines (consolidated)
  Comment,                        // % ...
  EOF
}
export interface Token {
    kind: TokKind;
    text: string; // The raw text of the token
    span: TokenSpan;
    loc: {
        start: SourceLocation;
        end: SourceLocation;
    };
}

// Utility to calculate SourceLocation from an offset
export function calculateSourceLocation(fullSource: string, offset: number, precomputedLineStarts?: number[]): SourceLocation {
    if (offset < 0) offset = 0;
    if (offset > fullSource.length) offset = fullSource.length;

    let line = 1;
    let lineStartOffset = 0;

    if (precomputedLineStarts) {
        // Binary search or linear scan for the line
        let foundLine = false;
        for (let i = precomputedLineStarts.length - 1; i >= 0; i--) {
            if (offset >= precomputedLineStarts[i]) {
                line = i + 1;
                lineStartOffset = precomputedLineStarts[i];
                foundLine = true;
                break;
            }
        }
        if (!foundLine && precomputedLineStarts.length > 0) { // Should not happen if offset is valid
             line = 1; lineStartOffset = 0;
        } else if (precomputedLineStarts.length === 0) {
             line = 1; lineStartOffset = 0;
        }

    } else { // Fallback if lineStarts not provided (slower)
        for (let i = 0; i < offset; i++) {
            if (fullSource[i] === '\n') {
                line++;
                lineStartOffset = i + 1;
            }
        }
    }
    const column = offset - lineStartOffset + 1;
    return { offset, line, column };
}