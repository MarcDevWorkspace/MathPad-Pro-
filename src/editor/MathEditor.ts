// src/editor/MathEditor.ts

import {
    // AST Node types and utilities
    Node as ASTNode,
    BaseNode, // For casting to get ID
    SymNode, GroupNode, SeqNode, FracNode, SqrtNode, SupSubNode,
    TextEnvNode, MatrixEnvNode, MatrixRowNode,
    getNodeChildren,
    createSpan, createSymNode, createSeqNode, // For placeholders or new nodes
    // Parser and Serializer
    toLatex,
    // Incremental State Management
    initialParse,
    updateParse, // Will use full re-parse initially
    IncrementalParseState,
    // Zipper
    Zipper,
    Path,
    Crumb,
    fromAST,
    toAST as zipperToAST,
    up as zipperUp,
    down as zipperDown,
    left as zipperLeft,
    right as zipperRight,
    replace as zipperReplace,
    modifySymNodeText as zipperModifySymNodeText,
    deleteNode as zipperDeleteNode,
    insertRight as zipperInsertRight,
    insertLeft as zipperInsertLeft,
    downToFirstChild as zipperDownToFirstChild,
} from '../core/latex-parser/index.ts'; // Ensure .ts extension if needed

// Declare MathJax globally
declare var MathJax: any;

export class MathEditor {
    private containerElement: HTMLElement;
    private mathJaxOutputElement: HTMLElement;
    private visualCaretElement: HTMLElement;

    private state: IncrementalParseState;
    private zipper: Zipper;
    private astNodeToDomElementsMap: Map<string, HTMLElement[]> = new Map();
    private mmlElementIndexStack: number[] = []; // For MML sibling traversal

    // For debouncing render calls if edits happen rapidly
    private renderTimeoutId: number | null = null;


