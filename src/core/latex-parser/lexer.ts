// src/core/latex-parser/lexer.ts
import { TokKind as K, Token, SourceLocation, calculateSourceLocation } from './tokens'; // Assuming SourceLocation utils are in tokens.ts

export class Lexer {
  private pos = 0;
  private sourceLength: number;
  private line = 1;
  private column = 1;
  private lineStarts: number[] = [0]; // Start offset of each line

  constructor(private src: string) {
    this.sourceLength = src.length;
    // Pre-calculate line starts for faster location lookup
    for (let i = 0; i < src.length; i++) {
        if (src[i] === '\n') {
            this.lineStarts.push(i + 1);
        }
    }
  }

  private advance(count = 1): void {
    for (let i = 0; i < count && this.pos < this.sourceLength; i++) {
        if (this.src[this.pos] === '\n') {
            this.line++;
            this.column = 1;
        } else {
            this.column++;
        }
        this.pos++;
    }
  }

  private getCurrentLocation(offset: number): SourceLocation {
      return calculateSourceLocation(this.src, offset, this.lineStarts);
  }
  
  private createToken(kind: K, startOffset: number, text?: string): Token {
      const endOffset = this.pos;
      // For multi-char tokens, text is usually value. For single char, it might be omitted if derivable from kind.
      const tokenText = text !== undefined ? text : this.src.slice(startOffset, endOffset);
      return {
          kind,
          text: tokenText,
          span: { start: startOffset, end: endOffset },
          loc: {
              start: this.getCurrentLocation(startOffset), // Location at start of token
              end: this.getCurrentLocation(endOffset)      // Location at end of token
          }
      };
  }


  next(): Token {
    if (this.pos >= this.sourceLength) {
        const loc = this.getCurrentLocation(this.pos);
        return { kind: K.EOF, text: '', span: { start: this.pos, end: this.pos }, loc: {start: loc, end: loc} };
    }

    const startOffset = this.pos;
    const startLine = this.line;
    const startCol = this.column;

    const char = this.src[this.pos];

    // 1. Whitespace (consolidated)
    if (/\s/.test(char)) {
        this.advance(); // Consume the first whitespace char
        while (this.pos < this.sourceLength && /\s/.test(this.src[this.pos])) {
            this.advance();
        }
        return this.createToken(K.Whitespace, startOffset);
    }

    // 2. Single character tokens
    switch (char) {
      case '{': this.advance(); return this.createToken(K.LBrace, startOffset);
      case '}': this.advance(); return this.createToken(K.RBrace, startOffset);
      case '[': this.advance(); return this.createToken(K.LBrack, startOffset);
      case ']': this.advance(); return this.createToken(K.RBrack, startOffset);
      case '^': this.advance(); return this.createToken(K.Caret, startOffset);
      case '_': this.advance(); return this.createToken(K.Underscore, startOffset);
      case '&': this.advance(); return this.createToken(K.Ampersand, startOffset);
      case '%': // Comment
        this.advance(); // Consume '%'
        while(this.pos < this.sourceLength && this.src[this.pos] !== '\n') {
            this.advance();
        }
        return this.createToken(K.Comment, startOffset);
    }

    // 3. Backslash-initiated tokens (commands, \\)
    if (char === '\\') {
      this.advance(); // Consume '\'
      if (this.pos >= this.sourceLength) return this.createToken(K.Backslash, startOffset); // Lone backslash at EOF

      const nextChar = this.src[this.pos];
      if (nextChar === '\\') { // Double backslash
        this.advance();
        return this.createToken(K.DoubleBackslash, startOffset, '\\\\');
      }
      
      // Check for command (alphabetic)
      if (/[a-zA-Z]/.test(nextChar)) {
        let commandName = nextChar;
        this.advance(); // Consume first letter of command
        while (this.pos < this.sourceLength && /[a-zA-Z]/.test(this.src[this.pos])) {
          commandName += this.src[this.pos];
          this.advance();
        }
        return this.createToken(K.Command, startOffset, '\\' + commandName);
      }
      
      // Check for single non-alphabetic char command (e.g., \$, \% - though % is comment)
      // This can also be a symbol like +, (, etc.
      // \ followed by any other char is often that char itself (e.g. \{ is { ) or a named symbol
      this.advance(); // Consume the character after backslash
      return this.createToken(K.Command, startOffset, '\\' + nextChar); // Treat as command e.g. "\{" or "\%"
    }

    // 4. Default: Text (numbers, identifiers, operators not caught above)
    //    This will grab a sequence of non-special, non-whitespace characters.
    let textValue = char;
    this.advance(); // Consume the first char
    while (this.pos < this.sourceLength) {
        const currentChar = this.src[this.pos];
        if (/[{}\[\]^_\&%\s\\]/.test(currentChar)) { // Break on special LaTeX chars or whitespace
            break;
        }
        textValue += currentChar;
        this.advance();
    }
    return this.createToken(K.Text, startOffset, textValue);
  }
}