// Mission Control — boot, session flow, shell, router, global shortcuts.

import * as model from './model.js';
import * as C from './crypto.js';
import * as ui from './ui.js';
import { h, mount, icon, toast, confirm, modal, md } from './ui.js';
import { session } from './session.js';
import * as auth from './views/auth.js';
import { openPalette } from './palette.js';
import { resubscribePush } from './push.js';

const app = document.getElementById('app');

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '#/', key: 'd' },
  { id: 'approvals', label: 'Approvals', icon: 'approvals', href: '#/approvals', key: 'a', badge: 'approvals' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', href: '#/inbox', key: 'i', badge: 'inbox' },
  { id: 'radar', label: 'Radar', icon: 'radar', href: '#/radar', key: 'r' },
  { id: 'vault', label: 'Vault', icon: 'vault', href: '#/vault', key: 'v' },
  { id: 'brain', label: 'Brain', icon: 'brain', href: '#/brain', key: 'b' },
  { id: 'activity', label: 'Activity', icon: 'activity', href: '#/activity', key: 'l' },
  { id: 'deck', label: 'Deck', icon: 'deck', href: '#/deck', key: 'k' },
  { id: 'settings', label: 'Settings', icon: 'settings', href: '#/settings', key: 's' },
];
const TABBAR = ['dashboard', 'approvals', 'inbox', 'vault'];

const VIEWS = {
  dashboard: () => import('./views/dashboard.js'),
  project: () => import('./views/project.js'),
  approvals: () => import('./views/approvals.js'),
  inbox: () => import('./views/inbox.js'),
  radar: () => import('./views/radar.js'),
  vault: () => import('./views/vault.js'),
  activity: () => import('./views/activity.js'),
  deck: () => import('./views/deck.js'),
  settings: () => import('./views/settings.js'),
};

const state = {
  shell: null,
  main: null,
  projects: [],
  counts: { approvals: 0, inbox: 0 },
  cleanups: [],
  routeToken: 0,
  pollTimer: null,
  tickTimer: null,
  busy: 0,
  route: null,
  swUpdateRequested: false,
};

// ---------------- routing ----------------

