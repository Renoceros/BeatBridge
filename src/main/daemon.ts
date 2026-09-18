import http from 'http';
import { ExtensionBridge } from '../server/extensionBridge.js';
import { createBeatBridgeMcpServer, startMcpHttpServer } from '../mcp/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const PORT = parseInt(process.env.MCP_PORT || '4382', 10);
const isStdio = process.argv.includes('--stdio');

const log = isStdio ? console.error : console.log;

log('----------------------------------------------------');
log('  BeatBridge DJ - Multi-Platform MCP Audio Daemon   ');
log('  Supports: YouTube Music, Spotify & SoundCloud    ');
log('----------------------------------------------------');

const extensionBridge = new ExtensionBridge();

if (isStdio) {
  log('[BeatBridge] Starting MCP in STDIO transport mode...');
  const mcpServer = createBeatBridgeMcpServer(extensionBridge);
  const stdioTransport = new StdioServerTransport();
  mcpServer.connect(stdioTransport).catch((err) => {
    console.error('[BeatBridge MCP] Stdio transport error:', err);
  });

  const wsHttpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        extensionConnected: extensionBridge.isConnected(),
        activeProvider: extensionBridge.getActiveProvider()
      }));
      return;
    }
    res.writeHead(200).end('BeatBridge Daemon (STDIO Mode)');
  });

  extensionBridge.attach(wsHttpServer);

  wsHttpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      log(`[BeatBridge] Port ${PORT} already bound; extension websocket will use existing daemon.`);
    } else {
      console.error('[BeatBridge] WebSocket server error:', err);
    }
  });

  wsHttpServer.listen(PORT, '127.0.0.1', () => {
    log(`[BeatBridge] Extension WebSocket listening on ws://127.0.0.1:${PORT}/ws`);
  });

  process.on('SIGINT', () => {
    wsHttpServer.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    wsHttpServer.close();
    process.exit(0);
  });
} else {
  const server = startMcpHttpServer(PORT, extensionBridge, extensionBridge);

  process.on('SIGINT', () => {
    console.log('\n[BeatBridge] Shutting down daemon...');
    server.close(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    console.log('\n[BeatBridge] Shutting down daemon...');
    server.close(() => process.exit(0));
  });
}

