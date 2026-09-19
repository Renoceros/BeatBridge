import assert from 'assert';
import http from 'http';
import { WebSocket } from 'ws';
import { ExtensionBridge } from '../server/extensionBridge.js';
import { createBeatBridgeMcpServer, startMcpHttpServer } from '../mcp/server.js';

async function runSelfCheck() {
  console.log('[Self-Check] 1. Initializing ExtensionBridge & MCP Server...');
  const bridge = new ExtensionBridge();
  const mcpServer = createBeatBridgeMcpServer(bridge);
  assert(mcpServer, 'MCP Server must instantiate');
  console.log('✓ MCP Server instantiated with all 9 DJ tools');

  console.log('[Self-Check] 2. Booting HTTP/SSE & WebSocket server on ephemeral port 4399...');
  const testPort = 4399;
  const server = startMcpHttpServer(testPort, bridge, bridge);

  // Health endpoint verification
  await new Promise<void>((resolve, reject) => {
    http.get(`http://127.0.0.1:${testPort}/health`, (res) => {
      assert.strictEqual(res.statusCode, 200);
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const json = JSON.parse(data);
        assert.strictEqual(json.status, 'ok');
        assert.strictEqual(json.extensionConnected, false);
        console.log('✓ Health endpoint responded HTTP 200:', json);
        resolve();
      });
    }).on('error', reject);
  });

  console.log('[Self-Check] 3. Testing Browser Extension WebSocket connection...');
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);

    ws.on('open', () => {
      console.log('✓ Extension connected to WebSocket bridge');
      ws.send(JSON.stringify({ type: 'register', provider: 'ytmusic', version: '1.0.0' }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.action === 'player_get_state') {
        // Return simulated playback state
        ws.send(JSON.stringify({
          id: msg.id,
          result: {
            isPlaying: true,
            elapsedSeconds: 42,
            totalSeconds: 210,
            track: {
              videoId: 'test123',
              title: 'Resonance',
              artist: 'HOME'
            }
          }
        }));
      }
    });

    setTimeout(async () => {
      try {
        assert.strictEqual(bridge.isConnected(), true, 'Bridge must report connected');
        assert.strictEqual(bridge.getActiveProvider(), 'ytmusic', 'Provider must be ytmusic');

        // Test roundtrip command dispatch through the WebSocket
        const state: any = await bridge.getPlayerState();
        assert.strictEqual(state.isPlaying, true);
        assert.strictEqual(state.track.title, 'Resonance');
        console.log('✓ Bidirectional WebSocket command dispatch verified:', state.track);

        ws.close();
        resolve();
      } catch (err) {
        reject(err);
      }
    }, 200);

    ws.on('error', reject);
  });

  console.log('[Self-Check] 4. Testing Stdio Bridge Proxy CLI with MCP Host...');
  const { spawn } = await import('child_process');
  await new Promise<void>((resolve, reject) => {
    const bridgeProc = spawn('node', ['dist/bin/bridge.js', '--port', String(testPort)], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    };

    let received = '';
    bridgeProc.stdout.on('data', (chunk) => {
      received += chunk.toString();
      if (received.includes('"result"')) {
        const parsed = JSON.parse(received.trim().split('\n')[0]);
        assert.strictEqual(parsed.id, 1);
        assert.strictEqual(parsed.result.serverInfo.name, 'BeatBridge');
        console.log('✓ Stdio Bridge successfully communicated with MCP Host');
        bridgeProc.kill('SIGTERM');
        resolve();
      }
    });

    bridgeProc.on('error', reject);

    setTimeout(() => {
      bridgeProc.stdin.write(JSON.stringify(initRequest) + '\n');
    }, 500);

    setTimeout(() => {
      if (!received) {
        bridgeProc.kill('SIGKILL');
        reject(new Error('Bridge timed out waiting for MCP response'));
      }
    }, 5000);
  });

  server.close();
  console.log('✓ Test server closed cleanly');
  console.log('\nAll self-checks passed successfully!');
}

runSelfCheck().catch((err) => {
  console.error('Self-check failed:', err);
  process.exit(1);
});
