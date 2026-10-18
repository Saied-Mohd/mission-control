// Settings: push notifications, notify preferences, security (auto-lock, remember device, passphrase),
// backup export, connection info, install hints.

import { h, mount, icon, chip, timeEl, fail, modal, field, confirm, strengthMeter, downloadText, ask, fmtDateTime } from '../ui.js';
import { pushSupported, subscribePush, removePushSub, thisDeviceSubId, defaultDeviceLabel, currentSubscription, installPrompt, clearInstallPrompt } from '../push.js';
import { MIN_PASSPHRASE } from '../session.js';

const NOTIFY = [
  ['requests', 'Approval requests', 'Secret and action requests from agents'],
  ['questions', 'Questions', 'Agents asking you something in the inbox'],
  ['blockers', 'Blockers', 'Log entries of kind “blocker”'],
  ['handoffs', 'Handoffs', 'End-of-session handoffs'],
  ['radar', 'Radar', 'Deadlines and expiring secrets coming up'],
];
const DEFAULT_NOTIFY = { requests: true, questions: true, blockers: true, handoffs: false, radar: true };

function hostOf(u) {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
}

function panel(title, ...body) {
  return h('section.panel', h('div.panel-head', h('h3', title)), h('div.panel-body', body));
}

export async function render(root, ctx) {
  const { store, model, toast, session } = ctx;
  const isLocal = session.mode === 'local';

  const settings = await store.get(model.DOC.settings, { notify: DEFAULT_NOTIFY });
  const remembered = await session.isRemembered();

  // ---------------- notifications ----------------
  const pushEl = h('div');
  async function paintPush() {
    const list = (await store.get(model.DOC.pushSubs, { items: [] })).items;
    const mine = thisDeviceSubId();
    let browserSub = null;
    try {
      browserSub = await currentSubscription();
    } catch {}
    const supported = pushSupported();
    const perm = supported ? Notification.permission : 'unsupported';
    const label = h('input.input.sm', { value: defaultDeviceLabel(), style: 'max-width:240px' });
    const enabled = !!(mine && list.some((s) => s.id === mine) && browserSub);
    mount(pushEl,
      h('div.row.wrap',
        chip(supported ? `permission: ${perm}` : 'push unsupported here', perm === 'granted' ? 'ok' : perm === 'denied' ? 'urgent' : 'warm'),
        enabled ? chip('this device is subscribed', 'ok dot') : null),
      supported
        ? h('div.row.wrap',
          label,
          h('button.btn.btn-primary.btn-sm', { onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              await subscribePush(session, label.value.trim() || defaultDeviceLabel());
              toast('Notifications enabled on this device', { kind: 'ok' });
            } catch (err) {
              fail(err);
            }
            paintPush();
          } }, icon('bell', 14), enabled ? 'Re-subscribe' : 'Enable on this device'))
        : h('p.muted', 'This browser has no Web Push. On iPhone/iPad: install to the Home Screen first (iOS 16.4+), then enable here from the installed app.'),
      h('div.list', { style: 'margin-top:6px' }, list.length ? list.map((s) => h('div.item-row', { style: 'padding:8px 0' },
        icon('bell', 15),
        h('div.main-col', h('div.title', s.device || 'device', s.id === mine ? h('span', { style: 'margin-left:6px' }, chip('this device', 'cool')) : null), h('div.meta', 'added ', timeEl(s.created), h('span.ellipsis.dim', { style: 'max-width:240px' }, hostOf(s.endpoint)))),
        h('button.btn.btn-sm.btn-danger', { onclick: async () => {
          if (!(await confirm(`Stop push notifications to “${s.device}”?`, { okLabel: 'Remove', danger: true }))) return;
          try {
            await removePushSub(session, s.id);
            toast('Device removed', { kind: 'ok' });
          } catch (err) {
            fail(err);
          }
          paintPush();
        } }, 'Remove'))) : h('div.muted', 'No devices subscribed.')),
      isLocal
        ? h('button.btn.btn-sm', { onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          try {
            const r = await session.adapter.notify({ title: 'Mission Control', body: 'Test push — notifications work.', url: '#/settings', tag: 'mc-test' });
            toast(`Test push sent${r?.sent !== undefined ? ` to ${r.sent} device(s)` : ''}`, { kind: 'ok' });
          } catch (err) {
            fail(err);
          }
          b.disabled = false;
        } }, icon('send', 14), 'Send test push')
        : h('p.muted', { style: 'font-size:12.5px' }, 'Pushes are sent by the agent CLI (it holds the VAPID private key). In GitHub mode, ask the agent to send a test push.'));
  }

  // ---------------- notify prefs ----------------
  const notify = { ...DEFAULT_NOTIFY, ...(settings.notify || {}) };
  const prefs = h('div.col', NOTIFY.map(([k, label, hint]) => h('label.check', { style: 'align-items:flex-start' },
    h('input', { type: 'checkbox', checked: !!notify[k], onchange: async (e) => {
      notify[k] = e.target.checked;
      try {
        await store.update(model.DOC.settings, (s) => {
          s.notify = { ...DEFAULT_NOTIFY, ...(s.notify || {}), [k]: e.target.checked };
        }, { notify: DEFAULT_NOTIFY });
        toast('Saved', { kind: 'ok', timeout: 1200 });
      } catch (err) {
        e.target.checked = !e.target.checked;
        fail(err);
      }
    } }),
    h('span', h('div', { style: 'color:var(--text)' }, label), h('div.muted', { style: 'font-size:12px' }, hint)))));

  // ---------------- security ----------------
  const autolock = h('select.input', { style: 'width:auto', onchange: (e) => { session.autoLockMinutes = Number(e.target.value); session.touch(); toast('Auto-lock updated', { kind: 'ok', timeout: 1200 }); } },
    [[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [240, '4 hours'], [0, 'Never']].map(([v, l]) => h('option', { value: v, selected: session.autoLockMinutes === v }, l)));
  const rememberEl = h('div');
  function paintRemember(on) {
    mount(rememberEl, h('div.row.wrap',
      on ? chip('this device is remembered', 'ok dot') : chip('passphrase needed on reload', 'note'),
      on
        ? h('button.btn.btn-sm', { onclick: async () => { await session.forgetDevice(); toast('This device will ask for the passphrase again', { kind: 'ok' }); paintRemember(false); } }, 'Forget device')
        : h('button.btn.btn-sm', { onclick: async () => {
          if (!(await confirm('Store the (non-extractable) data keys in this browser so reloads skip the passphrase? Anyone with access to this browser profile can then open Mission Control (not the vault).', { okLabel: 'Remember' }))) return;
          await session.rememberDevice();
          toast('Device remembered', { kind: 'ok' });
          paintRemember(true);
        } }, 'Remember this device')));
  }
  paintRemember(remembered);

  async function changeMaster() {
    const cur = h('input.input', { type: 'password', autocomplete: 'current-password' });
    const n1 = h('input.input', { type: 'password', autocomplete: 'new-password' });
    const n2 = h('input.input', { type: 'password', autocomplete: 'new-password' });
    const ok = await modal('Change master passphrase', h('div', field('Current passphrase', cur), field('New passphrase', n1), strengthMeter(n1), field('Confirm', n2),
      h('div.muted', { style: 'font-size:12px' }, 'Re-wraps the data key. Your recovery code keeps working. Other devices pick up the change on their next unlock (remembered devices keep working).')), [
      { label: 'Cancel', value: false },
      { label: 'Change', kind: 'primary', onClick: async () => {
        if (n1.value.length < MIN_PASSPHRASE) { toast(`At least ${MIN_PASSPHRASE} characters`, { kind: 'warn' }); return false; }
        if (n1.value !== n2.value) { toast('Passphrases do not match', { kind: 'warn' }); return false; }
        try {
          await session.changePassphrase(cur.value, n1.value);
        } catch (e) {
          toast(e.message === 'BAD_SECRET' ? 'Current passphrase is wrong' : e.message, { kind: 'error' });
          return false;
        }
        return true;
      } },
    ]);
    cur.value = n1.value = n2.value = '';
    if (ok) toast('Master passphrase changed', { kind: 'ok' });
  }

  // ---------------- backup ----------------
  async function exportBackup(btn) {
    btn.disabled = true;
    try {
      const idx = await store.get(model.DOC.index, { order: [], projects: {}, activity: [] });
      const reqs = await store.get(model.DOC.requests, { items: [] });
      const logical = [
        model.DOC.index, model.DOC.brain, model.DOC.requests, model.DOC.inbox, model.DOC.radar, model.DOC.audit,
        model.DOC.vault, model.DOC.vaultIndex, model.DOC.pushSubs, model.DOC.deck, model.DOC.settings,
        ...idx.order.flatMap((s) => [model.DOC.project(s), model.DOC.log(s)]),
        ...reqs.items.filter((r) => r.type === 'secret' && r.status === 'approved').map((r) => model.DOC.grant(r.id)),
      ];
      const files = {};
      const keys = await session.adapter.read('keys.json');
      for (const l of logical) {
        const path = await store.file(l);
        const hit = await session.adapter.read(path);
        if (hit) files[path] = hit.text;
      }
      const out = { kind: 'mission-control-backup', v: 1, exportedAt: model.now(), note: 'Ciphertext only. Restore by copying files back into the data repo. Needs your passphrase or recovery code to read.', keys: JSON.parse(keys.text), files };
      downloadText(`mission-control-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 1), 'application/json');
      await model.audit(store, 'saied', 'backup.export', `${Object.keys(files).length} files`);
      toast(`Exported ${Object.keys(files).length} encrypted files`, { kind: 'ok' });
    } catch (e) {
      fail(e);
    }
    btn.disabled = false;
  }

  // ---------------- connection ----------------
  const k = session.keys || {};
  const gh = session.gh;
  const conn = h('dl.kv',
    h('dt', 'Mode'), h('dd', isLocal ? 'Local server (mc serve)' : 'GitHub (remote)'),
    isLocal ? [h('dt', 'Remote'), h('dd', session.info?.hasRemote ? String(session.info.remote || 'yes') : 'none (local only)')] : [h('dt', 'Repo'), h('dd', gh ? h('code', `${gh.owner}/${gh.repo}`) : '—')],
    h('dt', 'Agent'), h('dd', k.agent?.name || '—'),
    h('dt', 'Claimed'), h('dd', k.claimedAt ? fmtDateTime(k.claimedAt) : k.claimed ? 'yes' : 'no'),
    h('dt', 'Keys created'), h('dd', k.createdAt ? fmtDateTime(k.createdAt) : '—'),
    h('dt', 'Push key'), h('dd', k.vapidPublicKey ? 'present' : 'missing'));

  // ---------------- install ----------------
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  const installEl = h('div',
    standalone ? h('p', chip('installed', 'ok dot'), ' Running as an installed app.') : null,
    ios && !standalone ? h('div.note-box', h('b', 'iPhone / iPad: '), 'open this page in Safari → tap ', h('b', 'Share'), ' → ', h('b', 'Add to Home Screen'), '. Push notifications need iOS 16.4+ and only work from the installed app.') : null,
    !ios && !standalone && installPrompt ? h('button.btn.btn-primary.btn-sm', { onclick: async () => { const p = installPrompt; clearInstallPrompt(); await p.prompt(); } }, icon('download', 14), 'Install app') : null,
    !ios && !standalone && !installPrompt ? h('p.muted', 'Use your browser’s “Install app” / “Add to Home screen” menu item.') : null);

  const exportBtn = h('button.btn', { onclick: (e) => exportBackup(e.currentTarget) }, icon('download', 15), 'Export encrypted backup');

  mount(root,
    h('div.view-head', h('div', h('h1', 'Settings'), h('div.sub', 'This device, notifications and keys.')), h('div.actions', h('button.btn.btn-amber', { onclick: () => session.lock('manual') }, icon('lock', 15), 'Lock now'))),
    h('div.settings-grid',
      panel('Push notifications', pushEl),
      panel('Notify me about', prefs, h('p.muted', { style: 'font-size:12px' }, 'Shared across devices; the agent reads these before sending a push.')),
      panel('Security',
        h('div.row.wrap', h('span.label', 'Auto-lock after'), autolock),
        h('div.muted', { style: 'font-size:12px' }, 'The vault always relocks 5 minutes after unlocking.'),
        rememberEl,
        h('div.row.wrap', h('button.btn.btn-sm', { onclick: changeMaster }, icon('key', 14), 'Change master passphrase'), h('a.btn.btn-sm', { href: '#/vault' }, icon('vault', 14), 'Vault passphrase…'))),
      panel('Data',
        h('p.muted', { style: 'margin:0' }, 'Download keys.json and every known encrypted doc as one JSON file. Nothing is decrypted.'),
        h('div.row.wrap', exportBtn,
          isLocal ? h('button.btn', { onclick: async (e) => {
            const b = e.currentTarget;
            b.disabled = true;
            try {
              const r = await session.adapter.sync();
              toast(`Synced${r?.status ? ': ' + r.status : ''}`, { kind: 'ok' });
            } catch (err) {
              fail(err);
            }
            b.disabled = false;
          } }, icon('refresh', 15), 'Sync now') : null)),
      panel('Connection', conn,
        !isLocal ? h('div.row.wrap',
          h('button.btn.btn-sm', { onclick: async () => {
            const pat = await ask('Update GitHub token', { label: 'New fine-grained token (Contents: read/write on the data repo only)', type: 'password', okLabel: 'Save token' });
            if (!pat) return;
            try {
              await session.setPat(pat);
              toast('Token updated', { kind: 'ok' });
            } catch (e) {
              fail(e);
            }
          } }, icon('key', 14), 'Update token'),
          h('button.btn.btn-sm.btn-danger', { onclick: async () => {
            if (!(await confirm('Disconnect this device? Removes the cached keys.json, the encrypted token and remembered keys from this browser.', { okLabel: 'Disconnect', danger: true }))) return;
            await session.disconnect();
          } }, 'Disconnect device')) : null),
      panel('Install', installEl)));

  await paintPush();
}
