// src/core/latex-parser/parser.ts
import { Lexer } from './lexer.ts'; // Assuming .ts extension if your setup requires it
import { TokKind as K, Token, SourceLocation } from './tokens.ts'; // Or token.ts
import * as A from './ast.ts';

export class Parser {
  private look!: Token;
  private lastConsumedTokenEndLoc!: SourceLocation;

  constructor(private lex: Lexer) {
    this.advanceToken(); // Prime the lookahead
    // Initialize lastConsumedTokenEndLoc for cases where no token is consumed before error
    // or for the very start of parsing.
    this.lastConsumedTokenEndLoc = this.look ? this.look.loc.start : { offset: 0, line: 1, column: 1 };
  }

  private advanceToken(): void {
    if (this.look) {
        // Before advancing, the end of the current lookahead is conceptually the end of the "last consumed"
        this.lastConsumedTokenEndLoc = this.look.loc.end;
    }
    this.look = this.lex.next();
    // Skip whitespace and comments automatically
    while (this.look.kind === K.Whitespace || this.look.kind === K.Comment) {
      this.lastConsumedTokenEndLoc = this.look.loc.end; // Update for skipped tokens too
      this.look = this.lex.next();
    }
  }

  private consume(expectedKind: K, errorMessage?: string): Token {
    const currentToken = this.look;
    if (currentToken.kind !== expectedKind) {
      this.throwError(errorMessage || `Expected token ${K[expectedKind]}, but found ${K[currentToken.kind]} ('${currentToken.text}')`);
    }
    this.advanceToken();
    return currentToken;
  }

  private consumeCommand(expectedCommandText: string, errorMessage?: string): Token {
    const currentToken = this.look;
    if (currentToken.kind !== K.Command || currentToken.text !== expectedCommandText) {
      this.throwError(errorMessage || `Expected command '${expectedCommandText}', but found ${K[currentToken.kind]} ('${currentToken.text}')`);
    }
    this.advanceToken();
    return currentToken;
  }
  
  private consumeText(expectedText?: string, errorMessage?: string): Token {
    const currentToken = this.look;
    if (currentToken.kind !== K.Text) {
        this.throwError(errorMessage || `Expected text content, but found ${K[currentToken.kind]} ('${currentToken.text}')`);
    }
    if (expectedText !== undefined && currentToken.text !== expectedText) {
        this.throwError(errorMessage || `Expected text '${expectedText}', but found '${currentToken.text}'`);
    }
    this.advanceToken();
    return currentToken;
  }

  private createNodeSpan(startEntity: Token | A.Node, endEntity: Token | A.Node): A.Span {
      const start = (startEntity as Token).span ? (startEntity as Token).span.start : (startEntity as A.Node).span.start;
      const end = (endEntity as Token).span ? (endEntity as Token).span.end : (endEntity as A.Node).span.end;
      return A.createSpan(start, end);
  }
   private createNodeSpanFromPos(startPos: number, endPos: number): A.Span {
      return A.createSpan(startPos, endPos);
  }

  parse(): A.Node {
    const startLoc = this.look.loc.start;
    const body = this.sequence([K.EOF]); // Root sequence expects EOF as a stop token
    
    let rootSpan: A.Span;
    if ((body as A.SeqNode).children.length > 0) {
        const children = (body as A.SeqNode).children;
        rootSpan = this.createNodeSpan(children[0], children[children.length - 1]);
    } else {
        // If entire input is empty or only comments/whitespace, span is zero-width at start
        rootSpan = A.createSpan(startLoc.offset, startLoc.offset);
    }
    // Ensure the root SeqNode itself has its span updated if it was modified (e.g. by children)
    // The createSeqNode should handle its own span correctly based on children or start/end pos.
    // Here, we ensure the top-level sequence node from parse() has a span covering all content.
    if (body.kind === 'seq') {
        body.span = rootSpan;
    }
    return body;
  }

  private sequence(stopTokens: K[]): A.Node {
    const kids: A.Node[] = [];
    const seqStartLoc = this.look.loc.start;

    while (!stopTokens.includes(this.look.kind) && this.look.kind !== K.EOF) {
      kids.push(this.term());
    }
    
    let seqSpan: A.Span;
    if (kids.length > 0) {
        seqSpan = this.createNodeSpan(kids[0], kids[kids.length-1]);
    } else {
        seqSpan = A.createSpan(seqStartLoc.offset, seqStartLoc.offset); // Zero-width span for empty sequence
    }
    return A.createSeqNode(seqSpan, kids);
  }

