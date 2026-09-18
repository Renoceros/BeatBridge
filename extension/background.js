// BeatBridge Background Service Worker
let socket = null;
let reconnectTimer = null;
const WS_URL = 'ws://127.0.0.1:4382/ws';

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    socket = new WebSocket(WS_URL);

    socket.onopen = async () => {
      console.log('[BeatBridge Extension] Connected to local MCP daemon');
      const provider = await detectActiveProvider();
      socket.send(JSON.stringify({
        type: 'register',
        provider,
        version: '1.0.0'
      }));
    };

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (!msg.id || !msg.action) return;

        handleMcpCommand(msg);
      } catch (err) {
        console.error('[BeatBridge Extension] Message handling error:', err);
      }
    };

    socket.onerror = (err) => {
      console.warn('[BeatBridge Extension] WebSocket error, will reconnect...');
    };

    socket.onclose = () => {
      console.log('[BeatBridge Extension] WebSocket closed. Reconnecting in 3s...');
      scheduleReconnect();
    };
  } catch (err) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectWebSocket();
  }, 3000);
}

async function findMusicTab() {
  const patterns = [
    'https://music.youtube.com/*',
    'https://open.spotify.com/*',
    'https://soundcloud.com/*'
  ];

  for (const url of patterns) {
    const tabs = await chrome.tabs.query({ url });
    if (tabs && tabs.length > 0) {
      // Return audible/active tab if available, else first tab
      const audible = tabs.find(t => t.audible);
      return audible || tabs[0];
    }
  }

  return null;
}

async function detectActiveProvider() {
  const tab = await findMusicTab();
  if (!tab || !tab.url) return 'none';
  if (tab.url.includes('music.youtube.com')) return 'ytmusic';
  if (tab.url.includes('open.spotify.com')) return 'spotify';
  if (tab.url.includes('soundcloud.com')) return 'soundcloud';
  return 'unknown';
}

async function handleMcpCommand(msg) {
  const tab = await findMusicTab();

  if (!tab || !tab.id) {
    socket.send(JSON.stringify({
      id: msg.id,
      result: null,
      error: 'No active music tab found. Please open YouTube Music, Spotify, or SoundCloud in Brave/Chrome.'
    }));
    return;
  }

  try {
    // Send command directly to content script in active tab
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: msg.action,
      params: msg.params || {}
    });

    socket.send(JSON.stringify({
      id: msg.id,
      result: response?.result !== undefined ? response.result : response,
      error: response?.error || null
    }));
  } catch (err) {
    socket.send(JSON.stringify({
      id: msg.id,
      result: null,
      error: `Failed to communicate with music tab (${tab.title}): ${err.message}`
    }));
  }
}

// Handle status request from popup
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === 'getStatus') {
    const isConnected = socket !== null && socket.readyState === WebSocket.OPEN;
    sendResponse({
      connected: isConnected,
      wsState: socket ? socket.readyState : -1
    });
    return true;
  }
  if (req.type === 'reconnect') {
    connectWebSocket();
    sendResponse({ ok: true });
    return true;
  }
});

// Keep connection alive & listen for lifecycle events
connectWebSocket();
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && (tab.url.includes('music.youtube.com') || tab.url.includes('spotify.com') || tab.url.includes('soundcloud.com'))) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    }
  }
});
