#!/usr/bin/env bash
# Claude Code PostToolUse hook.
#
# Install: add to ~/.claude/settings.json (or project .claude/settings.json):
#
# {
#   "hooks": {
#     "PostToolUse": [
#       {
#         "matcher": "Edit|Write",
#         "hooks": [{ "type": "command", "command": "/path/to/blug/hooks/claude-code-post-tool-use.sh" }]
#       }
#     ]
#   }
# }
#
# This does NOT re-implement blug logic. It just asks the already-running
# blug MCP tool (or, if you're not running MCP, the CLI) to check the file
# that was just touched. If you're already running the standalone daemon
# (npm run watch:daemon) in this repo, this hook is redundant but harmless —
# the daemon already caught the change directly from the filesystem.

FILE_PATH="$(cat - | node -e "
  let d='';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try { console.log(JSON.parse(d).tool_input.file_path || ''); }
    catch { console.log(''); }
  });
")"

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

BLUG_DIR="$(dirname "$0")/.."
node "$BLUG_DIR/dist/cli.js" check "$FILE_PATH" 2>/dev/null
exit 0
