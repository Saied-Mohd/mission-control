// Encrypted document store over a pluggable adapter.
// Adapters: GitHub contents API (app, remote), local server (app, localhost), git working tree (CLI).
// Every doc lives at store/<hmac(logical)>.enc, encrypted with AES-GCM using the logical path as AAD.

import { opaqueName, encryptJSON, decryptJSON } from './crypto.js';

export class ConflictError extends Error {
  constructor(msg = 'conflict') {
    super(msg);
    this.name = 'ConflictError';
  }
}

const clone = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));

export class Store {
  /** @param adapter {read(path), write(path, text, version), remove(path, version)} */
  constructor(adapter, { dataKey, nameKey }) {
    this.adapter = adapter;
    this.dataKey = dataKey;
    this.nameKey = nameKey;
    this.names = new Map();
  }

  async file(logical) {
    if (!this.names.has(logical)) this.names.set(logical, 'store/' + (await opaqueName(this.nameKey, logical)) + '.enc');
    return this.names.get(logical);
  }

  async getV(logical, fallback = null, key = this.dataKey) {
    const hit = await this.adapter.read(await this.file(logical));
    if (!hit) return { value: clone(fallback), version: null };
    return { value: await decryptJSON(key, hit.text, logical), version: hit.version };
  }

  async get(logical, fallback = null, key) {
    return (await this.getV(logical, fallback, key)).value;
  }

  async put(logical, value, version = null, key = this.dataKey) {
    const text = await encryptJSON(key, value, logical);
    return this.adapter.write(await this.file(logical), text, version);
  }

  /** Read-modify-write with optimistic concurrency. fn may mutate and/or return the next value. */
  async update(logical, fn, fallback = null, key = this.dataKey) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { value, version } = await this.getV(logical, fallback, key);
      const draft = clone(value);
      const out = await fn(draft);
      const next = out === undefined ? draft : out;
      try {
        await this.put(logical, next, version, key);
        return next;
      } catch (e) {
        if (!(e instanceof ConflictError) && e?.name !== 'ConflictError') throw e;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1) + Math.random() * 250));
      }
    }
    throw new Error(`Could not save ${logical} after repeated conflicts`);
  }

  async remove(logical) {
    const path = await this.file(logical);
    const hit = await this.adapter.read(path);
    if (hit) await this.adapter.remove(path, hit.version);
  }
}