  private term(): A.Node {
    const currentToken = this.look;
    switch (currentToken.kind) {
      case K.Command:
        if (currentToken.text === '\\frac') return this.fraction();
        if (currentToken.text === '\\sqrt') return this.sqrt();
        if (currentToken.text === '\\text' || currentToken.text === '\\mathrm') return this.textEnv(currentToken);
        if (currentToken.text === '\\begin') return this.beginEnv(currentToken);
        return this.symbolOrSupSub(); // Handles commands like \alpha, \beta as bases

      case K.LBrace:
        return this.group();

      case K.Text:
        return this.symbolOrSupSub();
      
      case K.Caret: case K.Underscore: case K.Ampersand:
      case K.DoubleBackslash: case K.Backslash:
        this.advanceToken();
        return A.createSymNode(currentToken.span, currentToken.text);

      default:
        this.throwError(`Unexpected token ${K[currentToken.kind]} ('${currentToken.text}') when expecting a term.`);
        // Unreachable due to throwError, but for TS completeness:
        return A.createSymNode(currentToken.span, "ERROR_UNEXPECTED_TERM_TOKEN"); 
    }
  }
  
  private group(): A.Node {
    const startTok = this.consume(K.LBrace);
    const body = this.sequence([K.RBrace]);
    const endTok = this.consume(K.RBrace, "Expected '}' to close group.");
    return A.createGroupNode(
      this.createNodeSpan(startTok, endTok),
      (body as A.SeqNode).children
    );
  }

  private symbolOrSupSub(): A.Node {
    let baseNode: A.Node;
    const baseToken = this.look;

    if (baseToken.kind === K.LBrace) {
        baseNode = this.group();
    } else if (baseToken.kind === K.Text || baseToken.kind === K.Command) {
        this.advanceToken();
        baseNode = A.createSymNode(baseToken.span, baseToken.text);
    } else {
        this.throwError(`Expected a symbol, command, or group as base for super/subscript, got ${K[baseToken.kind]}`);
        this.advanceToken(); baseNode = A.createSymNode(baseToken.span, "ERROR_BASE"); // Unreachable
    }

    let supNode: A.Node | undefined;
    let subNode: A.Node | undefined;
    let lastNodeForSpan = baseNode;

    let changedInIteration = true;
    while(changedInIteration) {
        changedInIteration = false;
        if (!supNode && this.look.kind === K.Caret) {
            this.consume(K.Caret);
            supNode = this.argument();
            lastNodeForSpan = supNode;
            changedInIteration = true;
        }
        if (!subNode && this.look.kind === K.Underscore) {
            this.consume(K.Underscore);
            subNode = this.argument();
            // Update lastNodeForSpan only if subNode is physically later or same as current last
            if (subNode.span.end >= lastNodeForSpan.span.end) {
                lastNodeForSpan = subNode;
            }
            changedInIteration = true;
        }
    }

    if (supNode || subNode) {
      return A.createSupSubNode(this.createNodeSpan(baseNode, lastNodeForSpan), baseNode, supNode, subNode);
    }
    return baseNode;
  }

  private argument(): A.Node {
    const lookToken = this.look;
    if (lookToken.kind === K.LBrace) {
      return this.group();
    } else if (lookToken.kind === K.Command || lookToken.kind === K.Text) {
      this.advanceToken();
      return A.createSymNode(lookToken.span, lookToken.text);
    } else {
      this.throwError(`Expected a group '{...}' or a single symbol/command as argument, got ${K[lookToken.kind]} ('${lookToken.text}')`);
      this.advanceToken(); return A.createSymNode(lookToken.span, "ERROR_ARG"); // Unreachable
    }
  }

  private fraction(): A.Node {
    const fracCmdToken = this.consumeCommand('\\frac');
    const num = this.argument();
    const den = this.argument();
    return A.createFracNode(this.createNodeSpan(fracCmdToken, den), num, den);
  }

  private sqrt(): A.Node {
    const sqrtCmdToken = this.consumeCommand('\\sqrt');
    let idxNode: A.Node | undefined;
    let endOfOptionalArgToken: Token | undefined;

    if (this.look.kind === K.LBrack) {
      this.consume(K.LBrack);
      idxNode = this.sequence([K.RBrack]);
      endOfOptionalArgToken = this.consume(K.RBrack, "Expected ']' for sqrt index.");
    }
    
    const radNode = this.argument();
    const endEntityForSpan = endOfOptionalArgToken ? 
                             ((endOfOptionalArgToken.span.end > radNode.span.end) ? endOfOptionalArgToken : radNode) : 
                             radNode;

    return A.createSqrtNode(this.createNodeSpan(sqrtCmdToken, endEntityForSpan), radNode, idxNode);
  }

