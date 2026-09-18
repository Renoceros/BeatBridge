# BeatBridge (`ytmusic-mcp-dj`)

> Agent-steered programmatic DJ playback engine and embedded Model Context Protocol (MCP) host for YouTube Music.

BeatBridge wraps YouTube Music inside an Electron host with a persistent session (`persist:ytmusic`) and exposes a local MCP server over SSE on port `4382`, plus a zero-dependency CLI bridge for stdio-bound orchestrators.

---

## Architecture

- **Electron Webview**: Renders `music.youtube.com`. Authenticate once in the GUI—no Google Cloud API keys or developer console setup required.
- **PlayerBridge**: Injects scripts into the DOM to inspect player states and mutate queues on the fly without page reload or audio stutter.
- **InnerTube Client**: Reuses extracted session cookies to query `/youtubei/v1/` endpoints for semantic search and radio seed graph traversal.
- **MCP SSE Server**: Embedded HTTP/SSE server listening on `http://127.0.0.1:4382/sse`.
- **Stdio Bridge CLI (`ytmusic-mcp-bridge`)**: Standalone proxy piping stdio to port `4382`.

---

## Available MCP Tools

1. `player_get_state` — Real-time status of active playback, progress, volume, and track metadata.
2. `queue_inspect` — Ordered inspection of played, playing, and upcoming queue items.
3. `music_search` — Semantic query search for songs on YouTube Music.
4. `music_get_radio_seeds` — Algorithmic watch-next seeds for DJ transition curves.
5. `queue_insert_relative` — Insert tracks at arbitrary offsets relative to current song (e.g. offset `1` for Up Next).
6. `queue_append` — Append tracks to the end of the queue.
7. `queue_jump_to` — Jump playback directly to a queue index.
8. `queue_remove` — Remove an item from the queue by index.
9. `player_control` — Playback transport controls (`play`, `pause`, `next`, `previous`, `seek`).

---

## Getting Started

### 1. Installation & Build

```bash
npm install
npm run build
```

### 2. Run Self-Checks

```bash
npm test
```

### 3. Launch BeatBridge

```bash
npm start
```

Log in to your YouTube Music account in the window. Session cookies are automatically stored in the local persistent partition.

---

## Client Configurations

### Google Antigravity IDE (`~/.gemini/config/mcp_config.json`)

```json
{
  "mcpServers": {
    "ytmusic-dj": {
      "serverUrl": "http://127.0.0.1:4382/sse"
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "ytmusic-dj": {
      "command": "node",
      "args": ["/Users/moreno_m5/Projects/BeatBridge/dist/bin/bridge.js", "--port", "4382"]
    }
  }
}
```

---

## License

MIT
