// Activity: agent activity feed (index.activity) merged with the audit log, filterable.

import { h, mount, chip, timeEl, empty, fmtDate, debounce } from '../ui.js';
import { kindBadge, projLink, projectSelect, poll } from './common.js';

const f = { source: 'all', project: '', actor: '', q: '' };

export async function render(root, ctx) {
  const { store, model } = ctx;
  let rows = [];

  async function load() {
    const [idx, aud] = await Promise.all([store.get(model.DOC.index, { order: [], projects: {}, activity: [] }), store.get(model.DOC.audit, { items: [] })]);
    const acts = (idx.activity || []).map((a) => ({ src: 'activity', ts: a.ts, kind: a.kind || 'note', actor: a.agent || '', project: a.slug || null, text: a.text }));
    const auds = (aud.items || []).map((a) => ({ src: 'audit', ts: a.ts, kind: 'audit', actor: a.actor || '', project: a.project || null, text: a.action + (a.target ? ` · ${a.target}` : ''), action: a.action }));
    rows = [...acts, ...auds].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  }

  const listEl = h('div');
  const src = h('select.input', { style: 'width:auto', onchange: (e) => { f.source = e.target.value; paint(); } },
    [['all', 'Everything'], ['activity', 'Agent activity'], ['audit', 'Audit log']].map(([v, l]) => h('option', { value: v, selected: f.source === v }, l)));
  const projHolder = h('span');
  const actorSel = h('select.input', { style: 'width:auto', onchange: (e) => { f.actor = e.target.value; paint(); } });
  const q = h('input.input', { type: 'search', placeholder: 'Search…', value: f.q, dataset: { search: '1' }, style: 'flex:1;min-width:160px', oninput: debounce((e) => { f.q = e.target.value; paint(); }, 120) });

  mount(root,
    h('div.view-head', h('div', h('h1', 'Activity'), h('div.sub', 'What the agents did, and every security-relevant action (audit).'))),
    h('div.filters', src, projHolder, actorSel, q),
    listEl);

  function paint() {
    const ps = projectSelect(ctx.projects(), f.project, { allLabel: 'All projects' });
    ps.style.width = 'auto';
    ps.addEventListener('change', (e) => { f.project = e.target.value; paint(); });
    mount(projHolder, ps);
    const actors = [...new Set(rows.map((r) => r.actor).filter(Boolean))].sort();
    mount(actorSel, h('option', { value: '' }, 'Anyone'), actors.map((a) => h('option', { value: a, selected: f.actor === a }, a)));
    const qq = f.q.trim().toLowerCase();
    const list = rows.filter((r) => (f.source === 'all' || r.src === f.source) && (!f.project || r.project === f.project) && (!f.actor || r.actor === f.actor) && (!qq || `${r.text} ${r.actor} ${r.project || ''}`.toLowerCase().includes(qq)));
    if (!list.length) return mount(listEl, h('div.panel', empty('No matching activity', '', 'activity')));
    const out = [];
    let day = '';
    for (const r of list.slice(0, 600)) {
      const d = fmtDate(r.ts, { weekday: 'long', month: 'short', day: 'numeric' });
      if (d !== day) {
        out.push(h('div.caps', { style: 'padding:14px 14px 6px' }, d));
        day = d;
      }
      out.push(h('div.feed-item', { class: 'kind-' + r.kind },
        kindBadge(r.kind),
        h('div',
          h('div.meta', h('b', { style: 'color:var(--text-2)' }, r.actor || '—'), r.project ? projLink(ctx.projects(), r.project) : null, chip(r.src === 'audit' ? r.action.split('.')[0] : r.kind, r.src === 'audit' ? (/secret|vault|grant/.test(r.action) ? 'hot' : 'note') : r.kind), timeEl(r.ts)),
          h('div.t', { style: '-webkit-line-clamp:6' }, r.text))));
    }
    mount(listEl, h('div.panel', out));
  }

  await load();
  paint();
  return poll(() => load().then(paint).catch(() => {}), 30000);
}
