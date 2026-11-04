import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Ast = { type: string; nodes?: Ast[] };
type Braces = {
	(input: string | string[], options?: Record<string, unknown>): string[];
	parse(input: string, options?: Record<string, unknown>): Ast;
	compile(input: string | Ast, options?: Record<string, unknown>): string;
	expand(input: string | Ast, options?: Record<string, unknown>): string[];
	stringify(input: string | Ast, options?: Record<string, unknown>): string;
};
const braces = require("braces") as Braces;

describe("hardened brace patterns used by build and lint tooling", () => {
	it("installs the documented patched implementation for transitive consumers", () => {
		const fromMicromatch = createRequire(require.resolve("micromatch"));
		expect(fromMicromatch("braces/package.json")).toMatchObject({
			name: "@mailflare/braces",
			version: "3.0.3-mailflare.1",
		});
		expect(fromMicromatch.resolve("braces")).toBe(require.resolve("braces"));
	});

	it("preserves alternatives, numeric ranges, nested patterns and AST round trips", () => {
		expect(braces.expand("src/{app,lib}/file-{01..03}.ts")).toEqual([
			"src/app/file-01.ts",
			"src/app/file-02.ts",
			"src/app/file-03.ts",
			"src/lib/file-01.ts",
			"src/lib/file-02.ts",
			"src/lib/file-03.ts",
		]);
		expect(braces.compile("src/{app,lib}/**/*.{ts,tsx}")).toBe("src/(app|lib)/**/*.(ts|tsx)");
		expect(braces.expand("{a,{b,c}}/{1..2}")).toEqual(["a/1", "a/2", "b/1", "b/2", "c/1", "c/2"]);
		const ast = braces.parse("folder/{alpha,beta}/file.ts");
		expect(braces.stringify(ast)).toBe("folder/{alpha,beta}/file.ts");
		expect(braces.compile(ast)).toBe("folder/(alpha|beta)/file.ts");
		expect(braces(["{a,b}", "{b,c}"], { expand: true, nodupes: true })).toEqual(["a", "b", "c"]);
	});

	it("rejects deep brace and parenthesis strings below the upstream character limit", () => {
		for (const [open, close] of [
			["{", "}"],
			["(", ")"],
		]) {
			const input = open.repeat(4000) + "a,b" + close.repeat(4000);
			for (const operation of [braces.parse, braces.compile, braces.expand, braces.stringify]) {
				expect(() => operation(input, { maxDepth: Infinity })).toThrow(/maximum nesting depth/);
			}
		}
	});

	it("validates supplied ASTs and direct recursive library entry points before walking", () => {
		let ast: Ast = { type: "text" };
		for (let index = 0; index < 2000; index++) ast = { type: "root", nodes: [ast] };
		for (const name of ["compile", "expand", "stringify"]) {
			const operation = require(`braces/lib/${name}`) as (input: Ast) => unknown;
			expect(() => operation(ast)).toThrow(/maximum nesting depth/);
		}
		const cyclic: Ast = { type: "root", nodes: [] };
		cyclic.nodes!.push(cyclic);
		expect(() => braces.compile(cyclic)).toThrow(/maximum nesting depth/);
	});

	it("preserves escaped literal braces and the upstream expansion range limit", () => {
		expect(braces.expand("literal/\\{alpha,beta\\}")).toEqual(["literal/{alpha,beta}"]);
		expect(() => braces.compile("\\{".repeat(4000))).not.toThrow();
		expect(() => braces.expand("{1..1001}")).toThrow(/range limit/);
	});

	it("bounds oversized caller-supplied ASTs without allocating their traversal", () => {
		const ast: Ast = { type: "root", nodes: new Array<Ast>(150000).fill({ type: "text" }) };
		expect(() => braces.stringify(ast)).toThrow(/maximum AST size/);
	});
});
