import { WebSocket, WebSocketServer } from 'ws';
import http from 'http';
import crypto from 'crypto';

export interface ExtensionMessage {
  id?: string;
  type?: string;
  provider?: string;
  action?: string;
  params?: any;
  result?: any;
  error?: string | null;
}

export class ExtensionBridge {
  private wss: WebSocketServer | null = null;
  private activeSocket: WebSocket | null = null;
  private activeProvider: string = 'none';
  private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }>();

  attach(server: http.Server) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
      if (url.pathname === '/ws') {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[BeatBridge Extension] Connected from browser');
      this.activeSocket = ws;

      ws.on('message', (raw: string) => {
        try {
          const msg: ExtensionMessage = JSON.parse(raw.toString());

          if (msg.type === 'register') {
            this.activeProvider = msg.provider || 'ytmusic';
            console.log(`[BeatBridge Extension] Registered provider: ${this.activeProvider}`);
            return;
          }

          if (msg.id && this.pendingRequests.has(msg.id)) {
            const { resolve, reject, timer } = this.pendingRequests.get(msg.id)!;
            clearTimeout(timer);
            this.pendingRequests.delete(msg.id);

            if (msg.error) {
              reject(new Error(msg.error));
            } else {
              resolve(msg.result);
            }
          }
        } catch (err: any) {
          console.error('[BeatBridge Extension] Error parsing message:', err.message);
        }
      });

      ws.on('close', () => {
        console.log('[BeatBridge Extension] Browser disconnected');
        if (this.activeSocket === ws) {
          this.activeSocket = null;
          this.activeProvider = 'none';
        }
      });
    });
  }

  isConnected(): boolean {
    return this.activeSocket !== null && this.activeSocket.readyState === WebSocket.OPEN;
  }

  getActiveProvider(): string {
    return this.activeProvider;
  }

  async sendCommand<T>(action: string, params: Record<string, any> = {}): Promise<T> {
    if (!this.isConnected()) {
      throw new Error(
        'BeatBridge extension is not connected. Open Brave/Chrome with YouTube Music, Spotify, or SoundCloud running.'
      );
    }

    const id = crypto.randomUUID();
    const payload = JSON.stringify({ id, action, params });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Command '${action}' timed out after 10 seconds`));
        }
      }, 10000);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.activeSocket!.send(payload);
    });
  }

  async getPlayerState() {
    return await this.sendCommand('player_get_state');
  }

  async inspectQueue() {
    return await this.sendCommand('queue_inspect');
  }

  async search(query: string, limit: number = 5) {
    return await this.sendCommand('music_search', { query, limit });
  }

  async getRadioSeeds(videoId: string, limit: number = 10) {
    return await this.sendCommand('music_get_radio_seeds', { videoId, limit });
  }

  async insertRelative(videoIds: string[], offset: number = 1) {
    return await this.sendCommand('queue_insert_relative', { videoIds, offset });
  }

  async appendQueue(videoIds: string[]) {
    return await this.sendCommand('queue_append', { videoIds });
  }

  async jumpTo(index: number) {
    return await this.sendCommand('queue_jump_to', { index });
  }

  async removeTrack(index: number) {
    return await this.sendCommand('queue_remove', { index });
  }

  async playerControl(action: string, seekSeconds?: number) {
    return await this.sendCommand('player_control', { action, seekSeconds });
  }
}
