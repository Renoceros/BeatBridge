// BeatBridge Content Script: YouTube Music Controller

function getPlayerState() {
  const playerBar = document.querySelector('ytmusic-player-bar');
  if (!playerBar) {
    return { isPlaying: false, elapsedSeconds: 0, totalSeconds: 0, track: null };
  }

  const playPauseBtn = document.querySelector('#play-pause-button');
  const isPlaying = playPauseBtn ? (
    playPauseBtn.getAttribute('aria-label') === 'Pause' ||
    playPauseBtn.getAttribute('title') === 'Pause'
  ) : false;

  const titleEl = playerBar.querySelector('.title');
  const bylineEl = playerBar.querySelector('.byline a') || playerBar.querySelector('.byline');
  const progressBar = document.querySelector('#progress-bar');

  const elapsedSeconds = progressBar ? Number(progressBar.getAttribute('value') || 0) : 0;
  const totalSeconds = progressBar ? Number(progressBar.getAttribute('aria-valuemax') || 0) : 0;

  let videoId = '';
  const activeQueueItem = document.querySelector('ytmusic-player-queue-item[selected]');
  if (activeQueueItem && activeQueueItem.data && activeQueueItem.data.videoId) {
    videoId = activeQueueItem.data.videoId;
  }
  if (!videoId) {
    const urlParams = new URLSearchParams(window.location.search);
    videoId = urlParams.get('v') || '';
  }

  const title = titleEl ? titleEl.textContent.trim() : '';
  const artist = bylineEl ? bylineEl.textContent.trim() : '';

  return {
    isPlaying,
    elapsedSeconds,
    totalSeconds,
    track: title ? { videoId, title, artist } : null
  };
}

function inspectQueue() {
  const queueItems = Array.from(document.querySelectorAll('ytmusic-player-queue-item'));
  let currentIndex = -1;

  const raw = queueItems.map((el, idx) => {
    const isSelected = el.hasAttribute('selected');
    if (isSelected) currentIndex = idx;

    const data = el.data || {};
    const titleEl = el.querySelector('.song-title');
    const bylineEl = el.querySelector('.byline');

    const title = titleEl ? titleEl.textContent.trim() : (data.title?.runs?.[0]?.text || '');
    const artist = bylineEl ? bylineEl.textContent.trim() : (data.shortBylineText?.runs?.[0]?.text || '');
    const videoId = data.videoId || (el.querySelector('a')?.href ? (new URL(el.querySelector('a').href, window.location.href)).searchParams.get('v') : '') || '';

    return { index: idx, videoId, title, artist };
  });

  const items = raw.map((item, idx) => {
    let status = 'upcoming';
    if (currentIndex !== -1) {
      if (idx < currentIndex) status = 'played';
      else if (idx === currentIndex) status = 'playing';
      else status = 'upcoming';
    }
    return { ...item, status };
  });

  return {
    currentIndex: currentIndex >= 0 ? currentIndex : 0,
    items
  };
}

function insertRelative(videoIds = [], offset = 1) {
  const queueEl = document.querySelector('ytmusic-player-queue');
  if (queueEl && queueEl.dispatch) {
    queueEl.dispatch({
      type: 'ADD_ITEMS_TO_QUEUE',
      payload: { videoIds, offset }
    });
  }

  const items = document.querySelectorAll('ytmusic-player-queue-item');
  return {
    success: true,
    insertedIndices: videoIds.map((_, i) => offset + i),
    newQueueLength: items.length + videoIds.length
  };
}

function appendQueue(videoIds = []) {
  const queueEl = document.querySelector('ytmusic-player-queue');
  if (queueEl && queueEl.dispatch) {
    queueEl.dispatch({
      type: 'ADD_ITEMS_TO_QUEUE',
      payload: { videoIds }
    });
  }

  const items = document.querySelectorAll('ytmusic-player-queue-item');
  return {
    success: true,
    newQueueLength: items.length + videoIds.length
  };
}

function jumpTo(index) {
  const items = document.querySelectorAll('ytmusic-player-queue-item');
  if (items[index]) {
    const btn = items[index].querySelector('.play-button') || items[index];
    btn.click();
    const titleEl = items[index].querySelector('.song-title');
    return {
      success: true,
      nowPlaying: titleEl ? titleEl.textContent.trim() : ''
    };
  }
  return { success: false, nowPlaying: '' };
}

function removeTrack(index) {
  const queueEl = document.querySelector('ytmusic-player-queue');
  if (queueEl && queueEl.dispatch) {
    queueEl.dispatch({
      type: 'REMOVE_ITEM_FROM_QUEUE',
      payload: { index }
    });
    return { success: true };
  }
  return { success: false };
}

