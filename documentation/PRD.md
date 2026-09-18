Project Overview
Product Name: Project BeatBridge (ytmusic-mcp-dj)
Type: Electron Desktop Host + Embedded Model Context Protocol (MCP) Server
Target Clients: Google Antigravity, Claude Desktop, Cursor, and custom agent runtimes
Project BeatBridge transforms YouTube Music into a programmatic, agent-steered playback engine. By hosting YouTube Music inside an Electron wrapper, it exposes a local MCP server that allows AI agents to inspect ephemeral playback states, read live queues, fetch latent audio graph seeds, and dynamically mutate queues with DJ-grade transition curves—without requiring Google Cloud API keys or external streaming service subscriptions.
Target Personas & Use Cases
The Flow-State Engineer (Antigravity IDE): Commands ambient, techno, or lofi queues inline via developer prompts without leaving the coding environment.
The Curation Architect (Claude Desktop / Conversational Agent): Requests precise aesthetic progressions (e.g., "ramp up from acoustic indie to french electro in 4 tracks") and expects harmonic, tempo-aware bridging.
The Party Co-Host: Requests batch queueing ("add 10 dark synthwave tracks") with automatic deduplication against existing queues and playback history.
Functional Requirements
FR-1: Frictionless Authentication & Display
FR-1.1: Embedded Chromium webview rendering music.youtube.com.
FR-1.2: Persistent local browser profile (persist:ytmusic). Standard Google authentication completed once via GUI; no Google Cloud Developer Console or API key configuration permitted.
FR-1.3: Cookie extraction mechanism to capture active SAPISID and __Secure-3PAPISID credentials for background requests.
FR-2: Playback State Introspection
FR-2.1: Real-time polling or event-based extraction of active track metadata: title, artist, album, videoId, durationSeconds, elapsedSeconds, and playbackStatus (PLAYING, PAUSED, BUFFERING).
FR-2.2: Real-time queue inspection exposing ordered items: index, title, artist, videoId, and state (PLAYED, ACTIVE, QUEUED).
FR-3: Live Queue Mutation
FR-3.1 Relative Insertion: Ability to insert tracks at arbitrary positions relative to the currently active index (offset: +1 for next, offset: +N for down-the-line insertion).
FR-3.2 Batch Appending: Ability to push lists of validated track IDs to the end of the active queue.
FR-3.3 Deduplication Enforcement: Inspection layer verifying candidates against the active queue prior to insertion.
FR-3.4 State Navigation: Capability to jump directly to a previously played or queued index (jump_to_index), or remove tracks (remove_from_queue).
FR-4: Discovery & Sonic Graph Traversal
FR-4.1 Semantic Entity Resolution: Natural-language search tool returning matched YouTube Music song entities and identifiers.
FR-4.2 Radio Seed Extraction: Direct extraction of YouTube Music’s latent recommendations via watch_playlist endpoints, returning contextually related tracks based on acoustic profile and user co-listening graphs.
FR-5: MCP Connectivity & Dual Transports
FR-5.1 Local Server: An embedded HTTP/SSE server running inside Electron bound to 127.0.0.1:4382.
FR-5.2 Universal Stdio Proxy: A zero-dependency CLI bridge package (ytmusic-mcp-bridge) that proxies stdio to localhost:4382 for legacy MCP orchestrators.
Non-Functional Requirements
NFR-1 (Latency): Queue inspection and transport operations must complete within ≤150 ms of agent invocation.
NFR-2 (Playback Continuity): Injected scripts must manipulate the player asynchronously without causing audio stutter, DOM freezes, or page refreshes.
NFR-3 (Reliability & Recovery): If DOM selectors change, script injection errors must return standardized MCP error messages instructing fallback behavior rather than terminating the MCP host process.