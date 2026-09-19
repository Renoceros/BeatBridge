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

  // Pre-check daemon health with quick timeout to prevent hanging initialization
  try {
    const healthUrl = `http://127.0.0.1:${port}/health`;
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      process.stderr.write(`[BeatBridge] Health check warning: status ${res.status}\n`);
    }
  } catch (err: any) {
    process.stderr.write(
      `[BeatBridge] Warning: Could not reach daemon at http://127.0.0.1:${port}/health (${err.message}).\n` +
      `Ensure Project BeatBridge daemon is running ('npm run daemon').\n`
    );
  }

  const endpointUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  const transport = new StreamableHTTPClientTransport(endpointUrl);

  transport.onerror = (err) => {
    process.stderr.write(`[BeatBridge] Transport error: ${err.message || err}\n`);
  };

  transport.onclose = () => {
    process.stderr.write('[BeatBridge] Connection closed. Exiting.\n');
    process.exit(0);
  };

  transport.onmessage = (message) => {
    process.stdout.write(JSON.stringify(message) + '\n');
  };

  try {
    await transport.start();
  } catch (err: any) {
    process.stderr.write(
      `[BeatBridge] Failed to connect to BeatBridge host at ${endpointUrl.toString()}.\n` +
      `Ensure Project BeatBridge daemon is running on port ${port}.\n`
    );
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let json: any = null;
    try {
      json = JSON.parse(trimmed);
      await transport.send(json);
    } catch (err: any) {
      process.stderr.write(`[BeatBridge] Failed to send message: ${err.message}\n`);
      // If the request had an id, return a JSON-RPC error so client does not hang
      if (json && json.id !== undefined) {
        const errorResponse = {
          jsonrpc: '2.0',
          id: json.id,
          error: {
            code: -32603,
            message: `BeatBridge daemon communication error: ${err.message}. Is the daemon running on port ${port}?`
          }
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
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
  process.stderr.write(`[BeatBridge] Fatal error: ${err.message}\n`);
  process.exit(1);
});
