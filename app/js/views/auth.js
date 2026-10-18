// Pre-shell screens: claim (first run, local), connect (GitHub, first visit on a device), lock, recovery reset.

import { h, mount, icon, toast, spinner, strengthMeter, downloadText, passStrength, confirm } from '../ui.js';
import { MIN_PASSPHRASE } from '../session.js';

function card(children, wide = false) {
  return h('div.auth', h('div.panel.auth-card' + (wide ? '.wide' : ''),
    h('div.auth-mark', h('img', { src: './icons/icon.svg', alt: '' }), h('div', h('h1', 'Mission Control'), h('p', 'Encrypted workstation · Saied + Claude'))),
    children));
}

function passInput({ placeholder = '', autocomplete = 'current-password', id } = {}) {
  const input = h('input.input', { type: 'password', placeholder, autocomplete, spellcheck: 'false', autocapitalize: 'off', id });
  const toggle = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Show', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; } }, icon('eye', 16));
  const wrap = h('div.row', { style: 'gap:6px' }, input, toggle);
  wrap.input = input;
  return wrap;
}

function busyRow(text) {
  return h('div.unlocking', spinner(16), text);
}

function errMsg(e) {
  const m = e?.message || String(e);
  return m === 'BAD_SECRET' ? 'That passphrase does not match.' : m;
}

// ---------------- claim ----------------

export function renderClaim(root, { session, done }) {
  let token = '';
  const m = (location.hash || '').match(/claim=([^&]+)/);
  if (m) token = decodeURIComponent(m[1]);
  // Strip the one-time token from the address bar and history right away.
  history.replaceState(null, '', location.pathname + location.search + '#/');

  const tokenIn = h('input.input.mono', { placeholder: 'claim token', value: token, autocomplete: 'off', spellcheck: 'false' });
  const p1 = passInput({ placeholder: 'At least 12 characters — a sentence works well', autocomplete: 'new-password' });
  const p2 = passInput({ placeholder: 'Repeat master passphrase', autocomplete: 'new-password' });
  const v1 = passInput({ placeholder: 'Different from the master passphrase', autocomplete: 'new-password' });
  const v2 = passInput({ placeholder: 'Repeat vault passphrase', autocomplete: 'new-password' });
  const err = h('div.auth-err');
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, icon('shield', 18), 'Claim & encrypt');
  const status = h('div');

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const pass = p1.input.value;
      const vpass = v1.input.value;
      const tok = tokenIn.value.trim();
      if (!tok) return (err.textContent = 'Missing claim token. Open the exact link printed by `mc serve`.');
      if (pass.length < MIN_PASSPHRASE) return (err.textContent = `Master passphrase must be at least ${MIN_PASSPHRASE} characters.`);
      if (passStrength(pass).score < 2) return (err.textContent = 'Master passphrase is too weak. Try four or more random words.');
      if (pass !== p2.input.value) return (err.textContent = 'Master passphrases do not match.');
      if (vpass.length < MIN_PASSPHRASE) return (err.textContent = `Vault passphrase must be at least ${MIN_PASSPHRASE} characters.`);
      if (vpass !== v2.input.value) return (err.textContent = 'Vault passphrases do not match.');
      if (vpass === pass) return (err.textContent = 'The vault passphrase must be different from the master passphrase.');
      btn.disabled = true;
      mount(status, busyRow('Deriving keys and encrypting… (a few seconds)'));
      try {
        const code = await session.claim({ token: tok, passphrase: pass, vaultPassphrase: vpass });
        p1.input.value = p2.input.value = v1.input.value = v2.input.value = '';
        renderRecovery(root, code, done);
      } catch (e2) {
        err.textContent = errMsg(e2);
        btn.disabled = false;
        mount(status);
      }
    },
  },
  h('p.lead', 'First run. Set the two passphrases that protect everything. Both are turned into keys in this browser only.'),
  token ? null : h('label.field', h('span.label', 'Claim token'), tokenIn, h('span.hint', 'From the link printed by `mc serve` (…#claim=TOKEN).')),
  h('label.field', h('span.label', 'Master passphrase'), p1),
  strengthMeter(p1.input),
  h('label.field', h('span.label', 'Confirm master passphrase'), p2),
  h('label.field', h('span.label', 'Vault passphrase'), v1, h('span.hint', 'Protects env vars and secrets. Needed to view secrets or approve secret requests.')),
  strengthMeter(v1.input),
  h('label.field', h('span.label', 'Confirm vault passphrase'), v2),
  h('div.note-box', h('b', 'What the agent can and cannot see. '), 'Claude’s CLI keeps the data key so it can read and write boards, logs and handoffs. It never sees either passphrase, the vault key, or the recovery code you are about to get. Secret values only reach it when you approve a request.'),
  err,
  btn,
  status);
  mount(root, card(form, true));
  setTimeout(() => (token ? p1.input : tokenIn).focus(), 50);
}

