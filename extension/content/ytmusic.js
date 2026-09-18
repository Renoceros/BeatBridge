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

let isQueueingLock = false;

async function queueTrackViaMenu(queryOrId, position = 'next') {
  if (isQueueingLock) {
    for (let w = 0; w < 30 && isQueueingLock; w++) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  isQueueingLock = true;
  try {
    return await doQueueTrack(queryOrId, position);
  } finally {
    isQueueingLock = false;
  }
}

function scoreTrackMatch(item, query, targetVideoId = null) {
  const queryLower = query.toLowerCase();
  const searchTerms = queryLower.split(/\s+/).filter(w => w.length > 1);

  const titleEl = item.querySelector('.title') || 
                  item.querySelector('.song-title') || 
                  item.querySelector('yt-formatted-string.ytmusic-responsive-list-item-renderer') ||
                  item.querySelector('a');
  const title = titleEl ? titleEl.textContent.trim().toLowerCase() : '';
  const fullText = item.textContent.trim().toLowerCase();

  // Strict Disqualification: NEVER pick karaoke, tribute, instrumental, cover, backing track unless requested
  const disqualifiers = ['karaoke', 'tribute', 'instrumental', 'backing track', 'minus one', 'cover'];
  for (const dq of disqualifiers) {
    if (!queryLower.includes(dq) && (title.includes(dq) || fullText.includes(dq))) {
      return -100000;
    }
  }

  // Check videoId match
  const itemVid = item.data?.videoId || 
                  item.data?.playlistItemData?.videoId ||
                  (item.querySelector('a[href*="v="]') ? new URL(item.querySelector('a[href*="v="]').href, window.location.href).searchParams.get('v') : null);
  if (targetVideoId && itemVid === targetVideoId) {
    return 10000; // Perfect match by canonical video ID
  }

  // Must contain all core search terms
  if (!searchTerms.every(term => fullText.includes(term))) {
    return -10000;
  }

  let score = 100;

  // 1. Prioritize official songs over video / fan uploads
  if (fullText.includes('song •') || fullText.includes('song\n') || item.querySelector('ytmusic-item-thumbnail-overlay-renderer')) {
    score += 60;
  }

  // 2. Penalize acoustic, live, remix unless requested
  const unwantedModifiers = ['acoustic', 'live', 'remix', 'slowed', 'reverb', '8d'];
  for (const mod of unwantedModifiers) {
    if (!queryLower.includes(mod)) {
      if (title.includes(mod)) score -= 80;
      else if (fullText.includes(mod)) score -= 40;
    }
  }

  // 3. Exact clean title match bonus
  const cleanTitle = title.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
  for (const term of searchTerms) {
    if (cleanTitle === term) {
      score += 40;
    }
  }
  if (cleanTitle === queryLower || queryLower.includes(cleanTitle)) {
    score += 30;
  }

  return score;
}

async function doQueueTrack(queryOrId, position = 'next') {
  let targetVideoId = null;
  let targetTitle = '';
  let targetArtist = '';

  // 1. If queryOrId is not a raw 11-char videoId, pre-resolve canonical studio track via InnerTube search
  const isRawVideoId = /^[a-zA-Z0-9_-]{11}$/.test(queryOrId);
  if (isRawVideoId) {
    targetVideoId = queryOrId;
  } else {
    try {
      const searchResults = await searchMusic(queryOrId, 5);
      if (searchResults && searchResults.length > 0) {
        targetVideoId = searchResults[0].videoId;
        targetTitle = searchResults[0].title;
        targetArtist = searchResults[0].artist;
      }
    } catch (e) {
      console.warn('[BeatBridge] Pre-resolve search failed, falling back to DOM search:', e);
    }
  }

  function findItemInList(items) {
    // Priority 1: Match by exact videoId
    if (targetVideoId) {
      for (const item of items) {
        const vid = item.data?.videoId || 
                    item.data?.playlistItemData?.videoId ||
                    (item.querySelector('a[href*="v="]') ? new URL(item.querySelector('a[href*="v="]').href, window.location.href).searchParams.get('v') : null);
        if (vid === targetVideoId) return item;
      }
    }

    // Priority 2: Scored match with strict disqualification and high confidence threshold (>= 140)
    const scored = items
      .map(item => ({ item, score: scoreTrackMatch(item, queryOrId, targetVideoId) }))
      .filter(c => c.score >= 140)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.item || null;
  }

  // 2. Check if track is already present in current page results (only if high confidence)
  const existingItems = Array.from(document.querySelectorAll('ytmusic-responsive-list-item-renderer'));
  let targetItem = findItemInList(existingItems);

  // 3. If not found, perform search in YouTube Music without interrupting playback
  if (!targetItem) {
    const searchBox = document.querySelector('ytmusic-search-box');
    const searchInput = document.querySelector('input.ytmusic-search-box') || 
                        document.querySelector('#input.ytmusic-search-box') ||
                        document.querySelector('input#input');

    if (searchInput) {
      if (searchBox) {
        const searchBtn = searchBox.querySelector('button') || searchBox.querySelector('yt-icon-button');
        if (searchBtn) searchBtn.click();
      }
      searchInput.click();
      searchInput.focus();

      // Search using canonical title + clean artist if available, else queryOrId
      const cleanArtist = targetArtist ? targetArtist.replace(/^Song\s*•\s*/i, '').replace(/•.*/, '').trim() : '';
      const searchStr = (targetTitle && cleanArtist)
        ? `${targetTitle} ${cleanArtist}`
        : queryOrId;

      searchInput.value = searchStr;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

      // Wait for search results and pick verified studio match
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200));
        const items = Array.from(document.querySelectorAll('ytmusic-responsive-list-item-renderer'));
        const matched = findItemInList(items);
        if (matched) {
          targetItem = matched;
          break;
        }
      }
    }
  }

  if (targetItem) {
    // 4. Click 3-dot menu button on the matched item
    const menuBtn = targetItem.querySelector('ytmusic-menu-renderer yt-icon-button') ||
                    targetItem.querySelector('ytmusic-menu-renderer button') ||
                    targetItem.querySelector('#menu button');
    if (menuBtn) {
      menuBtn.click();
      await new Promise(r => setTimeout(r, 400));

      // 5. Click "Play next" or "Add to queue" in popup menu
      const targetText = position === 'next' ? 'Play next' : 'Add to queue';
      const menuItems = Array.from(document.querySelectorAll('ytmusic-menu-service-item-renderer'));
      const actionItem = menuItems.find(el => el.textContent && el.textContent.includes(targetText));

      if (actionItem) {
        actionItem.click();
        await new Promise(r => setTimeout(r, 400));

        // 6. Open UP NEXT tab so user immediately sees it
        const upNextTab = Array.from(document.querySelectorAll('ytmusic-tab-renderer')).find(t =>
          t.textContent && (t.textContent.includes('Up next') || t.textContent.includes('UP NEXT'))
        );
        if (upNextTab) upNextTab.click();

        return { 
          success: true, 
          queued: targetTitle ? `${targetTitle} - ${targetArtist}` : queryOrId,
          videoId: targetVideoId,
          position 
        };
      }
    }
  }

  return { success: false, error: `Could not find verified matching track for query: ${queryOrId}` };
}

