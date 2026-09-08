# coder-stack (Cursor / Antigravity drop-in)

Unzip this into the **root of a git project**. The supervisor agent then follows
the shared workflow. You do **not** install Docker, Compose, or a model.

```bash
cd /path/to/your-project
unzip ready-for-you.zip
```

This repo must be opened **on the GPU server** where `coder-stack` is already
on PATH (or at `/home/tanglab/.local/bin/coder-stack`). The stack is started
once by the server owner. You never run `docker`, `build`, or `start`.

Does not overwrite your project README. Adds:

```text
.agents/mcp_config.json
.agents/rules/coder-stack.md
.cursor/mcp.json
.cursor/rules/coder-stack.mdc
.coder-stack/README.md
```

## Enable MCP

**Cursor:** Settings → MCP → enable **coder-stack** (green). Reload MCP if needed.
Do not restart Docker.

**Antigravity over SSH:** Agent Panel MCP often fails with
`context deadline exceeded`. That is an Antigravity/SSH stdio handshake
limit, not a broken Qwen stack. If `coder-stack status` prints health OK,
use the CLI from the git root. Do not loop on MCP reload. Do not start Docker.

**Antigravity (MCP loaded, typically local not SSH):** Agent panel → … →
MCP Servers. `.agents/mcp_config.json` is command-only. Always-on rule:
`.agents/rules/coder-stack.md`. Tools: status, smoke, implement, review, correct.

The MCP server resolves `realpath` then `git rev-parse --show-toplevel` and
runs workers there. Process cwd has no semantic role. Do not use
`${workspaceFolder}` in config.

```
Cursor / Antigravity
  → coder_stack_implement(workspace_root, task, allowed_files, acceptance)
  → tests / build / lint
  → coder_stack_review
  → small findings → coder_stack_correct
  → large findings → coder_stack_implement
  → re-test
```
