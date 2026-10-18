import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as C from '../app/js/crypto.js';
import * as M from '../app/js/model.js';
import { Store } from '../app/js/store.js';
import { FsAdapter } from '../cli/gitstore.js';
import { encryptPayload, decryptPayload, generateVapid, vapidHeader } from '../cli/webpush.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const MC = path.join(ROOT, 'bin', 'mc.js');

test('passphrase wrap / unwrap, wrong passphrase rejected', async () => {
  const dek = C.randomBytes(32);
  const box = await C.wrapWithSecret(dek, 'correct horse battery staple', 'mc-dek');
  assert.deepEqual(await C.unwrapWithSecret(box, 'correct horse battery staple', 'mc-dek'), dek);
  await assert.rejects(C.unwrapWithSecret(box, 'wrong', 'mc-dek'), /BAD_SECRET/);
  await assert.rejects(C.unwrapWithSecret(box, 'correct horse battery staple', 'mc-vault'), /BAD_SECRET/);
});

test('docs are bound to their logical name (AAD) and names are opaque', async () => {
  const keys = await C.deriveDataKeys(C.randomBytes(32));
  const ct = await C.encryptJSON(keys.dataKey, { a: 1 }, 'project/x');
  assert.deepEqual(await C.decryptJSON(keys.dataKey, ct, 'project/x'), { a: 1 });
  await assert.rejects(C.decryptJSON(keys.dataKey, ct, 'project/y'));
  const n = await C.opaqueName(keys.nameKey, 'project/drmbld');
  assert.match(n, /^[a-f0-9]{24}$/);
  assert.ok(!ct.includes('drmbld'));
});

test('sealed grant opens only with the agent private key', async () => {
  const agent = await C.generateAgentKeys();
  const other = await C.generateAgentKeys();
  const box = await C.sealToPublic(agent.publicJwk, { secrets: { K: 'v' } });
  assert.deepEqual((await C.openSealed(agent.privateJwk, box)).secrets, { K: 'v' });
  await assert.rejects(C.openSealed(other.privateJwk, box));
});

test('web push aes128gcm round trip + VAPID JWT verifies', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const keys = { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const buf = encryptPayload(keys, '{"title":"hi"}');
  assert.equal(decryptPayload(ua, auth, buf), '{"title":"hi"}');

  const v = generateVapid();
  const hdr = vapidHeader('https://push.example.com/abc', v, 'mailto:x@y.z');
  const [, jwt, k] = hdr.match(/^vapid t=(.+), k=(.+)$/);
  assert.equal(k, v.publicKey);
  const [h, p, s] = jwt.split('.');
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: v.privateJwk.x, y: v.privateJwk.y }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'https://push.example.com');
});

test('store conflict detection + model flows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-store-'));
  const keys = await C.deriveDataKeys(C.randomBytes(32));
  const store = new Store(new FsAdapter(dir), keys);
  await M.createProject(store, { name: 'Alpha Beta', slug: undefined, path: undefined, tags: ['x'] });
  assert.equal((await M.listProjects(store))[0].slug, 'alpha-beta');
  assert.equal(await M.resolveSlug(store, 'alp'), 'alpha-beta');
  const t = await M.addTask(store, 'alpha-beta', { title: 'Ship it' });
  await M.updateTask(store, 'alpha-beta', t.id.slice(-5), { col: 'done' });
  const [s] = await M.listProjects(store);
  assert.equal(s.done, 1);
  assert.equal(s.lastLine, 'Done: Ship it');
  await M.setHandoff(store, 'alpha-beta', 'next: test');
  assert.equal((await M.getProject(store, 'alpha-beta')).handoff.text, 'next: test');

  const { version } = await store.getV('index');
  await store.put('index', { order: [], projects: {}, activity: [] }, version);
  await assert.rejects(store.put('index', {}, version), (e) => e.name === 'ConflictError');

  const m = await M.brainAdd(store, { type: 'idea', title: 'stale idea', confidence: 0.2 });
  const b = await store.get(M.DOC.brain);
  b.nodes[0].touched = new Date(Date.now() - 400 * 86400000).toISOString();
  await store.put(M.DOC.brain, b, (await store.getV(M.DOC.brain)).version);
  assert.equal(M.pruneCandidates(await store.get(M.DOC.brain))[0].n.id, m.id);
  await M.brainPrune(store, m.id, 'never acted on');
  assert.equal((await store.get(M.DOC.brain)).pruned[0].reason, 'never acted on');
});

