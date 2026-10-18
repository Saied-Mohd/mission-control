// Radar: deadlines, renewals, events + vault expiries, soonest first.

import { h, mount, icon, chip, empty, fail, confirm, fmtDate, field } from '../ui.js';
import { projLink, projectSelect, daysClass, daysText } from './common.js';

const KINDS = ['deadline', 'milestone', 'renewal', 'event', 'reminder'];
let showPast = false;

export async function render(root, ctx) {
  const { store, model, toast } = ctx;
  let feed = [];

  const listEl = h('div');
  const date = h('input.input', { type: 'date', required: true, value: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) });
  const text = h('input.input', { placeholder: 'What is due?', required: true });
  const kind = h('select.input', KINDS.map((k) => h('option', { value: k }, k)));
  const projHolder = h('div');
  const addBtn = h('button.btn.btn-primary', { type: 'submit' }, icon('plus', 15), 'Add');
  const form = h('form.panel.composer', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!text.value.trim() || !date.value) return;
      addBtn.disabled = true;
      try {
        await model.addRadar(store, { date: date.value, text: text.value, kind: kind.value, project: projHolder.querySelector('select')?.value || null });
        await model.audit(store, 'saied', 'radar.add', text.value.trim().slice(0, 80), projHolder.querySelector('select')?.value || null);
        text.value = '';
        await refresh();
        toast('Added to radar', { kind: 'ok' });
      } catch (err) {
        fail(err);
      }
      addBtn.disabled = false;
    },
  }, h('div.form-grid', field('Date', date), field('Kind', kind), field('Project', projHolder)), field('What', text), h('div.row', h('span.spacer'), addBtn));

  const pastToggle = h('label.check', h('input', { type: 'checkbox', checked: showPast, onchange: (e) => { showPast = e.target.checked; paint(); } }), 'Show past');

  mount(root,
    h('div.view-head', h('div', h('h1', 'Radar'), h('div.sub', 'Deadlines, renewals and secret expiries.')), h('div.actions', pastToggle)),
    listEl,
    h('h3.section-title', { style: 'margin:24px 0 10px' }, 'Add to radar'),
    form);

  function paint() {
    mount(projHolder, projectSelect(ctx.projects(), projHolder.querySelector('select')?.value || ''));
    const rows = feed.map((r) => ({ ...r, d: model.daysUntil(r.date) })).filter((r) => showPast || r.d >= -7);
    if (!rows.length) return mount(listEl, h('div.panel', empty('Nothing on the radar', 'Add deadlines below. Vault secrets with an expiry show up automatically.', 'radar')));
    mount(listEl, h('div.panel.list', rows.map((r) => {
      const isVault = String(r.id).startsWith('vault:');
      return h('div.item-row.radar-row',
        h('div.days', { class: daysClass(r.d) }, h('b', String(Math.abs(r.d))), h('span', r.d < 0 ? 'days ago' : r.d === 1 ? 'day' : 'days')),
        h('div.main-col',
          h('div.title', r.text),
          h('div.meta',
            chip(r.kind || 'deadline', isVault ? 'urgent' : r.d <= 3 ? 'hot' : r.d <= 14 ? 'soon' : 'later'),
            h('span', fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })),
            h('span', { class: daysClass(r.d) }, daysText(r.d)),
            r.project ? projLink(ctx.projects(), r.project) : null)),
        h('div.acts', isVault
          ? h('a.btn.btn-sm', { href: '#/vault' }, icon('vault', 14), 'Vault')
          : h('button.icon-btn.sm', { 'aria-label': 'Remove', title: 'Remove', onclick: () => remove(r) }, icon('trash', 15))));
    })));
  }

  async function remove(r) {
    if (!(await confirm(`Remove “${r.text}” from the radar?`, { okLabel: 'Remove', danger: true }))) return;
    try {
      await model.removeRadar(store, r.id);
      await model.audit(store, 'saied', 'radar.remove', r.text.slice(0, 80), r.project);
      await refresh();
    } catch (e) {
      fail(e);
    }
  }

  async function refresh() {
    feed = await model.radarFeed(store);
    paint();
  }

  await refresh();
}
