#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Claude Code — Add Choreo Docs MCP Server (stdio transport)
# ──────────────────────────────────────────────────────────
# Run this once after completing the setup steps in README.md

claude mcp add choreo-docs \
  --transport stdio \
  -e DATABASE_URL="postgresql://choreomcp:choreomcp@localhost:5432/choreodocs" \
  -e EMBEDDING_PROVIDER="ollama" \
  -- npx -y choreo-docs-mcp-server

echo "Choreo Docs MCP server added to Claude Code"
echo "   Verify with: claude mcp list"
