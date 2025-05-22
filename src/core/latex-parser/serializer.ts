// src/core/latex-parser/serializer.ts
import * as A from './ast';

export function toLatex(n: A.Node): string {
  switch (n.kind) {
    case 'seq': 
      return n.children.map(toLatex).join('');
    case 'grp': 
      // If a group node has no children, it serializes to "{}"
      // This is important for the SupSubNode check below.
      if (n.children.length === 0) {
        return '{}';
      }
      return '{' + n.children.map(toLatex).join('') + '}';
    case 'frac': 
      // Ensure arguments are properly wrapped if they are not single tokens or braced groups
      // The parser.argument() currently produces single SymNode or GroupNode.
      // If it's a SymNode, toLatex(SymNode) is fine. If GroupNode, toLatex handles braces.
      // More complex structures might require adding braces here if not already grouped.
      // e.g. \frac \alpha \beta -> \frac{\alpha}{\beta} is not strictly needed as parser makes sym nodes
      // but \frac{1+2}{3} parser would make GroupNode for 1+2.
      // For now, assuming argument parser gives appropriate single nodes or groups.
      return '\\frac' + toLatex(n.num) + toLatex(n.den);
    case 'sqrt':
      const idxStr = n.idx ? `[${toLatex(n.idx)}]` : '';
      // Similar to frac, ensure radicand is properly wrapped if needed.
      return `\\sqrt${idxStr}${toLatex(n.rad)}`;
    case 'spsb':
      let res = toLatex(n.base);
      if (n.sup) {
          const supLatex = toLatex(n.sup);
          if (supLatex === "{}") { // Check if the argument serialized to an empty group
              res += "^{}";
          } else if (n.sup.kind === 'sym' && n.sup.text.length === 1 && !n.sup.text.startsWith('\\') && n.sup.text !== '{' && n.sup.text !== '}') {
              // Ensure single char is not a brace itself if unbraced
              res += `^${supLatex}`;
          } else {
              res += `^{${supLatex}}`;
          }
      }
      if (n.sub) {
          const subLatex = toLatex(n.sub);
          if (subLatex === "{}") { // Check if the argument serialized to an empty group
              res += "_{}";
          } else if (n.sub.kind === 'sym' && n.sub.text.length === 1 && !n.sub.text.startsWith('\\') && n.sub.text !== '{' && n.sub.text !== '}') {
              // Ensure single char is not a brace itself if unbraced
              res += `_${subLatex}`;
          } else {
              res += `_{${subLatex}}`;
          }
      }
      return res;
    case 'sym': 
      return n.text;
    
    case 'textenv': // For \text{raw content}
      return `${n.command}{${n.rawText}}`; 
    
    case 'mtrxrow':
      return n.children.map(toLatex).join(' & ');
    case 'mtrxenv':
      const rowsStr = n.rows.map(toLatex).join(' \\\\\n');
      return `\\begin{${n.environment}}\n${rowsStr}\n\\end{${n.environment}}`;
    default:
      const exhaustiveCheck: never = n;
      throw new Error(`Unknown node kind for serialization: ${(exhaustiveCheck as A.Node).kind}`);
  }
}