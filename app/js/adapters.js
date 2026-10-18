// Storage adapters for the Store: { read(path) → {text, version}|null, write(path, text, version) → version, remove(path, version) }.
// LocalAdapter talks to `mc serve` (127.0.0.1) and GitHubAdapter to the GitHub contents API.
// Both report network activity through a window 'mc:net' event so the shell can show "syncing…".

import { ConflictError } from './store.js';
import { b64, utf8 } from './crypto.js';

const SAFE_PATH = /^(keys\.json|store\/[a-f0-9]{24}\.enc)$/;

function assertPath(p) {
  if (!SAFE_PATH.test(p)) throw new Error(`refusing path ${p}`);
}

let busy = 0;
function emit() {
  window.dispatchEvent(new CustomEvent('mc:net', { detail: { busy } }));
}
async function tracked(fn) {
  busy++;
  emit();
  try {
    return await fn();
  } finally {
    busy--;
    emit();
  }
}

export class HttpError extends Error {
  constructor(status, msg) {
    super(msg || `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function errorText(res) {
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      return j.error || j.message || t.slice(0, 200);
    } catch {
      return t.slice(0, 200);
    }
  } catch {
    return '';
  }
}

// ---------------- local server ----------------

export class LocalAdapter {
  constructor(base = './api/') {
    this.base = base;
    this.kind = 'local';
  }

  async req(method, path, { query, body } = {}) {
    const url = new URL(this.base + path, location.href);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return tracked(() =>
      fetch(url, {
        method,
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'X-MC': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  }

  async json(method, path, opts) {
    const res = await this.req(method, path, opts);
    if (!res.ok) throw new HttpError(res.status, `${method} /api/${path}: ${res.status} ${await errorText(res)}`);
    return res.json();
  }

  async read(path) {
    assertPath(path);
    const res = await this.req('GET', 'file', { query: { path } });
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(res.status, `read ${path}: ${res.status} ${await errorText(res)}`);
    const j = await res.json();
    return { text: j.text, version: j.version ?? null };
  }

  async write(path, text, version = null) {
    assertPath(path);
    const res = await this.req('PUT', 'file', { body: { path, text, version: version ?? null } });
    if (res.status === 409) throw new ConflictError(path);
    if (!res.ok) throw new HttpError(res.status, `write ${path}: ${res.status} ${await errorText(res)}`);
    const j = await res.json();
    return j.version;
  }

  async remove(path, version) {
    assertPath(path);
    const res = await this.req('DELETE', 'file', { body: { path, version: version ?? null } });
    if (res.status === 409) throw new ConflictError(path);
    if (res.status === 404) return;
    if (!res.ok) throw new HttpError(res.status, `delete ${path}: ${res.status} ${await errorText(res)}`);
  }

  info() {
    return this.json('GET', 'info');
  }
  claim(token) {
    return this.json('POST', 'claim', { body: { token } });
  }
  sync() {
    return this.json('POST', 'sync', { body: {} });
  }
  notify(payload) {
    return this.json('POST', 'notify', { body: payload });
  }
}

/** Probe for the local server. Resolves the /api/info JSON or null. */
export async function probeLocal(timeoutMs = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch('./api/info', { headers: { 'X-MC': '1' }, cache: 'no-store', signal: ctl.signal });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    const j = await res.json();
    return j && j.mode === 'local' ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ---------------- GitHub contents API ----------------

const GH = 'https://api.github.com';

function encPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

export class GitHubAdapter {
  constructor({ owner, repo, token }) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.kind = 'github';
  }

  get base() {
    return `${GH}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
  }

  async req(method, url, body) {
    const res = await tracked(() =>
      fetch(url, {
        method,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('mc:auth', { detail: { status: 401 } }));
      throw new HttpError(401, 'GitHub rejected the token (401). The PAT may have expired — update it in Settings.');
    }
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      throw new HttpError(403, `GitHub rate limit hit; resets ${reset ? new Date(reset).toLocaleTimeString() : 'soon'}.`);
    }
    return res;
  }

  async read(path) {
    assertPath(path);
    const res = await this.req('GET', `${this.base}/contents/${encPath(path)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(res.status, `GitHub read ${path}: ${res.status} ${await errorText(res)}`);
    const j = await res.json();
    if (Array.isArray(j) || j.type !== 'file') throw new Error(`${path} is not a file`);
    let content = j.content;
    // Files over 1 MB come back with empty content (encoding "none"): fetch the blob by sha.
    if ((!content && j.size > 0) || j.encoding === 'none') {
      const bres = await this.req('GET', `${this.base}/git/blobs/${encodeURIComponent(j.sha)}`);
      if (!bres.ok) throw new HttpError(bres.status, `GitHub blob ${path}: ${bres.status} ${await errorText(bres)}`);
      const blob = await bres.json();
      content = blob.content || '';
    }
    return { text: utf8.decode(b64.decode(content || '')), version: j.sha };
  }

  async write(path, text, version = null) {
    assertPath(path);
    const body = { message: 'mc: update', content: b64.encode(utf8.encode(text)) };
    if (version) body.sha = version;
    const res = await this.req('PUT', `${this.base}/contents/${encPath(path)}`, body);
    if (res.status === 409 || res.status === 422) throw new ConflictError(path);
    if (!res.ok) throw new HttpError(res.status, `GitHub write ${path}: ${res.status} ${await errorText(res)}`);
    const j = await res.json();
    return j.content?.sha ?? null;
  }

  async remove(path, version) {
    assertPath(path);
    const res = await this.req('DELETE', `${this.base}/contents/${encPath(path)}`, { message: 'mc: update', sha: version });
    if (res.status === 404) return;
    if (res.status === 409 || res.status === 422) throw new ConflictError(path);
    if (!res.ok) throw new HttpError(res.status, `GitHub delete ${path}: ${res.status} ${await errorText(res)}`);
  }

  /** Quick check that the token can see the repo. */
  async checkRepo() {
    const res = await this.req('GET', this.base);
    if (res.status === 404) throw new HttpError(404, `Repo ${this.owner}/${this.repo} not found, or the token cannot see it.`);
    if (!res.ok) throw new HttpError(res.status, `GitHub: ${res.status} ${await errorText(res)}`);
    return res.json();
  }
}
