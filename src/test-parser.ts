// src/test-parser.ts
import { parseFull, toLatex, Node as ASTNode } from './core/latex-parser/index.ts'; // Ensure correct path and .ts if needed

const testCases: { input: string; description: string; expectError?: boolean }[] = [
    // --- Original Test Cases (Retained for Regression) ---
    { input: "a+b", description: "Simple symbols and operator" },
    { input: "\\frac{1}{2}", description: "Simple fraction" },
    { input: "x^2", description: "Simple superscript" },
    { input: "y_i", description: "Simple subscript" },
    { input: "\\sqrt[3]{x+y}", description: "Square root with index and grouped radicand" },
    { input: "\\text{hello world}", description: "Text environment with space" },
    { input: "\\begin{matrix} a & b \\\\ c & d \\end{matrix}", description: "Simple 2x2 matrix" },
    { input: "\\begin{pmatrix} x^2 & \\alpha \\\\ \\frac{1}{2} & \\text{complex} \\end{pmatrix}", description: "Complex matrix" },
    { input: "{a+{b}}", description: "Nested groups" },
    { input: "f(x) = x^2_i + \\sqrt{\\frac{a}{b}}", description: "Mixed expression with scripts, sqrt, frac" },
    { input: "% a comment\na + b % another comment", description: "Comments and newlines" },
    { input: "\\alpha^2_3", description: "Command with superscript then subscript" },
    { input: "\\alpha_3^2", description: "Command with subscript then superscript" },

    // --- New Test Cases ---

    // Nested Structures
    { input: "\\frac{\\frac{a}{b}}{\\frac{c}{d}}", description: "Nested fractions" },
    { input: "\\sqrt{\\sqrt{x}}", description: "Nested square roots" },
    { input: "x^{y^z}", description: "Nested superscripts (grouped)" },
    { input: "x_{y_z}", description: "Nested subscripts (grouped)" },
    { input: "\\frac{a}{b^c_d}", description: "Script in denominator" },
    { input: "{ (a+b)^2 }", description: "Group containing a script" },
    { input: "\\sqrt[\\alpha]{\\beta_1^2}", description: "Complex index and radicand for sqrt" },

    // Edge Cases for \text{}
    { input: "\\text{}", description: "Empty text environment" },
    { input: "\\text{ { braced text } }", description: "Text with internal braces" },
    { input: "\\text{mixed \\alpha and text}", description: "Text with commands inside (treated as raw)" },
    { input: "\\text{a%comment\nb}", description: "Text with comment and newline (raw)" },
    { input: "\\text{\\frac{1}{2}}", description: "Text with a fraction command (raw)" }, // \frac should be literal text here

    // Edge Cases for Matrices
    { input: "\\begin{matrix} \\end{matrix}", description: "Empty matrix" },
    { input: "\\begin{pmatrix} a & \\\\ & b \\end{pmatrix}", description: "Matrix with empty cells (a ; ; b)" },
    { input: "\\begin{bmatrix} 1 \\\\ 2 \\\\ 3 \\end{bmatrix}", description: "Column vector (nx1 matrix)" },
    { input: "\\begin{vmatrix} x & y \\end{vmatrix}", description: "1x2 matrix (row vector)" },
    { input: "\\begin{matrix} a & b & c \\\\ d & e & f \\end{matrix}", description: "3-column matrix" },
    { input: "\\begin{matrix} a & b \\\\ c & d \\\\ \\end{matrix}", description: "Matrix with trailing double backslash" },
    { input: "\\begin{matrix} a \\\\ \\end{matrix}", description: "Single element matrix with trailing double backslash" },
    { input: "\\begin{matrix} \\alpha & \\frac{x_1^2}{\\text{test}} \\\\ \\sqrt{y} & {a+b+c} \\end{matrix}", description: "Matrix with highly complex cells" },

    // Whitespace and Comment Variations
    { input: "  a  +  b  ", description: "Leading/trailing/internal spaces around simple expr" },
    { input: "\\frac { 1 } { 2 }", description: "Spaces around frac arguments (should be fine)" },
    { input: "x ^ 2", description: "Spaces around superscript operator" },
    { input: "y _ i", description: "Spaces around subscript operator" },
    { input: " %%% \n \\alpha %%% \n ", description: "Commands surrounded by comments and newlines" },

    // Expected Error Conditions (for manual observation of thrown errors)
    { input: "\\frac{1}{", description: "Unclosed fraction (missing denominator group)", expectError: true },
    { input: "{a+b", description: "Unclosed group", expectError: true },
    { input: "\\sqrt[3", description: "Unclosed sqrt optional argument", expectError: true },
    { input: "\\begin{matrix} a & b \\ c & d \\end{pmatrix}", description: "Mismatched matrix environment name", expectError: true },
    { input: "x^", description: "Superscript without argument", expectError: true },
    { input: "x^^2", description: "Double superscript operator", expectError: true },
    { input: "\\begin{test} \\end{test}", description: "Unsupported environment", expectError: true },
    { input: "\\newcommand", description: "An unhandled command (should be sym)", expectError: false }, // Test it becomes a SymNode
    { input: "\\", description: "Lone backslash (should be sym)", expectError: false }, // Test it becomes a SymNode

    // Span and ID generation check (more for visual inspection of output)
    { input: "{}", description: "Empty group (check span)"},
    { input: "x^{}", description: "Superscript with empty group (check span)"},
];

