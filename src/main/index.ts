import { app, BrowserWindow, session, Menu, dialog, clipboard } from 'electron';
import http from 'http';
import { PlayerBridgeController } from '../bridge/controller.js';
import { InnerTubeClient } from '../innertube/client.js';
import { startMcpHttpServer } from '../mcp/server.js';

// Anti-detection: disable AutomationControlled so navigator.webdriver is false
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

let mainWindow: BrowserWindow | null = null;
let mcpHttpServer: http.Server | null = null;

const MCP_PORT = parseInt(process.env.MCP_PORT || '4382', 10);
const PARTITION = 'persist:ytmusic';

// Clean Chrome User-Agent matching the bundled Chromium version
const CHROME_VERSION = process.versions.chrome || '134.0.6998.35';
const USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

// Apply globally before windows open
app.userAgentFallback = USER_AGENT;

async function importCookiesFromClipboard(ses: Electron.Session, win: BrowserWindow) {
  const raw = clipboard.readText().trim();
  if (!raw) {
    dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Import Cookies',
      message: 'Clipboard is empty. Copy your cookie header string (e.g. from Chrome DevTools Network tab) and try again.'
    });
    return;
  }

  try {
    const pairs = raw.split(';').map(s => s.trim()).filter(Boolean);
    let count = 0;

    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();

      await ses.cookies.set({
        url: 'https://music.youtube.com',
        domain: '.youtube.com',
        name,
        value,
        path: '/',
        secure: true,
        sameSite: 'no_restriction'
      });
      count++;
    }

    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Cookies Imported',
      message: `Successfully imported ${count} cookies! Reloading YouTube Music...`
    });

    win.loadURL('https://music.youtube.com');
  } catch (err: any) {
    dialog.showErrorBox('Cookie Import Error', err.message || String(err));
  }
}

function setupMenu(ses: Electron.Session) {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'BeatBridge',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Import Session Cookies from Clipboard',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (mainWindow) importCookiesFromClipboard(ses, mainWindow);
          }
        },
        {
          label: 'Reload YouTube Music',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.loadURL('https://music.youtube.com');
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

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

  mainWindow.webContents.setUserAgent(USER_AGENT);

  // Handle popups/OAuth redirects in the same partition and clean user-agent
  mainWindow.webContents.setWindowOpenHandler(() => {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          partition: PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false
        }
      }
    };
  });

  mainWindow.loadURL('https://music.youtube.com');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

app.whenReady().then(() => {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(USER_AGENT);

  // Strip Electron brand from Client Hints and request headers
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    requestHeaders['User-Agent'] = USER_AGENT;

    if (requestHeaders['sec-ch-ua'] || requestHeaders['Sec-Ch-Ua']) {
      const major = CHROME_VERSION.split('.')[0];
      const cleanCh = `"Chromium";v="${major}", "Not_A Brand";v="24", "Google Chrome";v="${major}"`;
      requestHeaders['sec-ch-ua'] = cleanCh;
      if (requestHeaders['Sec-Ch-Ua']) requestHeaders['Sec-Ch-Ua'] = cleanCh;
    }

    callback({ requestHeaders });
  });

  app.on('browser-window-created', (_event, win) => {
    win.webContents.setUserAgent(USER_AGENT);
  });

  setupMenu(ses);
  createWindow();

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
