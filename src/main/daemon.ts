import { ExtensionBridge } from '../server/extensionBridge.js';
import { startMcpHttpServer } from '../mcp/server.js';

const PORT = parseInt(process.env.MCP_PORT || '4382', 10);

console.log('----------------------------------------------------');
console.log('  BeatBridge DJ - Multi-Platform MCP Audio Daemon   ');
console.log('  Supports: YouTube Music, Spotify & SoundCloud    ');
console.log('----------------------------------------------------');

const extensionBridge = new ExtensionBridge();
const server = startMcpHttpServer(PORT, extensionBridge, extensionBridge);

process.on('SIGINT', () => {
  console.log('\n[BeatBridge] Shutting down daemon...');
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('\n[BeatBridge] Shutting down daemon...');
  server.close(() => process.exit(0));
});
