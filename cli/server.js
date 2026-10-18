// mc serve — local Mission Control on 127.0.0.1. Serves app/ and deck/, plus the file API
// from docs/CONTRACT.md backed by the data repo working tree.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, loadConfig } from './config.js';
import { FsAdapter, withLock, commit, pull, push, hasRemote, git, assertSafePath } from './gitstore.js';
import { ConflictError } from '../app/js/store.js';
import { notifyAll } from './notify.js';
import { storeFor } from './gitstore.js';
import { c } from './util.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    ...(isObj ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (d) => {
      size += d.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(d);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function serveStatic(res, baseDir, rel) {
  const target = path.normalize(path.join(baseDir, rel));
  if (!target.startsWith(baseDir)) return send(res, 403, 'forbidden');
  let file = target;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return send(res, 404, 'not found');
  const ext = path.extname(file);
  const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
  if (path.basename(file) === 'sw.js') headers['Service-Worker-Allowed'] = './';
  send(res, 200, fs.readFileSync(file), headers);
}

export async function serve({ flags }) {
  const cfg = loadConfig();
  const port = Number(flags.port || cfg.port || 4317);
  const dir = cfg.dataDir;
  const adapter = new FsAdapter(dir);
  const appDir = path.join(ROOT, 'app');
  const deckDir = path.join(ROOT, 'deck');
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const keysFile = path.join(dir, 'keys.json');
  const claimed = () => JSON.parse(fs.readFileSync(keysFile, 'utf8')).claimed === true;
  const claimToken = claimed() ? null : crypto.randomBytes(18).toString('base64url');

  // Debounced commit+push after writes; periodic pull to pick up phone edits.
  let pushTimer = null;
  let lastPull = 'never';
  const schedulePush = () => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      withLock(dir, async () => {
        commit(dir);
        if (!hasRemote(dir)) return;
        const r = push(dir);
        if (!r.ok) {
          lastPull = pull(dir, { force: true });
          push(dir);
        }
      }).catch((e) => console.error('push failed:', e.message));
    }, 2000);
  };
  const pullNow = () =>
    withLock(dir, async () => {
      commit(dir);
      lastPull = pull(dir, { force: true });
    }).catch(() => {});
  const pullTimer = setInterval(pullNow, 30000);

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host)) return send(res, 421, 'bad host');
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
        if (url.pathname === '/deck') return send(res, 301, '', { Location: '/deck/' });
        if (url.pathname.startsWith('/deck/')) return serveStatic(res, deckDir, decodeURIComponent(url.pathname.slice(5)));
        return serveStatic(res, appDir, decodeURIComponent(url.pathname));
      }
      // API: custom header blocks cross-site form/simple requests; Origin, when present, must be us.
      if (req.headers['x-mc'] !== '1') return send(res, 403, { error: 'missing X-MC header' });
      if (req.headers.origin && !allowedHosts.has(req.headers.origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'bad origin' });

      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /api/info') {
        return send(res, 200, { mode: 'local', claimed: claimed(), hasRemote: hasRemote(dir), remote: hasRemote(dir) ? git(dir, ['remote', 'get-url', 'origin']).replace(/\/\/[^@]*@/, '//') : null, lastPull });
      }
      if (route === 'GET /api/file') {
        const p = url.searchParams.get('path');
        assertSafePath(p);
        const hit = await adapter.read(p);
        return hit ? send(res, 200, hit) : send(res, 404, { error: 'not found' });
      }
      if (route === 'PUT /api/file' || route === 'DELETE /api/file') {
        const body = await readBody(req);
        assertSafePath(body.path);
        if (body.path === 'keys.json' && claimed()) {
          // After claiming, keys.json may only change wraps, never the agent/vapid identity.
          const cur = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
          const next = JSON.parse(body.text);
          if (next.agent?.publicJwk?.x !== cur.agent.publicJwk.x || next.vapidPublicKey !== cur.vapidPublicKey || next.claimed !== true) {
            return send(res, 403, { error: 'keys.json identity is immutable' });
          }
        }
        try {
          const out = await withLock(dir, async () => {
            if (req.method === 'PUT') return { version: await adapter.write(body.path, body.text, body.version ?? null) };
            await adapter.remove(body.path, body.version);
            return { ok: true };
          });
          schedulePush();
          return send(res, 200, out);
        } catch (e) {
          if (e instanceof ConflictError) return send(res, 409, { error: 'conflict' });
          throw e;
        }
      }
      if (route === 'POST /api/claim') {
        const body = await readBody(req);
        if (claimed() || !claimToken) return send(res, 410, { error: 'already claimed' });
        const a = Buffer.from(String(body.token || ''));
        const b = Buffer.from(claimToken);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 403, { error: 'bad token' });
        return send(res, 200, { dek: cfg.dek });
      }
      if (route === 'POST /api/sync') {
        await pullNow();
        schedulePush();
        return send(res, 200, { ok: true, status: lastPull });
      }
      if (route === 'POST /api/notify') {
        const body = await readBody(req);
        const r = await withLock(dir, async () => {
          const { store } = await storeFor(cfg);
          return notifyAll(cfg, store, { title: String(body.title || 'Mission Control').slice(0, 120), body: String(body.body || '').slice(0, 300), url: body.url || '#/', tag: body.tag || 'test', kind: 'agent' }, 'agent');
        });
        schedulePush();
        return send(res, 200, r);
      }
      return send(res, 404, { error: 'unknown route' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${port}/`;
  console.log(c.green(`Mission Control → ${base}`));
  if (claimToken) console.log(c.amber(`First run — Saied, open this to set your passphrases:\n  ${base}#claim=${claimToken}`));
  console.log(c.dim(`deck → ${base}deck/   data → ${dir}   (Ctrl+C to stop)`));
  const stop = () => {
    clearInterval(pullTimer);
    server.close();
    withLock(dir, async () => {
      commit(dir);
      if (hasRemote(dir)) push(dir);
    }).finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return new Promise(() => {});
}