function renderRecovery(root, code, done) {
  const saved = h('input', { type: 'checkbox' });
  const cont = h('button.btn.btn-primary.btn-lg.btn-block', { disabled: true, onclick: () => done() }, 'Continue to Mission Control');
  saved.addEventListener('change', () => (cont.disabled = !saved.checked));
  const text = `Mission Control recovery code\n\n${code}\n\nUnlocks both the data key and the vault if you forget a passphrase.\nCreated ${new Date().toISOString()}\nKeep it offline (password manager or paper). Claude never sees it.\n`;
  mount(root, card([
    h('h2', { style: 'margin:0 0 6px' }, 'Your recovery code'),
    h('p.lead', 'This is the only way back in if you forget a passphrase. It is shown once. Store it somewhere safe and offline.'),
    h('div.recovery-code', code),
    h('div.row.wrap', { style: 'justify-content:center' },
      h('button.btn', { onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Copied. Paste it into your password manager, then clear your clipboard.', { kind: 'ok' }); } catch { toast('Copy failed — select the code and copy it manually', { kind: 'warn' }); } } }, icon('copy', 16), 'Copy'),
      h('button.btn', { onclick: () => downloadText('mission-control-recovery.txt', text) }, icon('download', 16), 'Download .txt')),
    h('div.note-box.warn', 'The agent cannot see either passphrase or this code. If you lose all three, the encrypted data cannot be recovered by anyone.'),
    h('label.check', { style: 'margin:14px 0' }, saved, 'I saved the recovery code somewhere safe'),
    cont,
  ], true));
}

// ---------------- GitHub connect ----------------

export function renderConnect(root, { session, done }) {
  let useRecovery = false;
  const owner = h('input.input', { placeholder: 'your-github-username', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false' });
  const repo = h('input.input', { value: 'mission-control-data', autocapitalize: 'off', spellcheck: 'false' });
  const pat = passInput({ placeholder: 'github_pat_…', autocomplete: 'off' });
  const pass = passInput({ placeholder: 'Master passphrase', autocomplete: 'current-password' });
  const secretLabel = h('span.label', 'Master passphrase');
  const remember = h('input', { type: 'checkbox' });
  const err = h('div.auth-err');
  const status = h('div');
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, icon('link', 18), 'Connect');
  const toggle = h('button', { type: 'button', onclick: () => {
    useRecovery = !useRecovery;
    secretLabel.textContent = useRecovery ? 'Recovery code' : 'Master passphrase';
    pass.input.placeholder = useRecovery ? 'XXXXX-XXXXX-XXXXX-XXXXX' : 'Master passphrase';
    toggle.textContent = useRecovery ? 'Use passphrase instead' : 'Use recovery code instead';
  } }, 'Use recovery code instead');
  try {
    const gh = session.gh;
    if (gh) { owner.value = gh.owner; repo.value = gh.repo; }
  } catch {}

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      mount(status, busyRow('Checking the repo and unwrapping keys…'));
      try {
        await session.connect({ owner: owner.value, repo: repo.value, pat: pat.input.value, secret: pass.input.value, useRecovery, remember: remember.checked });
        pat.input.value = pass.input.value = '';
        done();
      } catch (e2) {
        err.textContent = errMsg(e2);
        btn.disabled = false;
        mount(status);
      }
    },
  },
  h('p.lead', 'Connect this device to your private data repo. Everything is decrypted here, in this browser only.'),
  h('div.form-grid', h('label.field', h('span.label', 'GitHub owner'), owner), h('label.field', h('span.label', 'Data repo'), repo)),
  h('label.field', h('span.label', 'Fine-grained access token'), pat, h('span.hint', 'Stored on this device encrypted with your data key.')),
  h('details.note-box',
    h('summary', 'How to create the token'),
    h('ol',
      h('li', 'Open ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer' }, 'GitHub → Settings → Developer settings → Fine-grained tokens'), '.'),
      h('li', 'Resource owner: you. Expiration: 1 year or less.'),
      h('li', 'Repository access: ', h('b', 'Only select repositories'), ' → pick only ', h('code', 'mission-control-data'), '.'),
      h('li', 'Repository permissions → ', h('b', 'Contents: Read and write'), '. Nothing else (Metadata: read-only is added automatically).'),
      h('li', 'Generate, copy, paste it here. Set a reminder to rotate it before it expires.'))),
  h('label.field', secretLabel, pass),
  h('label.check', { style: 'margin:4px 0 12px' }, remember, 'Remember this device (skip the passphrase on reload)'),
  err,
  btn,
  status,
  h('div.auth-alt', toggle, h('span.dim', 'GitHub mode')));
  mount(root, card(form, true));
  setTimeout(() => (owner.value ? pat.input : owner).focus(), 50);
}

// ---------------- lock ----------------

