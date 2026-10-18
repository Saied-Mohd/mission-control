// Deck: the agent publishes an HTML deck (encrypted, DOC.deck). It is rendered in a sandboxed iframe
// (allow-scripts only → opaque origin, no access to the app, its storage or keys).
//
// Why not a Blob URL / srcdoc: both inherit the embedding page's CSP (policy container of local-scheme
// documents), so the deck's inline scripts would be blocked by script-src 'self'. Instead the frame loads
// ./deck-frame.html (same server, no CSP of its own) and receives the HTML via postMessage.

import { h, mount, icon, timeEl, empty, fmtDateTime } from '../ui.js';

export async function render(root, ctx) {
  const { store, model, session } = ctx;
  const deck = await store.get(model.DOC.deck, null);
  const local = session.mode === 'local';
  const liveBtn = local ? h('a.btn', { href: './deck/', target: '_blank', rel: 'noopener' }, icon('external', 15), 'Open live deck') : null;

  if (!deck?.html) {
    mount(root,
      h('div.view-head', h('div', h('h1', 'Deck'), h('div.sub', 'The agent’s presentation of the current state of things.')), h('div.actions', liveBtn)),
      h('div.panel', empty('No deck published yet', 'The agent runs `mc deck publish` to encrypt deck/index.html into the data repo.', 'deck')));
    return;
  }

  let frame;
  let onMsg;
  const wrap = h('div.deck-wrap');

  function load() {
    if (onMsg) window.removeEventListener('message', onMsg);
    frame = h('iframe', { sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', title: 'Deck', src: './deck-frame.html', allow: 'fullscreen' });
    onMsg = (e) => {
      if (e.source !== frame.contentWindow) return;
      if (e.data?.type === 'mc-deck-ready') frame.contentWindow.postMessage({ type: 'mc-deck', html: deck.html }, '*');
    };
    window.addEventListener('message', onMsg);
    mount(wrap, frame);
  }

  const fullBtn = h('button.btn', { onclick: () => toggleFull() }, icon('external', 15), 'Full screen');
  function toggleFull(force) {
    const on = force ?? !wrap.classList.contains('full');
    wrap.classList.toggle('full', on);
    fullBtn.lastChild.textContent = on ? 'Exit full screen' : 'Full screen';
    if (on) wrap.appendChild(exitBtn);
    else exitBtn.remove();
  }
  const exitBtn = h('button.btn.btn-sm', { style: 'position:absolute;top:10px;right:10px;z-index:2', onclick: () => toggleFull(false) }, icon('x', 14), 'Exit');
  const onKey = (e) => { if (e.key === 'Escape' && wrap.classList.contains('full')) toggleFull(false); };
  document.addEventListener('keydown', onKey);

  mount(root,
    h('div.view-head',
      h('div', h('h1', 'Deck'), h('div.sub', 'Published ', timeEl(deck.updated), ` · ${fmtDateTime(deck.updated)}`)),
      h('div.actions', h('button.btn', { onclick: load }, icon('refresh', 15), 'Reload'), fullBtn, liveBtn)),
    wrap);
  load();

  return () => {
    if (onMsg) window.removeEventListener('message', onMsg);
    document.removeEventListener('keydown', onKey);
  };
}
