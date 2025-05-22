// src/core/latex-parser/zipper.ts
import * as A from './ast';
// No import from './serializer.ts' needed anymore

// --- Crumb Definition (Path Segments) ---
export type Crumb =
  | { kind: 'seq_parent'; parentId: string; parentKind: 'seq' | 'grp' | 'textenv' | 'mtrxrow'; leftSiblings: A.Node[]; rightSiblings: A.Node[]; span: A.Span; command?: string /* For textenv */ ; environment?: string /* For mtrxenv, but mtrxenv rows are direct children */ }
  | { kind: 'frac_parent_num'; parent: A.FracNode } 
  | { kind: 'frac_parent_den'; parent: A.FracNode } 
  | { kind: 'sqrt_parent_rad'; parent: A.SqrtNode } 
  | { kind: 'sqrt_parent_idx'; parent: A.SqrtNode } 
  | { kind: 'spsb_parent_base'; parent: A.SupSubNode }
  | { kind: 'spsb_parent_sup'; parent: A.SupSubNode }
  | { kind: 'spsb_parent_sub'; parent: A.SupSubNode }
  | { kind: 'mtrxenv_parent_row'; parent: A.MatrixEnvNode; leftSiblings: A.MatrixRowNode[]; rightSiblings: A.MatrixRowNode[]; parentId: string };

export type Path = Crumb[];

export interface Zipper {
  focus: A.Node;
  path: Path;
  charOffset?: number;
}

// --- Zipper Creation ---
export function fromAST(rootNode: A.Node, initialCharOffset?: number): Zipper {
  return { focus: rootNode, path: [], charOffset: initialCharOffset };
}

// --- AST Reconstruction from Zipper ---
export function toAST(zipper: Zipper): A.Node {
  let currentNode = zipper.focus;
  for (let i = zipper.path.length - 1; i >= 0; i--) {
    const crumb = zipper.path[i];
    let newParentNode: A.Node;

    let approxParentSpan: A.Span;
    if (crumb.kind === 'seq_parent') {
        approxParentSpan = crumb.span; 
    } else if (crumb.kind === 'mtrxenv_parent_row') {
        approxParentSpan = crumb.parent.span;
    } else { 
        approxParentSpan = crumb.parent.span; 
    }

    switch (crumb.kind) {
      case 'seq_parent':
        const children = [...crumb.leftSiblings, currentNode, ...crumb.rightSiblings];
        const startOffset = children[0]?.span.start ?? crumb.span.start;
        const endOffset = children[children.length-1]?.span.end ?? crumb.span.end;
        const calculatedSpan = A.createSpan(startOffset, endOffset);

        if (crumb.parentKind === 'seq') {
            newParentNode = A.createSeqNode(calculatedSpan, children);
        } else if (crumb.parentKind === 'grp') {
            newParentNode = A.createGroupNode(calculatedSpan, children);
        } else if (crumb.parentKind === 'textenv') {
            // If this case is hit, it means a TextEnvNode was treated as having Node children by 'down',
            // which contradicts the typical rawText model where getNodeChildren would be [].
            const command = crumb.command || "\\text";
            console.error(`toAST: Inconsistent state - Reconstructing TextEnvNode ('${command}') from a seq_parent crumb with Node children. TextEnvNode model uses rawText. This suggests an issue in how 'down' or 'getNodeChildren' handles TextEnvNode.`);
            // Fallback: create with empty raw text or throw.
            // Forcing children to text here would require serializer, which we are removing.
            // If children exist, it's a structural issue.
            newParentNode = A.createTextEnvNode(calculatedSpan, command, "[ERROR: Inconsistent TextEnv children]");
        } else if (crumb.parentKind === 'mtrxrow') {
            newParentNode = A.createMatrixRowNode(calculatedSpan, children);
        } else {
            const exhaustiveCheck: never = crumb.parentKind;
            throw new Error(`Unhandled parentKind in seq_parent crumb: ${exhaustiveCheck}`);
        }
        currentNode = newParentNode;
        break;
      // ... (other cases remain the same as your last version)
      case 'mtrxenv_parent_row':
        const matrixRows = [...crumb.leftSiblings, currentNode as A.MatrixRowNode, ...crumb.rightSiblings];
        newParentNode = A.createMatrixEnvNode(approxParentSpan, crumb.parent.environment, matrixRows);
        currentNode = newParentNode;
        break;
      case 'frac_parent_num':
        newParentNode = A.createFracNode(approxParentSpan, currentNode, crumb.parent.den);
        currentNode = newParentNode;
        break;
      case 'frac_parent_den':
        newParentNode = A.createFracNode(approxParentSpan, crumb.parent.num, currentNode);
        currentNode = newParentNode;
        break;
      case 'sqrt_parent_rad':
        newParentNode = A.createSqrtNode(approxParentSpan, currentNode, crumb.parent.idx);
        currentNode = newParentNode;
        break;
      case 'sqrt_parent_idx':
        newParentNode = A.createSqrtNode(approxParentSpan, crumb.parent.rad, currentNode);
        currentNode = newParentNode;
        break;
      case 'spsb_parent_base':
        newParentNode = A.createSupSubNode(approxParentSpan, currentNode, crumb.parent.sup, crumb.parent.sub);
        currentNode = newParentNode;
        break;
      case 'spsb_parent_sup':
        newParentNode = A.createSupSubNode(approxParentSpan, crumb.parent.base, currentNode, crumb.parent.sub);
        currentNode = newParentNode;
        break;
      case 'spsb_parent_sub':
        newParentNode = A.createSupSubNode(approxParentSpan, crumb.parent.base, crumb.parent.sup, currentNode);
        currentNode = newParentNode;
        break;
      default:
        const _exhaustiveCheck: never = crumb;
        throw new Error(`Unknown crumb kind in toAST: ${(_exhaustiveCheck as Crumb).kind}`);
    }
  }
  return currentNode;
}


