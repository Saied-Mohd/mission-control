// Web Push subscription helpers. Subscriptions are saved to DOC.pushSubs so the agent can push.

import * as model from './model.js';
import { b64url } from './crypto.js';

const LS_SUB = 'mc.pushSubId';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function thisDeviceSubId() {
  try {
    return localStorage.getItem(LS_SUB);
  } catch {
    return null;
  }
}

export function defaultDeviceLabel() {
  const ua = navigator.userAgent || '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  return `${os} · ${br}${standalone ? ' (app)' : ''}`;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function subRecord(sub, device, id) {
  const j = sub.toJSON();
  return { id, endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, device, created: model.now() };
}

/** Ask permission, subscribe, and save to DOC.pushSubs. Returns the saved record. */
export async function subscribePush(session, device) {
  if (!pushSupported()) throw new Error('Push is not supported in this browser. On iPhone, install the app to the Home Screen first (iOS 16.4+).');
  const key = session.keys?.vapidPublicKey;
  if (!key) throw new Error('keys.json has no vapidPublicKey yet. Run `mc init` / `mc serve` on your computer.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not granted');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const appKey = b64url.decode(key);
  if (sub) {
    // Re-subscribe if it was created for a different VAPID key.
    const cur = sub.options?.applicationServerKey;
    if (cur && b64url.encode(new Uint8Array(cur)) !== b64url.encode(appKey)) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  const id = thisDeviceSubId() || model.newId('s');
  const rec = subRecord(sub, device || defaultDeviceLabel(), id);
  await session.store.update(model.DOC.pushSubs, (d) => {
    d.items = d.items.filter((x) => x.id !== id && x.endpoint !== rec.endpoint);
    d.items.push(rec);
  }, { items: [] });
  try {
    localStorage.setItem(LS_SUB, id);
  } catch {}
  await model.audit(session.store, 'saied', 'push.subscribe', rec.device);
  return rec;
}

export async function removePushSub(session, id) {
  await session.store.update(model.DOC.pushSubs, (d) => {
    d.items = d.items.filter((x) => x.id !== id);
  }, { items: [] });
  if (id === thisDeviceSubId()) {
    try {
      const sub = await currentSubscription();
      if (sub) await sub.unsubscribe();
    } catch {}
    try {
      localStorage.removeItem(LS_SUB);
    } catch {}
  }
  await model.audit(session.store, 'saied', 'push.remove', id);
}

/** After pushsubscriptionchange: subscribe again with the same device id. → true when renewed. */
export async function resubscribePush(session) {
  const id = thisDeviceSubId();
  if (!id || !pushSupported() || Notification.permission !== 'granted') return false;
  const subs = await session.store.get(model.DOC.pushSubs, { items: [] });
  const prev = subs.items.find((x) => x.id === id);
  await subscribePush(session, prev?.device);
  return true;
}

// ---------- install prompt (Chromium) ----------

export let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
});
export function clearInstallPrompt() {
  installPrompt = null;
}
