<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository agent rules

- Never stop, restart, replace, or take over a development server started by the user in order to launch an agent-owned server. Reuse the existing server when possible; if a restart is genuinely required, ask the user to do it or obtain their explicit approval first.
- Track development servers started by an agent and stop them before handing work back unless the user explicitly asks to keep them running.