// --- Navigation ---
export function up(zipper: Zipper): Zipper | null {
  if (zipper.path.length === 0) return null;

  const newPath = zipper.path.slice(0, -1);
  const lastCrumb = zipper.path[zipper.path.length - 1];
  let newFocus: A.Node;

  switch (lastCrumb.kind) {
    case 'seq_parent':
      const children = [...lastCrumb.leftSiblings, zipper.focus, ...lastCrumb.rightSiblings];
      const startOffset = children[0]?.span.start ?? lastCrumb.span.start;
      const endOffset = children[children.length-1]?.span.end ?? lastCrumb.span.end;
      const calculatedSpan = A.createSpan(startOffset, endOffset);
      if (lastCrumb.parentKind === 'seq') {
        newFocus = A.createSeqNode(calculatedSpan, children);
      } else if (lastCrumb.parentKind === 'grp') {
        newFocus = A.createGroupNode(calculatedSpan, children);
      } else if (lastCrumb.parentKind === 'textenv') {
        const command = lastCrumb.command || "\\text";
        console.error(`up: Inconsistent state - Reconstructing TextEnvNode ('${command}') from a seq_parent crumb with Node children. TextEnvNode model uses rawText.`);
        newFocus = A.createTextEnvNode(calculatedSpan, command, "[ERROR: Inconsistent TextEnv children]");
      } else if (lastCrumb.parentKind === 'mtrxrow') {
        newFocus = A.createMatrixRowNode(calculatedSpan, children);
      }
      else {
        const exhaustiveCheck: never = lastCrumb.parentKind;
        throw new Error(`Unhandled parentKind in up for seq_parent: ${exhaustiveCheck}`);
      }
      break;
    // ... (other cases remain the same as your last version)
    case 'mtrxenv_parent_row':
        const matrixRows = [...lastCrumb.leftSiblings, zipper.focus as A.MatrixRowNode, ...lastCrumb.rightSiblings];
        newFocus = A.createMatrixEnvNode(lastCrumb.parent.span, lastCrumb.parent.environment, matrixRows);
        break;
    case 'frac_parent_num': newFocus = A.createFracNode(lastCrumb.parent.span, zipper.focus, lastCrumb.parent.den); break;
    case 'frac_parent_den': newFocus = A.createFracNode(lastCrumb.parent.span, lastCrumb.parent.num, zipper.focus); break;
    case 'sqrt_parent_rad': newFocus = A.createSqrtNode(lastCrumb.parent.span, zipper.focus, lastCrumb.parent.idx); break;
    case 'sqrt_parent_idx': newFocus = A.createSqrtNode(lastCrumb.parent.span, lastCrumb.parent.rad, zipper.focus); break;
    case 'spsb_parent_base': newFocus = A.createSupSubNode(lastCrumb.parent.span, zipper.focus, lastCrumb.parent.sup, lastCrumb.parent.sub); break;
    case 'spsb_parent_sup': newFocus = A.createSupSubNode(lastCrumb.parent.span, lastCrumb.parent.base, zipper.focus, lastCrumb.parent.sub); break;
    case 'spsb_parent_sub': newFocus = A.createSupSubNode(lastCrumb.parent.span, lastCrumb.parent.base, lastCrumb.parent.sup, zipper.focus); break;
    default:
      const _exhaustiveCheck: never = lastCrumb;
      throw new Error(`Unknown crumb kind in 'up': ${(_exhaustiveCheck as Crumb).kind}`);
  }
  return { focus: newFocus, path: newPath, charOffset: undefined };
}

