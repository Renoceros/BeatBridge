// BeatBridge Content Script: YouTube Music Controller
try {
  chrome.runtime.sendMessage({ type: 'content_log', data: `Script initialized on ${window.location.href}` });
} catch (e) {}

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

  const playerBar = document.querySelector('ytmusic-player-bar');
  const barTitle = playerBar?.querySelector('.title')?.textContent?.trim()?.toLowerCase();
  if (barTitle) {
    const matchIdx = raw.findIndex(t => t.title && t.title.toLowerCase() === barTitle);
    if (matchIdx !== -1) {
      currentIndex = matchIdx;
    }
  }

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
let lastQueueTime = 0;
let lastQueueQuery = '';

async function queueTrackViaMenu(queryOrId, position = 'next') {
  const now = Date.now();
  if (queryOrId === lastQueueQuery && now - lastQueueTime < 3000) {
    console.log('[BeatBridge] Ignoring duplicate queue call within 3s for:', queryOrId);
    return { success: true, queued: queryOrId, position, duplicateSuppressed: true };
  }
  lastQueueTime = now;
  lastQueueQuery = queryOrId;

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

function scoreTrackMatch(item, query) {
  const normalize = (str) => (str || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^\w\s']/g, ' ').trim();
  const queryNorm = normalize(query);
  const searchTerms = queryNorm.split(/\s+/).filter(w => w.length > 1);

  const titleEl = (item && typeof item.querySelector === 'function') ? (
                    item.querySelector('.title') || 
                    item.querySelector('.song-title') || 
                    item.querySelector('yt-formatted-string.ytmusic-responsive-list-item-renderer') ||
                    item.querySelector('a')
                  ) : null;
  const bylineEl = (item && typeof item.querySelector === 'function') ? (
                    item.querySelector('.subtitle') ||
                    item.querySelector('.byline') || 
                    item.querySelector('.secondary-flex-columns') ||
                    item.querySelector('yt-formatted-string.subtitle')
                  ) : null;

  const title = titleEl ? normalize(titleEl.textContent) : (item?.title ? normalize(item.title) : '');
  const byline = bylineEl ? normalize(bylineEl.textContent) : (item?.artist ? normalize(item.artist) : '');
  const fullText = normalize((item && item.textContent) ? item.textContent : `${item?.title || ''} ${item?.artist || ''}`);

  // Strict Disqualification: NEVER pick karaoke, tribute, instrumental, cover, backing track, TV clips, reactions, podcasts
  const disqualifiers = [
    'karaoke', 'tribute', 'instrumental', 'backing track', 'minus one', 'cover',
    'interview', 'reaction', 'react', 'the noite', 'podcast', 'parody', 'talk show',
    'clip', 'episode', 'review'
  ];
  for (const dq of disqualifiers) {
    if (!queryNorm.includes(dq) && (title.includes(dq) || byline.includes(dq))) {
      return -100000;
    }
  }

  // Must contain core search terms (at least 50% of search terms)
  const matchedTerms = searchTerms.filter(term => 
    fullText.includes(term) || (term.length >= 5 && fullText.includes(term.slice(0, -2)))
  );
  if (searchTerms.length <= 2 && matchedTerms.length < searchTerms.length) {
    return -10000;
  }
  if (matchedTerms.length < Math.ceil(searchTerms.length * 0.5)) {
    return -10000;
  }

  let score = 100;

  // 1. Prioritize official songs over video / fan uploads
  if (byline.startsWith('song') || byline.includes('song')) {
    score += 100; // Strong bonus for official studio audio tracks
  } else if (byline.startsWith('video') || byline.includes('video')) {
    score -= 60; // Penalize video uploads when official songs are present
  }

  // 2. Artist match bonus in byline
  const artistMatch = searchTerms.some(term => byline.includes(term) || (term.length >= 5 && byline.includes(term.slice(0, -2))));
  if (artistMatch) {
    score += 60;
  }

  // 3. Penalize acoustic, live, remix unless requested
  const unwantedModifiers = ['acoustic', 'live', 'remix', 'slowed', 'reverb', '8d'];
  for (const mod of unwantedModifiers) {
    if (!queryNorm.includes(mod)) {
      if (title.includes(mod)) score -= 80;
      else if (byline.includes(mod)) score -= 40;
    }
  }

  // 4. Exact clean title match bonus
  const cleanTitle = title.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
  if (cleanTitle === queryNorm || queryNorm.includes(cleanTitle) || cleanTitle.includes(queryNorm)) {
    score += 50;
  }
  for (const term of searchTerms) {
    if (cleanTitle === term) score += 20;
  }

  return score;
}

async function doQueueTrack(queryOrId, position = 'next') {
  // 1. Actually click and open the search bar in the header
  const searchBox = document.querySelector('ytmusic-search-box');
  if (searchBox) {
    const openBtn = searchBox.querySelector('button') || 
                    searchBox.querySelector('yt-icon-button') ||
                    searchBox.querySelector('#placeholder') ||
                    searchBox.querySelector('#icon');
    if (openBtn) openBtn.click();
    await new Promise(r => setTimeout(r, 200));
  }

  const searchInput = document.querySelector('input.ytmusic-search-box') || 
                      document.querySelector('#input.ytmusic-search-box') ||
                      document.querySelector('ytmusic-search-box input') ||
                      document.querySelector('input#input');

  if (!searchInput) {
    return { success: false, error: 'Could not find YouTube Music search bar in page' };
  }

  // 2. Click, focus, enter query directly without mangling, and press Enter
  searchInput.click();
  searchInput.focus();
  searchInput.value = queryOrId;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.dispatchEvent(new Event('change', { bubbles: true }));

  const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
  searchInput.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
  searchInput.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
  searchInput.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

  // 3. Wait for search results to render
  let candidates = [];
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    const card = document.querySelector('ytmusic-card-shelf-renderer');
    // Only select items from the search results page, excluding search suggestions
    const listItems = Array.from(document.querySelectorAll(
      'ytmusic-search-page ytmusic-responsive-list-item-renderer, #contents.ytmusic-section-list-renderer ytmusic-responsive-list-item-renderer, ytmusic-section-list-renderer ytmusic-responsive-list-item-renderer'
    )).filter(item => !item.closest('ytmusic-search-box') && !item.closest('ytmusic-search-suggestions-section'));

    const all = [];
    if (card) all.push(card);
    all.push(...listItems);

    const validMatches = all.filter(item => scoreTrackMatch(item, queryOrId) >= 80);
    if (validMatches.length > 0) {
      candidates = all;
      break;
    }
  }

  // 4. Grade results from top to bottom in DOM order and rank them
  const scoredCandidates = [];
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const score = scoreTrackMatch(item, queryOrId);
    const titleEl = item.querySelector('.title') || item.querySelector('.song-title') || item.querySelector('a');
    const titleStr = titleEl ? titleEl.textContent.trim() : item.textContent.slice(0, 30);
    try {
      chrome.runtime.sendMessage({ type: 'content_log', data: `Candidate ${i}: "${titleStr}" -> score: ${score}` });
    } catch (e) {}

    if (score < 80) continue; // Disqualified or poor candidate

    // Top-to-bottom ranking preference: earlier results in DOM get a position bonus
    const topBonus = Math.max(0, 30 - i * 3);
    const totalScore = score + topBonus;
    scoredCandidates.push({ item, totalScore, titleStr });
  }

  scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);


  // 5. Try each ranked candidate from top to bottom until one successfully plays next
  for (const { item: targetItem } of scoredCandidates) {
    const menuBtn = targetItem.querySelector('button[aria-label="Action menu"]') ||
                    targetItem.querySelector('ytmusic-menu-renderer button') ||
                    targetItem.querySelector('ytmusic-menu-renderer yt-icon-button') ||
                    targetItem.querySelector('#menu button') ||
                    targetItem.querySelector('yt-icon-button');

    if (menuBtn) {
      menuBtn.scrollIntoView({ block: 'center', inline: 'nearest' });
      menuBtn.click();

      // 6. Click "Play next" or "Add to queue" in popup menu
      const targetText = position === 'next' ? 'Play next' : 'Add to queue';
      let actionItem = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise(r => setTimeout(r, 100));
        const menuItems = Array.from(document.querySelectorAll('ytmusic-menu-service-item-renderer'));
        actionItem = menuItems.find(el => 
          el.textContent && 
          el.textContent.includes(targetText) && 
          (el.offsetParent !== null || el.getBoundingClientRect().width > 0)
        );
        if (actionItem) break;
      }

      if (actionItem) {
        const opts = { bubbles: true, cancelable: true, view: window };
        actionItem.dispatchEvent(new PointerEvent('pointerdown', opts));
        actionItem.dispatchEvent(new MouseEvent('mousedown', opts));
        actionItem.dispatchEvent(new PointerEvent('pointerup', opts));
        actionItem.dispatchEvent(new MouseEvent('mouseup', opts));
        actionItem.click();
        await new Promise(r => setTimeout(r, 500));

        // 7. Open UP NEXT tab so user immediately sees it
        const upNextTab = Array.from(document.querySelectorAll('ytmusic-tab-renderer')).find(t =>
          t.textContent && (t.textContent.includes('Up next') || t.textContent.includes('UP NEXT'))
        );
        if (upNextTab) upNextTab.click();
        await new Promise(r => setTimeout(r, 200));

        // Deduplication safeguard: If YouTube Music queued an identical consecutive duplicate, remove it
        try {
          const queueData = inspectQueue();
          const cur = queueData.currentIndex;
          const next1 = queueData.items[cur + 1];
          const next2 = queueData.items[cur + 2];
          if (next1 && next2 && next1.title && next1.title === next2.title) {
            await removeTrack(cur + 2);
          }
        } catch (dedupErr) {
          // Ignore deduplication errors
        }

        const titleEl = targetItem.querySelector('.title') || 
                        targetItem.querySelector('.song-title') || 
                        targetItem.querySelector('yt-formatted-string.ytmusic-responsive-list-item-renderer') ||
                        targetItem.querySelector('a');
        const queuedTitle = titleEl ? titleEl.textContent.trim() : queryOrId;

        return { 
          success: true, 
          queued: queuedTitle,
          position 
        };
      } else {
        // Close menu if action item not found before checking next
        document.body.click();
        await new Promise(r => setTimeout(r, 200));
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
  try {
    chrome.runtime.sendMessage({ type: 'content_log', data: `Action received in content script: ${req.action}` });
  } catch (e) {}
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

