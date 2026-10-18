// Git working-tree adapter + transactions for the CLI and the local server.
// The data dir is its own git repo (private remote once published). A transaction:
//   lock → pull (if remote) → run → commit → push → on rejection reset to remote and re-run.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ConflictError, Store } from '../app/js/store.js';
import { b64, deriveDataKeys } from '../app/js/crypto.js';

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const SAFE_PATH = /^(keys\.json|store\/[a-f0-9]{24}\.enc)$/;

export function assertSafePath(p) {
  if (!SAFE_PATH.test(p)) throw new Error(`refusing path ${p}`);
}

export class FsAdapter {
  constructor(dir) {
    this.dir = dir;
    this.dirty = false;
  }
  abs(p) {
    assertSafePath(p);
    return path.join(this.dir, p);
  }
  async read(p) {
    const f = this.abs(p);
    if (!fs.existsSync(f)) return null;
    const text = fs.readFileSync(f, 'utf8');
    return { text, version: sha(text) };
  }
  async write(p, text, version) {
    const cur = await this.read(p);
    if ((cur?.version ?? null) !== (version ?? null)) throw new ConflictError(p);
    const f = this.abs(p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f + '.tmp', text);
    fs.renameSync(f + '.tmp', f);
    this.dirty = true;
    return sha(text);
  }
  async remove(p, version) {
    const cur = await this.read(p);
    if (!cur) return;
    if (version && cur.version !== version) throw new ConflictError(p);
    fs.unlinkSync(this.abs(p));
    this.dirty = true;
  }
}

export function git(dir, args, opts = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function tryGit(dir, args) {
  try {
    return { ok: true, out: git(dir, args) };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message) };
  }
}

export const hasRemote = (dir) => tryGit(dir, ['remote']).out.split('\n').includes('origin');
const branch = (dir) => tryGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).out || 'main';

// ---- cross-process lock (CLI invocations + mc serve share the data dir) ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withLock(dir, fn) {
  const lock = path.join(dir, '.git', 'mc.lock');
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 60000) fs.rmSync(lock, { recursive: true, force: true });
      } catch {}
      if (Date.now() - start > 30000) throw new Error('data dir is locked (another mc running?)');
      await sleep(80);
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

const PULL_STAMP = (dir) => path.join(dir, '.git', 'mc-last-pull');

export function pull(dir, { force = false } = {}) {
  if (!hasRemote(dir)) return 'no-remote';
  const stamp = PULL_STAMP(dir);
  if (!force && fs.existsSync(stamp) && Date.now() - fs.statSync(stamp).mtimeMs < 20000) return 'fresh';
  const b = branch(dir);
  const f = tryGit(dir, ['fetch', '--quiet', 'origin', b]);
  if (!f.ok) return 'offline';
  // Data repo is only written through mc, so local commits are always pushed or replayable: rebase, else hard reset.
  const r = tryGit(dir, ['rebase', '--quiet', `origin/${b}`]);
  if (!r.ok) {
    tryGit(dir, ['rebase', '--abort']);
    git(dir, ['reset', '--quiet', '--hard', `origin/${b}`]);
  }
  fs.writeFileSync(stamp, String(Date.now()));
  return 'pulled';
}

export function commit(dir, message = 'mc: sync') {
  git(dir, ['add', '-A']);
  if (!tryGit(dir, ['diff', '--cached', '--quiet']).ok) {
    git(dir, ['-c', 'user.name=Mission Control', '-c', 'user.email=mc@localhost', 'commit', '--quiet', '-m', message]);
    return true;
  }
  return false;
}

export function push(dir) {
  if (!hasRemote(dir)) return { ok: true, out: 'no-remote' };
  return tryGit(dir, ['push', '--quiet', 'origin', `HEAD:${branch(dir)}`]);
}

export async function storeFor(cfg) {
  const { dataKey, nameKey } = await deriveDataKeys(b64.decode(cfg.dek));
  const adapter = new FsAdapter(cfg.dataDir);
  return { store: new Store(adapter, { dataKey, nameKey }), adapter };
}

/**
 * Run fn(store) as a transaction. Writes are committed with a generic message (no metadata leaks)
 * and pushed. Returns fn's result.
 */
export async function tx(cfg, fn, { write = true, offline = !!process.env.MC_OFFLINE } = {}) {
  const dir = cfg.dataDir;
  return withLock(dir, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!offline) pull(dir, { force: write });
      const { store, adapter } = await storeFor(cfg);
      const result = await fn(store);
      if (!write || !adapter.dirty) return result;
      commit(dir);
      if (offline) return result;
      const p = push(dir);
      if (p.ok) return result;
      if (!/rejected|non-fast-forward|fetch first/i.test(p.out)) {
        process.stderr.write(`mc: committed locally, push failed (${p.out.split('\n')[0]}). Run: mc sync\n`);
        return result;
      }
      git(dir, ['fetch', '--quiet', 'origin']);
      git(dir, ['reset', '--quiet', '--hard', `origin/${branch(dir)}`]);
    }
    throw new Error('push kept being rejected; try mc sync');
  });
}