export function down(zipper: Zipper, childIndex: number): Zipper | null {
  const focusNode = zipper.focus;
  const focusChildren = A.getNodeChildren(focusNode); 
  
  if (focusNode.kind === 'textenv') {
      // For TextEnvNode with rawText, getNodeChildren should return [].
      // Thus, focusChildren.length will be 0, and the condition below will prevent 'down'.
      // No seq_parent crumb with parentKind 'textenv' holding Node children should be created.
      if (focusChildren.length === 0) {
          // console.log("Zipper 'down' attempted on TextEnvNode with rawText and no Node children. Returning null.");
          return null;
      }
      // If somehow focusChildren is not empty for TextEnvNode, it's an inconsistency.
      console.warn("Zipper 'down' into TextEnvNode: getNodeChildren returned non-empty array, which is inconsistent with rawText model if it's not supposed to have parsed children.");
  }

  if (childIndex < 0 || childIndex >= focusChildren.length) return null;

  const childToFocusOn = focusChildren[childIndex];
  let newCrumb: Crumb;

  switch (focusNode.kind) {
    case 'seq':
    case 'grp':
    case 'mtrxrow': 
      newCrumb = {
        kind: 'seq_parent',
        parentId: focusNode.id,
        parentKind: focusNode.kind,
        leftSiblings: focusChildren.slice(0, childIndex),
        rightSiblings: focusChildren.slice(childIndex + 1),
        span: focusNode.span
      };
      break;
    case 'textenv':
      // This path should ideally not be taken if TextEnvNode strictly uses rawText
      // and getNodeChildren returns [] (as handled by the check above).
      // If it is taken, a seq_parent crumb for textenv implies it held Node children.
      newCrumb = {
        kind: 'seq_parent',
        parentId: focusNode.id,
        parentKind: focusNode.kind, // Will be 'textenv'
        leftSiblings: focusChildren.slice(0, childIndex), // These would be Node children
        rightSiblings: focusChildren.slice(childIndex + 1),
        span: focusNode.span,
        command: focusNode.command 
      };
      break;
    // ... (other cases remain the same as your last version)
    case 'mtrxenv': 
        newCrumb = {
            kind: 'mtrxenv_parent_row',
            parent: focusNode,
            leftSiblings: focusChildren.slice(0, childIndex) as A.MatrixRowNode[],
            rightSiblings: focusChildren.slice(childIndex + 1) as A.MatrixRowNode[],
            parentId: focusNode.id,
        };
        break;
    case 'frac':
      if (childIndex === 0) newCrumb = { kind: 'frac_parent_num', parent: focusNode };
      else newCrumb = { kind: 'frac_parent_den', parent: focusNode };
      break;
    case 'sqrt':
      if (focusNode.idx && childIndex === 0) newCrumb = { kind: 'sqrt_parent_idx', parent: focusNode };
      else newCrumb = { kind: 'sqrt_parent_rad', parent: focusNode };
      break;
    case 'spsb':
      if (childIndex === 0) newCrumb = { kind: 'spsb_parent_base', parent: focusNode };
      else { 
          const actualChild = focusChildren[childIndex];
          if (focusNode.sup === actualChild) newCrumb = { kind: 'spsb_parent_sup', parent: focusNode };
          else if (focusNode.sub === actualChild) newCrumb = { kind: 'spsb_parent_sub', parent: focusNode };
          else return null; 
      }
      break;
    case 'sym': return null; 
    default:
      const _exhaustiveCheck: never = focusNode;
      throw new Error(`Unknown node kind for 'down': ${(_exhaustiveCheck as A.Node).kind}`);
  }

  return { focus: childToFocusOn, path: [...zipper.path, newCrumb], charOffset: (childToFocusOn.kind === 'sym' ? 0 : undefined) };
}