export function parseRoute(hash = location.hash) {
  const path = (hash || '#/').replace(/^#\/?/, '');
  if (path.startsWith('claim=')) return { name: 'claim', params: {} };
  const parts = path.split('?')[0].split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (!parts.length) return { name: 'dashboard', params: {} };
  if (parts[0] === 'p' && parts[1]) return { name: 'project', params: { slug: parts[1], tab: parts[2] || 'board' } };
  return { name: parts[0], params: { sub: parts[1] || null } };
}

function nav(href) {
  if (!href.startsWith('#')) href = '#/' + href.replace(/^\/+/, '');
  if (location.hash === href) render();
  else location.hash = href;
}

/** Update the hash without re-rendering (e.g. project tabs). */
function setHash(href) {
  history.replaceState(history.state, '', href);
  state.route = parseRoute();
  updateNav();
}

function runCleanups() {
  for (const fn of state.cleanups.splice(0)) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

function makeCtx(route) {
  return {
    // contract for brain.js: { store, model, toast, nav, h, confirm }
    store: session.store,
    model,
    toast,
    nav,
    h,
    confirm,
    modal,
    // extras for the built-in views
    ui,
    icon,
    md,
    crypto: C,
    session,
    mode: session.mode,
    keys: session.keys,
    params: route.params || {},
    route,
    setHash,
    projects: () => state.projects,
    refreshCounts,
    setProjects: (list) => {
      state.projects = list;
      renderSideProjects();
    },
    onCleanup: (fn) => state.cleanups.push(fn),
  };
}

async function render() {
  if (!session.unlocked || !state.main) return;
  const route = parseRoute();
  if (route.name === 'claim') {
    history.replaceState(null, '', location.pathname + location.search + '#/');
    return render();
  }
  state.route = route;
  runCleanups();
  const token = ++state.routeToken;
  updateNav();
  const el = h('div.view', h('div.loading', ui.spinner(), 'Decrypting…'));
  mount(state.main, el);
  window.scrollTo({ top: 0 });
  const ctx = makeCtx(route);
  try {
    let ret;
    if (route.name === 'brain') {
      let mod = null;
      try {
        mod = await import('./views/brain.js');
      } catch (e) {
        console.warn('brain view unavailable', e);
      }
      if (token !== state.routeToken) return;
      if (mod && typeof mod.renderBrain === 'function') ret = await mod.renderBrain(el, ctx);
      else mount(el, h('div.view-head', h('div', h('h1', 'Brain'), h('div.sub', 'Claude’s memory graph'))), h('div.panel', ui.empty('The brain view is not installed yet', 'app/js/views/brain.js will render the memory graph once it ships.', 'brain')));
    } else {
      const loader = VIEWS[route.name];
      if (!loader) {
        mount(el, ui.empty('Nothing here', `No view called “${route.name}”.`, 'question'), h('div.row', { style: 'justify-content:center' }, h('a.btn', { href: '#/' }, 'Back to dashboard')));
        return;
      }
      const mod = await loader();
      if (token !== state.routeToken) return;
      ret = await mod.render(el, ctx);
    }
    if (typeof ret === 'function') {
      if (token !== state.routeToken) ret();
      else state.cleanups.push(ret);
    }
  } catch (e) {
    console.error(e);
    if (token !== state.routeToken) return;
    mount(el, h('div.panel.err-panel', h('h3', 'This view failed to load'), h('pre', String(e?.message || e)), h('button.btn', { onclick: () => render() }, icon('refresh', 16), 'Retry')));
  }
}

// ---------------- shell ----------------

function navLink(item, cls) {
  return h(`a.${cls}`, { href: item.href, dataset: { nav: item.id } }, icon(item.icon, cls === 'nav-item' ? 18 : 22), h('span', item.label), item.badge ? h('span.badge.hidden', { dataset: { badge: item.badge } }) : null);
}

function buildShell() {
  const syncPill = h('span.status-pill.sync.hidden', ui.spinner(10), 'syncing…');
  const offlinePill = h('span.status-pill.offline.hidden', icon('wifiOff', 12), 'offline');
  const syncPill2 = syncPill.cloneNode(true);
  const offlinePill2 = offlinePill.cloneNode(true);
  state.syncPills = [syncPill, syncPill2];
  state.offlinePills = [offlinePill, offlinePill2];

  const sidebar = h('aside.sidebar',
    h('a.brand', { href: '#/' }, h('img', { src: './icons/icon.svg', alt: '' }), h('div', 'Mission Control', h('small', session.mode === 'local' ? 'local · live' : 'github · remote'))),
    h('button.btn.btn-ghost.btn-sm', { style: 'justify-content:flex-start;margin:0 0 10px;color:var(--muted)', onclick: () => palette() }, icon('search', 15), 'Search & commands', h('kbd', { style: 'margin-left:auto' }, navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl K')),
    h('nav.nav', NAV.map((n) => navLink(n, 'nav-item'))),
    h('div.side-section.caps', 'Projects'),
    (state.sideProjects = h('div.side-projects')),
    h('div.side-foot',
      h('div.row.wrap', h('span.status-pill.mode', session.mode === 'local' ? 'local' : 'github'), syncPill, offlinePill),
      h('button.btn.btn-ghost.btn-sm', { style: 'justify-content:flex-start', onclick: () => session.lock('manual') }, icon('lock', 15), 'Lock', h('kbd', { style: 'margin-left:auto' }, 'g x')),
    ),
  );

  const topbar = h('header.topbar',
    h('a.brand', { href: '#/' }, h('img', { src: './icons/icon.svg', alt: '' }), 'Mission Control'),
    h('span.spacer'),
    syncPill2,
    offlinePill2,
    h('button.icon-btn', { 'aria-label': 'Search', onclick: () => palette() }, icon('search')),
    h('button.icon-btn', { 'aria-label': 'Lock', onclick: () => session.lock('manual') }, icon('lock')),
  );

  const tabbar = h('nav.tabbar',
    TABBAR.map((id) => navLink(NAV.find((n) => n.id === id), 'tab')),
    h('button', { dataset: { nav: 'more' }, onclick: () => moreSheet() }, icon('more', 22), h('span', 'More')),
  );

  state.main = h('main.main#main');
  state.shell = h('div.shell', sidebar, h('div.main', topbar, state.main), tabbar);
  mount(app, state.shell);
  renderSideProjects();
  updateNet();
}

function moreSheet() {
  const list = h('div.nav', NAV.filter((n) => !TABBAR.includes(n.id)).map((n) => {
    const a = navLink(n, 'nav-item');
    a.addEventListener('click', () => close && close());
    return a;
  }),
  h('button.nav-item', { style: 'border:0;background:none;width:100%;cursor:pointer', onclick: () => { close && close(); session.lock('manual'); } }, icon('lock', 18), h('span', 'Lock now')));
  let close;
  modal('More', list, [], { noAutofocus: true, onOpen: ({ close: c }) => (close = c) });
  updateCountsUI(list);
}

function updateNav() {
  if (!state.shell) return;
  const r = state.route || parseRoute();
  const id = r.name === 'project' ? null : r.name;
  for (const el of state.shell.querySelectorAll('[data-nav]')) el.classList.toggle('on', el.dataset.nav === id);
  for (const el of state.shell.querySelectorAll('.side-project')) el.classList.toggle('on', r.name === 'project' && el.dataset.slug === r.params.slug);
}

function renderSideProjects() {
  if (!state.sideProjects) return;
  const list = state.projects.filter((p) => p.status !== 'archived');
  mount(state.sideProjects, list.length
    ? list.map((p) => h('a.side-project', { href: `#/p/${encodeURIComponent(p.slug)}`, dataset: { slug: p.slug } },
      h('span.swatch', { style: { background: p.color || 'var(--cyan)' } }),
      h('span.ellipsis', p.name),
      p.open ? h('span.cnt', String(p.open)) : null))
    : h('div.dim', { style: 'padding:0 10px;font-size:12px' }, 'No projects yet'));
  updateNav();
}

function updateCountsUI(root = state.shell) {
  if (!root) return;
  for (const b of root.querySelectorAll('[data-badge]')) {
    const n = state.counts[b.dataset.badge] || 0;
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hidden', !n);
    b.classList.toggle('pulse', b.dataset.badge === 'approvals' && n > 0);
    b.classList.toggle('amber', b.dataset.badge === 'inbox');
  }
}

async function refreshCounts() {
  if (!session.unlocked) return;
  const store = session.store;
  try {
    const [idx, reqs, inbox] = await Promise.all([
      store.get(model.DOC.index, { order: [], projects: {}, activity: [] }),
      store.get(model.DOC.requests, { items: [] }),
      store.get(model.DOC.inbox, { items: [] }),
    ]);
    if (store !== session.store) return;
    state.projects = idx.order.map((s) => idx.projects[s]).filter(Boolean);
    state.counts.approvals = reqs.items.filter((r) => r.status === 'pending').length;
    state.counts.inbox = inbox.items.filter((i) => i.status === 'open' && i.from !== 'saied').length;
    renderSideProjects();
    updateCountsUI();
    setAppBadge(state.counts.approvals + state.counts.inbox);
  } catch (e) {
    console.warn('refresh failed', e);
  }
}

function setAppBadge(n) {
  try {
    if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
    else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch {}
}

function updateNet() {
  const offline = !navigator.onLine;
  for (const p of state.offlinePills || []) p.classList.toggle('hidden', !offline);
  for (const p of state.syncPills || []) p.classList.toggle('hidden', !(state.busy > 0) || offline);
}

let netShowTimer;
window.addEventListener('mc:net', (e) => {
  const busy = e.detail.busy;
  clearTimeout(netShowTimer);
  if (busy > 0) netShowTimer = setTimeout(() => { state.busy = busy; updateNet(); }, 250);
  else { state.busy = 0; updateNet(); }
});
window.addEventListener('online', () => { updateNet(); toast('Back online', { kind: 'ok' }); refreshCounts(); });
window.addEventListener('offline', () => { updateNet(); toast('You are offline — changes will fail until you reconnect', { kind: 'warn' }); });
let authToastAt = 0;
window.addEventListener('mc:auth', () => {
  if (Date.now() - authToastAt < 30000) return;
  authToastAt = Date.now();
  toast('GitHub token rejected — it may have expired.', { kind: 'error', timeout: 10000, action: { label: 'Settings', onClick: () => nav('#/settings') } });
});

// ---------------- palette & shortcuts ----------------

function palette() {
  if (!session.unlocked || ui.isModalOpen()) return;
  openPalette({ projects: state.projects, nav, session, model, toast, refreshCounts, lock: () => session.lock('manual'), help: showHelp });
}

function showHelp() {
  const rows = [
    ['Ctrl/⌘ K', 'Command palette'],
    ['/', 'Search / filter on this page'],
    ['g d', 'Dashboard'],
    ['g a', 'Approvals'],
    ['g i', 'Inbox'],
    ['g r', 'Radar'],
    ['g v', 'Vault'],
    ['g b', 'Brain'],
    ['g l', 'Activity'],
    ['g k', 'Deck'],
    ['g s', 'Settings'],
    ['g x', 'Lock now'],
    ['?', 'This help'],
  ];
  modal('Keyboard shortcuts', h('div.help-grid', rows.flatMap(([k, d]) => [h('div.row', k.split(' ').map((x) => h('kbd', x))), h('div.muted', d)])));
}

let gPending = 0;
function onKey(e) {
  if (!session.unlocked) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palette();
    return;
  }
  const t = e.target;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (ui.isModalOpen()) return;
  if (Date.now() - gPending < 1200) {
    gPending = 0;
    const k = e.key.toLowerCase();
    if (k === 'x') return session.lock('manual');
    const item = NAV.find((n) => n.key === k);
    if (item) {
      e.preventDefault();
      nav(item.href);
    }
    return;
  }
  if (e.key === 'g') {
    gPending = Date.now();
    return;
  }
  if (e.key === '/') {
    const s = state.main?.querySelector('[data-search]');
    e.preventDefault();
    if (s) s.focus();
    else palette();
    return;
  }
  if (e.key === '?') {
    e.preventDefault();
    showHelp();
  }
}
document.addEventListener('keydown', onKey);

// ---------------- activity tracking for auto-lock ----------------

let lastTouch = 0;
const touch = () => {
  const n = Date.now();
  if (n - lastTouch > 5000) {
    lastTouch = n;
    session.touch();
  }
};
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, touch, { passive: true, capture: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    session.checkIdle();
    if (session.unlocked) refreshCounts();
  }
});

// ---------------- service worker ----------------

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version of Mission Control is ready', {
            timeout: 20000,
            action: { label: 'Reload', onClick: () => { state.swUpdateRequested = true; w.postMessage({ type: 'skipWaiting' }); } },
          });
        }
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !state.swUpdateRequested) return;
      reloading = true;
      location.reload();
    });
  } catch (e) {
    console.warn('SW registration failed', e);
  }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'navigate' && d.url) {
      try {
        const u = new URL(d.url, location.href);
        nav(u.hash || '#/');
      } catch {}
      if (session.unlocked) refreshCounts();
    } else if (d.type === 'pushsubscriptionchange') {
      if (session.unlocked) resubscribePush(session).then((ok) => ok && toast('Push subscription renewed', { kind: 'ok' })).catch(() => toast('Push subscription changed — re-enable notifications in Settings', { kind: 'warn' }));
    } else if (d.type === 'push') {
      if (session.unlocked) refreshCounts();
    }
  });
}
// ---------------- session lifecycle ----------------

