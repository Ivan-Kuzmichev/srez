// Loaded before the web server (`node --import`): puts the TCP peer address of every request into
// `x-srez-peer`, overwriting anything a client sent. Next.js keeps a client's X-Forwarded-For and drops
// the socket address, which would let anyone claim a local address (docs/06-api.md, section 3).
// A per-run key proves the header came from here; child processes of `next dev` inherit it.
import { randomBytes } from 'node:crypto';
import http from 'node:http';

process.env.SREZ_PEER_KEY ??= randomBytes(16).toString('hex');
const key = process.env.SREZ_PEER_KEY;
const emit = http.Server.prototype.emit;

http.Server.prototype.emit = function (event, req, ...rest) {
  if (event === 'request' && req && req.headers) {
    req.headers['x-srez-peer'] = `${key} ${req.socket?.remoteAddress ?? ''}`;
  }
  return emit.call(this, event, req, ...rest);
};