  private textEnv(commandToken: Token): A.Node {
    this.consumeCommand(commandToken.text); // commandToken is \text, \mathrm, etc.

    const lbrace = this.consume(K.LBrace, `Command ${commandToken.text} expects a '{...}' argument.`);
    
    let rawText = "";
    const rawTextStartOffset = this.look.span.start; // Start of the content inside braces
    let nestLevel = 0;
    let lastTextTokenForSpanEnd = lbrace; // Fallback if rawText is empty

    // Manually advance lexer to capture raw tokens, including whitespace/comments if any
    // Stop when RBrace at nestLevel 0 is encountered, or EOF.
    while (!(this.look.kind === K.RBrace && nestLevel === 0) && this.look.kind !== K.EOF) {
        if (this.look.kind === K.LBrace) nestLevel++;
        else if (this.look.kind === K.RBrace) nestLevel--;
        
        // Append the *full text* of the current token (including its whitespace if lexer produced that)
        // The current lexer consolidates whitespace into K.Whitespace tokens.
        // If we want \text{ a b } to be " a b ", lexer should produce K.Text for 'a', K.Whitespace, K.Text for 'b'.
        // Our current lexer's next() gives us significant tokens.
        // The "raw advance" `this.look = this.lex.next()` in previous `textEnv` was to get *all* chars.
        // Let's adjust to use raw source slice for simplicity if lexer is skipping.
        // For now, assume lexer passes through all content tokens.
        rawText += this.srcSlice(this.look.span); // Use srcSlice to get exact text of the token
        lastTextTokenForSpanEnd = this.look;
        this.look = this.lex.next(); // Use raw lexer.next(), not this.advanceToken() which skips
    }

    if (this.look.kind !== K.RBrace || nestLevel !== 0) {
        this.throwError(`Unterminated argument for ${commandToken.text}. Missing '}'?`);
    }
    // At this point, this.look IS the RBrace. Consume it using the main advanceToken.
    const rbrace = this.consume(K.RBrace); 

    // Re-enable normal whitespace/comment skipping after raw text capture.
    // this.advanceToken(); // Not needed as consume() does it.

    return A.createTextEnvNode(
      this.createNodeSpan(commandToken, rbrace),
      commandToken.text,
      rawText
    );
}

  private beginEnv(beginCmdToken: Token): A.Node {
     this.consumeCommand('\\begin');
    this.consume(K.LBrace, "Expected '{' after \\begin.");
    
    const envNameToken = this.consumeText(undefined, "Expected environment name after \\begin{.");
    const envName = envNameToken.text;
    this.consume(K.RBrace, `Expected '}' after environment name '${envName}'.`);

    if (envName === 'matrix' || envName === 'pmatrix' || envName === 'bmatrix' || envName === 'vmatrix') {
      return this.matrixEnv(beginCmdToken, envNameToken);
    } else {
      this.throwError(`Unsupported environment: ${envName}`);
      // Unreachable:
      return A.createSymNode(this.createNodeSpan(beginCmdToken, this.look /*approx end*/), `Unsupported env: ${envName}`);
    }
  }

