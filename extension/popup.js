document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const activeTabEl = document.getElementById('activeTab');

  function updateStatus(connected) {
    if (connected) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
    } else {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Daemon Offline';
    }
  }

  // Ask background service worker for WebSocket state
  chrome.runtime.sendMessage({ type: 'getStatus' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      // Background worker might be waking up, try direct health check
      checkHealthEndpoint();
    } else {
      updateStatus(res.connected);
      if (!res.connected) {
        chrome.runtime.sendMessage({ type: 'reconnect' });
      }
    }
  });

  async function checkHealthEndpoint() {
    try {
      const res = await fetch('http://127.0.0.1:4382/health');
      if (res.ok) {
        const data = await res.json();
        updateStatus(true);
      } else {
        updateStatus(false);
      }
    } catch (err) {
      updateStatus(false);
    }
  }

  // Detect active music tabs
  const patterns = [
    'https://music.youtube.com/*',
    'https://open.spotify.com/*',
    'https://soundcloud.com/*'
  ];

  let found = null;
  for (const url of patterns) {
    const tabs = await chrome.tabs.query({ url });
    if (tabs && tabs.length > 0) {
      found = tabs.find(t => t.audible) || tabs[0];
      break;
    }
  }

  if (found) {
    activeTabEl.textContent = found.title || found.url;
  } else {
    activeTabEl.textContent = 'No music tab open';
  }
});
