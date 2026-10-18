// Vault: encrypted env vars & secrets. Separate unlock (vault passphrase or recovery code), relocks after 5 minutes.
// Decrypted values live only in this closure while unlocked; vault-index (names only) is kept in sync on every write.

import { h, mount, icon, chip, timeEl, empty, fail, modal, field, confirm, strengthMeter, spinner } from '../ui.js';
import { daysClass, daysText, projLink } from './common.js';
import { MIN_PASSPHRASE } from '../session.js';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export async function copySecret(value, toast) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    toast('Copy failed (clipboard blocked)', { kind: 'error' });
    return;
  }
  toast('Copied — clipboard is cleared in 30s', { kind: 'ok' });
  setTimeout(async () => {
    try {
      const cur = await navigator.clipboard.readText();
      if (cur !== value) return; // something else was copied since
    } catch {
      /* no read permission: clear anyway */
    }
    try {
      await navigator.clipboard.writeText('');
    } catch {}
  }, 30000);
}

export async function render(root, ctx) {
  const { store, model, toast, session } = ctx;
  let vault = null; // decrypted, in memory only
  let query = '';
  let timer = null;
  const revealTimers = new Map();

  const offVault = session.on('vault', () => {
    if (session.vaultUnlocked) return; // unlock paths repaint themselves after loading
    vault = null;
    paint();
  });

  function cleanup() {
    offVault();
    clearInterval(timer);
    for (const t of revealTimers.values()) clearTimeout(t);
    vault = null;
  }

  async function loadVault() {
    vault = await session.getVault();
    vault.items.sort((a, b) => a.name.localeCompare(b.name));
  }

  function paint() {
    clearInterval(timer);
    if (!session.vaultUnlocked || !vault) return paintLocked();
    paintUnlocked();
  }

  // ---------------- locked ----------------

  async function paintLocked() {
    let recovery = false;
    const vi = await store.get(model.DOC.vaultIndex, { items: [] }).catch(() => ({ items: [] }));
    if (session.vaultUnlocked && vault) return; // unlocked meanwhile
    const input = h('input.input', { type: 'password', placeholder: 'Vault passphrase', autocomplete: 'off', spellcheck: 'false' });
    const label = h('span.label', 'Vault passphrase');
    const err = h('div.auth-err');
    const status = h('div');
    const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, icon('unlock', 18), 'Unlock vault');
    const toggle = h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => {
      recovery = !recovery;
      label.textContent = recovery ? 'Recovery code' : 'Vault passphrase';
      input.placeholder = recovery ? 'XXXXX-XXXXX-…' : 'Vault passphrase';
      toggle.textContent = recovery ? 'Use vault passphrase' : 'Use recovery code';
      input.focus();
    } }, 'Use recovery code');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!input.value) return input.focus();
        err.textContent = '';
        btn.disabled = true;
        mount(status, h('div.unlocking', { style: 'justify-content:center;margin-top:10px' }, spinner(16), 'Deriving vault key…'));
        try {
          await session.unlockVault(input.value, { recovery });
          input.value = '';
          await loadVault();
          paint();
        } catch (e2) {
          err.textContent = e2.message === 'BAD_SECRET' ? 'That does not match.' : e2.message;
          btn.disabled = false;
          mount(status);
        }
      },
    }, h('label.field', { style: 'text-align:left' }, label, input), err, btn, status, h('div', { style: 'margin-top:10px' }, toggle));
    mount(root,
      h('div.view-head', h('div', h('h1', 'Vault'), h('div.sub', `${vi.items.length} secret${vi.items.length === 1 ? '' : 's'} · encrypted with a separate key the agent never has`))),
      h('div.panel.vault-lock',
        h('div.big-ico', icon('vault', 30)),
        h('h2', { style: 'margin:0 0 6px' }, 'Vault locked'),
        h('p.muted', { style: 'margin:0 0 18px' }, 'Unlock to view, edit or grant secrets. It relocks automatically after 5 minutes.'),
        form),
      vi.items.length ? h('div.panel.list', { style: 'margin-top:16px' }, vi.items.map((s) => h('div.item-row',
        icon('key', 16),
        h('div.main-col', h('code', s.name), h('div.meta', (s.projects || []).map((p) => projLink(ctx.projects(), p)), s.note ? h('span', s.note) : null)),
        expiry(s)))) : null);
    setTimeout(() => input.focus(), 30);
  }

  function expiry(s) {
    if (!s.expiresAt) return null;
    const d = model.daysUntil(s.expiresAt.slice(0, 10));
    return h('span', { class: daysClass(d), style: 'font-size:12px;white-space:nowrap' }, d < 0 ? 'expired' : `expires in ${daysText(d)}`);
  }

  // ---------------- unlocked ----------------

  function paintUnlocked() {
    const timerEl = h('span.vault-timer.chip.ok.dot');
    const tick = () => {
      const left = Math.max(0, session.vaultUntil - Date.now());
      if (!left) {
        session.lockVault();
        return;
      }
      timerEl.textContent = `unlocked · relocks in ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
    };
    tick();
    timer = setInterval(tick, 1000);
    const listEl = h('div');
    const search = h('input.input', { type: 'search', placeholder: 'Filter secrets…', value: query, dataset: { search: '1' }, style: 'max-width:320px', oninput: (e) => { query = e.target.value; paintList(listEl); } });
    mount(root,
      h('div.view-head',
        h('div', h('h1', 'Vault'), h('div.sub.row.wrap', timerEl, h('span', `${vault.items.length} secrets`))),
        h('div.actions',
          h('button.btn.btn-primary', { onclick: () => editSecret(null) }, icon('plus', 15), 'Add'),
          h('button.btn', { onclick: importEnv }, icon('upload', 15), 'Import .env'),
          h('button.btn', { onclick: changePass }, icon('key', 15), h('span.hide-sm', 'Change passphrase')),
          h('button.btn.btn-amber', { onclick: () => session.lockVault() }, icon('lock', 15), 'Lock'))),
      h('div.filters', search),
      listEl);
    paintList(listEl);
  }

  function paintList(listEl) {
    const q = query.trim().toLowerCase();
    const rows = vault.items.filter((s) => !q || `${s.name} ${(s.projects || []).join(' ')} ${s.note || ''}`.toLowerCase().includes(q));
    if (!vault.items.length) return mount(listEl, h('div.panel', empty('Vault is empty', 'Add secrets one by one or import a .env file.', 'vault')));
    if (!rows.length) return mount(listEl, h('div.panel', empty('No secrets match', '', 'search')));
    mount(listEl, h('div.panel.list', rows.map((s) => {
      const val = h('span.val', '•'.repeat(Math.min(24, Math.max(8, String(s.value || '').length))));
      const reveal = h('button.btn.btn-sm', { onclick: () => {
        if (val.classList.contains('revealed')) return hide();
        val.textContent = s.value;
        val.classList.add('revealed');
        reveal.textContent = 'Hide';
        clearTimeout(revealTimers.get(s.name));
        revealTimers.set(s.name, setTimeout(hide, 10000));
        model.audit(store, 'saied', 'vault.reveal', s.name).catch(() => {});
      } }, icon('eye', 14), 'Reveal');
      function hide() {
        clearTimeout(revealTimers.get(s.name));
        val.textContent = '•'.repeat(Math.min(24, Math.max(8, String(s.value || '').length)));
        val.classList.remove('revealed');
        mount(reveal, icon('eye', 14), 'Reveal');
      }
      return h('div.item-row.secret-row',
        h('div.main-col',
          h('div.row.wrap', h('code', { style: 'font-weight:700;color:#fff' }, s.name), (s.projects || []).map((p) => chip(p, 'cool')), expiry(s)),
          s.note ? h('div.muted', { style: 'font-size:12.5px;margin-top:3px' }, s.note) : null,
          val,
          h('div.meta', 'updated ', timeEl(s.updated))),
        h('div.acts',
          reveal,
          h('button.btn.btn-sm', { onclick: () => { copySecret(s.value, toast); model.audit(store, 'saied', 'vault.copy', s.name).catch(() => {}); } }, icon('copy', 14), 'Copy'),
          h('button.icon-btn.sm', { title: 'Edit', 'aria-label': 'Edit', onclick: () => editSecret(s) }, icon('edit', 15)),
          h('button.icon-btn.sm', { title: 'Delete', 'aria-label': 'Delete', onclick: () => del(s) }, icon('trash', 15))));
    })));
  }

  function projectPicker(selected = []) {
    const set = new Set(selected);
    const wrap = h('div.row.wrap');
    for (const p of ctx.projects()) {
      wrap.appendChild(h('label.chip.clickable', { class: set.has(p.slug) ? 'on cool' : '' },
        h('input', { type: 'checkbox', checked: set.has(p.slug), style: 'width:12px;height:12px', onchange: (e) => {
          if (e.target.checked) set.add(p.slug);
          else set.delete(p.slug);
          e.target.parentElement.classList.toggle('on', e.target.checked);
          e.target.parentElement.classList.toggle('cool', e.target.checked);
        } }), p.name));
    }
    for (const s of selected) if (!ctx.projects().some((p) => p.slug === s)) wrap.appendChild(chip(s, 'cool'));
    wrap.getValue = () => [...set];
    return wrap;
  }

  async function editSecret(s) {
    const name = h('input.input.mono', { value: s?.name || '', placeholder: 'STRIPE_SECRET_KEY', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters' });
    const value = h('textarea.input.secret-input.masked', { rows: 2, value: s?.value || '', autocomplete: 'off', spellcheck: 'false', placeholder: 'value' });
    const show = h('label.check', { style: 'font-size:12px;margin-top:-6px;margin-bottom:10px' }, h('input', { type: 'checkbox', onchange: (e) => value.classList.toggle('masked', !e.target.checked) }), 'Show value');
    const projects = projectPicker(s?.projects || []);
    const note = h('input.input', { value: s?.note || '', placeholder: 'Where it came from, scope, owner…' });
    const exp = h('input.input', { type: 'date', value: s?.expiresAt ? s.expiresAt.slice(0, 10) : '' });
    const ok = await modal(s ? `Edit ${s.name}` : 'Add secret', h('div', field('Name', name), field('Value', value), show, field('Projects', projects), field('Note', note), field('Expires', exp, 'Optional. Shows on the radar.')), [
      { label: 'Cancel', value: false },
      { label: 'Save', kind: 'primary', onClick: async () => {
        const n = name.value.trim();
        if (!NAME_RE.test(n)) { toast('Name must look like an env var (A-Z, 0-9, _ . -)', { kind: 'warn' }); name.focus(); return false; }
        if (!s && vault.items.some((x) => x.name === n) && !(await confirm(`${n} already exists. Overwrite?`, { okLabel: 'Overwrite', danger: true }))) return false;
        const item = { name: n, value: value.value, projects: projects.getValue(), note: note.value.trim(), expiresAt: exp.value ? new Date(exp.value + 'T23:59:59').toISOString() : null, updated: model.now() };
        vault = await session.updateVault((v) => {
          v.items = v.items.filter((x) => x.name !== n && (!s || x.name !== s.name));
          v.items.push(item);
          v.items.sort((a, b) => a.name.localeCompare(b.name));
        }, s ? 'vault.update' : 'vault.add', n);
        return true;
      } },
    ]);
    value.value = '';
    if (ok) {
      toast('Saved to vault', { kind: 'ok' });
      paint();
    }
  }

  async function del(s) {
    if (!(await confirm(`Delete ${s.name} from the vault? Agents with an active grant keep their sealed copy until it expires or you revoke it.`, { okLabel: 'Delete', danger: true }))) return;
    try {
      vault = await session.updateVault((v) => {
        v.items = v.items.filter((x) => x.name !== s.name);
      }, 'vault.delete', s.name);
      toast('Deleted', { kind: 'ok' });
      paint();
    } catch (e) {
      fail(e);
    }
  }

  async function importEnv() {
    const ta = h('textarea.input.secret-input', { rows: 8, placeholder: '# paste a .env file\nAPI_KEY=...\nexport DB_URL="postgres://..."', autocomplete: 'off', spellcheck: 'false' });
    const projects = projectPicker([]);
    const preview = h('div');
    let parsed = [];
    const checks = new Map();
    const parse = () => {
      parsed = model.parseDotenv(ta.value);
      checks.clear();
      if (!parsed.length) return mount(preview, ta.value.trim() ? h('div.muted', 'No KEY=value lines found.') : null);
      mount(preview, h('table.preview',
        h('tr', h('th', ''), h('th', 'Name'), h('th', 'Status'), h('th', 'Length')),
        parsed.map((p) => {
          const ex = vault.items.find((x) => x.name === p.name);
          const status = !ex ? 'new' : ex.value === p.value ? 'same' : 'overwrite';
          const cb = h('input', { type: 'checkbox', checked: status !== 'same' });
          checks.set(p.name, cb);
          return h('tr', h('td', cb), h('td', h('code', p.name)), h('td', chip(status, status === 'new' ? 'ok' : status === 'same' ? 'note' : 'warm')), h('td.num', String(p.value.length)));
        })));
    };
    ta.addEventListener('input', parse);
    const ok = await modal('Import .env', h('div', field('Paste .env contents', ta, 'Parsed locally; nothing is sent anywhere until you import (then it is encrypted with the vault key).'), preview, field('Tag with projects', projects)), [
      { label: 'Cancel', value: false },
      { label: 'Import', kind: 'primary', onClick: async () => {
        const chosen = parsed.filter((p) => checks.get(p.name)?.checked);
        if (!chosen.length) { toast('Nothing selected', { kind: 'warn' }); return false; }
        const tags = projects.getValue();
        vault = await session.updateVault((v) => {
          for (const p of chosen) {
            const prev = v.items.find((x) => x.name === p.name);
            v.items = v.items.filter((x) => x.name !== p.name);
            v.items.push({ name: p.name, value: p.value, projects: [...new Set([...(prev?.projects || []), ...tags])], note: prev?.note || 'imported from .env', expiresAt: prev?.expiresAt || null, updated: model.now() });
          }
          v.items.sort((a, b) => a.name.localeCompare(b.name));
        }, 'vault.import', chosen.map((p) => p.name).join(','));
        return chosen.length;
      } },
    ], { wide: true });
    ta.value = '';
    parsed = [];
    if (ok) {
      toast(`Imported ${ok} secret${ok === 1 ? '' : 's'}`, { kind: 'ok' });
      paint();
    }
  }

  async function changePass() {
    let recovery = false;
    const cur = h('input.input', { type: 'password', placeholder: 'Current vault passphrase', autocomplete: 'off' });
    const curLabel = h('span.label', 'Current vault passphrase');
    const n1 = h('input.input', { type: 'password', autocomplete: 'new-password' });
    const n2 = h('input.input', { type: 'password', autocomplete: 'new-password' });
    const toggle = h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => {
      recovery = !recovery;
      curLabel.textContent = recovery ? 'Recovery code' : 'Current vault passphrase';
      toggle.textContent = recovery ? 'Use current passphrase' : 'Use recovery code instead';
    } }, 'Use recovery code instead');
    const ok = await modal('Change vault passphrase', h('div',
      h('label.field', curLabel, cur), toggle,
      h('div', { style: 'height:10px' }),
      field('New vault passphrase', n1), strengthMeter(n1), field('Confirm', n2),
      h('div.muted', { style: 'font-size:12px' }, 'Re-wraps the vault key; secrets are not re-encrypted. The recovery code keeps working. Must differ from the master passphrase.')), [
      { label: 'Cancel', value: false },
      { label: 'Change', kind: 'primary', onClick: async () => {
        if (n1.value.length < MIN_PASSPHRASE) { toast(`At least ${MIN_PASSPHRASE} characters`, { kind: 'warn' }); return false; }
        if (n1.value !== n2.value) { toast('New passphrases do not match', { kind: 'warn' }); return false; }
        try {
          await session.changeVaultPassphrase(cur.value, n1.value, { recovery });
        } catch (e) {
          toast(e.message === 'BAD_SECRET' ? 'Current passphrase / code is wrong' : e.message, { kind: 'error' });
          return false;
        }
        return true;
      } },
    ]);
    cur.value = n1.value = n2.value = '';
    if (ok) toast('Vault passphrase changed', { kind: 'ok' });
  }

  if (session.vaultUnlocked) {
    try {
      await loadVault();
    } catch (e) {
      fail(e);
      vault = null;
    }
  }
  paint();
  return cleanup;
}