    constructor(containerId: string, initialLatex: string) {
        console.log(`MathEditor: Initializing with container ID '${containerId}'.`);
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`MathEditor: Container element with ID '${containerId}' not found.`);
        }
        this.containerElement = container;
        this.containerElement.innerHTML = ''; // Clear placeholder

        this.mathJaxOutputElement = document.createElement('div');
        this.mathJaxOutputElement.className = 'mathjax-output-area';
        this.mathJaxOutputElement.setAttribute('aria-live', 'polite'); // For screen readers
        this.containerElement.appendChild(this.mathJaxOutputElement);

        this.visualCaretElement = document.createElement('div');
        this.visualCaretElement.className = 'math-editor-caret';
        this.containerElement.appendChild(this.visualCaretElement);

        // Defer MathJax-dependent initialization until MathJax is ready
        document.addEventListener('mathjax-ready', this.onMathJaxReady.bind(this, initialLatex), { once: true });
    }

    private onMathJaxReady(initialLatex: string): void {
        console.log("MathEditor: MathJax ready event received. Proceeding with initialization.");
        try {
            this.state = initialParse(initialLatex);
            this.zipper = fromAST(this.state.ast);
            console.log("MathEditor: Initial AST parsed and zipper created.", this.state.ast);

            this.renderAndMap().then(() => {
                console.log("MathEditor: Initial render and map complete.");
                this.updateVisualCaretPosition();
            }).catch(err => {
                console.error("MathEditor: Error during initial renderAndMap:", err);
                this.mathJaxOutputElement.textContent = "Error rendering initial LaTeX.";
            });

            this.setupEventListeners();
        } catch (e) {
            console.error("MathEditor: Error during initialization after MathJax ready:", e);
            this.mathJaxOutputElement.textContent = `Critical init error: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    private async renderAndMap(): Promise<void> {
        const latexToRender = toLatex(this.state.ast);
        console.log(`MathEditor: Rendering LaTeX (length ${latexToRender.length}): "${latexToRender.substring(0, 100)}${latexToRender.length > 100 ? '...' : ''}"`);

        this.mathJaxOutputElement.innerHTML = ''; // Clear previous output
        this.astNodeToDomElementsMap.clear();    // Clear old mapping

        if (!MathJax || !MathJax.tex2mml || !MathJax.mml2chtml || !MathJax.startup?.document) {
            console.error("MathEditor: MathJax core functions not available. Cannot render.");
            this.mathJaxOutputElement.textContent = "MathJax not fully loaded.";
            return;
        }

        try {
            // 1. Convert TeX to MML string
            const mmlString = MathJax.tex2mml(latexToRender, { display: true });
            // console.debug("MathEditor: Raw MML from tex2mml:", mmlString);

            // 2. Parse MML string to an XML DOM
            const mmlParser = new DOMParser();
            const mmlDoc = mmlParser.parseFromString(mmlString, "application/xml");

            const parseError = mmlDoc.getElementsByTagName("parsererror");
            if (parseError.length > 0) {
                console.warn("MathEditor: MML parsing error detected in tex2mml output. MML:", mmlString, "Error:", parseError[0].textContent);
                // Fallback strategy: try to render the potentially flawed MML or original TeX directly
                // For now, let's show an error. A production app might try to render the TeX.
                this.mathJaxOutputElement.textContent = "Error in LaTeX structure (MML parse failed).";
                throw new Error("MML parsing error from tex2mml output.");
            }
            
            const mmlRoot = mmlDoc.documentElement;
            if (!mmlRoot || mmlRoot.tagName.toLowerCase() !== 'math') {
                console.warn("MathEditor: Expected <math> root in MML, got:", mmlRoot?.tagName);
                // Proceeding, but correlation might be off.
            }

            // 3. Correlate AST with MML DOM and add 'data-ast-id' attributes
            console.log("MathEditor: Starting MML correlation with AST root:", this.state.ast.kind, this.state.ast.id);
            this.mmlElementIndexStack = []; // Reset stack for new correlation
            if (mmlRoot) { // Ensure mmlRoot is not null
                this.correlateAndAddIdsToMmlRecursive(this.state.ast, mmlRoot, mmlRoot);
            } else {
                 console.error("MathEditor: MML root element not found after parsing. Cannot add AST IDs.");
            }


            // 4. Serialize modified MML DOM back to string
            const mmlSerializer = new XMLSerializer();
            const mmlStringWithIds = mmlRoot ? mmlSerializer.serializeToString(mmlRoot) : mmlString; // Fallback to original MML if root was null
            // console.debug("MathEditor: MML with IDs:", mmlStringWithIds);

            // 5. Convert MML with IDs to CHTML/SVG (MathJax internal representation)
            const mathJaxNode = MathJax.mml2chtml(mmlStringWithIds); // or mml2svg

            // 6. Append to output and let MathJax finalize rendering
            this.mathJaxOutputElement.appendChild(mathJaxNode);
            await MathJax.startup.document.render().promise; // Process CHTML/SVG specific rendering steps & any queued math
            console.log("MathEditor: MathJax document render completed.");

            // 7. Build the map from 'data-ast-id' to rendered DOM elements
            this.buildAstToDomMapFromDataAttributes(this.mathJaxOutputElement);

        } catch (error) {
            console.error('MathEditor: Error during renderAndMap pipeline:', error);
            this.mathJaxOutputElement.textContent = `Render Error. Input: ${latexToRender.substring(0,50)}...`;
            // Optionally re-throw or handle further
        }

        this.updateVisualCaretPosition();
    }

    private correlateAndAddIdsToMmlRecursive(astNode: ASTNode, mmlParentContext: Element | null, currentMmlNodeHint?: Element): void {
        if (!astNode) {
            // console.debug("MML Correlation: Null AST node provided.");
            return;
        }

        let mmlElementToProcess: Element | null = currentMmlNodeHint || null;

        if (!mmlElementToProcess && mmlParentContext) {
            const mmlChildren = Array.from(mmlParentContext.children);
            const parentStackIndex = this.mmlElementIndexStack.length -1;
            const currentIndex = parentStackIndex >=0 ? this.mmlElementIndexStack[parentStackIndex] : 0;

            if (currentIndex < mmlChildren.length) {
                mmlElementToProcess = mmlChildren[currentIndex];
                 if (parentStackIndex >=0) this.mmlElementIndexStack[parentStackIndex]++;
            } else {
                // console.debug(`MML Correlation: Ran out of MML children in <${mmlParentContext.tagName}> for AST ${astNode.kind} ${astNode.id}. Current MML index ${currentIndex}, MML children count ${mmlChildren.length}`);
            }
        }
        
        if (!mmlElementToProcess) {
            // console.warn(`MML Correlation: Could not find/determine MML element for AST node ${astNode.kind} (${astNode.id}). Parent MML: <${mmlParentContext?.tagName}>`);
            return;
        }

        // --- Add ID to the currentMmlElement ---
        mmlElementToProcess.setAttribute('data-ast-id', astNode.id);
        // console.debug(`MML Correlation: Mapped AST ID ${astNode.id} (${astNode.kind}, span ${astNode.span.start}-${astNode.span.end}) to MML <${mmlElementToProcess.tagName}>`);

        // --- Recurse based on AST Node Kind and expected MML structure ---
        const astChildren = getNodeChildren(astNode);

        switch (astNode.kind) {
            case 'sym': // Mapped to <mi>, <mn>, <mo>
                // No AST children to recurse into. Content check can be useful.
                // console.debug(`  SymNode ${astNode.text} mapped to <${mmlElementToProcess.tagName}> with content "${mmlElementToProcess.textContent}"`);
                break;

            case 'grp': // Often <mrow>
            case 'seq': // Children are siblings, usually within an <mrow> (which might be mmlElementToProcess or its parent)
            case 'textenv': // If rawText, no children. If parsed children, behaves like 'grp'
                if (astNode.kind === 'textenv' && astNode.rawText !== undefined) {
                    // console.debug(`  TextEnvNode (rawText) "${astNode.rawText}" mapped to <${mmlElementToProcess.tagName}>`);
                    break; // No children to map for rawText model
                }
                // For grp, seq, or textenv with children, assume mmlElementToProcess is the <mrow> or similar container
                // console.debug(`  Entering children of AST ${astNode.kind} ${astNode.id}, MML <${mmlElementToProcess.tagName}>`);
                this.mmlElementIndexStack.push(0); // New sibling context for children
                for (const childAst of astChildren) {
                    this.correlateAndAddIdsToMmlRecursive(childAst, mmlElementToProcess);
                }
                this.mmlElementIndexStack.pop();
                break;

            case 'frac': // <mfrac>
                if (mmlElementToProcess.tagName.toLowerCase() === 'mfrac' && mmlElementToProcess.children.length >= 2) {
                    // console.debug(`  Mapping FracNode ${astNode.id} children to <mfrac> children`);
                    this.correlateAndAddIdsToMmlRecursive(astNode.num, null, mmlElementToProcess.children[0]);
                    this.correlateAndAddIdsToMmlRecursive(astNode.den, null, mmlElementToProcess.children[1]);
                } else {
                    console.warn(`MML Correlation: FracNode ${astNode.id} did not map to expected <mfrac> structure. MML: <${mmlElementToProcess.tagName}> with ${mmlElementToProcess.children.length} children.`);
                }
                break;

            case 'sqrt': // <msqrt> or <mroot>
                if ((mmlElementToProcess.tagName.toLowerCase() === 'msqrt' || mmlElementToProcess.tagName.toLowerCase() === 'mroot') && mmlElementToProcess.children.length > 0) {
                    const mmlSqrtChildren = Array.from(mmlElementToProcess.children);
                    let mmlChildIdx = 0;
                    // console.debug(`  Mapping SqrtNode ${astNode.id} to <${mmlElementToProcess.tagName}>`);
                    if (astNode.idx && mmlElementToProcess.tagName.toLowerCase() === 'mroot') {
                        if (mmlSqrtChildren[mmlChildIdx]) this.correlateAndAddIdsToMmlRecursive(astNode.idx, null, mmlSqrtChildren[mmlChildIdx]);
                        mmlChildIdx++;
                    }
                    if (mmlSqrtChildren[mmlChildIdx]) this.correlateAndAddIdsToMmlRecursive(astNode.rad, null, mmlSqrtChildren[mmlChildIdx]);
                } else {
                     console.warn(`MML Correlation: SqrtNode ${astNode.id} did not map to expected <msqrt>/<mroot> structure. MML: <${mmlElementToProcess.tagName}>`);
                }
                break;
            
            case 'spsb': // <msubsup>, <msub>, <msup>
                 if (mmlElementToProcess.tagName.toLowerCase().match(/m(sub|sup|subsup)$/) && mmlElementToProcess.children.length >= 1) {
                    const mmlScriptChildren = Array.from(mmlElementToProcess.children);
                    let mmlChildIdx = 0;
                    // console.debug(`  Mapping SupSubNode ${astNode.id} to <${mmlElementToProcess.tagName}>`);
                    // Base
                    if (mmlScriptChildren[mmlChildIdx]) this.correlateAndAddIdsToMmlRecursive(astNode.base, null, mmlScriptChildren[mmlChildIdx]);
                    mmlChildIdx++;
                    // MML order for msubsup is base, sub, sup.
                    if (astNode.sub && mmlScriptChildren[mmlChildIdx]) {
                        this.correlateAndAddIdsToMmlRecursive(astNode.sub, null, mmlScriptChildren[mmlChildIdx]);
                        mmlChildIdx++;
                    }
                    if (astNode.sup && mmlScriptChildren[mmlChildIdx]) {
                        this.correlateAndAddIdsToMmlRecursive(astNode.sup, null, mmlScriptChildren[mmlChildIdx]);
                    }
                 } else {
                     console.warn(`MML Correlation: SupSubNode ${astNode.id} did not map to expected script structure. MML: <${mmlElementToProcess.tagName}>`);
                 }
                break;

            case 'mtrxenv': // <mtable>
                if (mmlElementToProcess.tagName.toLowerCase() === 'mtable') {
                    const astRows = astNode.rows;
                    const mmlMtrElements = Array.from(mmlElementToProcess.getElementsByTagName('mtr')); // Get all <mtr> descendants
                    // console.debug(`  Mapping MatrixEnvNode ${astNode.id} to <mtable>. AST rows: ${astRows.length}, MML <mtr>s: ${mmlMtrElements.length}`);
                    this.mmlElementIndexStack.push(0); // New context for <mtr> children of <mtable>
                    for (const astRow of astRows) {
                        // We need to find the correct <mtr> for this astRow
                        // This simple linear pass might work if structure is direct.
                        this.correlateAndAddIdsToMmlRecursive(astRow, mmlElementToProcess);
                    }
                    this.mmlElementIndexStack.pop();
                } else {
                     console.warn(`MML Correlation: MatrixEnvNode ${astNode.id} did not map to <mtable>. MML: <${mmlElementToProcess.tagName}>`);
                }
                break;

            case 'mtrxrow': // <mtr>
                if (mmlElementToProcess.tagName.toLowerCase() === 'mtr') {
                    const astCells = astNode.children; // Cells are children of MatrixRowNode
                    const mmlMtdElements = Array.from(mmlElementToProcess.getElementsByTagName('mtd')); // Get all <mtd> descendants
                    // console.debug(`  Mapping MatrixRowNode ${astNode.id} to <mtr>. AST cells: ${astCells.length}, MML <mtd>s: ${mmlMtdElements.length}`);
                    this.mmlElementIndexStack.push(0); // New context for <mtd> children of <mtr>
                    for (const astCell of astCells) { // astCell is usually a SeqNode
                        this.correlateAndAddIdsToMmlRecursive(astCell, mmlElementToProcess);
                    }
                    this.mmlElementIndexStack.pop();
                } else {
                     console.warn(`MML Correlation: MatrixRowNode ${astNode.id} did not map to <mtr>. MML: <${mmlElementToProcess.tagName}>`);
                }
                break;

            default:
                // console.warn(`MML Correlation: No specific MML mapping logic for AST node kind: ${astNode.kind} (ID: ${astNode.id}) with MML <${mmlElementToProcess.tagName}>`);
                // Generic attempt for unhandled container nodes if they have children
                if (astChildren.length > 0 && mmlElementToProcess.children.length > 0) {
                    // console.debug(`  Generic child mapping for ${astNode.kind} ${astNode.id}`);
                    this.mmlElementIndexStack.push(0);
                    for (const childAst of astChildren) {
                        this.correlateAndAddIdsToMmlRecursive(childAst, mmlElementToProcess);
                    }
                    this.mmlElementIndexStack.pop();
                }
                break;
        }
    }


    private buildAstToDomMapFromDataAttributes(container: HTMLElement): void {
        this.astNodeToDomElementsMap.clear();
        container.querySelectorAll('[data-ast-id]').forEach(element => {
            const id = element.getAttribute('data-ast-id');
            if (id) {
                if (!this.astNodeToDomElementsMap.has(id)) {
                    this.astNodeToDomElementsMap.set(id, []);
                }
                this.astNodeToDomElementsMap.get(id)!.push(element as HTMLElement);
            }
        });
        console.log("MathEditor: AST to DOM Map updated. Size:", this.astNodeToDomElementsMap.size);
    }

    private setupEventListeners(): void {
        console.log("MathEditor: Setting up event listeners.");
        this.mathJaxOutputElement.addEventListener('click', this.handleClick.bind(this));
        // Future: Add listeners for virtual keyboard, focus/blur on editor area, etc.
    }

    private handleClick(event: MouseEvent): void {
        console.log("MathEditor: Click detected on output area.", event.clientX, event.clientY);
        let target = event.target as HTMLElement | null;
        let astNodeId: string | null = null;
        let clickedDomElement: HTMLElement | null = null;

        while (target && target !== this.mathJaxOutputElement && target !== this.containerElement) {
            astNodeId = target.getAttribute('data-ast-id');
            if (astNodeId) {
                clickedDomElement = target;
                break;
            }
            target = target.parentElement;
        }

        if (astNodeId && clickedDomElement) {
            console.log(`MathEditor: Click resolved to AST Node ID: ${astNodeId}, DOM Element: <${clickedDomElement.tagName}>`);
            const foundNodeInfo = this.findNodeAndPathByIdInAst(this.state.ast, astNodeId);

            if (foundNodeInfo) {
                let charOffset = 0;
                if (foundNodeInfo.node.kind === 'sym') {
                    charOffset = this.calculateCharOffsetFromClick(foundNodeInfo.node, clickedDomElement, event);
                } else if (getNodeChildren(foundNodeInfo.node).length === 0) { // Empty group, seq, etc.
                    charOffset = 0;
                }
                this.zipper = { focus: foundNodeInfo.node, path: foundNodeInfo.path, charOffset };
                console.log("MathEditor: New Zipper state:", { kind: this.zipper.focus.kind, id: this.zipper.focus.id, offset: charOffset });
                this.updateVisualCaretPosition();
            } else {
                console.warn(`MathEditor: Click on element with AST ID ${astNodeId}, but node not found in current AST.`);
            }
        } else {
            console.log("MathEditor: Click on non-mapped area or background.");
            // TODO: Handle clicks on background (e.g., focus last element, append new line)
        }
    }

    private findNodeAndPathByIdInAst(
        currentNode: ASTNode,
        targetId: string,
        currentPath: Path = []
    ): { node: ASTNode, path: Path } | null {
        if (currentNode.id === targetId) {
            return { node: currentNode, path: currentPath };
        }
        // getNodeChildren should handle specific child access for each node type
        const children = getNodeChildren(currentNode);
        for (let i = 0; i < children.length; i++) {
            const childNode = children[i];
            let crumb: Crumb | null = null;

            // Simplified crumb creation - a more robust version would exactly mirror zipper.ts 'down'
            // For this search, we mainly care about constructing the path.
            // The 'span' and exact sibling arrays in crumbs are less critical for path finding than for 'toAST'.
            const placeholderSpan = createSpan(0,0); // Placeholder span for these temporary crumbs

            switch (currentNode.kind) {
                case 'seq': case 'grp': case 'textenv':
                    crumb = { kind: 'seq_parent', parentId: currentNode.id, parentKind: currentNode.kind, leftSiblings: children.slice(0, i), rightSiblings: children.slice(i + 1), span: currentNode.span };
                    break;
                case 'frac':
                    const fracP = currentNode as FracNode;
                    if (childNode === fracP.num) crumb = { kind: 'frac_parent_num', parent: fracP };
                    else if (childNode === fracP.den) crumb = { kind: 'frac_parent_den', parent: fracP };
                    break;
                case 'sqrt':
                    const sqrtP = currentNode as SqrtNode;
                    if (childNode === sqrtP.idx) crumb = { kind: 'sqrt_parent_idx', parent: sqrtP };
                    else if (childNode === sqrtP.rad) crumb = { kind: 'sqrt_parent_rad', parent: sqrtP };
                    break;
                case 'spsb':
                    const spsbP = currentNode as SupSubNode;
                    if (childNode === spsbP.base) crumb = { kind: 'spsb_parent_base', parent: spsbP };
                    else if (childNode === spsbP.sup) crumb = { kind: 'spsb_parent_sup', parent: spsbP };
                    else if (childNode === spsbP.sub) crumb = { kind: 'spsb_parent_sub', parent: spsbP };
                    break;
                case 'mtrxenv': // children are MatrixRowNodes
                    crumb = { kind: 'seq_parent', parentId: currentNode.id, parentKind: 'mtrxenv' as any, leftSiblings: children.slice(0,i) as MatrixRowNode[], rightSiblings: children.slice(i+1) as MatrixRowNode[], span: currentNode.span };
                    break;
                case 'mtrxrow': // children are cell contents (SeqNodes)
                    crumb = { kind: 'seq_parent', parentId: currentNode.id, parentKind: 'mtrxrow' as any, leftSiblings: children.slice(0,i), rightSiblings: children.slice(i+1), span: currentNode.span };
                    break;
            }

            if (crumb) {
                const found = this.findNodeAndPathByIdInAst(childNode, targetId, [...currentPath, crumb]);
                if (found) return found;
            }
        }
        return null;
    }

    private calculateCharOffsetFromClick(symNode: SymNode, domElement: HTMLElement, event: MouseEvent): number {
        console.log(`MathEditor: Calculating char offset for SymNode "${symNode.text}" (ID: ${symNode.id})`);
        if (!symNode.text || symNode.text.length === 0) return 0;

        // Attempt with Range API for CHTML (more reliable for text nodes)
        if (domElement.childNodes.length > 0) {
            for(const child of Array.from(domElement.childNodes)) {
                if (child.nodeType === Node.TEXT_NODE) {
                    const textNode = child as Text;
                    const text = textNode.textContent || "";
                    if (text.trim() === "" && symNode.text.trim() !== "") continue; // Skip empty/whitespace only text nodes if symbol has content

                    try {
                        let bestOffset = text.length;
                        let minDistance = Infinity;
                        // Check positions *between* characters, including start and end
                        for (let i = 0; i <= text.length; i++) {
                            const range = document.createRange();
                            range.setStart(textNode, i);
                            range.setEnd(textNode, i); // Collapsed range
                            const rect = range.getBoundingClientRect();
                            // clientX is relative to viewport, rect.left is also relative to viewport
                            const clickPointX = event.clientX;
                            const caretPositionX = rect.left; // Position of caret *before* char i
                            
                            const dist = Math.abs(clickPointX - caretPositionX);

                            if (dist < minDistance) {
                                minDistance = dist;
                                bestOffset = i;
                            }
                            // If click is exactly on a char boundary, it's usually preferred.
                            // If click is far right, it should snap to end.
                        }
                        // Additional heuristic: if click is beyond the midpoint of the last char, snap to end.
                        if (text.length > 0) {
                            const rangeEnd = document.createRange();
                            rangeEnd.setStart(textNode, text.length -1);
                            rangeEnd.setEnd(textNode, text.length);
                            const lastCharRect = rangeEnd.getBoundingClientRect();
                            if (event.clientX > lastCharRect.left + lastCharRect.width / 2) {
                                // If click is to the right of the midpoint of the last character, offset is text.length
                                // But our loop for bestOffset already covers text.length.
                            }
                        }
                        console.log(`  Range API offset for "${text}": ${bestOffset}`);
                        return bestOffset;
                    } catch (e) {
                        console.warn("  Range API error for char offset:", e);
                    }
                }
            }
        }
        
        // Fallback: SVG getCharNumAtPosition or average width heuristic
        if (typeof (domElement as any).getCharNumAtPosition === 'function' && domElement.ownerSVGElement) {
            try {
                const svg = domElement.ownerSVGElement;
                let point = svg.createSVGPoint();
                point.x = event.clientX; point.y = event.clientY;
                const ctm = (domElement as SVGGraphicsElement).getScreenCTM();
                if (ctm) {
                    const svgPoint = point.matrixTransform(ctm.inverse());
                    let charNum = (domElement as SVGTextContentElement).getCharNumAtPosition(svgPoint);
                    
                    // getCharNumAtPosition gives index of char whose bbox contains point.
                    // We need to decide if cursor is before or after this char.
                    // Compare click X with midpoint of char's bbox.
                    if (charNum >= 0 && charNum < symNode.text.length) {
                        const charStartRect = (domElement as SVGTextContentElement).getExtentOfChar(charNum);
                        if (svgPoint.x > charStartRect.x + charStartRect.width / 2) {
                            charNum++; // Clicked on right half, cursor after char
                        }
                    } else if (charNum < 0) { // Click before first char
                        charNum = 0;
                    } else { // Click after last char or outside
                        charNum = symNode.text.length;
                    }
                    charNum = Math.max(0, Math.min(symNode.text.length, charNum));
                    console.log(`  SVG getCharNumAtPosition offset: ${charNum}`);
                    return charNum;
                }
            } catch(e) { console.warn("  SVG getCharNumAtPosition error", e); }
        }

        // Final fallback: Average char width (less accurate)
        const rect = domElement.getBoundingClientRect();
        const clickXRelative = event.clientX - rect.left;
        const avgCharWidth = rect.width / (symNode.text.length || 1);
        let estimatedCharIndex = Math.round(clickXRelative / (avgCharWidth || 1));
        estimatedCharIndex = Math.max(0, Math.min(symNode.text.length, estimatedCharIndex));
        console.log(`  Fallback average width offset: ${estimatedCharIndex}`);
        return estimatedCharIndex;
    }

    private updateVisualCaretPosition(): void {
        if (!this.zipper || !this.mathJaxOutputElement.isConnected) {
            this.visualCaretElement.style.display = 'none';
            return;
        }
        console.log(`MathEditor: Updating visual caret for focus: ${this.zipper.focus.kind} ${this.zipper.focus.id}, offset: ${this.zipper.charOffset}`);

        const focusedNodeId = this.zipper.focus.id;
        const domElementInfos = this.astNodeToDomElementsMap.get(focusedNodeId);
        let primaryElement: HTMLElement | null = domElementInfos && domElementInfos.length > 0 ? domElementInfos[0] : null;

        if (domElementInfos && domElementInfos.length > 1) {
            // Heuristic: find the "innermost" or most specific element if multiple are mapped
            // This could happen if a wrapper and its content both get the same AST ID.
            // Prefer element that doesn't contain other mapped elements, or smallest.
            // For now, just take the first, but this could be refined.
            // console.warn(`Multiple DOM elements mapped to AST ID ${focusedNodeId}. Using first.`);
        }
        
        if (!primaryElement || !primaryElement.isConnected) {
            this.visualCaretElement.style.display = 'none';
            console.warn(`MathEditor: Caret - No DOM element or not connected for AST ID: ${focusedNodeId}`);
            return;
        }
        this.visualCaretElement.style.display = 'block';

        const editorRect = this.mathJaxOutputElement.getBoundingClientRect(); // Used for relative positioning
        const elemRect = primaryElement.getBoundingClientRect();

        let caretX = elemRect.left - editorRect.left + this.mathJaxOutputElement.scrollLeft;
        let caretY = elemRect.top - editorRect.top + this.mathJaxOutputElement.scrollTop;
        let caretHeight = elemRect.height;

        if (this.zipper.focus.kind === 'sym' && this.zipper.charOffset !== undefined) {
            const symNode = this.zipper.focus;
            const offset = Math.min(this.zipper.charOffset, symNode.text.length);
            let textNodeForRange: Text | null = null;

            // Try to find a direct child text node for range calculation
            for (const child of Array.from(primaryElement.childNodes)) {
                if (child.nodeType === Node.TEXT_NODE && (child.textContent || "").trim().length > 0) {
                    textNodeForRange = child as Text;
                    break;
                }
            }
            // If no direct text node, MathJax might have nested structure (e.g. <mjx-c class="mjx-charTeX">α</mjx-c>)
            // We might need to search deeper for the actual text node.
            if (!textNodeForRange && primaryElement.querySelector) { // Simple deeper search
                const mjxChar = primaryElement.querySelector('mjx-c'); // Common for CHTML output
                if (mjxChar && mjxChar.firstChild?.nodeType === Node.TEXT_NODE) {
                    textNodeForRange = mjxChar.firstChild as Text;
                }
            }


            if (textNodeForRange) {
                try {
                    const range = document.createRange();
                    // Ensure offset is within textNode's length
                    const safeOffset = Math.min(offset, textNodeForRange.textContent?.length || 0);
                    range.setStart(textNodeForRange, safeOffset);
                    range.setEnd(textNodeForRange, safeOffset); // Collapsed range
                    const rect = range.getBoundingClientRect();

                    caretX = rect.left - editorRect.left + this.mathJaxOutputElement.scrollLeft;
                    // Use element's top/height if range is 0-height (can happen for empty text or at boundaries)
                    caretY = (rect.height === 0 ? elemRect.top : rect.top) - editorRect.top + this.mathJaxOutputElement.scrollTop;
                    caretHeight = rect.height > 4 ? rect.height : elemRect.height; // Prefer range height if sensible
                    console.debug(`  Caret (SymNode with Range): x=${caretX.toFixed(1)}, y=${caretY.toFixed(1)}, h=${caretHeight.toFixed(1)} for offset ${safeOffset} in "${textNodeForRange.textContent}"`);

                } catch (e) {
                    console.warn("  Caret range positioning error:", e, "Fallback to element boundary.");
                    caretX = (offset === 0 ? elemRect.left : elemRect.right) - editorRect.left + this.mathJaxOutputElement.scrollLeft;
                }
            } else {
                // Fallback if no suitable text node found: position based on proportion
                const proportion = symNode.text.length > 0 ? offset / symNode.text.length : 0;
                caretX = elemRect.left - editorRect.left + (elemRect.width * proportion) + this.mathJaxOutputElement.scrollLeft;
                console.debug(`  Caret (SymNode fallback): x=${caretX.toFixed(1)}`);
            }
        } else if (getNodeChildren(this.zipper.focus).length === 0 && 
                   (this.zipper.focus.kind === 'grp' || this.zipper.focus.kind === 'seq' || (this.zipper.focus.kind === 'textenv' && !this.zipper.focus.rawText))) {
            // Empty group/sequence placeholder: position caret at start, slightly indented
            caretX = elemRect.left - editorRect.left + 2 + this.mathJaxOutputElement.scrollLeft; // Small offset
            caretHeight = Math.max(16, elemRect.height); // Ensure minimum caret height
            console.debug(`  Caret (Empty Group/Seq): x=${caretX.toFixed(1)}`);
        } else {
             console.debug(`  Caret (Structural Node or default): x=${caretX.toFixed(1)}`);
        }

        this.visualCaretElement.style.left = `${Math.round(caretX)}px`;
        this.visualCaretElement.style.top = `${Math.round(caretY)}px`;
        this.visualCaretElement.style.height = `${Math.round(caretHeight)}px`;
    }

    // --- Public API for Editor Operations ---
    public processKey(key: string, event?: KeyboardEvent): void {
        console.log(`MathEditor: processKey received: "${key}"`);
        if (event) event.preventDefault(); // Prevent default browser action for handled keys

        let astChanged = false;
        let newZipperState: Zipper | null = this.zipper; // Start with current zipper

        // TODO: Implement actual editing logic based on key
        // This will involve using zipper functions (modifySymNodeText, deleteNode, insertRight, etc.)
        // to create a *new* zipper state.

        if (key.length === 1 && !event?.ctrlKey && !event?.metaKey) { // Simple character input
            const char = key;
            const currentFocus = this.zipper.focus;
            let currentOffset = this.zipper.charOffset === undefined ? (currentFocus.kind === 'sym' ? currentFocus.text.length : 0) : this.zipper.charOffset;

            if (currentFocus.kind === 'sym') {
                const newText = currentFocus.text.slice(0, currentOffset) + char + currentFocus.text.slice(currentOffset);
                newZipperState = zipperModifySymNodeText(this.zipper, newText, currentOffset + 1);
                if (newZipperState) astChanged = true;
            } else if (currentFocus.kind === 'grp' && getNodeChildren(currentFocus).length === 0) {
                // Typing into an empty group placeholder: replace group with sequence containing new symbol
                const newSymSpan = createSpan(currentFocus.span.start + 1, currentFocus.span.start + 1 + char.length); // Approximate span
                const newSymNode = createSymNode(newSymSpan, char);
                const newSeqNodeAsChild = createSeqNode(newSymSpan, [newSymNode]); // Wrap symbol in a sequence

                // To replace the empty group node's *content*, we need to modify its children
                // If group node is { }, its children list is empty. We want it to become { Sym(char) }
                // A more direct way using zipper:
                // 1. Focus on group.
                // 2. Create new SymNode.
                // 3. Replace the focused empty group with a new group containing the SymNode.
                // This is complex as it means replacing the focus with a *new version of itself*.
                
                // Simpler for now: Let's assume this triggers an AST transformation that needs full re-parse.
                // This is a placeholder for more sophisticated insertion.
                const tempNewFocus = { ...currentFocus, children: [newSymNode] } as GroupNode;
                newZipperState = zipperReplace(this.zipper, tempNewFocus);
                if (newZipperState) {
                    newZipperState = zipperDownToFirstChild(newZipperState); // Focus on the new symbol
                    if (newZipperState) newZipperState.charOffset = char.length;
                    astChanged = true;
                }

            } else {
                // TODO: Handle inserting into a sequence, or at end of a structural node.
                console.log("MathEditor: Character input in unhandled focus context:", currentFocus.kind);
            }
        } else if (key === 'Backspace') {
            // ... (zipperDeleteNode or modifySymNodeText) ...
            const currentFocus = this.zipper.focus;
            let currentOffset = this.zipper.charOffset === undefined ? (currentFocus.kind === 'sym' ? currentFocus.text.length : 0) : this.zipper.charOffset;
            if (currentFocus.kind === 'sym' && currentOffset > 0) {
                 const newText = currentFocus.text.slice(0, currentOffset - 1) + currentFocus.text.slice(currentOffset);
                 newZipperState = zipperModifySymNodeText(this.zipper, newText, currentOffset - 1);
                 if(newZipperState) astChanged = true;
            } else {
                newZipperState = zipperDeleteNode(this.zipper);
                if (newZipperState) astChanged = true;
            }

        } else if (key === 'ArrowLeft') {
            // ... (zipperLeft, or update charOffset) ...
             const currentFocus = this.zipper.focus;
            let currentOffset = this.zipper.charOffset === undefined ? 0 : this.zipper.charOffset;
            if (currentFocus.kind === 'sym' && currentOffset > 0) {
                newZipperState = {...this.zipper, charOffset: currentOffset - 1 };
            } else {
                newZipperState = zipperLeft(this.zipper) || zipperUp(this.zipper);
                if (newZipperState && newZipperState.focus.kind === 'sym') {
                    newZipperState.charOffset = newZipperState.focus.text.length; // Move to end
                }
            }
        } else if (key === 'ArrowRight') {
            // ... (zipperRight, or update charOffset) ...
             const currentFocus = this.zipper.focus;
            let currentOffset = this.zipper.charOffset === undefined ? 0 : this.zipper.charOffset;
             if (currentFocus.kind === 'sym' && currentOffset < currentFocus.text.length) {
                newZipperState = {...this.zipper, charOffset: currentOffset + 1 };
            } else {
                newZipperState = zipperRight(this.zipper) || zipperUp(this.zipper); // Simplistic for now
                 if (newZipperState && newZipperState.focus.kind === 'sym') {
                    newZipperState.charOffset = 0; // Move to start
                }
            }
        }
        // TODO: Handle ArrowUp, ArrowDown (complex navigation in fractions/matrices)
        // TODO: Handle structure insertion (e.g., user presses "fraction" button)

        if (newZipperState) {
            this.zipper = newZipperState;
        }

        if (astChanged) {
            console.log("MathEditor: AST changed due to key press. Updating state and re-rendering.");
            // This is the critical synchronization step:
            // 1. Get new LaTeX from the modified zipper's AST
            const newLatexFromZipper = toLatex(zipperToAST(this.zipper));
            
            // 2. Use updateParse (which currently does a full re-parse)
            //    This ensures spans and all AST properties are consistent after arbitrary zipper ops.
            //    The offsets for updateParse would ideally come from a diff, but for full re-parse,
            //    we can consider it as replacing the whole old text with newLatexFromZipper.
            this.state = updateParse(this.state, 0, this.state.source.length, newLatexFromZipper);

            // 3. Re-establish zipper focus in the new AST. This is hard.
            //    The old zipper.focus.id is gone. We need to find the "equivalent" position.
            //    For now, a naive reset or try to find by path structure or nearby text.
            //    This is a major TODO for good UX after edits.
            const oldFocusCharOffset = this.zipper.charOffset; // Try to preserve
            this.zipper = fromAST(this.state.ast); // Reset to root for now
            // Attempt to restore focus to a similar logical position if possible (very hard)
            // e.g. by finding a node with similar text/kind at a similar depth.
            // For now, we just update the visual caret which will be at the new (reset) zipper focus.
            console.warn("MathEditor: Zipper focus reset to root after AST change. Implement intelligent focus restoration.");

            this.scheduleRender();
        } else {
            // Only caret position might have changed due to navigation
            console.log("MathEditor: Caret position updated without AST change.");
            this.updateVisualCaretPosition();
        }
    }
    
    private scheduleRender(): void {
        if (this.renderTimeoutId !== null) {
            clearTimeout(this.renderTimeoutId);
        }
        this.renderTimeoutId = window.setTimeout(() => {
            this.renderAndMap().catch(err => console.error("MathEditor: Error during scheduled re-render:", err));
            this.renderTimeoutId = null;
        }, 50); // Debounce rendering slightly
    }
}