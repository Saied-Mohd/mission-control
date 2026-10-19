// Dashboard: greeting, stat strip, quick capture, project grid with filters, live activity feed.

import { h, mount, icon, chip, timeEl, excerpt, empty, fail, modal, field } from '../ui.js';
import { kindBadge, heatChip, statusChip, gitHealth, projectSelect, daysClass, daysText, emptyIndex, poll, pullToRefresh, projectName, deleteProjectFlow, toggleArchive } from './common.js';

const filters = { status: 'live', heat: 'all', q: '' }; // UI-only, kept for the session

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Late night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

export async function render(root, ctx) {
  const { store, model, toast, nav } = ctx;
  let data = null;

  async function load() {
    const [idx, reqs, inbox, radar] = await Promise.all([
      store.get(model.DOC.index, emptyIndex()),
      store.get(model.DOC.requests, { items: [] }),
      store.get(model.DOC.inbox, { items: [] }),
      model.radarFeed(store),
    ]);
    const projects = idx.order.map((s) => idx.projects[s]).filter(Boolean);
    ctx.setProjects(projects);
    data = { idx, projects, reqs: reqs.items, inbox: inbox.items, radar };
  }

  const ptr = h('div.ptr', icon('refresh', 18));
  const statsEl = h('div.stats');
  const gridEl = h('div.pgrid');
  const feedEl = h('div.feed');
  const countEl = h('span.muted.num');

  // --- quick capture ---
  const capIn = h('input.input', { placeholder: 'Tell the agents…', autocomplete: 'off', 'aria-label': 'Directive for the agents' });
  const capProj = h('span');
  const capture = h('form.panel.capture', {
    onsubmit: async (e) => {
      e.preventDefault();
      const text = capIn.value.trim();
      if (!text) return capIn.focus();
      const sel = capProj.querySelector('select');
      try {
        await model.addInbox(store, { from: 'saied', text, project: sel?.value || null });
        capIn.value = '';
        toast('Directive sent — agents see it on their next `mc brief`', { kind: 'ok' });
        await refresh();
      } catch (err) {
        fail(err);
      }
    },
  }, icon('send', 18), capIn, capProj, h('button.btn.btn-primary', { type: 'submit' }, 'Send'));

  // --- filters ---
  const search = h('input.input.search', { type: 'search', placeholder: 'Filter projects…  ( / )', value: filters.q, dataset: { search: '1' }, oninput: (e) => { filters.q = e.target.value; paintGrid(); } });
  const statusSel = h('select.input', { 'aria-label': 'Status', onchange: (e) => { filters.status = e.target.value; paintGrid(); } },
    [['live', 'All but archived'], ['all', 'All statuses'], ...model.PROJECT_STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)])].map(([v, l]) => h('option', { value: v, selected: filters.status === v }, l)));
  const heatSel = h('select.input', { 'aria-label': 'Heat', onchange: (e) => { filters.heat = e.target.value; paintGrid(); } },
    [['all', 'Any heat'], ['hot', 'Hot'], ['warm', 'Warm'], ['cool', 'Cool'], ['cold', 'Cold']].map(([v, l]) => h('option', { value: v, selected: filters.heat === v }, l)));

  const refreshBtn = h('button.btn', { onclick: () => refresh(true) }, icon('refresh', 16), h('span.hide-sm', 'Refresh'));
  const now = new Date();

  mount(root,
    ptr,
    h('div.view-head',
      h('div', h('h1', `${greeting()}, Saied`), h('div.sub', now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))),
      h('div.actions', refreshBtn, h('button.btn', { onclick: newProject }, icon('plus', 16), 'Project'))),
    statsEl,
    capture,
    h('div.dash',
      h('section',
        h('div.filters', search, statusSel, heatSel, countEl),
        gridEl),
      h('aside.panel',
        h('div.panel-head', h('h3', 'Live activity'), h('span.spacer'), h('a.btn.btn-ghost.btn-sm', { href: '#/activity' }, 'All')),
        h('div.feed-scroll', feedEl))));

  function paintStats() {
    const { projects, reqs, inbox, radar } = data;
    const active = projects.filter((p) => p.status === 'active').length;
    const open = projects.reduce((n, p) => n + (p.open || 0), 0);
    const doing = projects.reduce((n, p) => n + (p.doing || 0), 0);
    const pending = reqs.filter((r) => r.status === 'pending');
    const inboxOpen = inbox.filter((i) => i.status === 'open');
    const questions = inboxOpen.filter((i) => i.from !== 'saied').length;
    const upcoming = radar.map((r) => ({ ...r, d: model.daysUntil(r.date) })).filter((r) => r.d >= 0);
    const next = upcoming[0];
    const overdue = radar.filter((r) => model.daysUntil(r.date) < 0 && r.kind !== 'done').length;
    mount(statsEl,
      h('a.stat', { href: '#/', style: { '--accent': 'var(--cyan)' } }, h('span.k', 'Active projects'), h('span.v', String(active), h('small', `/ ${projects.length}`))),
      h('div.stat', { style: { '--accent': 'var(--blue)' } }, h('span.k', 'Open tasks'), h('span.v', String(open))),
      h('div.stat', { style: { '--accent': 'var(--green)' } }, h('span.k', 'Doing'), h('span.v', String(doing))),
      h('a.stat', { href: '#/approvals', style: { '--accent': 'var(--magenta)' } }, h('span.k', 'Pending approvals'),
        h('span.v', String(pending.length), pending.length ? h('span.live-dot.pulse') : null),
        pending.length ? h('span.s.ellipsis', pending.filter((r) => r.type === 'secret').length + ' secret · ' + pending.filter((r) => r.type !== 'secret').length + ' action') : null),
      h('a.stat', { href: '#/inbox', style: { '--accent': 'var(--amber)' } }, h('span.k', 'Inbox open'), h('span.v', String(inboxOpen.length)), questions ? h('span.s', `${questions} question${questions === 1 ? '' : 's'} for you`) : null),
      h('a.stat', { href: '#/radar', style: { '--accent': 'var(--violet)' } }, h('span.k', 'Next on radar'),
        next ? h('span.v', { class: daysClass(next.d) }, String(next.d), h('small', next.d === 1 ? 'day' : 'days')) : h('span.v.dim', '—'),
        next ? h('span.s.ellipsis', { title: next.text }, next.text) : overdue ? h('span.s.d-over', `${overdue} overdue`) : h('span.s.dim', 'clear skies')));
  }

  function card(p) {
    const ht = model.heat(p);
    return h('a.pcard', { href: `#/p/${encodeURIComponent(p.slug)}`, style: { '--c': p.color || 'var(--cyan)' }, dataset: { heat: ht } },
      h('div.top',
        h('div.grow', h('h3', p.name), p.tagline ? h('div.tagline', p.tagline) : null),
        h('div.chips', statusChip(p.status), heatChip(p),
          h('button.icon-btn.sm.pcard-menu', { type: 'button', title: 'Project actions', 'aria-label': `Actions for ${p.name}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); cardMenu(p); } }, icon('more', 16)))),
      h('div.counts',
        h('span', h('b', String(p.open || 0)), 'open'),
        h('span', h('b', String(p.doing || 0)), 'doing'),
        h('span', h('b', String(p.done || 0)), 'done')),
      p.next ? h('div.next', h('span.label', 'Next'), h('span.ellipsis', p.next)) : null,
      p.handoff ? h('div.handoff', h('span.label', `${p.handoff.agent} · `), excerpt(p.handoff.text, 220)) : p.lastLine ? h('div.handoff', excerpt(p.lastLine, 200)) : null,
      h('div.foot', p.health ? gitHealth(p.health) : null, h('span.spacer'), p.lastActivity ? timeEl(p.lastActivity) : p.updatedAt ? timeEl(p.updatedAt) : null));
  }

  async function cardMenu(p) {
    const choice = await modal(p.name, h('p.muted', { style: 'margin:0' }, p.tagline || p.slug), [
      { label: 'Cancel', value: null, kind: 'ghost' },
      { label: p.status === 'archived' ? 'Restore' : 'Archive', value: 'archive' },
      { label: 'Delete…', value: 'delete', kind: 'danger' },
      { label: 'Open', value: 'open', kind: 'primary' },
    ]);
    try {
      if (choice === 'open') location.hash = `#/p/${encodeURIComponent(p.slug)}`;
      if (choice === 'archive') await toggleArchive(store, p);
      if (choice === 'delete' && !(await deleteProjectFlow(store, p))) return;
      if (choice === 'archive' || choice === 'delete') {
        ctx.refreshCounts?.();
        await load();
        paint();
      }
    } catch (e) {
      fail(e);
    }
  }

  function paintGrid() {
    const q = filters.q.trim().toLowerCase();
    const list = data.projects.filter((p) => {
      if (filters.status === 'live' && p.status === 'archived') return false;
      if (filters.status !== 'live' && filters.status !== 'all' && p.status !== filters.status) return false;
      if (filters.heat !== 'all' && model.heat(p) !== filters.heat) return false;
      if (q && !`${p.name} ${p.slug} ${p.tagline || ''} ${(p.tags || []).join(' ')} ${p.next || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    countEl.textContent = `${list.length}/${data.projects.length}`;
    if (!data.projects.length) {
      mount(gridEl, h('div.panel', { style: 'grid-column:1/-1' }, empty('No projects yet', 'Agents add projects with `mc project add`, or create one here.', 'board')));
      return;
    }
    mount(gridEl, list.length ? list.map(card) : h('div.panel', { style: 'grid-column:1/-1' }, empty('No projects match these filters', '', 'search')));
  }

  function paintFeed() {
    const acts = (data.idx.activity || []).slice(0, 80);
    if (!acts.length) return mount(feedEl, empty('Quiet so far', 'Agent log entries show up here live.', 'activity'));
    mount(feedEl, acts.map((a) =>
      h('div.feed-item', { class: 'kind-' + (a.kind || 'note') },
        kindBadge(a.kind),
        h('div',
          h('div.meta',
            a.slug ? h('a', { href: `#/p/${encodeURIComponent(a.slug)}` }, projectName(data.projects, a.slug)) : null,
            h('span', a.agent || ''),
            chip(a.kind || 'note', a.kind || 'note'),
            timeEl(a.ts)),
          h('div.t', a.text)))));
  }

  function paintCapture() {
    const prev = capProj.querySelector('select')?.value || '';
    mount(capProj, projectSelect(data.projects.filter((p) => p.status !== 'archived'), prev, { allLabel: 'Any project' }));
  }

  function paint() {
    paintStats();
    paintGrid();
    paintFeed();
    paintCapture();
  }

  async function refresh(manual = false) {
    try {
      refreshBtn.disabled = true;
      await load();
      paint();
      ctx.refreshCounts();
      if (manual) toast('Up to date', { kind: 'ok', timeout: 1500 });
    } catch (e) {
      fail(e, 'Refresh failed');
    } finally {
      refreshBtn.disabled = false;
    }
  }

  async function newProject() {
    const name = h('input.input', { placeholder: 'e.g. Family OS' });
    const tagline = h('input.input', { placeholder: 'One line on what it is' });
    const color = h('input.input', { type: 'color', value: '#5ee7ff' });
    const out = await modal('New project', h('div', field('Name', name), field('Tagline', tagline), field('Color', color)), [
      { label: 'Cancel', value: null },
      { label: 'Create', kind: 'primary', onClick: async () => {
        if (!name.value.trim()) return false;
        const p = await model.createProject(store, { name: name.value.trim(), tagline: tagline.value.trim(), color: color.value });
        await model.audit(store, 'saied', 'project.create', p.slug, p.slug);
        return p;
      } },
    ]);
    if (out) nav(`#/p/${encodeURIComponent(out.slug)}`);
  }

  try {
    await load();
  } catch (e) {
    mount(root, h('div.panel.err-panel', h('h3', 'Could not load the dashboard'), h('pre', e.message || String(e)), h('button.btn', { onclick: () => ctx.nav(location.hash || '#/') }, 'Retry')));
    return;
  }
  paint();
  const stopPoll = poll(() => load().then(paint).catch(() => {}), 30000);
  const stopPtr = pullToRefresh(ptr, () => refresh(true));
  return () => {
    stopPoll();
    stopPtr();
  };
}