// ... (downToFirstChild, downToLastChild, left, right, replace, insertRight, insertLeft, deleteNode, modifySymNodeText)
// The rest of the functions from the previous version can remain as they are,
// as they don't involve the problematic TextEnvNode reconstruction with toLatex.
// Make sure they are consistent with the AST changes (e.g. MatrixRowNode in mtrxenv_parent_row).

export function downToFirstChild(zipper: Zipper): Zipper | null {
    return down(zipper, 0);
}

export function downToLastChild(zipper: Zipper): Zipper | null {
    const focusChildren = A.getNodeChildren(zipper.focus);
    if (!focusChildren || focusChildren.length === 0) return null;
    return down(zipper, focusChildren.length - 1);
}


export function left(zipper: Zipper): Zipper | null {
  if (zipper.path.length === 0) return null;
  const lastCrumb = zipper.path[zipper.path.length - 1];

  if (lastCrumb.kind === 'seq_parent' && lastCrumb.leftSiblings.length > 0) {
    const newFocus = lastCrumb.leftSiblings[lastCrumb.leftSiblings.length - 1];
    const newCrumb: Crumb = {
      ...lastCrumb,
      leftSiblings: lastCrumb.leftSiblings.slice(0, -1),
      rightSiblings: [zipper.focus, ...lastCrumb.rightSiblings],
    };
    return { focus: newFocus, path: [...zipper.path.slice(0, -1), newCrumb], charOffset: (newFocus.kind === 'sym' ? newFocus.text.length : undefined) };
  } else if (lastCrumb.kind === 'mtrxenv_parent_row' && lastCrumb.leftSiblings.length > 0) {
    const newFocus = lastCrumb.leftSiblings[lastCrumb.leftSiblings.length - 1];
    const newCrumb: Crumb = {
        ...lastCrumb,
        leftSiblings: lastCrumb.leftSiblings.slice(0, -1) as A.MatrixRowNode[],
        rightSiblings: [zipper.focus as A.MatrixRowNode, ...lastCrumb.rightSiblings] as A.MatrixRowNode[],
    };
    return { focus: newFocus, path: [...zipper.path.slice(0, -1), newCrumb], charOffset: undefined };
  }
  return null;
}

export function right(zipper: Zipper): Zipper | null {
  if (zipper.path.length === 0) return null;
  const lastCrumb = zipper.path[zipper.path.length - 1];

  if (lastCrumb.kind === 'seq_parent' && lastCrumb.rightSiblings.length > 0) {
    const newFocus = lastCrumb.rightSiblings[0];
    const newCrumb: Crumb = {
      ...lastCrumb,
      leftSiblings: [...lastCrumb.leftSiblings, zipper.focus],
      rightSiblings: lastCrumb.rightSiblings.slice(1),
    };
    return { focus: newFocus, path: [...zipper.path.slice(0, -1), newCrumb], charOffset: (newFocus.kind === 'sym' ? 0 : undefined) };
  } else if (lastCrumb.kind === 'mtrxenv_parent_row' && lastCrumb.rightSiblings.length > 0) {
    const newFocus = lastCrumb.rightSiblings[0];
    const newCrumb: Crumb = {
        ...lastCrumb,
        leftSiblings: [...lastCrumb.leftSiblings, zipper.focus as A.MatrixRowNode] as A.MatrixRowNode[],
        rightSiblings: lastCrumb.rightSiblings.slice(1) as A.MatrixRowNode[],
    };
    return { focus: newFocus, path: [...zipper.path.slice(0, -1), newCrumb], charOffset: undefined };
  }
  return null;
}

