// src/test-zipper.ts (or run as a snippet)
import * as A from './core/latex-parser/ast.ts';
import * as Z from './core/latex-parser/zipper.ts';
import { parseFull, toLatex } from './core/latex-parser/index.ts';

function assertEqual(actual: any, expected: any, message: string) {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr !== expectedStr) {
        console.error(`ASSERTION FAILED: ${message}`);
        console.error(`  Expected: ${expectedStr}`);
        console.error(`  Actual:   ${actualStr}`);
        throw new Error(`Assertion failed: ${message}`);
    }
    console.log(`ASSERTION PASSED: ${message}`);
}

console.log("--- Testing Zipper ---");

// Test 1: Basic navigation
let ast1 = parseFull("\\frac{a}{b}");
let zipper1 = Z.fromAST(ast1);

console.log("Initial AST (Frac):", toLatex(Z.toAST(zipper1)));
assertEqual(zipper1.focus.kind, 'seq', "Focus should be root SeqNode");

// Go down to FracNode
zipper1 = Z.downToFirstChild(zipper1)!;
assertEqual(zipper1.focus.kind, 'frac', "Focus on FracNode");

// Go down to Numerator (GroupNode)
let zipperNum = Z.down(zipper1, 0)!; // FracNode children: [num, den]
assertEqual(zipperNum.focus.kind, 'grp', "Focus on Numerator GroupNode");

// Go down to 'a' (SymNode in Group)
zipperNum = Z.downToFirstChild(zipperNum)!;
assertEqual(zipperNum.focus.kind, 'sym', "Focus on SymNode 'a'");
assertEqual((zipperNum.focus as A.SymNode).text, 'a', "Text is 'a'");

// Go up to Numerator GroupNode
zipperNum = Z.up(zipperNum)!;
assertEqual(zipperNum.focus.kind, 'grp', "Up to Numerator GroupNode");

// Go up to FracNode
zipper1 = Z.up(zipperNum)!;
assertEqual(zipper1.focus.kind, 'frac', "Up to FracNode");

// Go to Denominator (GroupNode)
let zipperDen = Z.down(zipper1, 1)!;
assertEqual(zipperDen.focus.kind, 'grp', "Focus on Denominator GroupNode");

// Go up to root
zipper1 = Z.up(zipper1)!; // Up from FracNode to SeqNode
assertEqual(zipper1.focus.kind, 'seq', "Up to root SeqNode");
assertEqual(Z.up(zipper1), null, "Up from root should be null");

console.log("\nTest 1 Navigation PASSED.");

// Test 2: Replacement
let ast2 = parseFull("a+b"); // SeqNode with one SymNode "a+b"
let zipper2 = Z.fromAST(ast2);
zipper2 = Z.downToFirstChild(zipper2)!; // Focus on SymNode "a+b"

const replacementSym = A.createSymNode(A.createSpan(0,3), "c*d");
zipper2 = Z.replace(zipper2, replacementSym);
assertEqual((zipper2.focus as A.SymNode).text, "c*d", "Symbol replaced");
const finalAst2 = Z.toAST(zipper2);
assertEqual(toLatex(finalAst2), "c*d", "Serialization after replace");

console.log("\nTest 2 Replacement PASSED.");

// Test 3: Modify SymNode Text
let ast3 = parseFull("x^2");
let zipper3 = Z.fromAST(ast3); // root Seq
zipper3 = Z.downToFirstChild(zipper3)!; // SpsbNode
zipper3 = Z.down(zipper3, 1)!; // Sup (SymNode "2")
assertEqual((zipper3.focus as A.SymNode).text, "2", "Initial sup text is 2");

zipper3 = Z.modifySymNodeText(zipper3, "3", 1)!;
assertEqual((zipper3.focus as A.SymNode).text, "3", "Modified sup text is 3");
assertEqual(zipper3.charOffset, 1, "Char offset updated");
const finalAst3 = Z.toAST(zipper3);
assertEqual(toLatex(finalAst3), "x^3", "Serialization after modifySymNodeText (smart brace)");

console.log("\nTest 3 Modify SymNode Text PASSED.");

// Test 4: Deletion in a sequence
let ast4 = parseFull("a+b+c"); // Seq [Sym(a), Sym(+), Sym(b), Sym(+), Sym(c)] (due to lexer)
// For this test, let's assume lexer makes "a", "+", "b", "+", "c" distinct if we changed it
// Current lexer: "a+b+c" is one SymNode.
// Let's use a structure that guarantees multiple children in sequence: {a}{b}{c}
ast4 = parseFull("{a}{b}{c}"); // Seq [Grp(a), Grp(b), Grp(c)]
let zipper4 = Z.fromAST(ast4);
assertEqual((zipper4.focus as A.SeqNode).children.length, 3, "Initial sequence length 3");

zipper4 = Z.down(zipper4, 1)!; // Focus on Grp(b)
assertEqual((Z.downToFirstChild(zipper4)!.focus as A.SymNode).text, "b", "Focused on {b}");

zipper4 = Z.deleteNode(zipper4)!; // Delete Grp(b), focus should move to Grp(c)
assertEqual((Z.downToFirstChild(zipper4)!.focus as A.SymNode).text, "c", "Focus moved to {c} after delete");
let finalAst4 = Z.toAST(zipper4);
assertEqual(toLatex(finalAst4), "{a}{c}", "Serialization after deleting {b}");

zipper4 = Z.deleteNode(zipper4)!; // Delete Grp(c), focus should move to Grp(a)
assertEqual((Z.downToFirstChild(zipper4)!.focus as A.SymNode).text, "a", "Focus moved to {a} after delete");
finalAst4 = Z.toAST(zipper4);
assertEqual(toLatex(finalAst4), "{a}", "Serialization after deleting {c}");

zipper4 = Z.deleteNode(zipper4)!; // Delete Grp(a), focus on parent (SeqNode), children empty
assertEqual(zipper4.focus.kind, 'seq', "Focus on parent SeqNode");
assertEqual((zipper4.focus as A.SeqNode).children.length, 0, "Parent sequence is empty");
finalAst4 = Z.toAST(zipper4);
assertEqual(toLatex(finalAst4), "", "Serialization after deleting all");

console.log("\nTest 4 Deletion PASSED.");

// Test 5: insertRight / insertLeft
let ast5 = parseFull("{a}{c}");
let zipper5 = Z.fromAST(ast5); // Seq [Grp(a), Grp(c)]
zipper5 = Z.downToFirstChild(zipper5)!; // Focus Grp(a)
const nodeB = A.createGroupNode(A.createSpan(0,3), [A.createSymNode(A.createSpan(1,2),"b")]);

zipper5 = Z.insertRight(zipper5, nodeB)!;
// Focus is still on Grp(a), but its context (path) changed
let finalAst5 = Z.toAST(zipper5);
assertEqual(toLatex(finalAst5), "{a}{b}{c}", "Serialization after insertRight");

// Move to b, then insert something to its left
zipper5 = Z.right(zipper5)!; // Focus on Grp(b)
assertEqual((Z.downToFirstChild(zipper5)!.focus as A.SymNode).text, "b", "Focused on {b}");
const nodeX = A.createGroupNode(A.createSpan(0,3), [A.createSymNode(A.createSpan(1,2),"x")]);
zipper5 = Z.insertLeft(zipper5, nodeX)!;
finalAst5 = Z.toAST(zipper5);
assertEqual(toLatex(finalAst5), "{a}{x}{b}{c}", "Serialization after insertLeft");

console.log("\nTest 5 Insertion PASSED.");


console.log("\n--- Zipper Tests Completed ---");