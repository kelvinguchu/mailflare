# Mailflare braces security patch

This private fork retains the MIT-licensed source of `micromatch/braces` 3.0.3 and its normal CommonJS API. The upstream license and attribution are preserved in `LICENSE`.

Upstream advisory [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) reports stack exhaustion in recursive AST walkers; no patched upstream release was available on 7 October 2026. This package is deliberately named `@mailflare/braces` with version `3.0.3-mailflare.1`, rather than representing it as an upstream security release.

The parser rejects stack nesting beyond 100 before constructing deeper blocks. Compile, expand and stringify validate supplied ASTs iteratively before entering recursive walkers, with hard depth and node-count limits. Caller options cannot disable these limits. Normal alternatives, ranges, escaping and literal patterns retain upstream behavior. Excessive nesting produces a controlled `SyntaxError` instead of consuming the native call stack.

The root npm override replaces all `braces` consumers with this reviewed local implementation. `tests/braces-security.test.ts` verifies normal behavior and pathological strings/ASTs, including direct library entry points. The full lint, tests and Worker build exercise downstream glob consumers. Remove this fork and override when upstream publishes a compatible fix, after running the same regression checks.
