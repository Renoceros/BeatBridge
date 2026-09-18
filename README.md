# BeatBridge (ytmusic-mcp-dj)

Programmatic, agent-steered playback engine and embedded Model Context Protocol (MCP) server for YouTube Music.

---

## 1. What It Is

BeatBridge is an Electron-based desktop host that wraps YouTube Music (`music.youtube.com`) and exposes its playback state, queue, and discovery graph to artificial intelligence agents through the Model Context Protocol (MCP).

By hosting the web client inside an Electron window with an embedded HTTP/SSE server, BeatBridge allows AI agents running in Google Antigravity, Claude Desktop, Cursor, or custom orchestration frameworks to:
- Inspect active playback status, progress, track metadata, and volume in real time.
- Inspect the live queue (played, currently playing, and upcoming tracks).
- Mutate the queue dynamically without reloading the page or interrupting audio playback (inserting next, appending, jumping, or removing tracks).
- Execute semantic song searches and query YouTube Music's latent recommendation graph (radio seeds) to build smooth DJ transition curves between disparate musical genres.

---

## 2. Why It Exists

Standard music streaming APIs (such as the official YouTube Data API or Spotify Web API) present significant friction for local developer agents and desktop coding environments:
1. **API Key Overhead & Quotas**: Official APIs require setting up a Google Cloud project, configuring OAuth consent screens, managing redirect URIs, and dealing with restrictive daily quota limits.
2. **Disconnected Playback State**: Web APIs cannot interact with your active, ephemeral browser playback queue directly unless you stream audio through a third-party playback client.
3. **Audio Disruption**: Automating standard browser tabs via general-purpose browser drivers (like Selenium or Playwright) frequently triggers page reloads, UI jitter, focus stealing, or audio stutter.
4. **Lack of Algorithmic DJ Seeds**: YouTube Data API v3 does not expose YouTube Music's underlying "watch next" radio graph—the exact recommendation engine that powers automated playlist continuation based on acoustic similarity and user co-listening behavior.

BeatBridge solves this by treating YouTube Music's desktop web application as a headless-capable, agent-controlled playback device. You log in once via standard Google authentication, and your local AI tools immediately gain native, zero-latency control over your music stream.

---

## 3. How It Works

BeatBridge consists of five interacting subsystems:

```
+-------------------------------------------------------------------+
|                     Electron Runtime Process                      |
|                                                                   |
|   +-----------------------+           +-----------------------+   |
|   |    WebContents View   |           |     MCP Host Core     |   |
|   |  (music.youtube.com)  |           |     (TypeScript)      |   |
|   +-----------+-----------+           +-----------+-----------+   |
|               |                                   |               |
|       Preload / CDP IPC                   Internal Dispatch       |
|               |                                   |               |
|   +-----------v-----------------------------------v-----------+   |
|   |                    PlayerBridge Controller                |   |
|   |  - Session Cookie Store (ytmusic / InnerTube Client)      |   |
|   |  - DOM Injection Harness (Player & Queue Control)         |   |
|   |  - SSE Transport Server (127.0.0.1:4382/sse)              |   |
|   +-------------------------------+---------------------------+   |
+-----------------------------------|-------------------------------+
                                    |
                    Local MCP Transport (SSE or Stdio)
                                    |
          +-------------------------+-------------------------+
          |                                                   |
+---------v-----------------+               +-----------------v---------+
| Native SSE Orchestrators  |               | Stdio-Bound Orchestrators |
| (Google Antigravity IDE)  |               | (Claude Desktop, Cursor)  |
| Config: serverUrl (:4382) |               | via: ytmusic-mcp-bridge   |
+---------------------------+               +---------------------------+
```

### Subsystem Breakdown

1. **Persistent Session Partition (`persist:ytmusic`)**:
   The webview uses an isolated Chromium session partition. Cookies, login sessions, and local storage persist across application restarts. No API keys or external authentication services are required.

2. **PlayerBridge DOM Injection Engine**:
   Executes asynchronous JavaScript within the webview context. It reads live DOM nodes from Polymer/Lit custom elements (`ytmusic-player-bar`, `ytmusic-player-queue`) and dispatches mutations directly to YouTube Music's internal application store (`ADD_ITEMS_TO_QUEUE`, `REMOVE_ITEM_FROM_QUEUE`).

3. **InnerTube Background Client**:
   Bypasses DOM scraping for search and discovery. It extracts the session's active `SAPISID` cookie, generates standard SHA-1 `SAPISIDHASH` authorization headers, and communicates directly with YouTube's internal `/youtubei/v1/search` and `/youtubei/v1/next` endpoints.

4. **Embedded MCP SSE Server**:
   A native Node HTTP server running inside the Electron main process listening on `http://127.0.0.1:4382`. It implements the Model Context Protocol over Server-Sent Events (`/sse`) and receives JSON-RPC commands at `/message`.

5. **Universal Stdio Bridge CLI (`ytmusic-mcp-bridge`)**:
   A companion CLI binary (`dist/bin/bridge.js`) that translates standard input/output (stdio) streams to the local HTTP/SSE server. This allows clients that only support process-based MCP communication (such as Claude Desktop and Cursor) to interface with BeatBridge seamlessly.

---

## 4. Algorithmic DJ Flow: Transition Bridging

When an agent is asked: *"Queue up 'Resonance' in 3 tracks, making the transition smooth from our current track"*, BeatBridge facilitates the following automated workflow:

