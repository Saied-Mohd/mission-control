// Push notifications from the agent side.

import { DOC } from '../app/js/model.js';
import { sendPush } from './webpush.js';

const DEFAULT_PREFS = { requests: true, questions: true, blockers: true, handoffs: false, radar: true, agent: true };

/**
 * Send a push to every subscribed device. category gates it against Saied's settings.
 * Removes dead subscriptions. Never throws (notifications are best-effort).
 */
export async function notifyAll(cfg, store, payload, category = 'agent') {
  try {
    const settings = await store.get(DOC.settings, {});
    const prefs = { ...DEFAULT_PREFS, ...(settings.notify || {}) };
    if (prefs[category] === false) return { sent: 0, skipped: 'muted' };
    const subs = await store.get(DOC.pushSubs, { items: [] });
    if (!subs.items.length) return { sent: 0, skipped: 'no devices' };
    let sent = 0;
    const gone = [];
    for (const sub of subs.items) {
      const r = await sendPush(sub, payload, cfg.vapid, cfg.vapidSubject || 'mailto:mission-control@localhost');
      if (r.ok) sent++;
      else if (r.gone) gone.push(sub.id);
    }
    if (gone.length) {
      await store.update(DOC.pushSubs, (d) => {
        d.items = d.items.filter((s) => !gone.includes(s.id));
      }, { items: [] });
    }
    return { sent, removed: gone.length };
  } catch (e) {
    return { sent: 0, error: e.message };
  }
}
