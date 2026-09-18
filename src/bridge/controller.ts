import { BrowserWindow } from 'electron';

export interface PlayerState {
  isPlaying: boolean;
  elapsedSeconds: number;
  totalSeconds: number;
  track: {
    videoId: string;
    title: string;
    artist: string;
    album?: string;
  } | null;
}

export interface QueueItem {
  index: number;
  videoId: string;
  title: string;
  artist: string;
  status: 'played' | 'playing' | 'upcoming';
}

export interface QueueSnapshot {
  currentIndex: number;
  items: QueueItem[];
}

export class PlayerBridgeController {
  private getWindow: () => BrowserWindow | null;

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
  }

  private async executeInPage<T>(script: string): Promise<T> {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) {
      throw new Error('Electron host window is not available');
    }
    return await win.webContents.executeJavaScript(script, true);
  }

  async getPlayerState(): Promise<PlayerState> {
    const script = `
      (() => {
        try {
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
            track: title ? {
              videoId,
              title,
              artist,
              album: undefined
            } : null
          };
        } catch (err) {
          return { isPlaying: false, elapsedSeconds: 0, totalSeconds: 0, track: null };
        }
      })()
    `;

    return await this.executeInPage<PlayerState>(script);
  }

  async inspectQueue(): Promise<QueueSnapshot> {
    const script = `
      (() => {
        try {
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
            return {
              ...item,
              status
            };
          });

          return {
            currentIndex: currentIndex >= 0 ? currentIndex : 0,
            items
          };
        } catch (err) {
          return { currentIndex: 0, items: [] };
        }
      })()
    `;

    return await this.executeInPage<QueueSnapshot>(script);
  }

  async insertRelative(videoIds: string[], offset: number = 1): Promise<{ success: boolean; insertedIndices: number[]; newQueueLength: number }> {
    const script = `
      (async () => {
        try {
          const ids = ${JSON.stringify(videoIds)};
          const off = ${JSON.stringify(offset)};

          const queueEl = document.querySelector('ytmusic-player-queue');
          if (queueEl && queueEl.dispatch) {
            queueEl.dispatch({
              type: 'ADD_ITEMS_TO_QUEUE',
              payload: { videoIds: ids, offset: off }
            });
          }

          const items = document.querySelectorAll('ytmusic-player-queue-item');
          const currentCount = items.length;
          const insertedIndices = ids.map((_, i) => off + i);

          return {
            success: true,
            insertedIndices,
            newQueueLength: currentCount + ids.length
          };
        } catch (err) {
          return {
            success: false,
            insertedIndices: [],
            newQueueLength: 0
          };
        }
      })()
    `;

    return await this.executeInPage(script);
  }

  async appendQueue(videoIds: string[]): Promise<{ success: boolean; newQueueLength: number }> {
    const script = `
      (async () => {
        try {
          const ids = ${JSON.stringify(videoIds)};
          const queueEl = document.querySelector('ytmusic-player-queue');
          if (queueEl && queueEl.dispatch) {
            queueEl.dispatch({
              type: 'ADD_ITEMS_TO_QUEUE',
              payload: { videoIds: ids }
            });
          }
          const items = document.querySelectorAll('ytmusic-player-queue-item');
          return {
            success: true,
            newQueueLength: items.length + ids.length
          };
        } catch (err) {
          return {
            success: false,
            newQueueLength: 0
          };
        }
      })()
    `;

    return await this.executeInPage(script);
  }

  async jumpTo(index: number): Promise<{ success: boolean; nowPlaying: string }> {
    const script = `
      (() => {
        try {
          const idx = ${JSON.stringify(index)};
          const items = document.querySelectorAll('ytmusic-player-queue-item');
          if (items[idx]) {
            const target = items[idx].querySelector('.play-button') || items[idx];
            target.click();
            const titleEl = items[idx].querySelector('.song-title');
            return {
              success: true,
              nowPlaying: titleEl ? titleEl.textContent.trim() : ''
            };
          }
          return { success: false, nowPlaying: '' };
        } catch (err) {
          return { success: false, nowPlaying: '' };
        }
      })()
    `;

    return await this.executeInPage(script);
  }

  async removeTrack(index: number): Promise<{ success: boolean }> {
    const script = `
      (() => {
        try {
          const idx = ${JSON.stringify(index)};
          const queueEl = document.querySelector('ytmusic-player-queue');
          if (queueEl && queueEl.dispatch) {
            queueEl.dispatch({
              type: 'REMOVE_ITEM_FROM_QUEUE',
              payload: { index: idx }
            });
            return { success: true };
          }
          return { success: false };
        } catch (err) {
          return { success: false };
        }
      })()
    `;

    return await this.executeInPage(script);
  }

  async playerControl(action: 'play' | 'pause' | 'next' | 'previous' | 'seek', seekSeconds?: number): Promise<{ success: boolean; state: string }> {
    const script = `
      (() => {
        try {
          const action = ${JSON.stringify(action)};
          const seekSec = ${JSON.stringify(seekSeconds)};

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
          } else if (action === 'seek' && typeof seekSec === 'number') {
            const progressBar = document.querySelector('#progress-bar');
            if (progressBar && progressBar.value !== undefined) {
              progressBar.value = seekSec;
              progressBar.dispatchEvent(new Event('change'));
            }
            return { success: true, state: 'seeked' };
          }
          return { success: false, state: 'unknown action' };
        } catch (err) {
          return { success: false, state: 'error' };
        }
      })()
    `;

    return await this.executeInPage(script);
  }
}
