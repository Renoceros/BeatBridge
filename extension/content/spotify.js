// BeatBridge Content Script: Spotify Web Player Adapter

function getSpotifyPlayerState() {
  const widget = document.querySelector('[data-testid="now-playing-widget"]');
  if (!widget) {
    return { isPlaying: false, elapsedSeconds: 0, totalSeconds: 0, track: null };
  }

  const playPauseBtn = document.querySelector('[data-testid="control-button-playpause"]');
  const isPlaying = playPauseBtn ? playPauseBtn.getAttribute('aria-label')?.toLowerCase().includes('pause') : false;

  const titleEl = document.querySelector('[data-testid="context-item-info-title"]') || widget.querySelector('a[data-testid="context-item-link"]');
  const artistEl = document.querySelector('[data-testid="context-item-info-subtitles"]') || document.querySelector('[data-testid="context-item-info-artist"]');

  const title = titleEl ? titleEl.textContent.trim() : '';
  const artist = artistEl ? artistEl.textContent.trim() : '';

  const elapsedEl = document.querySelector('[data-testid="playback-position"]');
  const totalEl = document.querySelector('[data-testid="playback-duration"]');

  const parseTime = (str) => {
    if (!str) return 0;
    const parts = str.trim().split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  };

  return {
    isPlaying,
    elapsedSeconds: parseTime(elapsedEl?.textContent),
    totalSeconds: parseTime(totalEl?.textContent),
    track: title ? { videoId: 'spotify-track', title, artist } : null
  };
}

function spotifyPlayerControl(action) {
  if (action === 'play' || action === 'pause') {
    const btn = document.querySelector('[data-testid="control-button-playpause"]');
    if (btn) btn.click();
    return { success: true, state: action };
  } else if (action === 'next') {
    const btn = document.querySelector('[data-testid="control-button-skip-forward"]');
    if (btn) btn.click();
    return { success: true, state: 'next' };
  } else if (action === 'previous') {
    const btn = document.querySelector('[data-testid="control-button-skip-back"]');
    if (btn) btn.click();
    return { success: true, state: 'previous' };
  }
  return { success: false, state: 'unsupported action on Spotify Web' };
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  const { action, params } = req;
  try {
    switch (action) {
      case 'player_get_state':
        sendResponse({ result: getSpotifyPlayerState(), error: null });
        break;
      case 'player_control':
        sendResponse({ result: spotifyPlayerControl(params.action), error: null });
        break;
      default:
        sendResponse({ result: null, error: `Action ${action} is not yet implemented for Spotify Web Player` });
    }
  } catch (err) {
    sendResponse({ result: null, error: err.message });
  }
  return true;
});
