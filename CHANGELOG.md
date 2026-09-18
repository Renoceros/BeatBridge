# Changelog

All notable changes to Project BeatBridge (`ytmusic-mcp-dj`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-18

### Added
- **Electron Chromium Host**: Persistent partition `persist:ytmusic` rendering YouTube Music with zero Google Cloud API keys needed.
- **Auth Session & SAPISID Generator**: Automatic cookie extraction and SHA-1 `SAPISIDHASH` generator for authenticated YouTube internal requests.
- **PlayerBridge Controller**: DOM injection controller for real-time playback state inspection, queue inspection, non-disruptive relative track insertion, append, removal, and playback jump.
- **InnerTube Client**: Direct HTTP client to `/youtubei/v1/music/search` and `/youtubei/v1/next` for semantic search and radio seed graph extraction.
- **Embedded MCP Server**: Full Model Context Protocol SSE server on port `4382` with Zod validation for all 9 DJ tools (`player_get_state`, `queue_inspect`, `music_search`, `music_get_radio_seeds`, `queue_insert_relative`, `queue_append`, `queue_jump_to`, `queue_remove`, `player_control`).
- **Stdio Proxy Bridge CLI (`ytmusic-mcp-bridge`)**: Standalone binary bridging stdio to local SSE port `4382` for Claude Desktop, Cursor, and custom agent runtimes.
- **Self-Check Test Suite**: Assert-driven test harness verifying hashing, server instantiation, HTTP/SSE routes, and live stdio-to-SSE proxy communication.
