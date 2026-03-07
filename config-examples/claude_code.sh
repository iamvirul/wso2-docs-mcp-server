#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Claude Code — Add WSO2 Docs MCP Server (stdio transport)
# ──────────────────────────────────────────────────────────
# Run this once from the project root after `npm install`

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

claude mcp add wso2-docs \
  --transport stdio \
  -- node "$PROJECT_DIR/dist/index.js"

# Or use tsx for development (no build step required):
# claude mcp add wso2-docs \
#   --transport stdio \
#   -- npx tsx "$PROJECT_DIR/src/index.ts"

echo "✅  WSO2 Docs MCP server added to Claude Code"
echo "   Verify with: claude mcp list"
