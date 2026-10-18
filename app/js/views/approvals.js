// Approvals: pending requests first (secret + action), approve/deny, history, revoke active grants.

import { h, mount, icon, chip, timeEl, md, empty, fail, modal, field, confirm, segmented, fmtDateTime } from '../ui.js';
import { projLink, daysClass, daysText, grantActive, poll } from './common.js';

let histFilter = 'all';

export async function render(root, ctx) {
  const { store, model, toast, session } = ctx;
  let reqs = [];
  let vindex = { items: [] };

  async function load() {
    const [r, vi] = await Promise.all([store.get(model.DOC.requests, { items: [] }), store.get(model.DOC.vaultIndex, { items: [] })]);
    reqs = r.items;
    vindex = vi;
  }

  const pendingEl = h('div');
  const histEl = h('div');
  const headCount = h('span.muted');
  mount(root,
    h('div.view-head', h('div', h('h1', 'Approvals'), h('div.sub', 'Secrets and risky actions the agents asked for. ', headCount)),
      h('div.actions', h('button.btn', { onclick: () => refresh() }, icon('refresh', 16), h('span.hide-sm', 'Refresh')))),
    pendingEl,
    h('div.row', { style: 'margin:26px 0 10px' }, h('h3.section-title', 'History'), h('span.spacer'), segmented([
      { value: 'all', label: 'All' }, { value: 'active', label: 'Active grants' }, { value: 'approved', label: 'Approved' }, { value: 'denied', label: 'Denied' }, { value: 'revoked', label: 'Revoked' },
    ], histFilter, (v) => { histFilter = v; paintHistory(); })),
    histEl);

  const vmeta = (name) => vindex.items.find((s) => s.name === name);

  function secretList(r) {
    return h('div.secret-names', (r.secrets || []).map((name) => {
      const m = vmeta(name);
      const d = m?.expiresAt ? model.daysUntil(m.expiresAt.slice(0, 10)) : null;
      return h('div.secret-name',
        icon('key', 14),
        h('code', name),
        m ? chip('in vault', 'ok') : chip('not in vault', 'urgent'),
        m?.projects?.length ? h('span.muted', m.projects.join(', ')) : null,
        d !== null ? h('span', { class: daysClass(d) }, d < 0 ? 'expired' : `expires in ${daysText(d)}`) : null,
        m?.note ? h('span.dim.ellipsis', { style: 'max-width:260px' }, m.note) : null);
    }));
  }

  function reqCard(r) {
    const isSecret = r.type === 'secret';
    const title = isSecret ? `Secret${(r.secrets || []).length === 1 ? '' : 's'}: ${(r.secrets || []).join(', ')}` : (r.text || '').split('\n')[0].slice(0, 120) || 'Action request';
    return h('article.panel.req', { class: isSecret ? 'secret' : '' },
      h('div.req-head',
        icon(isSecret ? 'key' : 'bolt', 16),
        h('h3', title),
        chip(r.type, isSecret ? 'hot' : 'warm'),
        isSecret ? chip(`TTL ${model.TTL[r.ttl]?.label || r.ttl}`, 'cool') : null),
      h('div.row.wrap.muted', { style: 'font-size:12px;margin-top:6px' },
        h('span', icon('user', 12)), h('span', r.agent || 'agent'),
        r.project ? [h('span', '·'), projLink(ctx.projects(), r.project)] : null,
        h('span', '·'), timeEl(r.ts)),
      r.reason ? h('div.reason', md(r.reason)) : null,
      !isSecret && r.text ? h('div.reason', md(r.text)) : null,
      isSecret ? secretList(r) : null,
      h('div.row.wrap', { style: 'margin-top:10px' },
        h('button.btn.btn-ok', { onclick: () => (isSecret ? approveSecret(r) : decide(r, 'approved')) }, icon('check', 16), 'Approve…'),
        h('button.btn.btn-danger', { onclick: () => decide(r, 'denied') }, icon('x', 16), 'Deny…')));
  }

  function paintPending() {
    const pending = reqs.filter((r) => r.status === 'pending');
    headCount.textContent = pending.length ? `${pending.length} pending.` : 'Nothing pending.';
    mount(pendingEl, pending.length ? pending.map(reqCard) : h('div.panel', empty('All clear', 'No pending requests. Agents ask with `mc request secret` or `mc request action`.', 'approvals')));
  }

  function paintHistory() {
    const now = Date.now();
    const rows = reqs.filter((r) => r.status !== 'pending').filter((r) => {
      if (histFilter === 'all') return true;
      if (histFilter === 'active') return grantActive(r, now);
      return r.status === histFilter;
    });
    if (!rows.length) return mount(histEl, h('div.panel', empty('No history here', '', 'clock')));
    mount(histEl, h('div.panel.list', rows.slice(0, 200).map((r) => {
      const active = grantActive(r, now);
      const expired = r.type === 'secret' && r.status === 'approved' && !active;
      const ttl = model.TTL[r.ttl];
      return h('div.item-row',
        h('div.main-col',
          h('div.row.wrap', h('span.title', r.type === 'secret' ? (r.secrets || []).join(', ') : (r.text || '').slice(0, 120)),
            chip(expired ? 'expired' : r.status, expired ? 'expired' : r.status), chip(r.type, 'note'),
            active ? chip('active', 'ok dot') : null),
          h('div.meta',
            h('span', r.agent || ''),
            r.project ? projLink(ctx.projects(), r.project) : null,
            h('span', 'asked '), timeEl(r.ts),
            r.resolvedAt ? [h('span', `· ${r.status} by ${r.resolvedBy || '?'}`), timeEl(r.resolvedAt)] : null,
            r.type === 'secret' && r.status === 'approved' && ttl ? h('span', `· ${ttl.label}${active ? ', until ' + fmtDateTime(Date.parse(r.resolvedAt) + ttl.ms) : ''}`) : null),
          r.note ? h('div.muted', { style: 'margin-top:4px;font-size:12.5px' }, '“', r.note, '”') : null),
        h('div.acts', active ? h('button.btn.btn-sm.btn-danger', { onclick: () => revoke(r) }, 'Revoke') : null));
    })));
  }

  function paint() {
    paintPending();
    paintHistory();
  }

  async function refresh() {
    try {
      await load();
      paint();
      ctx.refreshCounts();
    } catch (e) {
      fail(e);
    }
  }

  // ---------- actions ----------

  async function decide(r, status) {
    const note = h('textarea.input', { rows: 3, placeholder: status === 'denied' ? 'Why not / what to do instead (optional)' : 'Conditions or notes for the agent (optional)' });
    const body = h('div', r.type === 'action' && r.text ? h('div.note-box', md(r.text)) : null, field('Note', note));
    const ok = await modal(status === 'approved' ? 'Approve action' : 'Deny request', body, [
      { label: 'Cancel', value: false },
      { label: status === 'approved' ? 'Approve' : 'Deny', kind: status === 'approved' ? 'primary' : 'danger', onClick: async () => {
        await model.resolveRequest(store, r.id, { status, note: note.value.trim() }, 'saied');
        return true;
      } },
    ]);
    if (ok) {
      toast(status === 'approved' ? 'Approved' : 'Denied', { kind: 'ok' });
      refresh();
    }
  }

  async function approveSecret(r) {
    const ttlSeg = segmented(Object.entries(model.TTL).map(([k, v]) => ({ value: k, label: v.label })), model.TTL[r.ttl] ? r.ttl : 'once', null, 'full');
    const note = h('input.input', { placeholder: 'Optional note for the agent' });
    const vpass = h('input.input', { type: 'password', placeholder: 'Vault passphrase', autocomplete: 'off' });
    const vaultBlock = h('div', session.vaultUnlocked ? null : field('Vault passphrase (vault is locked)', vpass));
    const missing = (r.secrets || []).filter((n) => !vmeta(n));
    const missingInputs = {};
    const missingBlock = missing.length
      ? h('div.note-box.warn',
        h('b', 'Not in the vault yet. '), 'Enter values to add them to the vault (tagged to this project) and grant them in one go.',
        missing.map((n) => {
          missingInputs[n] = h('textarea.input.secret-input.masked', { rows: 1, placeholder: n, autocomplete: 'off', spellcheck: 'false' });
          return field(n, missingInputs[n]);
        }))
      : null;
    const body = h('div',
      h('div.row.wrap', { style: 'margin-bottom:10px' }, (r.secrets || []).map((n) => chip(n, vmeta(n) ? 'ok' : 'urgent'))),
      r.reason ? h('div.note-box', md(r.reason)) : null,
      field('Grant for', ttlSeg, `Requested: ${model.TTL[r.ttl]?.label || r.ttl}. “Once” = one use within 15 minutes.`),
      field('Note', note),
      missingBlock,
      vaultBlock,
      h('div.muted', { style: 'font-size:12px' }, 'Values are sealed to the agent’s public key (ECDH P-256) and stored as an encrypted grant. Only the agent’s private key can open it.'));

    const done = await modal('Approve secret request', body, [
      { label: 'Cancel', value: false },
      { label: 'Approve & seal', kind: 'primary', onClick: async () => {
        if (!session.vaultUnlocked) {
          if (!vpass.value) { vpass.focus(); return false; }
          try {
            await session.unlockVault(vpass.value);
          } catch (e) {
            toast(e.message === 'BAD_SECRET' ? 'Wrong vault passphrase' : e.message, { kind: 'error' });
            return false;
          }
          vpass.value = '';
        }
        for (const n of missing) if (!missingInputs[n].value) { missingInputs[n].focus(); toast(`Enter a value for ${n}`, { kind: 'warn' }); return false; }
        let vault = await session.getVault();
        if (missing.length) {
          vault = await session.updateVault((v) => {
            for (const n of missing) {
              v.items = v.items.filter((x) => x.name !== n);
              v.items.push({ name: n, value: missingInputs[n].value, projects: r.project ? [r.project] : [], note: `added while approving ${r.id}`, expiresAt: null, updated: model.now() });
            }
            v.items.sort((a, b) => a.name.localeCompare(b.name));
          }, 'vault.add', missing.join(','));
        }
        const secrets = {};
        for (const n of r.secrets || []) {
          const it = vault.items.find((x) => x.name === n);
          if (!it) throw new Error(`${n} is not in the vault`);
          secrets[n] = it.value;
        }
        const pub = r.agentPublicJwk || session.keys?.agent?.publicJwk;
        if (!pub) throw new Error('No agent public key (request.agentPublicJwk or keys.json agent.publicJwk)');
        const ttlKey = ttlSeg.getValue();
        const ttl = model.TTL[ttlKey];
        const box = await ctx.crypto.sealToPublic(pub, { requestId: r.id, secrets });
        await session.forcePut(model.DOC.grant(r.id), { box, expiresAt: new Date(Date.now() + ttl.ms).toISOString(), uses: ttl.uses, used: 0, created: model.now() });
        await model.resolveRequest(store, r.id, { status: 'approved', ttl: ttlKey, note: note.value.trim() }, 'saied');
        await model.audit(store, 'saied', 'vault.grant', Object.keys(secrets).join(','), r.project);
        return true;
      } },
    ]);
    if (done) {
      toast('Granted. The agent can now open it with `mc secret`.', { kind: 'ok' });
      refresh();
    }
  }

  async function revoke(r) {
    if (!(await confirm(`Revoke the grant for ${(r.secrets || []).join(', ')}? The sealed copy is deleted now. If the agent already opened it, rotate the secret too.`, { okLabel: 'Revoke', danger: true }))) return;
    try {
      await store.remove(model.DOC.grant(r.id));
      await model.resolveRequest(store, r.id, { status: 'revoked' }, 'saied');
      toast('Grant revoked', { kind: 'ok' });
      refresh();
    } catch (e) {
      fail(e);
    }
  }

  await load();
  paint();
  return poll(() => load().then(paint).catch(() => {}), 30000);
}

