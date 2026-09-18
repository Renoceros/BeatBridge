#!/usr/bin/env node
import readline from 'readline';
import { URL } from 'url';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function main() {
  const args = process.argv.slice(2);
  let port = 4382;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  const endpointUrl = new URL(`http://127.0.0.1:${port}/sse`);
  const transport = new StreamableHTTPClientTransport(endpointUrl);

  transport.onerror = (err) => {
    process.stderr.write(`[ytmusic-mcp-bridge] Transport error: ${err.message || err}\n`);
  };

  transport.onclose = () => {
    process.stderr.write('[ytmusic-mcp-bridge] Connection closed. Exiting.\n');
    process.exit(0);
  };

  transport.onmessage = (message) => {
    process.stdout.write(JSON.stringify(message) + '\n');
  };

  try {
    await transport.start();
  } catch (err: any) {
    process.stderr.write(
      `[ytmusic-mcp-bridge] Failed to connect to BeatBridge host at ${endpointUrl.toString()}.\n` +
      `Ensure Project BeatBridge daemon is running on port ${port}.\n`
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
      await transport.send(json);
    } catch (err: any) {
      process.stderr.write(`[ytmusic-mcp-bridge] Failed to send message: ${err.message}\n`);
    }
  });

  process.on('SIGINT', async () => {
    await transport.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await transport.close();
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`[ytmusic-mcp-bridge] Fatal error: ${err.message}\n`);
  process.exit(1);
});
