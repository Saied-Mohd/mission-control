// Project: header + Board (kanban w/ drag & drop) · Log (timeline) · Handoff · Info.
// Every mutation goes through model.js with actor 'saied'.

import { h, mount, icon, chip, timeEl, md, empty, fail, modal, field, confirm, segmented, extLink, safeUrl, fmtDateTime, fmtDate, excerpt } from '../ui.js';
import { kindBadge, statusChip, heatChip, gitHealth, prioChip, deleteProjectFlow } from './common.js';

const PRIO_RANK = { urgent: 0, high: 1, med: 2, low: 3 };
const COL_COLOR = { backlog: 'var(--dim)', next: 'var(--blue)', doing: 'var(--cyan)', review: 'var(--amber)', done: 'var(--green)' };
const TABS = [
  ['board', 'Board', 'board'],
  ['log', 'Log', 'log'],
  ['handoff', 'Handoff', 'handoff'],
  ['info', 'Info', 'info'],
];

function toLink(l) {
  if (!l) return null;
  if (typeof l === 'string') return { label: l.replace(/^https?:\/\//, ''), url: l };
  const url = l.url || l.href || '';
  return { label: l.label || l.title || l.name || url.replace(/^https?:\/\//, ''), url };
}

function repoUrl(repo) {
  if (!repo) return null;
  if (/^https?:\/\//.test(repo)) return repo;
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) return `https://github.com/${repo}`;
  return null;
}

const splitList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export async function render(root, ctx) {
  const { store, model, toast, nav } = ctx;
  const slug = ctx.params.slug;
  let tab = TABS.some((t) => t[0] === ctx.params.tab) ? ctx.params.tab : 'board';
  let p = await model.getProject(store, slug);
  if (!p) {
    mount(root, h('div.panel', empty(`No project “${slug}”`, 'It may have been deleted or renamed.', 'question')), h('div.row', { style: 'justify-content:center;margin-top:12px' }, h('a.btn', { href: '#/' }, 'Back to dashboard')));
    return;
  }
  let log = null;
  let logFilter = 'all';
  let logQuery = '';
  let logLimit = 150;
  let disposed = false;

  const headEl = h('section.panel.phead');
  const tabsEl = h('nav.tabs');
  const bodyEl = h('div');
  mount(root, headEl, tabsEl, bodyEl);

  async function reload() {
    p = await model.getProject(store, slug);
    if (!p) return nav('#/');
    paintHead();
    paintTab();
  }

  async function mut(fn, okMsg) {
    try {
      await fn();
      if (okMsg) toast(okMsg, { kind: 'ok', timeout: 1800 });
      await reload();
    } catch (e) {
      fail(e);
      await reload().catch(() => {});
    }
  }

  // ---------------- header ----------------

  function paintHead() {
    headEl.style.setProperty('--c', p.color || 'var(--cyan)');
    const statusSel = h('select.input', {
      'aria-label': 'Status',
      onchange: (e) => mut(async () => {
        const status = e.target.value;
        await model.saveProject(store, slug, (x) => { x.status = status; });
        await model.audit(store, 'saied', 'project.status', status, slug);
      }, 'Status updated'),
    }, model.PROJECT_STATUSES.map((s) => h('option', { value: s, selected: p.status === s }, s)));
    const rurl = repoUrl(p.repo);
    const links = (p.links || []).map(toLink).filter((l) => l && safeUrl(l.url));
    mount(headEl,
      h('div.title-row',
        h('span.swatch-lg'),
        h('h1', p.name),
        statusChip(p.status),
        heatChip(ctx.projects().find((x) => x.slug === slug) || p),
        h('div.actions', statusSel, h('button.btn.btn-sm', { onclick: editHeader }, icon('edit', 14), 'Edit'), h('button.icon-btn.sm.danger', { onclick: deleteIt, title: 'Delete project', 'aria-label': 'Delete project' }, icon('trash', 15)))),
      p.tagline ? h('p.tagline', p.tagline) : null,
      h('div.meta',
        (p.tags || []).length ? h('span.item', (p.tags || []).map((t) => chip('#' + t))) : null,
        p.path ? h('span.item', { title: 'Local path' }, icon('folder', 13), h('code', p.path)) : null,
        p.repo ? h('span.item', icon('git', 13), rurl ? extLink(rurl, p.repo) : h('code', p.repo)) : null,
        p.health ? h('span.item', gitHealth(p.health, { long: true })) : null,
        links.slice(0, 4).map((l) => h('span.item', icon('link', 13), extLink(l.url, l.label))),
        h('span.item.dim', 'updated ', timeEl(p.updatedAt))));
  }

  async function editHeader() {
    const name = h('input.input', { value: p.name });
    const tagline = h('input.input', { value: p.tagline || '' });
    const color = h('input.input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#5ee7ff' });
    const tags = h('input.input', { value: (p.tags || []).join(', '), placeholder: 'comma, separated' });
    const path = h('input.input.mono', { value: p.path || '', placeholder: '~/App Development/…' });
    const repo = h('input.input.mono', { value: p.repo || '', placeholder: 'owner/repo or URL' });
    await modal('Edit project', h('div', field('Name', name), field('Tagline', tagline), h('div.form-grid', field('Color', color), field('Tags', tags)), field('Path', path), field('Repo', repo)), [
      { label: 'Cancel', value: null },
      { label: 'Save', kind: 'primary', onClick: async () => {
        if (!name.value.trim()) return false;
        await model.saveProject(store, slug, (x) => {
          x.name = name.value.trim();
          x.tagline = tagline.value.trim();
          x.color = color.value;
          x.tags = splitList(tags.value);
          x.path = path.value.trim();
          x.repo = repo.value.trim();
        });
        await model.audit(store, 'saied', 'project.edit', 'header', slug);
        await reload();
        return true;
      } },
    ]);
  }

  // ---------------- tabs ----------------

  function paintTabs() {
    const open = (p.board?.tasks || []).filter((t) => t.col !== 'done').length;
    mount(tabsEl, TABS.map(([id, label, ic]) => h('button', { class: id === tab ? 'on' : '', onclick: () => { tab = id; ctx.setHash(`#/p/${encodeURIComponent(slug)}/${id}`); paintTabs(); paintTab(); } },
      icon(ic, 15), label, id === 'board' && open ? h('span.badge.cyan', String(open)) : null)));
  }

  function paintTab() {
    paintTabs();
    if (tab === 'board') paintBoard();
    else if (tab === 'log') paintLog();
    else if (tab === 'handoff') paintHandoff();
    else paintInfo();
  }

  // ---------------- board ----------------

  function sortedTasks(col) {
    const ts = (p.board?.tasks || []).filter((t) => t.col === col);
    if (col === 'done') return ts.sort((a, b) => String(b.doneAt || b.updated).localeCompare(String(a.doneAt || a.updated)));
    return ts.sort((a, b) => (PRIO_RANK[a.prio] ?? 2) - (PRIO_RANK[b.prio] ?? 2));
  }

  function taskCard(t) {
    const el = h('div.task', { class: `p-${t.prio || 'med'}${t.col === 'done' ? ' done' : ''}`, dataset: { id: t.id }, tabindex: '0', role: 'button', 'aria-label': t.title },
      h('div.tt', t.title),
      t.note ? h('div.tn', excerpt(t.note, 140)) : null,
      h('div.tm',
        t.prio && t.prio !== 'med' ? prioChip(t.prio) : null,
        (t.tags || []).slice(0, 3).map((x) => chip('#' + x)),
        h('span.spacer'),
        t.by ? h('span', t.by) : null,
        timeEl(t.updated || t.created)));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); taskSheet(t); } });
    attachDrag(el, t);
    return el;
  }

  let suppressClick = false;
  function attachDrag(el, t) {
    el.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      taskSheet(t);
    });
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return; // touch: tap opens the sheet with "move to"
      const sx = e.clientX;
      const sy = e.clientY;
      let ghost = null;
      let overCol = null;
      const rect = el.getBoundingClientRect();
      const move = (ev) => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
          ghost = el.cloneNode(true);
          ghost.classList.add('task-ghost');
          ghost.style.width = rect.width + 'px';
          document.body.appendChild(ghost);
          el.classList.add('dragging');
          try { el.setPointerCapture(e.pointerId); } catch {}
        }
        ghost.style.left = ev.clientX - (sx - rect.left) + 'px';
        ghost.style.top = ev.clientY - (sy - rect.top) + 'px';
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.kcol');
        if (under !== overCol) {
          overCol?.classList.remove('drop');
          overCol = under;
          overCol?.classList.add('drop');
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (!ghost) return;
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 300);
        ghost.remove();
        el.classList.remove('dragging');
        overCol?.classList.remove('drop');
        const col = overCol?.dataset.col;
        if (col && col !== t.col) {
          overCol.querySelector('.kcol-list').prepend(el); // optimistic
          mut(() => model.updateTask(store, slug, t.id, { col }, 'saied'));
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  function addForm(col, holder) {
    const input = h('input.input.sm', { placeholder: 'Task title, Enter to add', autocomplete: 'off' });
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const title = input.value.trim();
        if (!title) return;
        input.disabled = true;
        try {
          await model.addTask(store, slug, { title, col, by: 'saied' });
          p = await model.getProject(store, slug);
          paintBoard(col);
          ctx.refreshCounts();
        } catch (err) {
          fail(err);
          input.disabled = false;
        }
      },
    }, input);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); paintBoard(); } });
    input.addEventListener('blur', () => setTimeout(() => { if (!input.value.trim() && form.isConnected && !input.disabled) paintBoard(); }, 150));
    mount(holder, form);
    input.focus();
  }

  function paintBoard(reopenAddFor = null) {
    const cols = model.COLUMNS.map((c) => {
      const tasks = sortedTasks(c.id);
      const addHolder = h('div.kcol-add', h('button.btn.btn-ghost.btn-sm', { onclick: () => addForm(c.id, addHolder) }, icon('plus', 14), 'Add task'));
      return h('section.kcol', { dataset: { col: c.id } },
        h('header.kcol-head', h('span.bar', { style: { background: COL_COLOR[c.id] } }), h('span.caps', c.label), h('span.n', String(tasks.length))),
        h('div.kcol-list', tasks.map(taskCard)),
        c.id === 'done' ? null : addHolder);
    });
    mount(bodyEl, h('div.kanban', cols));
    if (reopenAddFor) {
      const holder = bodyEl.querySelector(`.kcol[data-col="${reopenAddFor}"] .kcol-add`);
      if (holder) addForm(reopenAddFor, holder);
    }
  }

  async function taskSheet(t0) {
    const t = (p.board.tasks || []).find((x) => x.id === t0.id) || t0;
    const title = h('textarea.input', { rows: 2, value: t.title });
    const note = h('textarea.input', { rows: 4, value: t.note || '', placeholder: 'Notes (markdown-lite)' });
    const tags = h('input.input', { value: (t.tags || []).join(', '), placeholder: 'comma, separated' });
    const prio = segmented(model.PRIORITIES.map((x) => ({ value: x, label: x })), t.prio || 'med', null, 'full');
    const col = segmented(model.COLUMNS.map((c) => ({ value: c.id, label: c.label })), t.col, null, 'full');
    const body = h('div',
      field('Move to', col),
      field('Title', title),
      field('Priority', prio),
      field('Notes', note),
      field('Tags', tags),
      h('div.muted', { style: 'font-size:12px' }, `Created ${fmtDateTime(t.created)}${t.by ? ' by ' + t.by : ''} · updated `, timeEl(t.updated)));
    const res = await modal('Task', body, [
      { label: 'Delete', kind: 'danger', onClick: async () => {
        if (!(await confirm(`Delete “${t.title}”?`, { okLabel: 'Delete', danger: true }))) return false;
        await model.removeTask(store, slug, t.id);
        return 'deleted';
      } },
      { label: 'Cancel', value: null },
      { label: 'Save', kind: 'primary', onClick: async () => {
        const patch = {};
        const nt = title.value.trim();
        if (!nt) return false;
        if (nt !== t.title) patch.title = nt;
        if (note.value !== (t.note || '')) patch.note = note.value;
        const ntags = splitList(tags.value);
        if (ntags.join(',') !== (t.tags || []).join(',')) patch.tags = ntags;
        if (prio.getValue() !== (t.prio || 'med')) patch.prio = prio.getValue();
        if (col.getValue() !== t.col) patch.col = col.getValue();
        if (!Object.keys(patch).length) return 'noop';
        await model.updateTask(store, slug, t.id, patch, 'saied');
        return 'saved';
      } },
    ]);
    if (res === 'deleted' || res === 'saved') {
      toast(res === 'deleted' ? 'Task deleted' : 'Task saved', { kind: 'ok', timeout: 1500 });
      await reload();
      ctx.refreshCounts();
    }
  }

  // ---------------- log ----------------

  async function loadLog() {
    log = await model.getLog(store, slug);
  }

  function paintLog() {
    if (!log) {
      mount(bodyEl, h('div.loading', 'Loading log…'));
      loadLog().then(() => !disposed && tab === 'log' && paintLog()).catch((e) => fail(e));
      return;
    }
    const kindSel = h('select.input', { style: 'width:auto' }, model.LOG_KINDS.map((k) => h('option', { value: k, selected: k === 'note' }, k)));
    const text = h('textarea.input', { rows: 3, placeholder: 'Add a note, decision or blocker for the agents…' });
    const addBtn = h('button.btn.btn-primary', { type: 'submit' }, 'Add entry');
    const composer = h('form.panel.composer', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!text.value.trim()) return text.focus();
        addBtn.disabled = true;
        try {
          await model.appendLog(store, slug, { kind: kindSel.value, text: text.value, agent: 'saied' });
          text.value = '';
          await loadLog();
          paintLog();
        } catch (err) {
          fail(err);
        }
        addBtn.disabled = false;
      },
    }, text, h('div.row', h('span.label', 'Kind'), kindSel, h('span.spacer'), addBtn));

    const entries = [...(log.entries || [])].reverse();
    const counts = {};
    for (const e of entries) counts[e.kind] = (counts[e.kind] || 0) + 1;
    const q = logQuery.trim().toLowerCase();
    const filtered = entries.filter((e) => (logFilter === 'all' || e.kind === logFilter) && (!q || `${e.text} ${e.agent} ${(e.files || []).join(' ')}`.toLowerCase().includes(q)));
    const filterChips = h('div.row.wrap', { style: 'margin-bottom:14px' },
      ['all', ...model.LOG_KINDS].map((k) => chip(`${k}${k === 'all' ? ' ' + entries.length : counts[k] ? ' ' + counts[k] : ''}`, `clickable ${k === 'all' ? '' : k}${logFilter === k ? ' on' : ''}`, { role: 'button', tabindex: '0', onclick: () => { logFilter = k; paintLog(); } })),
      h('span.spacer'),
      h('input.input.sm', { type: 'search', style: 'width:200px', placeholder: 'Search log', value: logQuery, dataset: { search: '1' }, oninput: (e) => { logQuery = e.target.value; const pos = e.target.selectionStart; paintLog(); const s = bodyEl.querySelector('[data-search]'); s.focus(); s.setSelectionRange(pos, pos); } }));
    const taskTitle = (id) => (p.board?.tasks || []).find((t) => t.id === id)?.title;

    const items = [];
    let lastDay = '';
    for (const e of filtered.slice(0, logLimit)) {
      const day = fmtDate(e.ts, { weekday: 'short', month: 'short', day: 'numeric' });
      if (day !== lastDay) {
        items.push(h('div.day-sep.caps', day));
        lastDay = day;
      }
      items.push(h('div.tl-item', { class: 'kind-' + e.kind },
        kindBadge(e.kind, 15),
        h('div.tl-body',
          h('div.tl-meta', h('span.who', e.agent || '—'), chip(e.kind, e.kind), timeEl(e.ts)),
          md(e.text),
          (e.files || []).length ? h('div.tl-files', e.files.map((f) => h('code', f))) : null,
          (e.tasks || []).length ? h('div.tl-files', e.tasks.map((id) => chip(taskTitle(id) ? excerpt(taskTitle(id), 40) : id, 'note'))) : null)));
    }
    mount(bodyEl, composer, filterChips,
      filtered.length ? h('div.timeline', items) : h('div.panel', empty(entries.length ? 'No entries match' : 'No log entries yet', entries.length ? '' : 'Agents write here with `mc log`.', 'log')),
      filtered.length > logLimit ? h('div.row', { style: 'justify-content:center' }, h('button.btn', { onclick: () => { logLimit += 200; paintLog(); } }, `Show more (${filtered.length - logLimit})`)) : null);
  }

  // ---------------- handoff ----------------

  function paintHandoff(editing = false) {
    const ho = p.handoff;
    if (editing) {
      const ta = h('textarea.input', { rows: 14, value: ho?.text || '', placeholder: 'Where things stand, what is next, gotchas…' });
      const save = h('button.btn.btn-primary', { onclick: async () => {
        if (!ta.value.trim()) return ta.focus();
        save.disabled = true;
        await mut(async () => {
          await model.setHandoff(store, slug, ta.value, 'saied');
          log = null;
        }, 'Handoff saved');
      } }, 'Save handoff');
      mount(bodyEl, h('div.panel.panel-pad', ta, h('div.row', { style: 'margin-top:10px;justify-content:flex-end' }, h('button.btn', { onclick: () => paintHandoff(false) }, 'Cancel'), save)));
      ta.focus();
      return;
    }
    const prev = h('div');
    mount(bodyEl,
      h('div.panel',
        h('div.panel-head', h('h3', 'Current handoff'), ho ? h('span.muted', { style: 'font-size:12px' }, `${ho.agent} · `, timeEl(ho.ts), ` · ${fmtDateTime(ho.ts)}`) : null, h('span.spacer'), h('button.btn.btn-sm', { onclick: () => paintHandoff(true) }, icon('edit', 14), ho ? 'Edit' : 'Write')),
        h('div.panel-body', ho ? md(ho.text) : empty('No handoff yet', 'Agents leave one at the end of a session with `mc handoff`.', 'handoff'))),
      prev);
    // earlier handoffs from the log
    (log ? Promise.resolve() : loadLog()).then(() => {
      if (disposed || tab !== 'handoff') return;
      const older = (log.entries || []).filter((e) => e.kind === 'handoff').reverse().slice(ho ? 1 : 0, 8);
      if (!older.length) return;
      mount(prev, h('div.section-title', { style: 'margin:20px 0 10px' }, 'Earlier handoffs'),
        h('div.timeline', older.map((e) => h('div.tl-item.kind-handoff', kindBadge('handoff', 15), h('div.tl-body', h('div.tl-meta', h('span.who', e.agent), timeEl(e.ts)), md(e.text))))));
    }).catch(() => {});
  }

  // ---------------- info ----------------

  function paintInfo() {
    const links = (p.links || []).map(toLink).filter(Boolean);
    const rurl = repoUrl(p.repo);
    mount(bodyEl,
      h('div.row', { style: 'margin-bottom:12px;justify-content:flex-end' }, h('button.btn', { onclick: editInfo }, icon('edit', 15), 'Edit info')),
      h('div.info-grid',
        h('section.panel', h('div.panel-head', h('h3', 'Rules'), h('span.muted', String((p.rules || []).length))),
          h('div.panel-body', (p.rules || []).length ? h('ol.rules', p.rules.map((r) => h('li', h('div', md(r))))) : h('div.muted', 'No rules. Rules are hard constraints agents must follow on this project.'))),
        h('section.panel', h('div.panel-head', h('h3', 'Notes')), h('div.panel-body', p.notes ? md(p.notes) : h('div.muted', 'No notes.'))),
        h('section.panel', h('div.panel-head', h('h3', 'Stack & links')),
          h('div.panel-body',
            (p.stack || []).length ? h('div.row.wrap', { style: 'margin-bottom:12px' }, p.stack.map((s) => chip(s, 'cool'))) : h('div.muted', { style: 'margin-bottom:12px' }, 'No stack listed.'),
            links.length ? h('div.links-list', links.map((l) => h('div', icon('link', 13), ' ', extLink(l.url, l.label)))) : h('div.muted', 'No links.'))),
        h('section.panel', h('div.panel-head', h('h3', 'Details')),
          h('div.panel-body', h('dl.kv',
            h('dt', 'Slug'), h('dd', h('code', p.slug)),
            h('dt', 'Path'), h('dd', p.path ? h('code', p.path) : '—'),
            h('dt', 'Repo'), h('dd', p.repo ? (rurl ? extLink(rurl, p.repo) : p.repo) : '—'),
            h('dt', 'Git'), h('dd', p.health ? gitHealth(p.health, { long: true }) : '—'),
            p.health?.path ? [h('dt', 'Git path'), h('dd', h('code', p.health.path))] : null,
            h('dt', 'Created'), h('dd', fmtDateTime(p.createdAt)),
            h('dt', 'Updated'), h('dd', fmtDateTime(p.updatedAt))))),
        h('section.panel', h('div.panel-head', h('h3', 'Danger zone')),
          h('div.panel-body', h('p.muted', { style: 'margin-top:0' }, 'Deleting removes the project, its board and its log from the data repo (git history keeps old ciphertext).'),
            h('button.btn.btn-danger', { onclick: deleteIt }, icon('trash', 15), 'Delete project')))));
  }

  async function editInfo() {
    const rules = h('textarea.input', { rows: 6, value: (p.rules || []).join('\n'), placeholder: 'One rule per line' });
    const notes = h('textarea.input', { rows: 8, value: p.notes || '' });
    const stack = h('input.input', { value: (p.stack || []).join(', '), placeholder: 'Next.js, Supabase, …' });
    const links = h('textarea.input.mono', { rows: 4, value: (p.links || []).map(toLink).filter(Boolean).map((l) => (l.label && l.label !== l.url.replace(/^https?:\/\//, '') ? `${l.label} | ${l.url}` : l.url)).join('\n'), placeholder: 'Label | https://…  (one per line)' });
    await modal('Edit project info', h('div', field('Rules', rules, 'One per line.'), field('Notes', notes, 'Markdown-lite: **bold**, `code`, lists, links.'), field('Stack', stack), field('Links', links, 'Only http(s) and mailto links are rendered as links.')), [
      { label: 'Cancel', value: null },
      { label: 'Save', kind: 'primary', onClick: async () => {
        const ls = lines(links.value).map((l) => {
          const [a, b] = l.includes('|') ? l.split('|').map((x) => x.trim()) : [null, l];
          return { label: a || b.replace(/^https?:\/\//, ''), url: b };
        });
        await model.saveProject(store, slug, (x) => {
          x.rules = lines(rules.value);
          x.notes = notes.value;
          x.stack = splitList(stack.value);
          x.links = ls;
        });
        await model.audit(store, 'saied', 'project.edit', 'info', slug);
        await reload();
        return true;
      } },
    ], { wide: true });
  }

  async function deleteIt() {
    if (!(await deleteProjectFlow(store, p))) return;
    ctx.refreshCounts();
    nav('#/');
  }

  paintHead();
  paintTab();
  return () => {
    disposed = true;
  };
}
