Technical Design Document (TDD)
System Architecture
┌─────────────────────────────────────────────────────────────┐
│                    Electron Runtime Process                 │
│                                                             │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │   WebContents View    │       │     MCP Host Core     │  │
│  │ (music.youtube.com)   │       │  (TypeScript / SDK)   │  │
│  └───────────▲───────────┘       └───────────▲───────────┘  │
│              │                               │              │
│      Preload / CDP IPC              Internal Dispatch       │
│              │                               │              │
│  ┌───────────▼───────────────────────────────▼───────────┐  │
│  │             PlayerBridge Controller                   │  │
│  │ - Session Cookie Store (ytmusicapi/InnerTube Client)  │  │
│  │ - DOM Injection Harness (Player & Queue Control)      │  │
│  │ - SSE Transport Server (:4382/sse)                    │  │
│  └───────────────────────────────────────────▲───────────┘  │
└──────────────────────────────────────────────┼──────────────┘
                                               │
                           Local MCP Transport (SSE or Stdio Bridge)
                                               │
                ┌──────────────────────────────┴──────────────────────────────┐
                ▼                                                             ▼
  ┌───────────────────────────┐                                 ┌───────────────────────────┐
  │  Native SSE Orchestrators │                                 │ Stdio-Bound Orchestrators │
  │ (Google Antigravity IDE)  │                                 │ (Claude Desktop, Cursor)  │
  │ Config: serverUrl (:4382) │                                 │ via: npx ytmusic-mcp-bridge│
  └───────────────────────────┘                                 └───────────────────────────┘
Module Specifications
1. PlayerBridge (DOM Injection Engine)
Executes within the context of the YouTube Music WebContents. YouTube Music runs a Polymer/Lit-based single-page application exposing elements under the ytmusic-app custom element tree.
DOM Selectors:
Player Bar: document.querySelector('ytmusic-player-bar')
Title / Artist: ytmusic-player-bar .title, ytmusic-player-bar .byline a
Play/Pause Toggle: document.querySelector('#play-pause-button')
Progress Slider: document.querySelector('#progress-bar')
Queue Elements: document.querySelectorAll('ytmusic-player-queue-item')
Direct DOM Queue Mutations:
To add a song to the active queue without page navigation, the bridge executes the following sequence:
Calls YouTube Music's internal action executor or simulates context menu interaction:
JavaScript
// Dispatched via webContents.executeJavaScript()
window.bridgeInsertNext = async (videoId) => {
  const response = await window.yt.config_.INNERTUBE_CONTEXT;
  // Dispatches via Polymer store action or UI trigger
  const queue = document.querySelector('ytmusic-app').querySelector('ytmusic-player-queue');
  if (queue && queue.dispatch) {
    queue.dispatch({
      type: 'ADD_ITEMS_TO_QUEUE',
      payload: { videoIds: [videoId] }
    });
  }
};
For reordering: Interacts directly with the underlying queue.data collection or triggers drag-drop synthetic events across the ytmusic-player-queue-item nodes.
2. InnerTubeService (Authenticated Background Client)
Bypasses web scraping by using extracted browser session cookies to call YouTube Music's internal API (/youtubei/v1/) directly.
Authentication Extraction:
On app ready, read cookies from Electron session:
TypeScript
import { session } from 'electron';

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const cookies = await session.fromPartition('persist:ytmusic').cookies.get({ domain: '.youtube.com' });
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  return {
    'Cookie': cookieHeader,
    'x-youtube-client-name': '67', // YouTube Music Web Client
    'x-youtube-client-version': '1.20260901.01.00',
    'authorization': generateSAPISIDHash(cookies.find(c => c.name === 'SAPISID')?.value)
  };
}
Endpoints Used:
music/search: Free-form semantic search queries.
next: Input { videoId }. Returns the algorithmic radio seeds, containing the raw candidate list for DJ transitions.
MCP Tool Interface Definitions
TypeScript
import { z } from 'zod';