export function replace(zipper: Zipper, newNode: A.Node): Zipper {
  return { ...zipper, focus: newNode, charOffset: (newNode.kind === 'sym' ? 0 : undefined) };
}

export function insertRight(zipper: Zipper, newNode: A.Node): Zipper | null {
  if (zipper.path.length === 0) return null;
  const lastCrumb = zipper.path[zipper.path.length - 1];

  if (lastCrumb.kind === 'seq_parent') {
    const newCrumb: Crumb = {
      ...lastCrumb,
      rightSiblings: [newNode, ...lastCrumb.rightSiblings],
    };
    return { ...zipper, path: [...zipper.path.slice(0, -1), newCrumb] };
  } else if (lastCrumb.kind === 'mtrxenv_parent_row') {
    if (newNode.kind !== 'mtrxrow') return null; 
    const newCrumb: Crumb = {
        ...lastCrumb,
        rightSiblings: [newNode, ...lastCrumb.rightSiblings] as A.MatrixRowNode[],
    };
    return { ...zipper, path: [...zipper.path.slice(0, -1), newCrumb] };
  }
  return null;
}

export function insertLeft(zipper: Zipper, newNode: A.Node): Zipper | null {
    if (zipper.path.length === 0) return null;
    const lastCrumb = zipper.path[zipper.path.length - 1];

    if (lastCrumb.kind === 'seq_parent') {
        const newCrumb: Crumb = {
            ...lastCrumb,
            leftSiblings: [...lastCrumb.leftSiblings, newNode],
        };
        return { ...zipper, path: [...zipper.path.slice(0, -1), newCrumb] };
    } else if (lastCrumb.kind === 'mtrxenv_parent_row') {
        if (newNode.kind !== 'mtrxrow') return null;
        const newCrumb: Crumb = {
            ...lastCrumb,
            leftSiblings: [...lastCrumb.leftSiblings, newNode] as A.MatrixRowNode[],
        };
        return { ...zipper, path: [...zipper.path.slice(0, -1), newCrumb] };
    }
    return null;
}

