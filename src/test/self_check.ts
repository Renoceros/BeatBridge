import assert from 'assert';
import http from 'http';
import { generateSAPISIDHash } from '../auth/session.js';
import { createBeatBridgeMcpServer, startMcpHttpServer } from '../mcp/server.js';
import { PlayerBridgeController } from '../bridge/controller.js';
import { InnerTubeClient } from '../innertube/client.js';

async function runSelfCheck() {
  console.log('[Self-Check] 1. Testing SAPISID Hash Generation...');
  const hash = generateSAPISIDHash('test_sapisid_token');
  assert(hash.startsWith('SAPISIDHASH '), 'Hash must begin with SAPISIDHASH');
  assert(hash.includes('_'), 'Hash must contain timestamp delimiter');
  console.log('✓ SAPISID Hash format valid:', hash);

  console.log('[Self-Check] 2. Testing MCP Server & Tool Registrations...');
  const mockBridge = new PlayerBridgeController(() => null);
  const mockInnerTube = new InnerTubeClient();
  const mcpServer = createBeatBridgeMcpServer(mockBridge, mockInnerTube);
  assert(mcpServer, 'MCP Server must instantiate');
  console.log('✓ MCP Server instantiated with DJ tools');

  console.log('[Self-Check] 3. Testing MCP SSE HTTP Server on ephemeral port 4399...');
  const testPort = 4399;
  const server = startMcpHttpServer(testPort, mockBridge, mockInnerTube);

  // Health endpoint check
  await new Promise<void>((resolve, reject) => {
    http.get(`http://127.0.0.1:${testPort}/health`, (res) => {
      assert.strictEqual(res.statusCode, 200, 'Health check should return HTTP 200');
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const json = JSON.parse(data);
        assert.strictEqual(json.status, 'ok');
        console.log('✓ Health endpoint responded HTTP 200:', json);
        resolve();
      });
    }).on('error', reject);
  });

  // SSE endpoint check
  await new Promise<void>((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${testPort}/sse`, (res) => {
      assert.strictEqual(res.statusCode, 200, 'SSE should return HTTP 200');
      assert.strictEqual(res.headers['content-type'], 'text/event-stream', 'Content-Type must be text/event-stream');
      console.log('✓ SSE endpoint initialized successfully');
      res.destroy();
      resolve();
    });
    req.on('error', (err: any) => {
      if (err.code === 'ECONNRESET') resolve();
      else reject(err);
    });
  });

  console.log('[Self-Check] 4. Testing Stdio Bridge Proxy CLI (ytmusic-mcp-bridge)...');
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
        assert.strictEqual(parsed.result.serverInfo.name, 'ytmusic-dj');
        console.log('✓ Stdio Bridge successfully communicated with MCP Host over SSE');
        bridgeProc.kill('SIGTERM');
        resolve();
      }
    });

    bridgeProc.on('error', reject);

    // Give the bridge 500ms to open SSE connection, then write initialize message
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