export function renderLock(root, { session, reason, remembered, done, reconnect }) {
  let useRecovery = false;
  const pass = passInput({ placeholder: 'Master passphrase', autocomplete: 'current-password' });
  const label = h('span.label', 'Master passphrase');
  const remember = h('input', { type: 'checkbox', checked: !!remembered });
  const err = h('div.auth-err');
  const status = h('div');
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, icon('unlock', 18), 'Unlock');

  const toggle = h('button', { type: 'button', onclick: () => {
    useRecovery = !useRecovery;
    label.textContent = useRecovery ? 'Recovery code' : 'Master passphrase';
    pass.input.placeholder = useRecovery ? 'XXXXX-XXXXX-XXXXX-XXXXX' : 'Master passphrase';
    toggle.textContent = useRecovery ? 'Use passphrase' : 'Forgot passphrase? Use recovery code';
    rememberRow.classList.toggle('hidden', useRecovery);
    pass.input.focus();
  } }, 'Forgot passphrase? Use recovery code');
  const rememberRow = h('label.check', { style: 'margin:4px 0 12px' }, remember, 'Remember this device');

  const quick = remembered
    ? h('button.btn.btn-lg.btn-block', { type: 'button', style: 'margin-bottom:14px', onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        if (await session.unlockRemembered()) return done();
        err.textContent = 'This device’s saved keys no longer work. Unlock with your passphrase.';
      } catch (e2) {
        err.textContent = errMsg(e2);
      }
      b.disabled = false;
    } }, icon('key', 18), 'Unlock this device')
    : null;

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      const secret = pass.input.value;
      if (!secret) return pass.input.focus();
      btn.disabled = true;
      mount(status, busyRow(useRecovery ? 'Checking recovery code…' : 'Deriving key (600k PBKDF2 rounds)…'));
      try {
        if (useRecovery) await session.unlockRecovery(secret);
        else await session.unlock(secret, { remember: remember.checked });
        if (!useRecovery && !remember.checked && remembered) await session.forgetDevice();
        pass.input.value = '';
        done();
      } catch (e2) {
        err.textContent = errMsg(e2);
        btn.disabled = false;
        mount(status);
        pass.input.select();
      }
    },
  },
  reason === 'idle' ? h('div.note-box', icon('clock', 14), ' Locked after ', String(session.autoLockMinutes), ' minutes idle.') : null,
  quick,
  h('label.field', label, pass),
  rememberRow,
  err,
  btn,
  status,
  h('div.auth-alt', toggle, session.mode === 'github' ? h('button', { type: 'button', onclick: async () => { if (await confirm('Disconnect this device? The cached keys and encrypted token are removed; you will need the token and passphrase again.', { okLabel: 'Disconnect', danger: true })) await reconnect(); } }, 'Reconnect') : h('span.dim', 'local mode')));
  mount(root, card(form));
  setTimeout(() => pass.input.focus(), 50);
}

// ---------------- forced passphrase reset after recovery ----------------

export function renderForceReset(root, { session }) {
  return new Promise((resolve) => {
    const p1 = passInput({ placeholder: 'New master passphrase', autocomplete: 'new-password' });
    const p2 = passInput({ placeholder: 'Repeat', autocomplete: 'new-password' });
    const err = h('div.auth-err');
    const status = h('div');
    const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, 'Set new passphrase');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        const v = p1.input.value;
        if (v.length < MIN_PASSPHRASE) return (err.textContent = `At least ${MIN_PASSPHRASE} characters.`);
        if (passStrength(v).score < 2) return (err.textContent = 'Too weak. Try four or more random words.');
        if (v !== p2.input.value) return (err.textContent = 'Passphrases do not match.');
        btn.disabled = true;
        mount(status, busyRow('Re-wrapping the data key…'));
        try {
          await session.setNewPassphrase(v);
          toast('New master passphrase set. Your recovery code still works.', { kind: 'ok' });
          resolve();
        } catch (e2) {
          err.textContent = errMsg(e2);
          btn.disabled = false;
          mount(status);
        }
      },
    },
    h('h2', { style: 'margin:0 0 6px' }, 'Set a new master passphrase'),
    h('p.lead', 'You unlocked with the recovery code. Choose a new master passphrase before continuing. The vault passphrase is unchanged (change it in Settings if needed).'),
    h('label.field', h('span.label', 'New master passphrase'), p1),
    strengthMeter(p1.input),
    h('label.field', h('span.label', 'Confirm'), p2),
    err,
    btn,
    status,
    h('div.auth-alt', h('button', { type: 'button', onclick: () => session.lock('manual') }, 'Cancel and lock')));
    mount(root, card(form));
    setTimeout(() => p1.input.focus(), 50);
  });
}

// ---------------- local server unreachable ----------------

export function renderLocalDown(root, { retry, useGithub }) {
  mount(root, card([
    h('h2', { style: 'margin:0 0 6px' }, 'Local server not reachable'),
    h('p.lead', 'This device last used Mission Control through the local server, but it is not answering. Start it with ', h('code', 'mc serve'), ' and retry.'),
    h('div.row', h('button.btn.btn-primary', { onclick: retry }, icon('refresh', 16), 'Retry'), h('button.btn', { onclick: useGithub }, 'Use GitHub mode')),
  ]));
}
