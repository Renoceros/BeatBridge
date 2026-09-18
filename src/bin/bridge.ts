#!/usr/bin/env node
import readline from 'readline';
import { URL } from 'url';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function main() {
  const args = process.argv.slice(2);
  let port = 4382;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  const sseUrl = new URL(`http://127.0.0.1:${port}/sse`);
  const sseTransport = new SSEClientTransport(sseUrl);

  sseTransport.onerror = (err) => {
    process.stderr.write(`[ytmusic-mcp-bridge] Transport error: ${err.message || err}\n`);
  };

  sseTransport.onclose = () => {
    process.stderr.write('[ytmusic-mcp-bridge] SSE connection closed. Exiting.\n');
    process.exit(0);
  };

  sseTransport.onmessage = (message) => {
    process.stdout.write(JSON.stringify(message) + '\n');
  };

  try {
    await sseTransport.start();
  } catch (err: any) {
    process.stderr.write(
      `[ytmusic-mcp-bridge] Failed to connect to BeatBridge host at ${sseUrl.toString()}.\n` +
      `Ensure Project BeatBridge (ytmusic-mcp-dj) is running on port ${port}.\n`
    );
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const json = JSON.parse(trimmed);
      await sseTransport.send(json);
    } catch (err: any) {
      process.stderr.write(`[ytmusic-mcp-bridge] Failed to send message: ${err.message}\n`);
    }
  });

  process.on('SIGINT', async () => {
    await sseTransport.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await sseTransport.close();
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`[ytmusic-mcp-bridge] Fatal error: ${err.message}\n`);
  process.exit(1);
});