test('end to end: init → claim → seed → secret request → approve (as app) → exec', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-home-'));
  const data = path.join(home, 'data');
  const env = { ...process.env, MC_HOME: home, MC_OFFLINE: '1', NO_COLOR: '1' };
  const mc = (...a) => execFileSync(process.execPath, [MC, ...a], { env, encoding: 'utf8' });

  mc('init', '--data', data);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'agent.json'), 'utf8'));
  assert.equal(fs.statSync(path.join(home, 'agent.json')).mode & 0o777, 0o600);

  // --- what the browser does on claim ---
  const dek = C.b64.decode(cfg.dek);
  const vaultRaw = C.randomBytes(32);
  const keysPath = path.join(data, 'keys.json');
  const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
  const rc = C.newRecoveryCode();
  keys.dek = { passphrase: await C.wrapWithSecret(dek, 'master pass 1234', 'mc-dek'), recovery: await C.wrapWithSecret(dek, rc, 'mc-dek') };
  keys.vault = { passphrase: await C.wrapWithSecret(vaultRaw, 'vault pass 5678', 'mc-vault'), recovery: await C.wrapWithSecret(vaultRaw, rc, 'mc-vault') };
  keys.claimed = true;
  fs.writeFileSync(keysPath, JSON.stringify(keys));
  const dk = await C.deriveDataKeys(await C.unwrapWithSecret(keys.dek.passphrase, 'master pass 1234', 'mc-dek'));
  const vaultKey = await C.deriveVaultKey(await C.unwrapWithSecret(keys.vault.recovery, rc, 'mc-vault'));
  const app = new Store(new FsAdapter(data), dk);
  const vault = { items: [{ name: 'DEMO_TOKEN', value: 's3cr3t-value', projects: ['demo'], note: '', expiresAt: null, updated: M.now() }] };
  await app.put(M.DOC.vault, vault, null, vaultKey);
  await app.put(M.DOC.vaultIndex, M.vaultIndexFrom(vault));

  // --- agent works ---
  const seedFile = path.join(home, 'seed.json');
  fs.writeFileSync(seedFile, JSON.stringify({ projects: [{ slug: 'demo', name: 'Demo', tasks: [{ title: 'first', col: 'next' }], log: [{ ts: '2026-01-01T00:00:00Z', kind: 'progress', text: 'began' }], handoff: 'start here' }], brain: [{ type: 'principle', title: 'Ask before secrets', pinned: true }], radar: [{ date: '2030-01-01', text: 'far away', project: 'demo' }] }));
  mc('seed', seedFile);
  mc('log', 'dem', 'did a thing', '--kind', 'decision');
  const brief = mc('brief', 'demo');
  assert.match(brief, /start here/);
  assert.match(brief, /did a thing/);
  assert.match(brief, /first/);
  assert.match(mc('secret', 'ls'), /DEMO_TOKEN/);
  assert.doesNotMatch(mc('secret', 'ls'), /s3cr3t/);

  // agent cannot read the vault with its own key material
  const agentStore = new Store(new FsAdapter(data), await C.deriveDataKeys(C.b64.decode(cfg.dek)));
  await assert.rejects(agentStore.get(M.DOC.vault));

  assert.throws(() => mc('secret', 'exec', 'DEMO_TOKEN', '--', 'true'), /No live approval/);
  const reqOut = mc('secret', 'request', 'DEMO_TOKEN', '--project', 'demo', '--reason', 'test', '--ttl', 'once');
  const reqId = reqOut.match(/request (q\w+)/)[1];

  // --- Saied approves in the app ---
  const req = (await app.get(M.DOC.requests)).items.find((r) => r.id === reqId);
  const v = await app.get(M.DOC.vault, null, vaultKey);
  const box = await C.sealToPublic(req.agentPublicJwk, { requestId: req.id, secrets: { DEMO_TOKEN: v.items[0].value } });
  await app.put(M.DOC.grant(req.id), { box, expiresAt: new Date(Date.now() + M.TTL.once.ms).toISOString(), uses: 1, used: 0, created: M.now() });
  await M.resolveRequest(app, req.id, { status: 'approved', ttl: 'once' });

  const run = mc('secret', 'exec', 'DEMO_TOKEN', '--', process.execPath, '-e', 'process.stdout.write(process.env.DEMO_TOKEN === "s3cr3t-value" ? "GOT_IT" : "NOPE")');
  assert.match(run, /GOT_IT/);
  assert.doesNotMatch(run, /s3cr3t/);
  assert.throws(() => mc('secret', 'exec', 'DEMO_TOKEN', '--', 'true'), /No live approval/); // once = single use
  const auditLog = await app.get(M.DOC.audit);
  assert.ok(auditLog.items.some((a) => a.action === 'secret.exec'));

  // nothing in the data repo is plaintext
  const all = fs.readdirSync(path.join(data, 'store')).map((f) => fs.readFileSync(path.join(data, 'store', f), 'utf8')).join('');
  for (const leak of ['demo', 'DEMO_TOKEN', 's3cr3t', 'start here', 'Ask before']) assert.ok(!all.includes(leak), `leaked ${leak}`);
  assert.match(execFileSync('git', ['log', '--format=%s'], { cwd: data, encoding: 'utf8' }), /^mc: (sync|init)/m);
});

test('guard flags real-looking secrets, ignores env references and placeholders', async () => {
  const { scanText } = await import('../cli/guard.js');
  const fake = (n) => 'x'.repeat(n).replace(/x/g, () => 'abcdef0123456789'[Math.floor(Math.random() * 16)]);
  assert.equal(scanText(`TOKEN=123456789:AA${fake(33)}`, 'a.js')[0].rule, 'Telegram bot token');
  assert.equal(scanText(`const k = "sk-ant-api03-${fake(40)}"`, 'a.js')[0].rule, 'Anthropic key');
  assert.equal(scanText(`DB_PASSWORD=${fake(24)}`, 'a.env')[0].rule, 'Generic secret assignment');
  assert.equal(scanText('const S = process.env.N8N_WEBHOOK_SECRET', 'a.ts').length, 0);
  assert.equal(scanText('API_KEY=<your key here>', 'a').length, 0);
  assert.equal(scanText(`DB_PASSWORD=${fake(24)} // mc-guard: allow`, 'a').length, 0);
  assert.equal(scanText(`DB_PASSWORD=${fake(24)}`, '.env.example').length, 0);
});
