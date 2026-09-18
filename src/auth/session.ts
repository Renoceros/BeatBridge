import { session } from 'electron';
import * as crypto from 'crypto';

export interface AuthHeaders {
  Cookie: string;
  'x-youtube-client-name': string;
  'x-youtube-client-version': string;
  'x-origin': string;
  'Origin': string;
  'Referer': string;
  authorization?: string;
}

export function generateSAPISIDHash(sapisid: string, origin: string = 'https://music.youtube.com'): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1').update(`${timestamp} ${sapisid} ${origin}`).digest('hex');
  return `SAPISIDHASH ${timestamp}_${hash}`;
}

export async function getAuthHeaders(partition: string = 'persist:ytmusic'): Promise<AuthHeaders> {
  const authHeaders: AuthHeaders = {
    Cookie: '',
    'x-youtube-client-name': '67', // YouTube Music Web Client
    'x-youtube-client-version': '1.20260901.01.00',
    'x-origin': 'https://music.youtube.com',
    'Origin': 'https://music.youtube.com',
    'Referer': 'https://music.youtube.com/'
  };

  if (!session || typeof session.fromPartition !== 'function') {
    return authHeaders;
  }

  const ses = session.fromPartition(partition);
  const cookies = await ses.cookies.get({});
  
  // Filter for youtube cookies
  const ytCookies = cookies.filter(c => c.domain && c.domain.includes('youtube.com'));
  const cookieHeader = ytCookies.map(c => `${c.name}=${c.value}`).join('; ');
  authHeaders.Cookie = cookieHeader;

  const sapisidCookie = ytCookies.find(c => c.name === 'SAPISID' || c.name === '__Secure-3PAPISID');
  if (sapisidCookie) {
    authHeaders.authorization = generateSAPISIDHash(sapisidCookie.value);
  }

  return authHeaders;
}
