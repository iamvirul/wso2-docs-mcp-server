#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Claude Code — Add Choreo Labs Docs MCP Server (stdio transport)
# ──────────────────────────────────────────────────────────
# Run this once after completing the setup steps in README.md

claude mcp add choreo-labs-docs \
  --transport stdio \
  -e DATABASE_URL="postgresql://choreomcp:choreomcp@localhost:5432/choreodocs" \
  -e EMBEDDING_PROVIDER="ollama" \
  -- npx -y choreo-labs-docs-mcp-server

echo "Choreo Labs Docs MCP server added to Claude Code"
echo "   Verify with: claude mcp list"
