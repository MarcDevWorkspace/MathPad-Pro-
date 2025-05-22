// src/core/latex-parser/ast.ts

export interface Span { start: number; end: number }; // in UTF-16 code units

// --- Utility to generate unique IDs (simple version) ---
let nodeIdCounter = 0;
function generateNodeId(): string {
    return `node-${nodeIdCounter++}`;
}

export const createSpan = (start: number, end: number): Span => ({ start, end });

// --- Base Node ---
export interface BaseNode {
  kind: string;
  span: Span; // absolute in source buffer
  children?: Node[]; // General children access, specific accessors preferred
  id: string; // Unique ID for each node, useful for keying in UI and diffing
}

// --- Specific Node Types ---
export interface SeqNode extends BaseNode { kind: 'seq'; children: Node[] }
export interface GroupNode extends BaseNode { kind: 'grp'; children: Node[] }
export interface FracNode extends BaseNode {
  kind: 'frac';
  num: Node; // Numerator
  den: Node; // Denominator
}
export interface SqrtNode extends BaseNode {
  kind: 'sqrt';
  rad: Node; // Radicand
  idx?: Node; // Optional index (e.g., cube root)
}
export interface SupSubNode extends BaseNode {
  kind: 'spsb';
  base: Node;
  sup?: Node;
  sub?: Node;
}
export interface SymNode extends BaseNode { kind: 'sym'; text: string; }

// TextEnvNode to store raw text content for simplicity with \text
export interface TextEnvNode extends BaseNode {
  kind: 'textenv';
  command: string; // e.g., \text, \mathrm
  rawText: string; // The raw text content within the braces
  // No 'children: Node[]' if using rawText model primarily
}
export interface MatrixRowNode extends BaseNode { kind: 'mtrxrow'; children: Node[]; }
export interface MatrixEnvNode extends BaseNode { kind: 'mtrxenv'; rows: MatrixRowNode[]; environment: string; }

// --- Node Union Type ---
export type Node =
  | SeqNode | GroupNode | FracNode | SqrtNode
  | SupSubNode | SymNode | TextEnvNode
  | MatrixRowNode | MatrixEnvNode;

// --- Constructor Helpers (with ID generation) ---
export const createSeqNode = (span: Span, children: Node[]): SeqNode => (
    { id: generateNodeId(), kind: 'seq', span, children }
);
export const createGroupNode = (span: Span, children: Node[]): GroupNode => (
    { id: generateNodeId(), kind: 'grp', span, children }
);
export const createFracNode = (span: Span, num: Node, den: Node): FracNode => (
    { id: generateNodeId(), kind: 'frac', span, num, den }
);
export const createSqrtNode = (span: Span, rad: Node, idx?: Node): SqrtNode => (
    { id: generateNodeId(), kind: 'sqrt', span, rad, idx }
);
export const createSupSubNode = (span: Span, base: Node, sup?: Node, sub?: Node): SupSubNode => (
    { id: generateNodeId(), kind: 'spsb', span, base, sup, sub }
);
export const createSymNode = (span: Span, text: string): SymNode => (
    { id: generateNodeId(), kind: 'sym', span, text }
);

// Constructor for TextEnvNode (using rawText)
export const createTextEnvNode = (span: Span, command: string, rawText: string): TextEnvNode => (
    { id: generateNodeId(), kind: 'textenv', span, command, rawText }
);

export const createMatrixRowNode = (span: Span, children: Node[]): MatrixRowNode => (
    { id: generateNodeId(), kind: 'mtrxrow', span, children }
);
export const createMatrixEnvNode = (span: Span, environment: string, rows: MatrixRowNode[]): MatrixEnvNode => (
    { id: generateNodeId(), kind: 'mtrxenv', span, environment, rows }
);

// --- Utility Functions for AST Traversal/Manipulation ---
export function getNodeChildren(node: Node): Node[] {
    switch (node.kind) {
        case 'seq':
        case 'grp':
            return node.children;
        case 'textenv':
            return []; // No structured children if using rawText model
        case 'frac':
            return [node.num, node.den];
        case 'sqrt':
            return node.idx ? [node.idx, node.rad] : [node.rad];
        case 'spsb':
            const kids = [node.base];
            if (node.sup) kids.push(node.sup);
            if (node.sub) kids.push(node.sub);
            return kids;
        case 'sym':
            return [];
        case 'mtrxrow':
            return node.children;
        case 'mtrxenv':
            return node.rows; // Rows are the direct "structural" children
        default:
            const exhaustiveCheck: never = node;
            return [];
    }
}

export function replaceNodeChild(parent: Node, oldChildId: string, newChild: Node): Node {
    // Creates a new parent instance with the child replaced.
    // Span updates for the parent are complex and best handled by a re-parse or
    // by ensuring the newChild has a span that allows for correct parent span derivation.
    // For simplicity in zipper operations, we often rebuild the parent from path which handles this.

    const newParentBase = { ...parent, id: generateNodeId() };
    let updatedParent: Node;

    switch (newParentBase.kind) {
        case 'seq':
        case 'grp':
            updatedParent = { ...newParentBase, children: newParentBase.children.map(c => c.id === oldChildId ? newChild : c) };
            break;
        case 'textenv': // TextEnvNode with rawText has no Node children.
            updatedParent = newParentBase; // No change if oldChildId doesn't match self.id
            break;
        case 'frac':
            let newNum = newParentBase.num;
            let newDen = newParentBase.den;
            if (newParentBase.num.id === oldChildId) newNum = newChild;
            else if (newParentBase.den.id === oldChildId) newDen = newChild;
            updatedParent = { ...newParentBase, num: newNum, den: newDen };
            break;
        case 'sqrt':
            let newRad = newParentBase.rad;
            let newIdx = newParentBase.idx;
            if (newParentBase.idx?.id === oldChildId) newIdx = newChild;
            else if (newParentBase.rad.id === oldChildId) newRad = newChild;
            updatedParent = { ...newParentBase, rad: newRad, idx: newIdx };
            break;
        case 'spsb':
            let newBase = newParentBase.base;
            let newSup = newParentBase.sup;
            let newSub = newParentBase.sub;
            if (newParentBase.base.id === oldChildId) newBase = newChild;
            else if (newParentBase.sup?.id === oldChildId) newSup = newChild;
            else if (newParentBase.sub?.id === oldChildId) newSub = newChild;
            updatedParent = { ...newParentBase, base: newBase, sup: newSup, sub: newSub };
            break;
        case 'sym': // SymNode has no children that are Nodes themselves.
            updatedParent = newParentBase;
            break;
        case 'mtrxrow':
            updatedParent = { ...newParentBase, children: newParentBase.children.map(c => c.id === oldChildId ? newChild : c) };
            break;
        case 'mtrxenv':
            updatedParent = { ...newParentBase, rows: newParentBase.rows.map(r => r.id === oldChildId ? (newChild as MatrixRowNode) : r) };
            break;
        default:
            const exhaustiveCheck: never = newParentBase;
            throw new Error(`Unhandled node kind in replaceNodeChild: ${(exhaustiveCheck as Node).kind}`);
    }

    const childrenForSpan = getNodeChildren(updatedParent);
    if (childrenForSpan.length > 0) {
        const firstChildSpan = childrenForSpan[0].span;
        const lastChildSpan = childrenForSpan[childrenForSpan.length - 1].span;
        updatedParent.span = createSpan(firstChildSpan.start, lastChildSpan.end);
    } else if (updatedParent.span.start > updatedParent.span.end) {
        updatedParent.span = createSpan(updatedParent.span.start, updatedParent.span.start);
    }

    return updatedParent;
}