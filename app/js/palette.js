// Command palette (Ctrl/Cmd+K): jump to views/projects, add a task, send a directive, lock.

import { h, mount, icon, fail } from './ui.js';

const VIEWS = [
  ['Dashboard', '#/', 'dashboard'],
  ['Approvals', '#/approvals', 'approvals'],
  ['Inbox', '#/inbox', 'inbox'],
  ['Radar', '#/radar', 'radar'],
  ['Vault', '#/vault', 'vault'],
  ['Brain', '#/brain', 'brain'],
  ['Activity', '#/activity', 'activity'],
  ['Deck', '#/deck', 'deck'],
  ['Settings', '#/settings', 'settings'],
];

function score(text, q) {
  if (!q) return 1;
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 3;
  if (t.includes(q)) return 2;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}

export function openPalette({ projects, nav, session, model, toast, refreshCounts, lock, help }) {
  if (document.querySelector('.palette-back')) return;
  let mode = null; // { kind: 'task', project }
  let sel = 0;
  let items = [];
  const input = h('input', { placeholder: 'Jump to a project or view, or type a command…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Command' });
  const modeEl = h('span.palette-mode.hidden');
  const list = h('div.palette-list', { role: 'listbox' });
  const back = h('div.modal-back.palette-back.in', { onclick: (e) => e.target === back && close() },
    h('div.palette', h('div.palette-in', icon('search'), modeEl, input, h('kbd', 'esc')), list));
  const offLock = session.on('lock', () => close());

  function close() {
    offLock();
    back.remove();
  }

  function build() {
    const q = input.value.trim().toLowerCase();
    if (mode?.kind === 'task') {
      items = input.value.trim()
        ? [{ label: `Add “${input.value.trim()}” to ${mode.project.name} › Next`, icon: 'plus', run: () => addTask(mode.project, input.value.trim()) }]
        : [{ label: `Type a task title for ${mode.project.name}`, icon: 'board', run: () => {} }];
      return paint();
    }
    const out = [];
    for (const [label, href, ic] of VIEWS) {
      const s = score(label, q);
      if (s) out.push({ s: s + 0.5, label, icon: ic, hint: 'view', run: () => nav(href) });
    }
    for (const p of projects) {
      const s = Math.max(score(p.name, q), score(p.slug, q));
      if (s) out.push({ s: s + 0.4, label: p.name, color: p.color, hint: p.status, run: () => nav(`#/p/${encodeURIComponent(p.slug)}`) });
      if (s && q) out.push({ s: s - 0.2, label: `Add task to ${p.name}…`, icon: 'plus', hint: 'task', keep: true, run: () => { mode = { kind: 'task', project: p }; modeEl.textContent = p.name + ' ›'; modeEl.classList.remove('hidden'); input.value = ''; input.placeholder = 'New task title…'; build(); } });
    }
    if (!q) for (const p of projects.slice(0, 6)) out.push({ s: 0.1, label: `Add task to ${p.name}…`, icon: 'plus', hint: 'task', keep: true, run: () => { mode = { kind: 'task', project: p }; modeEl.textContent = p.name + ' ›'; modeEl.classList.remove('hidden'); input.value = ''; input.placeholder = 'New task title…'; build(); } });
    if (q) out.push({ s: 0.05, label: `Tell the agents: “${input.value.trim()}”`, icon: 'send', hint: 'directive', run: () => directive(input.value.trim()) });
    if (score('lock now', q)) out.push({ s: 0.3, label: 'Lock now', icon: 'lock', hint: 'command', run: lock });
    if (score('keyboard shortcuts help', q)) out.push({ s: 0.2, label: 'Keyboard shortcuts', icon: 'command', hint: '?', run: help });
    items = out.sort((a, b) => b.s - a.s).slice(0, 40);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    paint();
  }

  function paint() {
    mount(list, items.map((it, i) =>
      h('div.palette-item', { class: i === sel ? 'on' : '', role: 'option', onpointermove: () => { if (sel !== i) { sel = i; paint(); } }, onclick: () => choose(i) },
        it.color ? h('span.swatch', { style: { background: it.color } }) : icon(it.icon || 'spark', 16),
        h('span.ellipsis', it.label),
        it.hint ? h('span.hint', it.hint) : null)));
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  }

  async function choose(i) {
    const it = items[i];
    if (!it) return;
    if (!it.keep) close();
    try {
      await it.run();
    } catch (e) {
      fail(e);
    }
    if (it.keep) input.focus();
  }

  async function addTask(p, title) {
    await model.addTask(session.store, p.slug, { title, col: 'next', by: 'saied' });
    toast(`Added to ${p.name}`, { kind: 'ok', action: { label: 'Open', onClick: () => nav(`#/p/${encodeURIComponent(p.slug)}`) } });
    refreshCounts();
    if (location.hash.startsWith(`#/p/${encodeURIComponent(p.slug)}`)) nav(location.hash);
  }

  async function directive(text) {
    await model.addInbox(session.store, { from: 'saied', text });
    toast('Directive sent to the agents', { kind: 'ok' });
    refreshCounts();
  }

  input.addEventListener('input', () => { sel = 0; build(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (mode) { mode = null; modeEl.classList.add('hidden'); input.placeholder = 'Jump to a project or view, or type a command…'; input.value = ''; build(); }
      else close();
    } else if (e.key === 'Backspace' && mode && !input.value) {
      mode = null; modeEl.classList.add('hidden'); build();
    }
  });
  document.body.appendChild(back);
  build();
  input.focus();
}