async function insertRelative(videoIds = [], offset = 1) {
  const results = [];
  for (const id of videoIds) {
    const res = await queueTrackViaMenu(id, 'next');
    results.push(res);
  }
  const allSuccess = results.every(r => r.success);
  return {
    success: allSuccess,
    details: results
  };
}

async function appendQueue(videoIds = []) {
  const results = [];
  for (const id of videoIds) {
    const res = await queueTrackViaMenu(id, 'tail');
    results.push(res);
  }
  const allSuccess = results.every(r => r.success);
  return {
    success: allSuccess,
    details: results
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

async function removeTrack(index) {
  const items = Array.from(document.querySelectorAll('ytmusic-player-queue-item'));
  if (items[index]) {
    const menuBtn = items[index].querySelector('ytmusic-menu-renderer yt-icon-button') ||
                    items[index].querySelector('ytmusic-menu-renderer button') ||
                    items[index].querySelector('#menu button');
    if (menuBtn) {
      menuBtn.click();
      await new Promise(r => setTimeout(r, 300));
      const menuItems = Array.from(document.querySelectorAll('ytmusic-menu-service-item-renderer'));
      const removeItem = menuItems.find(el => el.textContent && el.textContent.includes('Remove from queue'));
      if (removeItem) {
        removeItem.click();
        return { success: true, removedIndex: index };
      }
    }
  }
  return { success: false, error: `Could not find or remove track at index ${index}` };
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
    const rawResults = [];
    const queryLower = query.toLowerCase();
    const disqualifiers = ['karaoke', 'tribute', 'instrumental', 'backing track', 'minus one', 'cover'];

    function isDisqualified(text) {
      const t = text.toLowerCase();
      for (const d of disqualifiers) {
        if (!queryLower.includes(d) && t.includes(d)) return true;
      }
      return false;
    }

    const sections = data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

    for (const section of sections) {
      // 1. Check musicCardShelfRenderer (Hero Card)
      if (section.musicCardShelfRenderer) {
        const card = section.musicCardShelfRenderer;
        const cardTitle = card.title?.runs?.[0]?.text || '';
        const cardSubtitle = card.subtitle?.runs?.map(r => r.text).join('') || '';
        const cardVideoId = card.onTap?.watchEndpoint?.videoId || 
                            card.buttons?.[0]?.buttonRenderer?.command?.watchEndpoint?.videoId;
        if (cardVideoId && cardTitle && !isDisqualified(cardTitle) && !isDisqualified(cardSubtitle)) {
          const isSong = cardSubtitle.toLowerCase().includes('song');
          rawResults.push({
            videoId: cardVideoId,
            title: cardTitle,
            artist: cardSubtitle,
            duration: '0:00',
            isSong,
            isHero: true
          });
        }
      }

      // 2. Check musicShelfRenderer or itemSectionRenderer
      const shelf = section.musicShelfRenderer || section.itemSectionRenderer;
      if (shelf && shelf.contents) {
        for (const item of shelf.contents) {
          const renderer = item.musicResponsiveListItemRenderer;
          if (!renderer) continue;

          const flexColumns = renderer.flexColumns || [];
          const titleCol = flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0];
          const title = titleCol?.text || '';
          
          let videoId = titleCol?.navigationEndpoint?.watchEndpoint?.videoId;
          if (!videoId) {
            videoId = renderer.playlistItemData?.videoId || renderer.menu?.menuRenderer?.topLevelButtons?.[0]?.likeButtonRenderer?.target?.videoId;
          }

          const bylineRuns = flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
          const artist = bylineRuns.map(x => x.text).join('') || 'Unknown Artist';

          if (!videoId || !title) continue;
          if (isDisqualified(title) || isDisqualified(artist)) continue;

          let duration = '0:00';
          for (let i = bylineRuns.length - 1; i >= 0; i--) {
            if (/^\d+:\d+$/.test(bylineRuns[i].text?.trim())) {
              duration = bylineRuns[i].text.trim();
              break;
            }
          }

          const isSong = artist.toLowerCase().includes('song');
          rawResults.push({
            videoId,
            title,
            artist,
            duration,
            isSong,
            isHero: false
          });
        }
      }
    }

    // Prioritize studio songs
    rawResults.sort((a, b) => {
      if (a.isSong && !b.isSong) return -1;
      if (!a.isSong && b.isSong) return 1;
      return 0;
    });

    // Deduplicate by videoId
    const seen = new Set();
    const results = [];
    for (const r of rawResults) {
      if (!seen.has(r.videoId)) {
        seen.add(r.videoId);
        results.push({
          videoId: r.videoId,
          title: r.title,
          artist: r.artist,
          duration: r.duration
        });
        if (results.length >= limit) break;
      }
    }

    return results;
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

// Listen for commands from background worker (allows hot update replacement)
if (window.__BEATBRIDGE_YTMUSIC_LISTENER__) {
  try {
    chrome.runtime.onMessage.removeListener(window.__BEATBRIDGE_YTMUSIC_LISTENER__);
  } catch (e) {
    // Ignore
  }
}

window.__BEATBRIDGE_YTMUSIC_LISTENER__ = (req, sender, sendResponse) => {
  (async () => {
    const { action, params } = req;
    switch (action) {
      case 'player_get_state':
        return getPlayerState();
      case 'queue_inspect':
        return inspectQueue();
      case 'queue_insert_relative':
        return await insertRelative(params.videoIds, params.offset);
      case 'queue_append':
        return await appendQueue(params.videoIds);
      case 'queue_jump_to':
        return jumpTo(params.index);
      case 'queue_remove':
        return await removeTrack(params.index);
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
};

chrome.runtime.onMessage.addListener(window.__BEATBRIDGE_YTMUSIC_LISTENER__);