function playerControl(action, seekSeconds) {
  if (action === 'play' || action === 'pause') {
    const btn = document.querySelector('#play-pause-button');
    if (btn) btn.click();
    return { success: true, state: action };
  } else if (action === 'next') {
    const btn = document.querySelector('.next-button') || document.querySelector('#next-button');
    if (btn) btn.click();
    return { success: true, state: 'next' };
  } else if (action === 'previous') {
    const btn = document.querySelector('.previous-button') || document.querySelector('#previous-button');
    if (btn) btn.click();
    return { success: true, state: 'previous' };
  } else if (action === 'seek' && typeof seekSeconds === 'number') {
    const progressBar = document.querySelector('#progress-bar');
    if (progressBar && progressBar.value !== undefined) {
      progressBar.value = seekSeconds;
      progressBar.dispatchEvent(new Event('change'));
    }
    return { success: true, state: 'seeked' };
  }
  return { success: false, state: 'unknown' };
}

async function searchMusic(query, limit = 5) {
  try {
    const payload = {
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20260901.01.00',
          hl: 'en',
          gl: 'US'
        }
      },
      query
    };

    const res = await fetch('/youtubei/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    const results = [];
    const sections = data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

    for (const section of sections) {
      const shelf = section.musicShelfRenderer || section.musicCardShelfRenderer;
      if (!shelf) continue;

      const contents = shelf.contents || [];
      for (const item of contents) {
        if (results.length >= limit) break;
        const renderer = item.musicResponsiveListItemRenderer;
        if (!renderer) continue;

        const flexColumns = renderer.flexColumns || [];
        const titleCol = flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0];
        const title = titleCol?.text || '';
        let videoId = titleCol?.navigationEndpoint?.watchEndpoint?.videoId;
        if (!videoId) {
          videoId = renderer.playlistItemData?.videoId;
        }

        const bylineRuns = flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        const artist = bylineRuns[0]?.text || 'Unknown Artist';

        let duration = '0:00';
        for (let i = bylineRuns.length - 1; i >= 0; i--) {
          if (/^\d+:\d+$/.test(bylineRuns[i].text?.trim())) {
            duration = bylineRuns[i].text.trim();
            break;
          }
        }

        if (videoId && title) {
          results.push({ videoId, title, artist, duration });
        }
      }
    }

    return results.slice(0, limit);
  } catch (err) {
    return [];
  }
}

async function getRadioSeeds(videoId, limit = 10) {
  try {
    const payload = {
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20260901.01.00',
          hl: 'en',
          gl: 'US'
        }
      },
      videoId,
      isAudioOnly: true
    };

    const res = await fetch('/youtubei/v1/next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    const seeds = [];
    const tabs = data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || [];
    const queueRenderer = tabs[0]?.tabRenderer?.content?.musicQueueRenderer;
    const playlistContents = queueRenderer?.content?.playlistPanelRenderer?.contents || [];

    for (const item of playlistContents) {
      if (seeds.length >= limit) break;
      const renderer = item.playlistPanelVideoRenderer;
      if (!renderer) continue;

      const itemVideoId = renderer.videoId;
      const title = renderer.title?.runs?.[0]?.text || '';
      const artist = renderer.shortBylineText?.runs?.[0]?.text || 'Unknown Artist';

      if (itemVideoId && title && itemVideoId !== videoId) {
        seeds.push({ videoId: itemVideoId, title, artist });
      }
    }

    return seeds.slice(0, limit);
  } catch (err) {
    return [];
  }
}

// Listen for commands from background worker
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  (async () => {
    const { action, params } = req;
    switch (action) {
      case 'player_get_state':
        return getPlayerState();
      case 'queue_inspect':
        return inspectQueue();
      case 'queue_insert_relative':
        return insertRelative(params.videoIds, params.offset);
      case 'queue_append':
        return appendQueue(params.videoIds);
      case 'queue_jump_to':
        return jumpTo(params.index);
      case 'queue_remove':
        return removeTrack(params.index);
      case 'player_control':
        return playerControl(params.action, params.seekSeconds);
      case 'music_search':
        return await searchMusic(params.query, params.limit);
      case 'music_get_radio_seeds':
        return await getRadioSeeds(params.videoId, params.limit);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  })()
    .then(result => sendResponse({ result, error: null }))
    .catch(err => sendResponse({ result: null, error: err.message }));

  return true; // Keep sendResponse channel open for async
});
