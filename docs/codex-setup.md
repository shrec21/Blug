# Codex CLI integration

Codex CLI supports MCP servers via its config. Add blug as a server:

```
codex mcp add blug -- node /absolute/path/to/blug/dist/mcp-server.js
```

Verify it registered:

```
codex mcp list
```

Then, inside a Codex session, `/mcp` should show `blug` with two tools:

- `check_architecture_drift` - scan specific relative paths, or omit `paths` to scan the whole repo. It updates `.blug/model.json` and `ARCHITECTURE.md` when drift is found.
- `get_architecture_diagram` - return the current Mermaid diagram without rescanning.

## Prompting Codex to use it automatically

Add to your `AGENTS.md` or system prompt for the repo:

```
After any change to database schema, API routes, docker-compose, or dependency
manifests, call the blug `check_architecture_drift` tool with the changed
file path(s) before finishing your turn. If it reports drift, mention it in
your summary to the user.
```

This is the Codex equivalent of the Claude Code hook — since Codex doesn't
(yet) have Claude Code's structured hook system, the instruction lives in
AGENTS.md instead and relies on the model calling the tool, rather than a
guaranteed local trigger. If you want a guarantee regardless of whether the
model remembers, run the standalone daemon (`npm run watch:daemon`) alongside
your Codex session instead — it doesn't depend on the agent calling anything.
