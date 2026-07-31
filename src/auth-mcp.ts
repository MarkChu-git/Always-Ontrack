#!/usr/bin/env bun

import { serveAuthMcp } from './auth-mcp-server.js';

serveAuthMcp().catch(() => {
  console.error('OnTrack Auth MCP failed to start.');
  process.exitCode = 1;
});