export const Tools = {
  player_get_state: {
    description: "Get real-time status of active playback, progress, volume, and track details.",
    parameters: z.object({}),
    returns: z.object({
      isPlaying: z.boolean(),
      elapsedSeconds: z.number(),
      totalSeconds: z.number(),
      track: z.object({
        videoId: z.string(),
        title: z.string(),
        artist: z.string(),
        album: z.string().optional()
      }).nullable()
    })
  },

  queue_inspect: {
    description: "Inspect the current active playing queue, including history and upcoming tracks.",
    parameters: z.object({}),
    returns: z.object({
      currentIndex: z.number(),
      items: z.array(z.object({
        index: z.number(),
        videoId: z.string(),
        title: z.string(),
        artist: z.string(),
        status: z.enum(["played", "playing", "upcoming"])
      }))
    })
  },

  music_search: {
    description: "Search for songs, albums, or artists on YouTube Music.",
    parameters: z.object({
      query: z.string().describe("Search keywords, title, or semantic description"),
      limit: z.number().default(5)
    }),
    returns: z.array(z.object({
      videoId: z.string(),
      title: z.string(),
      artist: z.string(),
      duration: z.string()
    }))
  },

  music_get_radio_seeds: {
    description: "Retrieve algorithmic watch-next radio seeds derived from YouTube's audio graph for a given track.",
    parameters: z.object({
      videoId: z.string().describe("The anchor track videoId"),
      limit: z.number().default(10)
    }),
    returns: z.array(z.object({
      videoId: z.string(),
      title: z.string(),
      artist: z.string()
    }))
  },

  queue_insert_relative: {
    description: "Insert one or more tracks relative to the active song index (e.g., offset=1 means Up Next).",
    parameters: z.object({
      videoIds: z.array(z.string()).describe("List of video IDs to insert in sequence"),
      offset: z.number().int().min(1).default(1).describe("1 = play immediately after current song, 2 = after 1 song, etc.")
    }),
    returns: z.object({
      success: z.boolean(),
      insertedIndices: z.array(z.number()),
      newQueueLength: z.number()
    })
  },

  queue_append: {
    description: "Append a list of track IDs to the end of the current active queue.",
    parameters: z.object({
      videoIds: z.array(z.string())
    }),
    returns: z.object({
      success: z.boolean(),
      newQueueLength: z.number()
    })
  },

  queue_jump_to: {
    description: "Jump playback directly to an existing item in the queue by its index.",
    parameters: z.object({
      index: z.number().int().min(0)
    }),
    returns: z.object({
      success: z.boolean(),
      nowPlaying: z.string()
    })
  },

  queue_remove: {
    description: "Remove a track from the upcoming queue by index.",
    parameters: z.object({
      index: z.number().int().min(0)
    }),
    returns: z.object({
      success: z.boolean()
    })
  },

  player_control: {
    description: "Basic playback transport controls.",
    parameters: z.object({
      action: z.enum(["play", "pause", "next", "previous", "seek"]),
      seekSeconds: z.number().optional().describe("Required if action is 'seek'")
    }),
    returns: z.object({
      success: z.boolean(),
      state: z.string()
    })
  }
};
DJ Algorithmic Flow: "Transition Bridging"
When an agent receives: "Queue up 'Resonance' in 3 tracks, making the transition smooth from our current track":
Step 1 (State Capture): Call player_get_state() and queue_inspect() to fetch T 
current
​	
  and Index 
current
​	
 .
Step 2 (Target Resolution): Call music_search("Resonance HOME") → yields T 
target
​	
 .
Step 3 (Dual Graph Traversal):
Call music_get_radio_seeds(T_{current}.videoId) → Set A.
Call music_get_radio_seeds(T_{target}.videoId) → Set B.
Step 4 (Aesthetic Interpolation):
The Agent passes Set A and Set B through its internal reasoning context to find intermediate anchors (e.g., Bridge 
1
​	
 ∈A with elevated synth density, Bridge 
2
​	
 ∈B with lower tempo to match Bridge 
1
​	
 ).
Step 5 (Queue Injection):
Verify neither Bridge 
1
​	
 , Bridge 
2
​	
 , nor T 
target
​	
  exist in queue_inspect().
Execute: queue_insert_relative(videoIds=[Bridge_1.id, Bridge_2.id, T_{target}.id], offset=1).
Packaging, Distribution & Deployment
1. Electron App Packaging
Built with electron-builder targeting macOS (.dmg, Universal binary), Linux (.AppImage), and Windows (.exe).
The app registers an internal Express/Fastify instance booting the MCP SSE handler on port 4382.
2. Stdio Bridge (ytmusic-mcp-bridge)
Distributed via npm as a lightweight proxy script:
TypeScript
#!/usr/bin/env node
import http from 'http';

// Pipes process.stdin/stdout to localhost:4382/sse and localhost:4382/message
// Handles auto-launching Electron binary if port 4382 does not respond.
3. Client Configuration Templates
Google Antigravity (~/.gemini/config/mcp_config.json):
JSON
{
  "mcpServers": {
    "BeatBridge": {
      "command": "node",
      "args": ["/Users/moreno_m5/Projects/BeatBridge/dist/bin/bridge.js", "--port", "4382"]
    }
  }
}
Claude Desktop (claude_desktop_config.json):
JSON
{
  "mcpServers": {
    "BeatBridge": {
      "command": "node",
      "args": ["/Users/moreno_m5/Projects/BeatBridge/dist/bin/bridge.js", "--port", "4382"]
    }
  }
}