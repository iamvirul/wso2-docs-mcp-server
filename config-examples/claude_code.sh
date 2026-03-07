#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Claude Code — Add WSO2 Docs MCP Server (stdio transport)
# ──────────────────────────────────────────────────────────
# Run this once after completing the setup steps in README.md

claude mcp add wso2-docs \
  --transport stdio \
  -e DATABASE_URL="postgresql://wso2mcp:wso2mcp@localhost:5432/wso2docs" \
  -e EMBEDDING_PROVIDER="ollama" \
  -- npx -y wso2-docs-mcp-server

echo "WSO2 Docs MCP server added to Claude Code"
echo "   Verify with: claude mcp list"