export function deleteNode(zipper: Zipper): Zipper | null {
  if (zipper.path.length === 0) {
    const span = A.createSpan(zipper.focus.span.start, zipper.focus.span.start);
    return fromAST(A.createSeqNode(span, []));
  }

  const lastCrumb = zipper.path[zipper.path.length - 1];
  const newPath = zipper.path.slice(0, -1);

  if (lastCrumb.kind === 'seq_parent') {
    if (lastCrumb.rightSiblings.length > 0) {
      const newFocus = lastCrumb.rightSiblings[0];
      const newCrumb: Crumb = { ...lastCrumb, rightSiblings: lastCrumb.rightSiblings.slice(1) };
      return { focus: newFocus, path: [...newPath, newCrumb], charOffset: (newFocus.kind === 'sym' ? 0 : undefined) };
    } else if (lastCrumb.leftSiblings.length > 0) {
      const newFocus = lastCrumb.leftSiblings[lastCrumb.leftSiblings.length - 1];
      const newCrumb: Crumb = { ...lastCrumb, leftSiblings: lastCrumb.leftSiblings.slice(0, -1) };
      return { focus: newFocus, path: [...newPath, newCrumb], charOffset: (newFocus.kind === 'sym' ? newFocus.text.length : undefined) };
    } else { 
      let parentNode: A.Node;
      if (lastCrumb.parentKind === 'seq') parentNode = A.createSeqNode(lastCrumb.span, []);
      else if (lastCrumb.parentKind === 'grp') parentNode = A.createGroupNode(lastCrumb.span, []);
      else if (lastCrumb.parentKind === 'textenv') {
          const command = lastCrumb.command || "\\text";
          parentNode = A.createTextEnvNode(lastCrumb.span, command, ""); 
      } else if (lastCrumb.parentKind === 'mtrxrow') {
          parentNode = A.createMatrixRowNode(lastCrumb.span, []);
      } else {
          const exc: never = lastCrumb.parentKind; throw new Error(`Unhandled parent kind: ${exc}`);
      }
      return { focus: parentNode, path: newPath, charOffset: undefined };
    }
  } else if (lastCrumb.kind === 'mtrxenv_parent_row') {
    if (lastCrumb.rightSiblings.length > 0) {
        const newFocus = lastCrumb.rightSiblings[0];
        const newCrumb: Crumb = { ...lastCrumb, rightSiblings: lastCrumb.rightSiblings.slice(1) as A.MatrixRowNode[] };
        return { focus: newFocus, path: [...newPath, newCrumb], charOffset: undefined };
    } else if (lastCrumb.leftSiblings.length > 0) {
        const newFocus = lastCrumb.leftSiblings[lastCrumb.leftSiblings.length - 1]; // Corrected typo here
        const newCrumb: Crumb = { ...lastCrumb, leftSiblings: lastCrumb.leftSiblings.slice(0, -1) as A.MatrixRowNode[] };
        return { focus: newFocus, path: [...newPath, newCrumb], charOffset: undefined };
    } else { 
        const parentNode = A.createMatrixEnvNode(lastCrumb.parent.span, lastCrumb.parent.environment, []);
        return { focus: parentNode, path: newPath, charOffset: undefined };
    }
  } else { 
    const placeholderSpan = A.createSpan(zipper.focus.span.start, zipper.focus.span.start); 
    const placeholder = A.createSymNode(placeholderSpan, ""); 
    let parentFocus: A.Node;
    switch (lastCrumb.kind) {
        case 'frac_parent_num': parentFocus = A.createFracNode(lastCrumb.parent.span, placeholder, lastCrumb.parent.den); break;
        case 'frac_parent_den': parentFocus = A.createFracNode(lastCrumb.parent.span, lastCrumb.parent.num, placeholder); break;
        case 'sqrt_parent_rad': parentFocus = A.createSqrtNode(lastCrumb.parent.span, placeholder, lastCrumb.parent.idx); break;
        case 'sqrt_parent_idx': parentFocus = A.createSqrtNode(lastCrumb.parent.span, lastCrumb.parent.rad, undefined); break; 
        case 'spsb_parent_base': parentFocus = A.createSupSubNode(lastCrumb.parent.span, placeholder, lastCrumb.parent.sup, lastCrumb.parent.sub); break;
        case 'spsb_parent_sup': parentFocus = A.createSupSubNode(lastCrumb.parent.span, lastCrumb.parent.base, undefined, lastCrumb.parent.sub); break;
        case 'spsb_parent_sub': parentFocus = A.createSupSubNode(lastCrumb.parent.span, lastCrumb.parent.base, lastCrumb.parent.sup, undefined); break;
        default:
            const exc: never = lastCrumb; throw new Error(`Unhandled fixed child deletion: ${(exc as Crumb).kind}`);
    }
    return { focus: parentFocus, path: newPath, charOffset: undefined };
  }
}

export function modifySymNodeText(zipper: Zipper, newText: string, newCharOffset?: number): Zipper | null {
    if (zipper.focus.kind !== 'sym') return null;
    const newFocus = A.createSymNode(
        A.createSpan(zipper.focus.span.start, zipper.focus.span.start + newText.length), 
        newText
    );
    newFocus.id = zipper.focus.id;

    return {
        ...zipper,
        focus: newFocus,
        charOffset: newCharOffset !== undefined ? newCharOffset : (zipper.charOffset !== undefined ? Math.min(zipper.charOffset, newText.length) : newText.length)
    };
}