import http from 'http';
import { URL } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { ExtensionBridge } from '../server/extensionBridge.js';

export interface PlaybackProvider {
  getPlayerState(): Promise<any>;
  inspectQueue(): Promise<any>;
  search(query: string, limit?: number): Promise<any>;
  getRadioSeeds(videoId: string, limit?: number): Promise<any>;
  insertRelative(videoIds: string[], offset?: number): Promise<any>;
  appendQueue(videoIds: string[]): Promise<any>;
  jumpTo(index: number): Promise<any>;
  removeTrack(index: number): Promise<any>;
  playerControl(action: string, seekSeconds?: number): Promise<any>;
}

export function createBeatBridgeMcpServer(provider: PlaybackProvider): McpServer {
  const server = new McpServer({
    name: 'ytmusic-dj',
    version: '0.2.0'
  });

  server.tool(
    'player_get_state',
    'Get real-time status of active playback, progress, volume, and track details from active browser player.',
    {},
    async () => {
      const state = await provider.getPlayerState();
      return {
        content: [{ type: 'text', text: JSON.stringify(state, null, 2) }]
      };
    }
  );

  server.tool(
    'queue_inspect',
    'Inspect current active playing queue, including history and upcoming tracks.',
    {},
    async () => {
      const queue = await provider.inspectQueue();
      return {
        content: [{ type: 'text', text: JSON.stringify(queue, null, 2) }]
      };
    }
  );

  server.tool(
    'music_search',
    'Search for songs, albums, or artists on active streaming platform.',
    {
      query: z.string().describe('Search keywords, title, or semantic description'),
      limit: z.number().default(5)
    },
    async ({ query, limit }) => {
      const results = await provider.search(query, limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
      };
    }
  );

  server.tool(
    'music_get_radio_seeds',
    'Retrieve algorithmic watch-next radio seeds derived from audio graph for a given track.',
    {
      videoId: z.string().describe('The anchor track videoId / URI'),
      limit: z.number().default(10)
    },
    async ({ videoId, limit }) => {
      const seeds = await provider.getRadioSeeds(videoId, limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(seeds, null, 2) }]
      };
    }
  );

  server.tool(
    'queue_insert_relative',
    'Insert one or more tracks relative to active song index (e.g., offset=1 means Up Next).',
    {
      videoIds: z.array(z.string()).describe('List of video/track IDs to insert in sequence'),
      offset: z.number().int().min(1).default(1).describe('1 = play immediately after current song, 2 = after 1 song, etc.')
    },
    async ({ videoIds, offset }) => {
      const result = await provider.insertRelative(videoIds, offset);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.tool(
    'queue_append',
    'Append a list of track IDs to end of current active queue.',
    {
      videoIds: z.array(z.string()).describe('List of video/track IDs to append')
    },
    async ({ videoIds }) => {
      const result = await provider.appendQueue(videoIds);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.tool(
    'queue_jump_to',
    'Jump playback directly to an existing item in queue by its index.',
    {
      index: z.number().int().min(0).describe('Target item index in queue')
    },
    async ({ index }) => {
      const result = await provider.jumpTo(index);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  server.tool(
    'queue_remove',
    'Remove a track from upcoming queue by index.',
    {
      index: z.number().int().min(0).describe('Queue index to remove')
    },
    async ({ index }) => {
      const result = await provider.removeTrack(index);
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
      const result = await provider.playerControl(action, seekSeconds);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  return server;
}

export function startMcpHttpServer(
  port: number,
  provider: PlaybackProvider,
  extensionBridge?: ExtensionBridge
): http.Server {
  const transports = new Map<string, SSEServerTransport>();

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200).end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    console.log(`[BeatBridge MCP] ${req.method} ${req.url}`);

    if (req.method === 'GET' && (parsedUrl.pathname === '/sse' || parsedUrl.pathname === '/')) {
      const transport = new SSEServerTransport('/message', res);
      const mcpServer = createBeatBridgeMcpServer(provider);

      transports.set(transport.sessionId, transport);
      console.log(`[BeatBridge MCP] Client connected to SSE stream (sessionId: ${transport.sessionId})`);

      transport.onclose = () => {
        console.log(`[BeatBridge MCP] Client closed SSE stream (sessionId: ${transport.sessionId})`);
        transports.delete(transport.sessionId);
      };

      await mcpServer.connect(transport);
      return;
    }

    if (req.method === 'POST' && (parsedUrl.pathname.startsWith('/message') || parsedUrl.pathname === '/sse' || parsedUrl.pathname === '/')) {
      const sessionId = parsedUrl.searchParams.get('sessionId') || parsedUrl.searchParams.get('session_id');
      let transport: SSEServerTransport | undefined;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId);
      } else if (transports.size === 1) {
        transport = Array.from(transports.values())[0];
      } else if (transports.size > 1) {
        const all = Array.from(transports.values());
        transport = all[all.length - 1];
      }

      if (!transport) {
        console.warn(`[BeatBridge MCP] 404 on POST ${req.url}: No active SSE session found. Active: ${transports.size}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Session not found. Connect to /sse first.');
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        activeSessions: transports.size,
        extensionConnected: extensionBridge ? extensionBridge.isConnected() : false,
        activeProvider: extensionBridge ? extensionBridge.getActiveProvider() : 'direct'
      }));
      return;
    }

    res.writeHead(404).end('Not Found');
  });

  if (extensionBridge) {
    extensionBridge.attach(server);
  }

  server.listen(port, '127.0.0.1', () => {
    console.log(`[BeatBridge Host] MCP Server listening on http://127.0.0.1:${port}/sse`);
    console.log(`[BeatBridge Host] Extension WebSocket listening on ws://127.0.0.1:${port}/ws`);
  });

  return server;
}
