// BeatBridge Content Script: SoundCloud Web Player Adapter

function getSoundCloudPlayerState() {
  const badge = document.querySelector('.playbackSoundBadge');
  if (!badge) {
    return { isPlaying: false, elapsedSeconds: 0, totalSeconds: 0, track: null };
  }

  const playPauseBtn = document.querySelector('.playControl');
  const isPlaying = playPauseBtn ? playPauseBtn.classList.contains('playing') : false;

  const titleEl = badge.querySelector('.playbackSoundBadge__titleLink');
  const artistEl = badge.querySelector('.playbackSoundBadge__lightLink');

  const title = titleEl ? titleEl.getAttribute('title') || titleEl.textContent.trim() : '';
  const artist = artistEl ? artistEl.getAttribute('title') || artistEl.textContent.trim() : '';

  const parseTime = (str) => {
    if (!str) return 0;
    const parts = str.trim().split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  };

  const elapsedEl = document.querySelector('.playbackTimeline__timePassed span[aria-hidden="true"]');
  const totalEl = document.querySelector('.playbackTimeline__duration span[aria-hidden="true"]');

  return {
    isPlaying,
    elapsedSeconds: parseTime(elapsedEl?.textContent),
    totalSeconds: parseTime(totalEl?.textContent),
    track: title ? { videoId: 'soundcloud-track', title, artist } : null
  };
}

function soundCloudPlayerControl(action) {
  if (action === 'play' || action === 'pause') {
    const btn = document.querySelector('.playControl');
    if (btn) btn.click();
    return { success: true, state: action };
  } else if (action === 'next') {
    const btn = document.querySelector('.skipControl__next');
    if (btn) btn.click();
    return { success: true, state: 'next' };
  } else if (action === 'previous') {
    const btn = document.querySelector('.skipControl__previous');
    if (btn) btn.click();
    return { success: true, state: 'previous' };
  }
  return { success: false, state: 'unsupported action on SoundCloud' };
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  const { action, params } = req;
  try {
    switch (action) {
      case 'player_get_state':
        sendResponse({ result: getSoundCloudPlayerState(), error: null });
        break;
      case 'player_control':
        sendResponse({ result: soundCloudPlayerControl(params.action), error: null });
        break;
      default:
        sendResponse({ result: null, error: `Action ${action} is not yet implemented for SoundCloud` });
    }
  } catch (err) {
    sendResponse({ result: null, error: err.message });
  }
  return true;
});