1. **State Capture**: The agent calls `player_get_state()` and `queue_inspect()` to retrieve the currently playing track ID ($T_{current}$) and active queue index.
2. **Target Resolution**: The agent calls `music_search({ query: "Resonance HOME" })` to resolve the target track ID ($T_{target}$).
3. **Dual Graph Traversal**:
   - The agent calls `music_get_radio_seeds({ videoId: T_{current}.videoId })` yielding candidate set $A$.
   - The agent calls `music_get_radio_seeds({ videoId: T_{target}.videoId })` yielding candidate set $B$.
4. **Aesthetic Interpolation**: The agent evaluates track metadata (tempo, vibe, acoustic profile) across sets $A$ and $B$ within its reasoning window to select two bridge tracks ($Bridge_1 \in A$ and $Bridge_2 \in B$).
5. **Atomic Queue Mutation**: The agent calls `queue_insert_relative({ videoIds: [Bridge_1.id, Bridge_2.id, T_{target}.id], offset: 1 })`. The tracks appear immediately in the upcoming queue without interrupting playback.

---

## 5. Available MCP Tools

BeatBridge exposes 9 tools conforming to the Model Context Protocol specification:

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `player_get_state` | *None* | Returns real-time status: `isPlaying`, `elapsedSeconds`, `totalSeconds`, and active `track` metadata (title, artist, videoId). |
| `queue_inspect` | *None* | Returns the ordered queue items, active `currentIndex`, and item status (`played`, `playing`, `upcoming`). |
| `music_search` | `query` (string), `limit` (number, default 5) | Performs semantic search on YouTube Music and returns matched song entities. |
| `music_get_radio_seeds` | `videoId` (string), `limit` (number, default 10) | Fetches algorithmic watch-next candidates derived from YouTube's audio graph. |
| `queue_insert_relative` | `videoIds` (string[]), `offset` (number, default 1) | Inserts tracks at relative offsets from the current song (`offset: 1` = Up Next). |
| `queue_append` | `videoIds` (string[]) | Appends an array of video IDs to the end of the active queue. |
| `queue_jump_to` | `index` (number) | Jumps playback directly to a specific item index in the queue. |
| `queue_remove` | `index` (number) | Removes a specific track index from the upcoming queue. |
| `player_control` | `action` ("play", "pause", "next", "previous", "seek"), `seekSeconds` (optional number) | Transport playback controls. |

---

## 6. Getting Started

### Prerequisites
- macOS, Linux, or Windows
- Node.js (v18 or higher)
- npm (v9 or higher)

### Installation & Build

Clone the repository and install dependencies:

```bash
git clone https://github.com/Renoceros/BeatBridge.git
cd BeatBridge
npm install
npm run build
```

### Running Self-Checks

Verify that cryptographic hash generators, MCP tool registries, the HTTP/SSE server, and the stdio proxy bridge pass all integration checks:

```bash
npm test
```

### Launching the Host Application

Start the Electron desktop host:

```bash
npm start
```

1. A window will launch loading `music.youtube.com`.
2. Complete your Google / YouTube Music sign-in once in the GUI.
3. The embedded MCP server automatically begins listening on `http://127.0.0.1:4382/sse`.

---

## 7. Client Configuration

### Google Antigravity IDE

Add the server entry to your configuration file at `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "ytmusic-dj": {
      "serverUrl": "http://127.0.0.1:4382/sse"
    }
  }
}
```

### Claude Desktop

Add the stdio bridge configuration to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "ytmusic-dj": {
      "command": "node",
      "args": [
        "/Users/YOUR_USERNAME/Projects/BeatBridge/dist/bin/bridge.js",
        "--port",
        "4382"
      ]
    }
  }
}
```

### Cursor / Generic Stdio MCP Clients

Use the compiled bridge CLI directly:

```bash
node /path/to/BeatBridge/dist/bin/bridge.js --port 4382
```

---

## 8. Frequently Asked Questions (FAQ)

#### Do I need a Google Cloud API key or YouTube developer quota?
No. BeatBridge runs an embedded Chromium browser session using an isolated partition (`persist:ytmusic`). You log in using your standard Google account in the Electron interface. All requests utilize your browser session credentials (`SAPISID`), eliminating the need for Google Cloud Console setup, developer tokens, or API billing.

#### Does mutating the queue cause the audio to stutter or the page to reload?
No. All queue manipulations (`queue_insert_relative`, `queue_append`, `queue_remove`) are dispatched directly into the in-memory Polymer store of the running single-page application. The active HTML5 audio element continues playback without disruption.

#### What happens if I close BeatBridge?
If the Electron app is closed, the local MCP server on port `4382` stops responding. Any active stdio bridges will output a diagnostic error indicating that the host process is offline. To continue using the agent controls, launch BeatBridge (`npm start`).

#### Can multiple agent clients connect at the same time?
Yes. The MCP SSE transport assigns isolated session IDs (`sessionId`) to each incoming client connection. You can have Google Antigravity and Claude Desktop connected to the same BeatBridge instance concurrently.

#### Does BeatBridge work with YouTube Free accounts, or is YouTube Music Premium required?
BeatBridge functions with both free and YouTube Music Premium accounts. However, free accounts are subject to standard YouTube video advertisements between tracks, which may briefly affect elapsed time readings during ad playback.

#### Where are my login credentials stored?
All cookies, local storage, and session tokens remain within Electron's standard user data directory on your local machine (`persist:ytmusic`). No tokens or cookies are ever transmitted to external servers or third-party APIs.

---

## 9. License

This project is open source and available under the [MIT License](LICENSE).
