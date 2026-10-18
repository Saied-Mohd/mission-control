// Inbox: Saied's directives to the agents and the agents' questions to Saied.

import { h, mount, icon, chip, timeEl, md, empty, fail, modal, field, segmented } from '../ui.js';
import { projLink, projectSelect, poll } from './common.js';

let tabState = 'open';
let whoState = 'all';

export async function render(root, ctx) {
  const { store, model, toast } = ctx;
  let items = [];

  async function load() {
    items = (await store.get(model.DOC.inbox, { items: [] })).items;
  }

  const listEl = h('div');
  const text = h('textarea.input', { rows: 2, placeholder: 'Tell the agents… (a directive they pick up on their next brief)' });
  const projHolder = h('span');
  const sendBtn = h('button.btn.btn-primary', { type: 'submit' }, icon('send', 15), 'Send');
  const composer = h('form.panel.composer', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!text.value.trim()) return text.focus();
      sendBtn.disabled = true;
      try {
        await model.addInbox(store, { from: 'saied', text: text.value, project: projHolder.querySelector('select')?.value || null });
        text.value = '';
        toast('Directive sent', { kind: 'ok' });
        await refresh();
      } catch (err) {
        fail(err);
      }
      sendBtn.disabled = false;
    },
  }, text, h('div.row.wrap', projHolder, h('span.spacer'), sendBtn));
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) composer.requestSubmit(); });

  const tabs = segmented([{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }], tabState, (v) => { tabState = v; paint(); });
  const who = segmented([{ value: 'all', label: 'All' }, { value: 'questions', label: 'From agents' }, { value: 'directives', label: 'My directives' }], whoState, (v) => { whoState = v; paint(); });

  mount(root,
    h('div.view-head', h('div', h('h1', 'Inbox'), h('div.sub', 'Directives for the agents, questions for you.'))),
    composer,
    h('div.row.wrap', { style: 'margin-bottom:12px' }, tabs, who),
    listEl);

  function paint() {
    mount(projHolder, projectSelect(ctx.projects().filter((p) => p.status !== 'archived'), projHolder.querySelector('select')?.value || '', { allLabel: 'Any project' }));
    const rows = items.filter((i) => (tabState === 'open' ? i.status === 'open' : i.status !== 'open'))
      .filter((i) => whoState === 'all' || (whoState === 'directives' ? i.from === 'saied' : i.from !== 'saied'));
    if (!rows.length) return mount(listEl, h('div.panel', empty(tabState === 'open' ? 'Inbox zero' : 'Nothing done yet', '', 'inbox')));
    mount(listEl, h('div.panel.list', rows.map((i) => {
      const mine = i.from === 'saied';
      return h('div.item-row',
        h('span', { style: { color: mine ? 'var(--cyan)' : 'var(--amber)', paddingTop: '2px' } }, icon(mine ? 'send' : 'question', 18)),
        h('div.main-col',
          h('div.meta', { style: 'margin:0 0 4px' },
            h('b', { style: 'color:var(--text-2)' }, mine ? 'You → agents' : `${i.from} asks`),
            chip(mine ? 'directive' : 'question', mine ? 'cool' : 'question'),
            i.project ? projLink(ctx.projects(), i.project) : null,
            timeEl(i.ts)),
          md(i.text),
          i.status !== 'open'
            ? h('div.note-box', { style: 'margin:8px 0 0' },
              h('div.meta', { style: 'margin:0 0 4px' }, icon('check', 12), `done by ${i.doneBy || '?'}`, i.doneAt ? timeEl(i.doneAt) : null),
              i.reply ? md(i.reply) : h('span.muted', 'No reply.'))
            : null),
        i.status === 'open'
          ? h('div.acts',
            h('button.btn.btn-sm.btn-primary', { onclick: () => reply(i) }, mine ? 'Close with note' : 'Reply'),
            h('button.btn.btn-sm', { onclick: () => markDone(i) }, icon('check', 14), 'Done'))
          : null);
    })));
  }

  async function reply(i) {
    const ta = h('textarea.input', { rows: 5, placeholder: 'Your answer — the agent sees it on its next brief' });
    const ok = await modal(i.from === 'saied' ? 'Close directive' : `Reply to ${i.from}`, h('div', h('div.note-box', md(i.text)), field('Reply', ta)), [
      { label: 'Cancel', value: false },
      { label: 'Send & close', kind: 'primary', onClick: async () => {
        if (!ta.value.trim()) { ta.focus(); return false; }
        await model.resolveInbox(store, i.id, 'saied', ta.value.trim());
        return true;
      } },
    ]);
    if (ok) {
      toast('Sent', { kind: 'ok' });
      refresh();
    }
  }

  async function markDone(i) {
    try {
      await model.resolveInbox(store, i.id, 'saied', '');
      refresh();
    } catch (e) {
      fail(e);
    }
  }

  async function refresh() {
    await load();
    paint();
    ctx.refreshCounts();
  }

  await load();
  paint();
  return poll(() => load().then(paint).catch(() => {}), 30000);
}
