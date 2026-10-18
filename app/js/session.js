// Session: mode detection, claim, connect, unlock/lock, remember-device, vault unlock, passphrase changes.
// Decrypted data and raw key bytes live only in memory. localStorage holds only: mode, {owner, repo},
// the wrapped keys.json (safe by design), the PAT *encrypted with the data key*, and UI preferences.
// IndexedDB holds non-extractable CryptoKeys when "remember this device" is on.

import * as C from './crypto.js';
import { Store } from './store.js';
import * as model from './model.js';
import { LocalAdapter, GitHubAdapter, probeLocal } from './adapters.js';

const LS = {
  mode: 'mc.mode',
  gh: 'mc.gh',
  keys: 'mc.keys',
  pat: 'mc.pat',
  autolock: 'mc.autolock',
};

const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};
const lsDel = (k) => {
  try {
    localStorage.removeItem(k);
  } catch {}
};

// ---------------- IndexedDB (remembered device keys) ----------------

const IDB_NAME = 'mission-control';
const IDB_STORE = 'keys';

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbOp(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const req = fn(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const idbGet = (k) => idbOp('readonly', (s) => s.get(k)).catch(() => null);
const idbPut = (k, v) => idbOp('readwrite', (s) => s.put(v, k));
const idbDel = (k) => idbOp('readwrite', (s) => s.delete(k)).catch(() => {});

// ---------------- session ----------------

export const VAULT_TTL_MS = 5 * 60 * 1000;
export const MIN_PASSPHRASE = 12;

class Session extends EventTarget {
  constructor() {
    super();
    this.mode = null; // 'local' | 'github'
    this.info = null; // /api/info in local mode
    this.adapter = null;
    this.keys = null; // parsed keys.json
    this.store = null;
    this.vaultKey = null;
    this.vaultUntil = 0;
    this._vaultTimer = null;
    this._idleTimer = null;
    this.lastActive = Date.now();
    this.pendingReset = null; // raw DEK after a recovery-code unlock, until a new passphrase is set
  }

  on(type, fn) {
    this.addEventListener(type, fn);
    return () => this.removeEventListener(type, fn);
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get unlocked() {
    return !!this.store;
  }
  get vaultUnlocked() {
    return !!this.vaultKey && Date.now() < this.vaultUntil;
  }
  get gh() {
    try {
      return JSON.parse(lsGet(LS.gh) || 'null');
    } catch {
      return null;
    }
  }
  get repoId() {
    return this.mode === 'local' ? 'local' : this.gh ? `${this.gh.owner}/${this.gh.repo}` : null;
  }

  // ---------- boot ----------

  /** → 'claim' | 'connect' | 'lock' | 'local-down' | 'error' */
  async init() {
    const info = await probeLocal();
    if (info) {
      this.mode = 'local';
      this.info = info;
      this.adapter = new LocalAdapter();
      lsSet(LS.mode, 'local');
      if (!info.claimed) return 'claim';
      await this.loadKeysFromAdapter();
      return 'lock';
    }
    this.mode = 'github';
    const gh = this.gh;
    const cached = lsGet(LS.keys);
    if (gh && cached) {
      try {
        this.keys = JSON.parse(cached);
        return 'lock';
      } catch {
        lsDel(LS.keys);
      }
    }
    if (lsGet(LS.mode) === 'local' && !gh) return 'local-down';
    return 'connect';
  }

  async loadKeysFromAdapter() {
    const hit = await this.adapter.read('keys.json');
    if (!hit) throw new Error('keys.json not found in the data repo. Run `mc init` first.');
    this.keys = JSON.parse(hit.text);
    if (this.mode === 'github') lsSet(LS.keys, hit.text);
    return hit;
  }

  /** Read-modify-write keys.json with optimistic concurrency. */
  async updateKeys(mutate) {
    for (let i = 0; i < 4; i++) {
      const hit = await this.adapter.read('keys.json');
      if (!hit) throw new Error('keys.json missing');
      const k = JSON.parse(hit.text);
      await mutate(k);
      const text = JSON.stringify(k, null, 2) + '\n';
      try {
        await this.adapter.write('keys.json', text, hit.version);
        this.keys = k;
        if (this.mode === 'github') lsSet(LS.keys, text);
        return k;
      } catch (e) {
        if (e?.name !== 'ConflictError') throw e;
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
    throw new Error('Could not save keys.json (conflicts)');
  }

  // ---------- claim (local mode, first run) ----------

  /**
   * Claim the data repo: sets master + vault passphrases. Returns the recovery code (show it once).
   * The agent never sees either passphrase or the recovery code; it only had the raw DEK already.
   */
  async claim({ token, passphrase, vaultPassphrase }) {
    if (this.mode !== 'local') throw new Error('Claiming only works against the local server');
    if (!token) throw new Error('Missing claim token. Open the link printed by `mc serve` (it ends in #claim=…).');
    if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Master passphrase must be at least ${MIN_PASSPHRASE} characters`);
    if (vaultPassphrase.length < MIN_PASSPHRASE) throw new Error(`Vault passphrase must be at least ${MIN_PASSPHRASE} characters`);
    if (passphrase === vaultPassphrase) throw new Error('The vault passphrase must differ from the master passphrase');

    const { dek } = await this.adapter.claim(token);
    const dekRaw = C.b64.decode(dek);
    const vaultRaw = C.randomBytes(32);
    const recovery = C.newRecoveryCode();
    try {
      const [dp, dr, vp, vr] = await Promise.all([
        C.wrapWithSecret(dekRaw, passphrase, 'mc-dek'),
        C.wrapWithSecret(dekRaw, recovery, 'mc-dek'),
        C.wrapWithSecret(vaultRaw, vaultPassphrase, 'mc-vault'),
        C.wrapWithSecret(vaultRaw, recovery, 'mc-vault'),
      ]);
      const dataKeys = await C.deriveDataKeys(dekRaw);
      const vaultKey = await C.deriveVaultKey(vaultRaw);
      await this.updateKeys((k) => {
        k.v = k.v || 1;
        k.claimed = true;
        k.claimedAt = model.now();
        k.dek = { passphrase: dp, recovery: dr };
        k.vault = { passphrase: vp, recovery: vr };
      });
      this.store = new Store(this.adapter, dataKeys);
      await this.forcePut(model.DOC.vault, { items: [] }, vaultKey);
      await this.forcePut(model.DOC.vaultIndex, model.vaultIndexFrom({ items: [] }));
      await model.audit(this.store, 'saied', 'claim', 'keys.json');
      this.info = { ...this.info, claimed: true };
      this.startIdleWatch();
      this.emit('unlock');
      return recovery;
    } finally {
      dekRaw.fill(0);
      vaultRaw.fill(0);
    }
  }

  /** put() that overwrites whatever is there (used for fresh docs at claim time). */
  async forcePut(logical, value, key) {
    const path = await this.store.file(logical);
    const hit = await this.adapter.read(path);
    return this.store.put(logical, value, hit?.version ?? null, key);
  }

  // ---------- GitHub connect (first visit on a device) ----------

  async connect({ owner, repo, pat, secret, useRecovery = false, remember = false }) {
    owner = owner.trim();
    repo = repo.trim();
    pat = pat.trim();
    if (!owner || !repo || !pat) throw new Error('Owner, repo and token are required');
    const adapter = new GitHubAdapter({ owner, repo, token: pat });
    await adapter.checkRepo();
    const hit = await adapter.read('keys.json');
    if (!hit) throw new Error('keys.json not found in that repo. Is this the data repo?');
    const keys = JSON.parse(hit.text);
    if (!keys.claimed || !keys.dek) throw new Error('This data repo has not been claimed yet. Run `mc serve` on your computer and finish setup first.');
    const dekRaw = useRecovery
      ? await C.unwrapWithSecret(keys.dek.recovery, C.normalizeRecoveryCode(secret), 'mc-dek')
      : await C.unwrapWithSecret(keys.dek.passphrase, secret, 'mc-dek');
    const dataKeys = await C.deriveDataKeys(dekRaw);
    lsSet(LS.gh, JSON.stringify({ owner, repo }));
    lsSet(LS.keys, hit.text);
    lsSet(LS.mode, 'github');
    lsSet(LS.pat, await C.encryptJSON(dataKeys.dataKey, pat, 'pat'));
    this.mode = 'github';
    this.keys = keys;
    this.adapter = adapter;
    this.store = new Store(adapter, dataKeys);
    if (useRecovery) this.pendingReset = dekRaw;
    else dekRaw.fill(0);
    if (remember) await this.rememberDevice(dataKeys);
    this.startIdleWatch();
    this.emit('unlock');
  }

  async setPat(pat) {
    if (!this.store) throw new Error('locked');
    pat = pat.trim();
    const adapter = new GitHubAdapter({ ...this.gh, token: pat });
    await adapter.checkRepo();
    lsSet(LS.pat, await C.encryptJSON(this.store.dataKey, pat, 'pat'));
    this.adapter = adapter;
    this.store.adapter = adapter;
  }

  // ---------- unlock ----------

  async _openWith(dataKeys) {
    if (this.mode === 'github') {
      const enc = lsGet(LS.pat);
      if (!enc) throw new Error('No saved GitHub token on this device. Reconnect.');
      let pat;
      try {
        pat = await C.decryptJSON(dataKeys.dataKey, enc, 'pat');
      } catch {
        throw new Error('Saved GitHub token could not be decrypted. Reconnect this device.');
      }
      this.adapter = new GitHubAdapter({ ...this.gh, token: pat });
    }
    this.store = new Store(this.adapter, dataKeys);
    this.startIdleWatch();
    // Refresh the cached keys.json in the background (passphrase changes from other devices).
    if (this.mode === 'github') this.loadKeysFromAdapter().catch(() => {});
  }

  async unlock(passphrase, { remember = false } = {}) {
    if (!this.keys?.dek?.passphrase) throw new Error('keys.json has no passphrase wrap yet');
    const dekRaw = await C.unwrapWithSecret(this.keys.dek.passphrase, passphrase, 'mc-dek');
    const dataKeys = await C.deriveDataKeys(dekRaw);
    dekRaw.fill(0);
    await this._openWith(dataKeys);
    if (remember) await this.rememberDevice(dataKeys);
    this.emit('unlock');
  }

  /** Unlock with the recovery code; the caller must then force setNewPassphrase(). */
  async unlockRecovery(code) {
    if (!this.keys?.dek?.recovery) throw new Error('keys.json has no recovery wrap');
    const dekRaw = await C.unwrapWithSecret(this.keys.dek.recovery, C.normalizeRecoveryCode(code), 'mc-dek');
    const dataKeys = await C.deriveDataKeys(dekRaw);
    await this._openWith(dataKeys);
    this.pendingReset = dekRaw;
    this.emit('unlock');
  }

  /** After a recovery unlock: rewrap the DEK with a new master passphrase. */
  async setNewPassphrase(passphrase) {
    if (!this.pendingReset) throw new Error('No pending reset');
    if (passphrase.length < MIN_PASSPHRASE) throw new Error(`At least ${MIN_PASSPHRASE} characters`);
    const box = await C.wrapWithSecret(this.pendingReset, passphrase, 'mc-dek');
    await this.updateKeys((k) => {
      k.dek.passphrase = box;
    });
    this.pendingReset.fill(0);
    this.pendingReset = null;
    await model.audit(this.store, 'saied', 'keys.reset-passphrase', 'keys.json');
  }

  async changePassphrase(oldPass, newPass) {
    if (newPass.length < MIN_PASSPHRASE) throw new Error(`New passphrase must be at least ${MIN_PASSPHRASE} characters`);
    const hit = await this.adapter.read('keys.json');
    const k = JSON.parse(hit.text);
    const dekRaw = await C.unwrapWithSecret(k.dek.passphrase, oldPass, 'mc-dek');
    try {
      if (k.vault?.passphrase) {
        let same = false;
        try {
          (await C.unwrapWithSecret(k.vault.passphrase, newPass, 'mc-vault')).fill(0);
          same = true;
        } catch {}
        if (same) throw new Error('The master passphrase must differ from the vault passphrase');
      }
      const box = await C.wrapWithSecret(dekRaw, newPass, 'mc-dek');
      await this.updateKeys((kk) => {
        kk.dek.passphrase = box;
      });
    } finally {
      dekRaw.fill(0);
    }
    await model.audit(this.store, 'saied', 'keys.change-passphrase', 'keys.json');
  }

  // ---------- remember device ----------

  async rememberDevice(dataKeys) {
    const keys = dataKeys || (this.store && { dataKey: this.store.dataKey, nameKey: this.store.nameKey });
    if (!keys) throw new Error('locked');
    await idbPut('device', { dataKey: keys.dataKey, nameKey: keys.nameKey, repoId: this.repoId, created: model.now() });
    this.emit('device');
  }

  async forgetDevice() {
    await idbDel('device');
    this.emit('device');
  }

  async rememberedRecord() {
    const rec = await idbGet('device');
    if (!rec || rec.repoId !== this.repoId || !rec.dataKey || !rec.nameKey) return null;
    return rec;
  }

  async isRemembered() {
    return !!(await this.rememberedRecord());
  }

  /** Try to unlock with keys remembered in IndexedDB. → true on success. */
  async unlockRemembered() {
    const rec = await this.rememberedRecord();
    if (!rec) return false;
    const dataKeys = { dataKey: rec.dataKey, nameKey: rec.nameKey };
    try {
      await this._openWith(dataKeys);
    } catch (e) {
      this.store = null;
      throw e;
    }
    // Verify the keys still decrypt (fails with OperationError if the DEK changed).
    try {
      await this.store.get(model.DOC.index, null);
    } catch (e) {
      if (e?.name === 'OperationError' || e?.name === 'SyntaxError') {
        this.store = null;
        await this.forgetDevice();
        return false;
      }
      // network problems: keep going, the shell will surface errors
    }
    this.emit('unlock');
    return true;
  }

  // ---------- lock ----------

  lock(reason = 'manual') {
    this.lockVault();
    if (this.pendingReset) {
      this.pendingReset.fill(0);
      this.pendingReset = null;
    }
    if (this.store) {
      this.store.names.clear();
      this.store.dataKey = null;
      this.store.nameKey = null;
    }
    this.store = null;
    if (this.mode === 'github' && this.adapter) this.adapter.token = null;
    clearInterval(this._idleTimer);
    this._idleTimer = null;
    this.emit('lock', { reason });
  }

  /** Forget everything on this device (GitHub mode): cached keys, encrypted PAT, remembered keys. */
  async disconnect() {
    await this.forgetDevice();
    for (const k of [LS.gh, LS.keys, LS.pat, LS.mode]) lsDel(k);
    this.lock('disconnect');
  }

  // ---------- idle auto-lock ----------

  get autoLockMinutes() {
    const v = Number(lsGet(LS.autolock));
    return Number.isFinite(v) && lsGet(LS.autolock) !== null ? v : 30;
  }
  set autoLockMinutes(v) {
    lsSet(LS.autolock, String(Math.max(0, Math.round(Number(v) || 0))));
  }

  touch() {
    this.lastActive = Date.now();
  }

  startIdleWatch() {
    this.lastActive = Date.now();
    clearInterval(this._idleTimer);
    this._idleTimer = setInterval(() => this.checkIdle(), 15000);
  }

  checkIdle() {
    if (!this.store) return;
    if (this.vaultKey && Date.now() >= this.vaultUntil) this.lockVault();
    const m = this.autoLockMinutes;
    if (m > 0 && Date.now() - this.lastActive > m * 60000) this.lock('idle');
  }

  // ---------- vault ----------

  async unlockVault(secret, { recovery = false } = {}) {
    if (!this.store) throw new Error('locked');
    const box = recovery ? this.keys.vault?.recovery : this.keys.vault?.passphrase;
    if (!box) throw new Error('No vault keys in keys.json');
    const raw = await C.unwrapWithSecret(box, recovery ? C.normalizeRecoveryCode(secret) : secret, 'mc-vault');
    try {
      this.vaultKey = await C.deriveVaultKey(raw);
    } finally {
      raw.fill(0);
    }
    this.vaultUntil = Date.now() + VAULT_TTL_MS;
    clearTimeout(this._vaultTimer);
    this._vaultTimer = setTimeout(() => this.lockVault(), VAULT_TTL_MS);
    await model.audit(this.store, 'saied', 'vault.unlock', '');
    this.emit('vault', { unlocked: true });
  }

  lockVault() {
    const was = !!this.vaultKey;
    this.vaultKey = null;
    this.vaultUntil = 0;
    clearTimeout(this._vaultTimer);
    if (was) this.emit('vault', { unlocked: false });
  }

  requireVault() {
    if (!this.vaultUnlocked) {
      this.lockVault();
      throw new Error('Vault is locked');
    }
    return this.vaultKey;
  }

  async getVault() {
    const key = this.requireVault();
    return this.store.get(model.DOC.vault, { items: [] }, key);
  }

  /** Mutate the vault, then keep vault-index in sync and audit. */
  async updateVault(fn, action = 'vault.update', target = '') {
    const key = this.requireVault();
    const next = await this.store.update(model.DOC.vault, fn, { items: [] }, key);
    await this.store.update(model.DOC.vaultIndex, () => model.vaultIndexFrom(next), { items: [] });
    await model.audit(this.store, 'saied', action, target);
    return next;
  }

  async changeVaultPassphrase(oldSecret, newPass, { recovery = false } = {}) {
    if (newPass.length < MIN_PASSPHRASE) throw new Error(`At least ${MIN_PASSPHRASE} characters`);
    const hit = await this.adapter.read('keys.json');
    const k = JSON.parse(hit.text);
    const raw = recovery
      ? await C.unwrapWithSecret(k.vault.recovery, C.normalizeRecoveryCode(oldSecret), 'mc-vault')
      : await C.unwrapWithSecret(k.vault.passphrase, oldSecret, 'mc-vault');
    try {
      // The master passphrase must not double as the vault passphrase.
      try {
        await C.unwrapWithSecret(k.dek.passphrase, newPass, 'mc-dek');
        throw new Error('The vault passphrase must differ from the master passphrase');
      } catch (e) {
        if (e.message !== 'BAD_SECRET') throw e;
      }
      const box = await C.wrapWithSecret(raw, newPass, 'mc-vault');
      await this.updateKeys((kk) => {
        kk.vault.passphrase = box;
      });
    } finally {
      raw.fill(0);
    }
    await model.audit(this.store, 'saied', 'vault.change-passphrase', 'keys.json');
  }
}

export const session = new Session();
