# Blug

Keeps a live architecture diagram (`ARCHITECTURE.md`, Mermaid) in sync with
your codebase, and alerts you the moment a change touches DB schema, API
surface, infra, dependencies, or messaging — **before** anyone gets surprised
by a schema drift they didn't see.

Built to be **agent-agnostic**: it doesn't hook into Claude Code, Codex, or
any specific tool. It watches the filesystem directly, so it works no matter
which agent (or human) made the change, or whether that agent has a hook
system at all.

## Why not just use a CI diagram generator?

Those only run on `git push` — by the time the diagram updates, the schema
drift already happened locally and may have already confused a teammate (or
future-you) who was working off the stale picture. blug catches it the
moment the file is saved, before any commit.

## How it works

```
┌─────────────────┐
│  filesystem      │  ← any agent or human edits a file
│  (chokidar watch)│
└────────┬─────────┘
         │ file changed
         ▼
┌─────────────────┐     not architecture-relevant → ignored, no-op
│  classify.ts     │────────────────────────────────┐
└────────┬─────────┘                                │
         │ schema / api / infra / deps / messaging   │
         ▼                                           │
┌─────────────────┐                                  │
│  analyzer.ts     │  regex-based structural extraction
│  (per category)  │  (tables, endpoints, services, deps, queues)
└────────┬─────────┘
         │ Component[]
         ▼
┌─────────────────┐
│  store.ts        │  merge into .blug/model.json, diff vs. previous
└────────┬─────────┘
         │ DriftReport
         ▼
┌─────────────────┐        ┌──────────────────┐
│  diagram.ts       │──────▶│ ARCHITECTURE.md  │  (git-friendly Mermaid)
└─────────────────┘        └──────────────────┘
         │
         ▼
┌─────────────────┐
│  notify.ts        │  terminal banner + desktop notification
└─────────────────┘
```

If an architecture-relevant file is deleted, blug removes components that were
previously attributed to that file and regenerates the diagram.

Three ways to run it, pick what fits your workflow:

| Mode | Command | When it fires | Works for |
|---|---|---|---|
| Standalone daemon | `npm run watch:daemon` | Instantly on any file save | Any agent, any editor, humans too |
| MCP server | `npm run mcp` | On demand, when an agent calls the tool | Codex, Claude Code, any MCP client |
| CLI (hook-driven) | `blug check <file>` | Triggered by a tool-specific hook | Claude Code `PostToolUse`, git hooks, etc. |

Run more than one at once if you like — they share the same
`.blug/model.json`, so they stay consistent with each other.

## Setup

```bash
npm install
npm test
npm run build
```

### Option A — standalone daemon (recommended default)

```bash
cd your-repo
node /path/to/blug/dist/watcher.js
```

Leave it running in a terminal (or a tmux pane) while you work. Seed the
baseline once per repo:

```bash
node /path/to/blug/dist/cli.js init
```

This creates `.blug/model.json` and `ARCHITECTURE.md`. If no components are
detected yet, `ARCHITECTURE.md` is still written with an empty-state diagram.

### Option B — MCP server (Codex, or Claude Code without hooks)

See `docs/codex-setup.md` for Codex. For Claude Code:

```json
// ~/.claude/settings.json or project .mcp.json
{
  "mcpServers": {
    "blug": {
      "command": "node",
      "args": ["/path/to/blug/dist/mcp-server.js"]
    }
  }
}
```

### Option C — Claude Code hook (guaranteed trigger, no daemon needed)

```json
// ~/.claude/settings.json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "/path/to/blug/hooks/claude-code-post-tool-use.sh" }]
      }
    ]
  }
}
```

This fires after every file edit Claude Code makes, checks just that file,
and updates the diagram + alerts if it's architecture-relevant. No daemon
process required.

## What counts as "architecture-relevant"

See `src/classify.ts` — currently: DB migrations/schema files (SQL, Prisma,
EF Core `DbSet`), API route definitions (Express/Fastify, ASP.NET attribute
routing, Flask/FastAPI, OpenAPI/gRPC), infra (`docker-compose.yml`,
`Dockerfile`, Terraform, k8s manifests, GitHub Actions), dependency manifests
(`package.json`, `requirements.txt`, `.csproj`, `go.mod`, `pom.xml`), and
messaging (queue/topic declarations). It's a static rule table — extend it
for your stack in five minutes.

## Extending the extraction (analyzer.ts)

Right now `analyzer.ts` is regex-based on purpose: fast, free, deterministic,
zero API calls. It's conservative — it'll miss unusual patterns rather than
hallucinate components. If you want richer extraction (e.g. inferring FK
relationships, or handling an ORM style the regexes don't cover), swap the
relevant `extract*()` function for an LLM call — the rest of the pipeline
(store, diagram, notify) doesn't care where `Component[]` came from.

## Known limitations

- Regex extraction won't catch every schema/route style — it's a starting
  rule set, not exhaustive. Add patterns for your stack in `analyzer.ts`.
- Relationships (FKs, service calls) aren't inferred yet — `model.relationships`
  is wired up in the diagram renderer but nothing populates it yet.
- The MCP server's full-repo scan (`check_architecture_drift` with no
  `paths`) re-reads every matching file each call — fine for CI/on-demand,
  not meant to run on a timer.