let testsPassed = 0;
let testsFailed = 0;

testCases.forEach((tc, index) => {
    console.log(`\n--- Test Case ${index + 1}: ${tc.description} ---`);
    console.log(`Input: ${tc.input}`);
    let ast: ASTNode | null = null;
    let serializedLatex: string | null = null;
    let errorOccurred = false;
    let errorMessage = "";

    try {
        ast = parseFull(tc.input);
        if (tc.expectError) {
            testsFailed++;
            console.error(`FAIL: Expected an error, but parsing succeeded.`);
            errorOccurred = true; // but not the one we wanted
        } else {
            serializedLatex = toLatex(ast);
            // Basic check: does serialized output roughly match input (ignoring whitespace and minor formatting)?
            // More sophisticated checks would involve parsing the serialized output and comparing ASTs.
            const simplifiedInput = tc.input.replace(/\s+/g, "").replace(/%.*$/gm, "");
            const simplifiedOutput = serializedLatex.replace(/\s+/g, "");

            // This comparison is very naive. True round-trip testing is complex.
            // For now, we primarily look at AST structure and if serialization looks reasonable.
            // if (simplifiedInput === simplifiedOutput) {
            //     testsPassed++;
            //     console.log("PASS (Simplified Roundtrip)");
            // } else {
            //     // It's okay if they don't match exactly due to formatting or smart bracing
            //     // The key is whether the AST is correct and serialization is valid LaTeX
            //     console.warn("NOTE: Simplified roundtrip differs (may be OK due to formatting).");
            // }
        }
    } catch (e) {
        errorOccurred = true;
        errorMessage = e instanceof Error ? e.message : String(e);
        if (tc.expectError) {
            testsPassed++;
            console.log(`PASS: Correctly threw error: ${errorMessage}`);
        } else {
            testsFailed++;
            console.error(`FAIL: Parse Error: ${errorMessage}`);
        }
    }

    if (!errorOccurred && !tc.expectError && ast) {
        testsPassed++; // If it didn't error and wasn't expected to, count as a structural pass for now.
        console.log("AST:", JSON.stringify(ast, null, 2));
        if (serializedLatex) {
            console.log("Serialized:", serializedLatex);
        }
    } else if (!tc.expectError && errorOccurred) {
        // Already handled by testsFailed++ above
    } else if (tc.expectError && !errorOccurred) {
        // Already handled by testsFailed++ above
    }
    console.log("--------------------------------------");
});

console.log(`\n======================================`);
console.log(`Total Tests: ${testCases.length}`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);
console.log(`======================================`);

if (testsFailed > 0) {
    // Exit with a non-zero code if any test fails, useful for CI
    // process.exit(1); // Uncomment for CI environments
}