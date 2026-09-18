import { app, BrowserWindow, session } from 'electron';
import http from 'http';
import { PlayerBridgeController } from '../bridge/controller.js';
import { InnerTubeClient } from '../innertube/client.js';
import { startMcpHttpServer } from '../mcp/server.js';

let mainWindow: BrowserWindow | null = null;
let mcpHttpServer: http.Server | null = null;

const MCP_PORT = parseInt(process.env.MCP_PORT || '4382', 10);
const PARTITION = 'persist:ytmusic';

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    title: 'BeatBridge - YouTube Music MCP Host',
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Navigate to YouTube Music
  mainWindow.loadURL('https://music.youtube.com');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

app.whenReady().then(() => {
  // Configure user agent if needed so Google Auth / YouTube Music renders fully
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );

  const win = createWindow();

  // Initialize controllers & MCP server
  const bridge = new PlayerBridgeController(() => mainWindow);
  const innertube = new InnerTubeClient(PARTITION);

  mcpHttpServer = startMcpHttpServer(MCP_PORT, bridge, innertube);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (mcpHttpServer) {
    mcpHttpServer.close();
    mcpHttpServer = null;
  }
});
