import { getAuthHeaders, AuthHeaders } from '../auth/session.js';

export interface SearchResult {
  videoId: string;
  title: string;
  artist: string;
  duration: string;
}

export interface RadioSeed {
  videoId: string;
  title: string;
  artist: string;
}

export class InnerTubeClient {
  private partition: string;

  constructor(partition: string = 'persist:ytmusic') {
    this.partition = partition;
  }

  private async fetchYouTubei(endpoint: string, body: Record<string, unknown>): Promise<any> {
    const authHeaders = await getAuthHeaders(this.partition);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...authHeaders
    };

    const url = `https://music.youtube.com/youtubei/v1/${endpoint}`;
    const payload = {
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20260901.01.00',
          hl: 'en',
          gl: 'US'
        }
      },
      ...body
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`InnerTube ${endpoint} failed with HTTP ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  }

  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    try {
      const data = await this.fetchYouTubei('search', { query });
      const results: SearchResult[] = [];

      // Navigate YouTubei sectionListRenderer structure
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
            videoId = renderer.playlistItemData?.videoId || renderer.menu?.menuRenderer?.topLevelButtons?.[0]?.likeButtonRenderer?.target?.videoId;
          }

          const bylineRuns = flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
          const artist = bylineRuns[0]?.text || 'Unknown Artist';
          
          // Last run is often duration or duration is in flexColumns
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
    } catch (err: any) {
      console.error('[InnerTubeClient.search error]:', err);
      return [];
    }
  }

  async getRadioSeeds(videoId: string, limit: number = 10): Promise<RadioSeed[]> {
    try {
      const data = await this.fetchYouTubei('next', { videoId, isAudioOnly: true });
      const seeds: RadioSeed[] = [];

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

        // Filter out anchor video if desired, but retain high-affinity candidates
        if (itemVideoId && title && itemVideoId !== videoId) {
          seeds.push({ videoId: itemVideoId, title, artist });
        }
      }

      return seeds.slice(0, limit);
    } catch (err: any) {
      console.error('[InnerTubeClient.getRadioSeeds error]:', err);
      return [];
    }
  }
}
