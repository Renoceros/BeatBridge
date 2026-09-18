# BeatBridge DJ - Browser Extension & Multi-Platform MCP Host

Programmatic, agent-steered playback engine and embedded Model Context Protocol (MCP) server for YouTube Music, Spotify, and SoundCloud.

---

## 1. What It Is

BeatBridge connects your active web player (YouTube Music, Spotify Web, or SoundCloud) in Brave or Chrome directly to AI agents (Google Antigravity, Claude Desktop, Cursor) via the Model Context Protocol (MCP).

Instead of running an embedded Electron browser that gets blocked by Google's anti-bot/device verification checks, BeatBridge uses a lean Chrome/Brave Extension (`Manifest V3`) that hooks directly into your already-authenticated browser tabs or installed PWAs, paired with a local Node daemon.

---

## 2. Why It Exists

1. **Zero Login Blockers**: Google's modern authentication checks block embedded Chromium/Electron windows. Operating as a browser extension inside your primary Brave/Chrome instance bypasses this entirely.
2. **Authentic Session & Premium**: Uses your active browser session, cookies, playlists, YouTube Music Premium (no ads), Spotify Premium, and SoundCloud profiles without re-entering credentials.
3. **Multi-Platform Ready**: Supports YouTube Music, Spotify Web Player, and SoundCloud.
4. **Minimal Overhead**: No duplicate Electron runtime consuming memory. Runs a tiny Node daemon listening on port 4382.

---

## 3. Architecture

```
+------------------------------------+              +-------------------------------+
|  Brave / Chrome Browser or PWA     |              |      BeatBridge Local Host    |
|                                    |              |       (Node MCP Daemon)       |
|  - music.youtube.com               |  WebSocket   |                               |
|  - open.spotify.com                |<------------>|  - MCP Server (:4382/sse)     |
|  - soundcloud.com                  | (:4382/ws)   |  - Extension Bridge (:4382/ws)|
|                                    |              |  - Stdio Proxy (bridge.js)    |
|  [BeatBridge Extension (MV3)]      |              +---------------+---------------+
|  - Injected player controllers     |                              |
+------------------------------------+                              |
                                                      Antigravity / Claude / Cursor
```

---

## 4. Available MCP Tools

All 9 DJ tools are exposed over MCP:

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `player_get_state` | *None* | Returns real-time status: `isPlaying`, `elapsedSeconds`, `totalSeconds`, and active `track` metadata. |
| `queue_inspect` | *None* | Returns ordered queue items, active `currentIndex`, and item status (`played`, `playing`, `upcoming`). |
| `music_search` | `query` (string), `limit` (number, default 5) | Performs search on active streaming platform. |
| `music_get_radio_seeds` | `videoId` (string), `limit` (number, default 10) | Fetches algorithmic watch-next seeds for DJ transitions. |
| `queue_insert_relative` | `videoIds` (string[]), `offset` (number, default 1) | Inserts tracks relative to active song (`offset: 1` = Up Next). |
| `queue_append` | `videoIds` (string[]) | Appends an array of video IDs to the end of the active queue. |
| `queue_jump_to` | `index` (number) | Jumps playback directly to a specific item index in the queue. |
| `queue_remove` | `index` (number) | Removes a specific track index from the upcoming queue. |
| `player_control` | `action` ("play", "pause", "next", "previous", "seek"), `seekSeconds` (optional number) | Transport playback controls. |

---

## 5. Setup & Getting Started

### Step 1: Install & Build Daemon

```bash
cd /Users/moreno_m5/Projects/BeatBridge
npm install
npm run build
```

### Step 2: Start the BeatBridge Daemon

```bash
npm start
```

The daemon starts:
- MCP SSE Server: `http://127.0.0.1:4382/sse`
- Extension WebSocket Bridge: `ws://127.0.0.1:4382/ws`

### Step 3: Install Extension in Brave / Chrome

1. Open Brave or Chrome and navigate to `brave://extensions` (or `chrome://extensions`).
2. Enable **Developer mode** (toggle in the top right).
3. Click **Load unpacked**.
4. Select the directory:
   `/Users/moreno_m5/Projects/BeatBridge/extension`
5. Open your YouTube Music, Spotify, or SoundCloud tab (or your installed YouTube Music PWA in Brave).
6. Click the BeatBridge extension icon to verify the green "Connected" status dot.

---

## 6. Client Configuration

### Google Antigravity (`~/.gemini/config/mcp_config.json`)

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

## 7. License

MIT
