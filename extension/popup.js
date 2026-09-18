document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const activeTabEl = document.getElementById('activeTab');

  // Check if daemon is reachable via health endpoint
  try {
    const res = await fetch('http://127.0.0.1:4382/health');
    if (res.ok) {
      const data = await res.json();
      statusDot.classList.add('connected');
      statusText.textContent = data.extensionConnected ? 'Connected' : 'Daemon Ready';
    } else {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Daemon Offline';
    }
  } catch (err) {
    statusDot.classList.remove('connected');
    statusText.textContent = 'Daemon Offline';
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