  // Using o4-mini's patched logic for matrixEnv
  private matrixEnv(beginCmdToken: Token, envNameToken: Token): A.Node {
    const envName = envNameToken.text;
    const rows: A.MatrixRowNode[] = [];
    let currentRowCells: A.Node[] = [];
    let currentRowContentStartOffset = this.look.loc.start.offset;
    let overallMatrixEndToken: Token = envNameToken; // For entire matrix span

    mainLoop: while (true) {
      if (this.look.kind === K.EOF) {
        this.throwError(`Unexpected EOF in matrix environment '${envName}'. Missing \\end{${envName}}?`);
      }
      
      // Check for \end{envName} first
      if (this.look.kind === K.Command && this.look.text === '\\end') {
        const endCmdStartToken = this.look; // For empty last row span
        this.consumeCommand('\\end');
        this.consume(K.LBrace, `Expected '{' after \\end for ${envName}.`);
        this.consumeText(envName, `Expected environment name '${envName}' after \\end{, got '${this.look.text}'.`);
        const endBraceToken = this.consume(K.RBrace, `Expected '}' after \\end{${envName}}.`);
        
        // Finalize any pending row
        if (currentRowCells.length > 0) {
          const lastCellInRow = currentRowCells[currentRowCells.length - 1];
          rows.push(A.createMatrixRowNode(
            A.createSpan(currentRowContentStartOffset, lastCellInRow.span.end), 
            currentRowCells
          ));
        } else if (rows.length > 0 || endCmdStartToken.span.start > currentRowContentStartOffset) {
            // This condition means the matrix had rows, and this \end might follow a \\ directly,
            // or it's the first \end after \begin (empty matrix).
            // Create span for empty row up to where \end started.
            rows.push(A.createMatrixRowNode(A.createSpan(currentRowContentStartOffset, endCmdStartToken.span.start), []));
        } else if (rows.length === 0 && currentRowCells.length === 0) {
            // Completely empty matrix: \begin{matrix}\end{matrix}
            // No rows to push, or push one empty row? LaTeX makes an empty row.
            rows.push(A.createMatrixRowNode(A.createSpan(currentRowContentStartOffset, endCmdStartToken.span.start), []));
        }
        overallMatrixEndToken = endBraceToken;
        break mainLoop;
      }

      // Parse one cell's content (stops at \end, &, \\, or EOF)
      let cellContentNode: A.Node;
      { // Block for o4-mini's inline sequence for cell
        const kids: A.Node[] = [];
        const seqStartLoc = this.look.loc.start;
        while (
          this.look.kind !== K.Ampersand &&
          this.look.kind !== K.DoubleBackslash &&
          !(this.look.kind === K.Command && this.look.text === '\\end') &&
          this.look.kind !== K.EOF
        ) {
          kids.push(this.term());
        }
        let seqSpan: A.Span;
        if (kids.length > 0) {
          seqSpan = this.createNodeSpan(kids[0], kids[kids.length - 1]);
        } else {
          // Empty cell content, span is zero-width at current location
          seqSpan = A.createSpan(seqStartLoc.offset, seqStartLoc.offset);
        }
        cellContentNode = A.createSeqNode(seqSpan, kids);
      }
      currentRowCells.push(cellContentNode);
      // Update overallMatrixEndToken to the end of what was just parsed for the cell,
      // or the separator that follows it.
      if (cellContentNode.span.end > overallMatrixEndToken.span.end) {
         // This update needs care. If cell is empty, this.look is the separator.
         // If cell has content, this.look is the separator.
         // overallMatrixEndToken should be the *consumed* separator or \end brace.
      }


      // Consume the separator or end-of-row marker
      if (this.look.kind === K.Ampersand) {
        overallMatrixEndToken = this.consume(K.Ampersand);
      } else if (this.look.kind === K.DoubleBackslash) {
        const tok = this.consume(K.DoubleBackslash);
        overallMatrixEndToken = tok;
        
        // Finish current row
        // Span of row ends at end of last cell, or if empty, before \\
        const lastCellOrRowStart = currentRowCells.length > 0 ? 
                                   currentRowCells[currentRowCells.length - 1].span.end : 
                                   currentRowContentStartOffset;
        // If currentRowCells is empty, its span is from currentRowContentStartOffset to just before \\
        const rowEndPos = currentRowCells.length > 0 ? 
                          currentRowCells[currentRowCells.length - 1].span.end : 
                          tok.span.start; // Row ends before the \\
        rows.push(A.createMatrixRowNode(
          A.createSpan(currentRowContentStartOffset, rowEndPos),
          currentRowCells
        ));
        currentRowCells = [];
        currentRowContentStartOffset = this.look.loc.start.offset; // For next row
      } else if (this.look.kind === K.Command && this.look.text === '\\end') {
        // Cell content finished, \end is next. Loop will handle it.
        // overallMatrixEndToken will be updated when \end is fully consumed.
      } else if (this.look.kind === K.EOF) {
        // Should be caught by the top of the loop. If here, it's after cell content.
        this.throwError(`Unexpected EOF after cell content in matrix '${envName}'. Missing \\end or separator?`);
      } else {
        // Any other token here is a real parse error after a cell's content
        this.throwError(`Unexpected token ${K[this.look.kind]} ('${this.look.text}') in matrix after cell. Expected '&', '\\\\', or '\\end'.`);
      }
    } // end mainLoop

    return A.createMatrixEnvNode(
      this.createNodeSpan(beginCmdToken, overallMatrixEndToken),
      envName,
      rows
    );
  }

  private srcSlice(s: A.Span){ return (this.lex as any).src.slice(s.start,s.end); } // Lexer needs to expose src or pass it

  private throwError(message: string): never {
    const loc = (this.look && this.look.kind !== K.EOF) ? this.look.loc.start : this.lastConsumedTokenEndLoc;
    const errorMessage = `Parse Error (Line ${loc.line}, Col ${loc.column}, Offset ${loc.offset}): ${message}`;
    const error = new Error(errorMessage);
    (error as any).location = loc;
    throw error;
  }
}