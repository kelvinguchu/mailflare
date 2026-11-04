"use strict";

// Keep recursive upstream walkers below the JavaScript call-stack limit.
// This hard cap cannot be disabled through caller-supplied options.
const MAX_AST_DEPTH = 100;
const MAX_AST_NODES = 131074;

const assertBoundedAst = (ast) => {
	const pending = [{ node: ast, depth: 0 }];
	let visited = 0;
	while (pending.length) {
		const { node, depth } = pending.pop();
		if (depth > MAX_AST_DEPTH) {
			throw new SyntaxError(`Brace pattern exceeds maximum nesting depth (${MAX_AST_DEPTH})`);
		}
		if (++visited > MAX_AST_NODES) {
			throw new SyntaxError("Brace pattern exceeds maximum AST size");
		}
		if (!node || !Array.isArray(node.nodes)) continue;
		if (node.nodes.length + visited + pending.length > MAX_AST_NODES) {
			throw new SyntaxError("Brace pattern exceeds maximum AST size");
		}
		for (const child of node.nodes) {
			pending.push({ node: child, depth: depth + 1 });
		}
	}
};

module.exports = { MAX_AST_DEPTH, assertBoundedAst };
