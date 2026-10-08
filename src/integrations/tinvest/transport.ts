import http from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import tls from 'node:tls';
import { RUSSIAN_TRUSTED_ROOT_CA } from './ca';

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** One POST of a JSON body; the T-Invest client never calls anything but its own REST gateway. */
export type Transport = (
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
) => Promise<RawResponse>;

/** Node's bundled roots plus the Russian root, for this client only (docs/05-integrations.md, section 1). */
const CA = [...tls.rootCertificates, RUSSIAN_TRUSTED_ROOT_CA];

function flatten(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers))
    if (v !== undefined) out[k] = Array.isArray(v) ? v.join(', ') : v;
  return out;
}

/** A tunnel through an HTTP proxy (CONNECT), for TINVEST_PROXY_URL. */
function tunnel(proxy: URL, host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const auth = proxy.username
      ? Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString(
          'base64',
        )
      : null;
    const req = http.request({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers: { host: `${host}:${port}`, ...(auth ? { 'proxy-authorization': `Basic ${auth}` } : {}) },
      timeout: timeoutMs,
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode === 200) resolve(socket);
      else {
        socket.destroy();
        reject(new Error(`Proxy refused the tunnel: HTTP ${res.statusCode}`));
      }
    });
    req.on('timeout', () => req.destroy(new Error('Proxy timeout')));
    req.on('error', reject);
    req.end();
  });
}

export function nodeTransport(proxyUrl?: string): Transport {
  const proxy = proxyUrl ? new URL(proxyUrl) : null;
  if (proxy && proxy.protocol !== 'http:')
    throw new Error('TINVEST_PROXY_URL: only http:// proxies are supported');
  return async (url, body, headers, timeoutMs) => {
    const target = new URL(url);
    const secure = target.protocol === 'https:';
    const port = Number(target.port || (secure ? 443 : 80));
    const socket = proxy && secure ? await tunnel(proxy, target.hostname, port, timeoutMs) : undefined;
    return new Promise<RawResponse>((resolve, reject) => {
      const options: https.RequestOptions = {
        method: 'POST',
        hostname: target.hostname,
        port,
        path: target.pathname + target.search,
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
        timeout: timeoutMs,
      };
      const onResponse = (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: flatten(res.headers),
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      };
      // Plain http only for the local mock server in tests.
      const req = secure
        ? https.request(
            { ...options, ca: CA, ...(socket ? { socket, servername: target.hostname, agent: false } : {}) },
            onResponse,
          )
        : http.request(options, onResponse);
      req.on('timeout', () =>
        req.destroy(Object.assign(new Error('Request timed out'), { name: 'TimeoutError' })),
      );
      req.on('error', reject);
      req.end(body);
    });
  };
}
