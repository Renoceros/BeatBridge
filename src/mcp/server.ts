import http from 'http';
import { URL } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { PlayerBridgeController } from '../bridge/controller.js';
import { InnerTubeClient } from '../innertube/client.js';

export function createBeatBridgeMcpServer(
  bridge: PlayerBridgeController,
  innertube: InnerTubeClient
): McpServer {
  const server = new McpServer({
    name: 'ytmusic-dj',
    version: '0.1.0'
  });

  server.tool(
    'player_get_state',
    'Get real-time status of active playback, progress, volume, and track details.',
    {},
    async () => {
      const state = await bridge.getPlayerState();
      return {
        content: [{ type: 'text', text: JSON.stringify(state, null, 2) }]
      };
    }
  );

  server.tool(
    'queue_inspect',
    'Inspect the current active playing queue, including history and upcoming tracks.',
    {},
    async () => {
      const queue = await bridge.inspectQueue();
      return {
        content: [{ type: 'text', text: JSON.stringify(queue, null, 2) }]
      };
    }
  );

  server.tool(
    'music_search',
    'Search for songs, albums, or artists on YouTube Music.',
    {
      query: z.string().describe('Search keywords, title, or semantic description'),
      limit: z.number().default(5)
    },
    async ({ query, limit }) => {
      const results = await innertube.search(query, limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
      };
    }
  );

  server.tool(
    'music_get_radio_seeds',
    'Retrieve algorithmic watch-next radio seeds derived from YouTube audio graph for a given track.',
    {
      videoId: z.string().describe('The anchor track videoId'),
      limit: z.number().default(10)
    },
    async ({ videoId, limit }) => {
      const seeds = await innertube.getRadioSeeds(videoId, limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(seeds, null, 2) }]
      };
    }
  );

  server.tool(
    'queue_insert_relative',
    'Insert one or more tracks relative to active song index (e.g., offset=1 means Up Next).',
    {
      videoIds: z.array(z.string()).describe('List of video IDs to insert in sequence'),
      offset: z.number().int().min(1).default(1).describe('1 = play immediately after current song, 2 = after 1 song, etc.')
    },
    async ({ videoIds, offset }) => {
      const result = await bridge.insertRelative(videoIds, offset);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.tool(
    'queue_append',
    'Append a list of track IDs to the end of the current active queue.',
    {
      videoIds: z.array(z.string()).describe('List of video IDs to append')
    },
    async ({ videoIds }) => {
      const result = await bridge.appendQueue(videoIds);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.tool(
    'queue_jump_to',
    'Jump playback directly to an existing item in the queue by its index.',
    {
      index: z.number().int().min(0).describe('Target item index in queue')
    },
    async ({ index }) => {
      const result = await bridge.jumpTo(index);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.tool(
    'queue_remove',
    'Remove a track from the upcoming queue by index.',
    {
      index: z.number().int().min(0).describe('Queue index to remove')
    },
    async ({ index }) => {
      const result = await bridge.removeTrack(index);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.tool(
    'player_control',
    'Basic playback transport controls.',
    {
      action: z.enum(['play', 'pause', 'next', 'previous', 'seek']).describe('Transport action'),
      seekSeconds: z.number().optional().describe('Target seconds if action is seek')
    },
    async ({ action, seekSeconds }) => {
      const result = await bridge.playerControl(action, seekSeconds);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  return server;
}

export function startMcpHttpServer(
  port: number,
  bridge: PlayerBridgeController,
  innertube: InnerTubeClient
): http.Server {
  const transports = new Map<string, SSEServerTransport>();

  const server = http.createServer(async (req, res) => {
    // Enable CORS for local dev / dashboard / Antigravity
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200).end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && parsedUrl.pathname === '/sse') {
      const transport = new SSEServerTransport('/message', res);
      const mcpServer = createBeatBridgeMcpServer(bridge, innertube);
      
      transports.set(transport.sessionId, transport);
      transport.onclose = () => {
        transports.delete(transport.sessionId);
      };

      await mcpServer.connect(transport);
      return;
    }

    if (req.method === 'POST' && parsedUrl.pathname.startsWith('/message')) {
      const sessionId = parsedUrl.searchParams.get('sessionId');
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(404).end('Session not found');
        return;
      }

      const transport = transports.get(sessionId)!;
      await transport.handlePostMessage(req, res);
      return;
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', activeSessions: transports.size }));
      return;
    }

    res.writeHead(404).end('Not Found');
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[BeatBridge MCP Host] Listening on http://127.0.0.1:${port}/sse`);
  });

  return server;
}