function startPolling() {
  clearInterval(state.pollTimer);
  clearInterval(state.tickTimer);
  state.pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshCounts();
  }, 60000);
  state.tickTimer = setInterval(() => ui.refreshTimes(state.main || document), 30000);
}

async function startShell() {
  buildShell();
  startPolling();
  await refreshCounts();
  render();
}

async function afterUnlock() {
  if (session.pendingReset) {
    await auth.renderForceReset(app, { session });
  }
  await startShell();
}

function teardown() {
  runCleanups();
  clearInterval(state.pollTimer);
  clearInterval(state.tickTimer);
  state.projects = [];
  state.counts = { approvals: 0, inbox: 0 };
  state.shell = null;
  state.main = null;
  state.sideProjects = null;
  // Close any open modals that might show decrypted content.
  ui.closeAllModals();
}

session.on('lock', async (e) => {
  const reason = e.detail?.reason;
  teardown();
  mount(app);
  if (reason === 'disconnect') return boot();
  showLock(reason);
});

async function showLock(reason) {
  const remembered = await session.isRemembered().catch(() => false);
  auth.renderLock(app, { session, reason, remembered, done: afterUnlock, reconnect: async () => { await session.disconnect(); } });
}

async function boot() {
  mount(app, h('div.boot', h('div', { style: 'display:grid;place-items:center;gap:14px' }, h('div.boot-mark'), h('div.caps', 'Mission Control'))));
  let st;
  try {
    st = await session.init();
  } catch (e) {
    mount(app, h('div.auth', h('div.panel.auth-card', h('h2', 'Could not start'), h('p.muted', String(e?.message || e)), h('button.btn.btn-primary', { onclick: () => boot() }, 'Retry'))));
    return;
  }
  if (st === 'claim') return auth.renderClaim(app, { session, done: startShell });
  if (st === 'connect') return auth.renderConnect(app, { session, done: afterUnlock });
  if (st === 'local-down')
    return auth.renderLocalDown(app, {
      retry: boot,
      useGithub: () => {
        try {
          localStorage.removeItem('mc.mode');
        } catch {}
        auth.renderConnect(app, { session, done: afterUnlock });
      },
    });
  try {
    if (await session.unlockRemembered()) return afterUnlock();
  } catch (e) {
    toast(e.message || String(e), { kind: 'error' });
  }
  showLock();
}

window.addEventListener('hashchange', () => {
  if (session.unlocked && state.main) render();
});

registerSW();
boot();
