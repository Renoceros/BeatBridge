import http from 'http';
import { URL } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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
    name: 'BeatBridge',
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
    'Insert one or more tracks relative to active song index (e.g., offset=1 means Up Next). Accepts song titles, artist queries, or video IDs directly.',
    {
      videoIds: z.array(z.string()).describe('List of song titles, artist queries, or video IDs to insert in sequence'),
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

import { randomUUID } from 'crypto';

export function startMcpHttpServer(
  port: number,
  provider: PlaybackProvider,
  extensionBridge?: ExtensionBridge
): http.Server {
  const sseSessions = new Map<string, SSEServerTransport>();
  const httpSessions = new Map<string, StreamableHTTPServerTransport>();

  function createHttpSession(): StreamableHTTPServerTransport {
    const mcpServer = createBeatBridgeMcpServer(provider);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (initializedSid) => {
        httpSessions.set(initializedSid, transport);
      },
      onsessionclosed: (closedSid) => {
        httpSessions.delete(closedSid);
      }
    });

    mcpServer.connect(transport).catch((err) => {
      console.error('[BeatBridge MCP] Transport error:', err);
    });

    return transport;
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version');

    if (req.method === 'OPTIONS') {
      res.writeHead(200).end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    console.log(`[BeatBridge MCP] ${req.method} ${req.url}`);

    if (req.method === 'GET' && parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        extensionConnected: extensionBridge ? extensionBridge.isConnected() : false,
        activeProvider: extensionBridge ? extensionBridge.getActiveProvider() : 'direct'
      }));
      return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/reload') {
      try {
        if (extensionBridge && (extensionBridge as any).reloadExtension) {
          const result = await (extensionBridge as any).reloadExtension();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, result }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No extension bridge attached' }));
        }
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/command') {
      try {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            if (!extensionBridge) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'No extension bridge' }));
              return;
            }
            const parsed = body ? JSON.parse(body) : {};
            const result = await extensionBridge.sendCommand(parsed.action, parsed.params || {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, result }));
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }


    // 1. Classic MCP SSE Transport (/sse and /message) vs Streamable HTTP SSE stream
    if (req.method === 'GET' && parsedUrl.pathname === '/sse') {
      const sidHeader = req.headers['mcp-session-id'] as string | undefined;
      // If Mcp-Session-Id is present, this is a Streamable HTTP SSE stream resumption, not classic SSE
      if (sidHeader && httpSessions.has(sidHeader)) {
        const transport = httpSessions.get(sidHeader)!;
        try {
          await transport.handleRequest(req, res);
        } catch (err: any) {
          console.error('[BeatBridge MCP] Streamable GET handleRequest error:', err);
          if (!res.headersSent) res.writeHead(500).end();
        }
        return;
      }

      try {
        const transport = new SSEServerTransport('/message', res);
        sseSessions.set(transport.sessionId, transport);
        transport.onclose = () => {
          sseSessions.delete(transport.sessionId);
        };
        const mcpServer = createBeatBridgeMcpServer(provider);
        await mcpServer.connect(transport);
      } catch (err: any) {
        console.error('[BeatBridge MCP] SSE connect error:', err);
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      }
      return;
    }

    if (req.method === 'POST' && (parsedUrl.pathname === '/message' || parsedUrl.pathname.startsWith('/message'))) {
      const sessionId = parsedUrl.searchParams.get('sessionId');
      const transport = sessionId ? sseSessions.get(sessionId) : undefined;
      if (transport) {
        await transport.handlePostMessage(req, res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Session '${sessionId}' not found` }));
      return;
    }

    // 2. Streamable HTTP Transport (/mcp, /, or POST /sse)
    if (parsedUrl.pathname === '/mcp' || parsedUrl.pathname === '/' || parsedUrl.pathname === '/sse') {
      if (!req.headers.accept || req.headers.accept === '*/*') {
        req.headers.accept = 'application/json, text/event-stream';
      } else if (!req.headers.accept.includes('text/event-stream')) {
        req.headers.accept = `${req.headers.accept}, text/event-stream`;
      }

      if (req.method === 'GET') {
        const sidHeader = req.headers['mcp-session-id'] as string | undefined;
        let transport = sidHeader ? httpSessions.get(sidHeader) : undefined;
        if (!transport) {
          transport = createHttpSession();
        }
        try {
          await transport.handleRequest(req, res);
        } catch (err: any) {
          console.error('[BeatBridge MCP] GET handleRequest error:', err);
          if (!res.headersSent) {
            res.writeHead(500).end();
          }
        }
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', async () => {
        try {
          let parsed: any = null;
          if (body) {
            try {
              parsed = JSON.parse(body);
            } catch {
              // Ignore non-JSON
            }
          }

          const isInit =
            parsed &&
            (parsed.method === 'initialize' ||
              (Array.isArray(parsed) && parsed.some((p: any) => p.method === 'initialize')));

          const sidHeader = req.headers['mcp-session-id'] as string | undefined;
          let transport = sidHeader ? httpSessions.get(sidHeader) : undefined;

          if (isInit || !transport) {
            transport = createHttpSession();
          }

          await transport.handleRequest(req, res, parsed);
        } catch (err: any) {
          console.error('[BeatBridge MCP] handleRequest error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32603, message: err?.message || 'Internal Server Error' },
                id: null
              })
            );
          }
        }
      });
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
