// Claude's Brain — a living view of the agent's memory graph.
// Zero dependencies. All user/agent text is rendered through text nodes (never innerHTML).

const CSS = `
.brain-root{--b-bg:var(--bg,#070b14);--b-panel:var(--panel,#0f1626);--b-text:var(--text,#e8eef7);--b-muted:var(--muted,#8a97ad);
  --b-cyan:var(--cyan,#5ee7ff);--b-amber:var(--amber,#ffb547);--b-magenta:var(--magenta,#ff5ea8);--b-green:var(--green,#4cf2a0);
  --b-line:rgba(255,255,255,.08);color:var(--b-text);display:flex;flex-direction:column;gap:12px;min-width:0}
.brain-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
.brain-head h2{margin:0;font-size:1.25rem;letter-spacing:.01em}
.brain-head-stats{color:var(--b-muted);font-size:.9rem}
.brain-head-stats b{color:var(--b-text);font-weight:600}
.brain-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,400px);gap:12px;min-width:0}
.brain-stage{position:relative;height:calc(100vh - 170px);min-height:420px;border-radius:16px;overflow:hidden;border:1px solid var(--b-line);
  background:radial-gradient(ellipse at 50% 45%,rgba(94,231,255,.07),transparent 60%),radial-gradient(ellipse at 80% 90%,rgba(255,94,168,.05),transparent 55%),var(--b-panel)}
.brain-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.brain-canvas.brain-grabbing{cursor:grabbing}
.brain-canvas.brain-pointer{cursor:pointer}
.brain-toolbar{position:absolute;left:10px;right:10px;top:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;z-index:2;pointer-events:none}
.brain-toolbar>*{pointer-events:auto}
.brain-search{flex:1 1 180px;max-width:300px;min-width:140px;background:rgba(7,11,20,.75);border:1px solid var(--b-line);color:var(--b-text);
  border-radius:10px;padding:7px 10px;font:inherit;font-size:.88rem;backdrop-filter:blur(6px)}
.brain-search:focus{outline:none;border-color:var(--b-cyan)}
.brain-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--b-line);background:rgba(7,11,20,.7);color:var(--b-muted);
  border-radius:999px;padding:4px 9px;font:inherit;font-size:.76rem;cursor:pointer;backdrop-filter:blur(6px);user-select:none}
.brain-chip.brain-on{color:var(--b-text);border-color:rgba(255,255,255,.22)}
.brain-chip .brain-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.brain-chip:not(.brain-on) .brain-dot{opacity:.25}
.brain-tip{position:absolute;z-index:3;pointer-events:none;background:rgba(7,11,20,.92);border:1px solid var(--b-line);border-radius:10px;
  padding:6px 9px;font-size:.8rem;max-width:260px;box-shadow:0 6px 24px rgba(0,0,0,.4);display:none}
.brain-tip-t{font-weight:600;margin-bottom:2px;overflow-wrap:anywhere}
.brain-tip-m{color:var(--b-muted);font-size:.74rem}
.brain-hint{position:absolute;left:12px;bottom:10px;color:var(--b-muted);font-size:.72rem;z-index:2;pointer-events:none;opacity:.8}
.brain-match-note{position:absolute;right:12px;bottom:10px;color:var(--b-muted);font-size:.74rem;z-index:2;pointer-events:none}
.brain-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;z-index:1}
.brain-empty-card{max-width:440px;text-align:center}
.brain-empty-orb{width:84px;height:84px;margin:0 auto 14px;border-radius:50%;
  background:radial-gradient(circle at 35% 35%,rgba(94,231,255,.9),rgba(167,139,250,.35) 55%,transparent 72%);
  box-shadow:0 0 60px rgba(94,231,255,.25);animation:brain-pulse 3.2s ease-in-out infinite}
@keyframes brain-pulse{0%,100%{transform:scale(.94);opacity:.8}50%{transform:scale(1.04);opacity:1}}
@media (prefers-reduced-motion:reduce){.brain-empty-orb{animation:none}}
.brain-empty h3{margin:0 0 6px;font-size:1.1rem}
.brain-empty p{color:var(--b-muted);margin:6px 0;font-size:.9rem;line-height:1.45}
.brain-code{display:block;text-align:left;background:rgba(0,0,0,.35);border:1px solid var(--b-line);border-radius:10px;padding:10px 12px;margin-top:10px;
  font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--b-cyan);white-space:pre-wrap;overflow-wrap:anywhere}
.brain-code span{color:var(--b-muted)}
.brain-detail{position:absolute;top:56px;right:10px;bottom:10px;width:340px;max-width:calc(100% - 20px);z-index:4;overflow:auto;
  background:rgba(10,15,27,.94);border:1px solid var(--b-line);border-radius:14px;padding:14px;box-shadow:0 12px 40px rgba(0,0,0,.45);backdrop-filter:blur(8px)}
.brain-detail[hidden]{display:none}
.brain-d-top{display:flex;gap:8px;align-items:flex-start}
.brain-d-title{font-size:1.05rem;font-weight:650;margin:0;flex:1;overflow-wrap:anywhere;line-height:1.3}
.brain-x{background:none;border:0;color:var(--b-muted);font-size:1.3rem;line-height:1;cursor:pointer;padding:2px 6px;border-radius:8px}
.brain-x:hover{color:var(--b-text);background:rgba(255,255,255,.06)}
.brain-type{display:inline-flex;align-items:center;gap:5px;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--b-muted);margin:6px 0 10px}
.brain-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.9rem;line-height:1.5;margin:0 0 10px;color:var(--b-text)}
.brain-body-empty{color:var(--b-muted);font-style:italic}
.brain-tags{display:flex;flex-wrap:wrap;gap:5px;margin:4px 0 8px}
.brain-tag{font-size:.74rem;border-radius:999px;padding:2px 8px;background:rgba(255,255,255,.06);color:var(--b-muted);border:1px solid var(--b-line)}
.brain-tag.brain-proj{color:var(--b-amber);border-color:rgba(255,181,71,.3)}
.brain-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:.8rem;margin:8px 0;align-items:center}
.brain-kv dt{color:var(--b-muted)}
.brain-kv dd{margin:0;min-width:0}
.brain-meter{height:6px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;min-width:60px}
.brain-meter>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--b-magenta),var(--b-amber),var(--b-green))}
.brain-range{width:100%;accent-color:var(--b-cyan)}
.brain-sec-t{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--b-muted);margin:12px 0 6px}
.brain-links{display:flex;flex-direction:column;gap:4px}
.brain-linkbtn{display:flex;align-items:center;gap:7px;text-align:left;width:100%;background:rgba(255,255,255,.03);border:1px solid var(--b-line);
  color:var(--b-text);border-radius:9px;padding:6px 8px;font:inherit;font-size:.82rem;cursor:pointer}
.brain-linkbtn:hover{border-color:rgba(255,255,255,.2)}
.brain-linkbtn span.brain-lt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brain-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.brain-btn{background:rgba(255,255,255,.06);border:1px solid var(--b-line);color:var(--b-text);border-radius:9px;padding:6px 11px;font:inherit;font-size:.82rem;cursor:pointer}
.brain-btn:hover{border-color:rgba(255,255,255,.25)}
.brain-btn:disabled{opacity:.5;cursor:default}
.brain-btn.brain-primary{background:rgba(94,231,255,.14);border-color:rgba(94,231,255,.4);color:var(--b-cyan)}
.brain-btn.brain-danger{background:rgba(255,94,168,.1);border-color:rgba(255,94,168,.35);color:var(--b-magenta)}
.brain-btn.brain-sm{padding:3px 8px;font-size:.75rem}
.brain-form{display:flex;flex-direction:column;gap:8px}
.brain-form label{display:flex;flex-direction:column;gap:3px;font-size:.75rem;color:var(--b-muted)}
.brain-form label.brain-row{flex-direction:row;align-items:center;gap:8px}
.brain-in{background:rgba(0,0,0,.3);border:1px solid var(--b-line);color:var(--b-text);border-radius:9px;padding:7px 9px;font:inherit;font-size:.86rem;width:100%;box-sizing:border-box}
.brain-in:focus{outline:none;border-color:var(--b-cyan)}
textarea.brain-in{resize:vertical;min-height:70px;line-height:1.45}
.brain-side{display:flex;flex-direction:column;min-width:0;max-height:calc(100vh - 170px);min-height:420px;border:1px solid var(--b-line);border-radius:16px;background:var(--b-panel);overflow:hidden}
.brain-tabs{display:flex;gap:2px;padding:6px;border-bottom:1px solid var(--b-line);overflow-x:auto;scrollbar-width:none;flex:none}
.brain-tabs::-webkit-scrollbar{display:none}
.brain-tab{flex:none;background:none;border:0;color:var(--b-muted);font:inherit;font-size:.82rem;padding:7px 10px;border-radius:9px;cursor:pointer;white-space:nowrap}
.brain-tab.brain-on{color:var(--b-text);background:rgba(255,255,255,.07)}
.brain-badge{display:inline-block;min-width:16px;padding:0 5px;margin-left:4px;border-radius:99px;background:rgba(255,94,168,.2);color:var(--b-magenta);font-size:.7rem;text-align:center}
.brain-pane{padding:12px;overflow:auto;flex:1;min-height:0}
.brain-list{display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0}
.brain-item{border:1px solid var(--b-line);border-radius:11px;padding:9px 10px;background:rgba(255,255,255,.02)}
.brain-item-meta{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:.72rem;color:var(--b-muted);margin-bottom:4px}
.brain-item-meta .brain-agent{color:var(--b-cyan)}
.brain-item-meta .brain-p{color:var(--b-amber)}
.brain-item-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.86rem;line-height:1.45}
.brain-item-row{display:flex;align-items:center;gap:8px}
.brain-item-row .brain-grow{flex:1;min-width:0}
.brain-clip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:.86rem;cursor:pointer;background:none;border:0;color:inherit;padding:0;font:inherit;text-align:left;width:100%}
.brain-clip:hover{color:var(--b-cyan)}
.brain-muted{color:var(--b-muted);font-size:.84rem;line-height:1.45}
.brain-stat-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.brain-card{border:1px solid var(--b-line);border-radius:11px;padding:9px;background:rgba(255,255,255,.02)}
.brain-card b{display:block;font-size:1.25rem;font-variant-numeric:tabular-nums}
.brain-card span{font-size:.72rem;color:var(--b-muted)}
.brain-bars{display:flex;flex-direction:column;gap:5px}
.brain-bar{display:grid;grid-template-columns:72px 1fr 30px;gap:8px;align-items:center;font-size:.78rem}
.brain-bar-track{height:8px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden}
.brain-bar-track>i{display:block;height:100%;border-radius:99px}
.brain-bar-n{text-align:right;color:var(--b-muted);font-variant-numeric:tabular-nums}
.brain-hist{display:flex;align-items:flex-end;gap:3px;height:90px;padding-top:4px;border-bottom:1px solid var(--b-line)}
.brain-hist>div{flex:1;border-radius:4px 4px 0 0;min-height:2px;position:relative}
.brain-hist-axis{display:flex;justify-content:space-between;font-size:.68rem;color:var(--b-muted);margin-top:3px}
.brain-modal{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.brain-modal-card{width:100%;max-width:420px;background:var(--b-panel);border:1px solid var(--b-line);border-radius:14px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.brain-modal-card h4{margin:0 0 8px;font-size:1rem}
.brain-picker{display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto;margin-top:8px}
@media (max-width:860px){
  .brain-grid{grid-template-columns:1fr}
  .brain-stage{height:55vh;min-height:300px}
  .brain-side{max-height:none;min-height:0}
  .brain-pane{overflow:visible}
  .brain-detail{position:fixed;left:0;right:0;bottom:0;top:auto;width:auto;max-width:none;max-height:72vh;border-radius:16px 16px 0 0;z-index:60;
    padding:14px 16px calc(16px + env(safe-area-inset-bottom,0px))}
  .brain-detail::before{content:"";display:block;width:40px;height:4px;border-radius:99px;background:rgba(255,255,255,.2);margin:-4px auto 10px}
  .brain-hint{display:none}
  .brain-stat-cards{grid-template-columns:repeat(3,1fr)}
}
`;

const TYPE_FALLBACK = {
  principle: '#5ee7ff', insight: '#ff5ea8', pattern: '#ffb547', fact: '#4cf2a0', idea: '#a78bfa', question: '#f4f6fb',
};
const TYPE_VAR = { principle: '--cyan', insight: '--magenta', pattern: '--amber', fact: '--green' };
const TABS = [
  { id: 'journal', label: 'Journal' },
  { id: 'prune', label: 'Prune queue' },
  { id: 'graveyard', label: 'Graveyard' },
  { id: 'stats', label: 'Stats' },
  { id: 'add', label: 'Add memory' },
];
const TAB_KEY = 'mc.brain.tab';
const HUB_KEY = 'mc.brain.hubs';

// ---------------- small pure helpers (safe in Node) ----------------

export function relTime(iso, at = Date.now()) {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const s = (at - t) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

const fmtDate = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? '—' : new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const splitList = (s) => [...new Set(String(s || '').split(',').map((x) => x.trim()).filter(Boolean))];
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** Undirected unique links among existing nodes. */
export function brainEdges(brain) {
  const ids = new Set(brain.nodes.map((n) => n.id));
  const seen = new Set();
  const out = [];
  for (const n of brain.nodes) {
    for (const l of n.links || []) {
      if (!ids.has(l) || l === n.id) continue;
      const key = n.id < l ? `${n.id}|${l}` : `${l}|${n.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([n.id, l]);
    }
  }
  return out;
}

// Fallback element factory (used if ctx.h is missing; same contract).
function fallbackH(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

// ---------------- force simulation ----------------

const SIM = { repel: 1500, cutoff2: 420 * 420, spring: 0.045, linkLen: 78, hubLen: 105, center: 0.012, damp: 0.8, vmax: 28, alphaMin: 0.004, decay: 0.985 };

function simStep(sim) {
  const N = sim.nodes;
  const a = sim.alpha;
  // 1) positions (velocity Verlet: x += v + ½·a_prev)
  for (const n of N) {
    if (n.fixed) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; continue; }
    n.x += n.vx + 0.5 * n.ax;
    n.y += n.vy + 0.5 * n.ay;
  }
  // 2) new forces
  for (const n of N) { n.nax = -n.x * SIM.center; n.nay = -n.y * SIM.center; }
  for (let i = 0; i < N.length; i++) {
    const p = N[i];
    for (let j = i + 1; j < N.length; j++) {
      const q = N[j];
      let dx = p.x - q.x, dy = p.y - q.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > SIM.cutoff2) continue;
      if (d2 < 0.01) { dx = (Math.random() - 0.5) * 0.5; dy = (Math.random() - 0.5) * 0.5; d2 = dx * dx + dy * dy + 0.01; }
      const d = Math.sqrt(d2);
      let f = SIM.repel / d2;
      const minD = p.r + q.r + 6;
      if (d < minD) f += (minD - d) * 0.6; // collision
      const fx = (dx / d) * f, fy = (dy / d) * f;
      p.nax += fx; p.nay += fy; q.nax -= fx; q.nay -= fy;
    }
  }
  for (const l of sim.links) {
    const s = l.s, t = l.t;
    const dx = t.x - s.x, dy = t.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const f = SIM.spring * (d - (l.hub ? SIM.hubLen : SIM.linkLen)) * (l.hub ? 0.6 : 1);
    const fx = (dx / d) * f, fy = (dy / d) * f;
    s.nax += fx; s.nay += fy; t.nax -= fx; t.nay -= fy;
  }
  // 3) velocities: v = (v + ½(a_prev + a_new)) · damping
  for (const n of N) {
    const nax = n.nax * a, nay = n.nay * a;
    if (!n.fixed) {
      n.vx = (n.vx + 0.5 * (n.ax + nax)) * SIM.damp;
      n.vy = (n.vy + 0.5 * (n.ay + nay)) * SIM.damp;
      const v = Math.hypot(n.vx, n.vy);
      if (v > SIM.vmax) { n.vx *= SIM.vmax / v; n.vy *= SIM.vmax / v; }
    }
    n.ax = nax; n.ay = nay;
  }
  sim.alpha += (sim.alphaTarget - sim.alpha) * (1 - SIM.decay);
}

// ---------------- the view ----------------

export async function renderBrain(root, ctx) {
  const { store, model } = ctx;
  const toast = ctx.toast || (() => {});
  const h0 = typeof ctx.h === 'function' ? ctx.h : fallbackH;
  // h with an extra `props` attr for live DOM properties (value, checked, …).
  const h = (tag, attrs, ...kids) => {
    const { props, ...rest } = attrs || {};
    const el = h0(tag, rest, ...kids);
    if (props) Object.assign(el, props);
    return el;
  };
  const confirmFn = ctx.confirm || (async (m) => window.confirm(m));

  if (!document.getElementById('brain-css')) {
    const st = document.createElement('style');
    st.id = 'brain-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const cs = getComputedStyle(document.documentElement);
  const typeColor = {};
  for (const t of model.BRAIN_TYPES) typeColor[t] = (TYPE_VAR[t] && cs.getPropertyValue(TYPE_VAR[t]).trim()) || TYPE_FALLBACK[t] || '#cbd5e1';
  const colorOf = (t) => typeColor[t] || '#cbd5e1';
  const mutedColor = cs.getPropertyValue('--muted').trim() || '#8a97ad';

  // ---------- state ----------
  let brain = model.emptyBrain();
  const state = {
    selected: null,
    hover: null,
    query: '',
    matches: null, // Set of ids or null
    types: new Set(model.BRAIN_TYPES),
    hubs: lsGet(HUB_KEY, '0') === '1',
    tab: TABS.some((t) => t.id === lsGet(TAB_KEY, 'journal')) ? lsGet(TAB_KEY, 'journal') : 'journal',
    editing: false,
  };
  let knownProjects = [];
  try {
    const idx = await store.get(model.DOC.index, { order: [], projects: {} });
    knownProjects = (idx && (idx.order || Object.keys(idx.projects || {}))) || [];
  } catch { /* offline / locked: fine */ }

  const byId = (id) => brain.nodes.find((n) => n.id === id);
  const strengthOf = (n) => { try { return model.strength(n); } catch { return 0.5; } };

  async function load() {
    try {
      const b = await store.get(model.DOC.brain, model.emptyBrain());
      brain = { ...model.emptyBrain(), ...(b || {}) };
      brain.nodes = Array.isArray(brain.nodes) ? brain.nodes : [];
      brain.journal = Array.isArray(brain.journal) ? brain.journal : [];
      brain.pruned = Array.isArray(brain.pruned) ? brain.pruned : [];
    } catch (e) {
      toast(`Could not load brain: ${e.message}`, 'error');
    }
  }

  async function act(fn, okMsg) {
    try {
      const r = await fn();
      if (okMsg) toast(okMsg, 'ok');
      await refresh();
      return r;
    } catch (e) {
      toast(e.message || String(e), 'error');
      await refresh();
      return undefined;
    }
  }
  const auditLog = async (action, target) => {
    try { if (model.audit) await model.audit(store, 'saied', action, target); } catch { /* best effort */ }
  };

  // ---------- modal (text prompt / picker host) ----------
  function modal(title, buildBody) {
    return new Promise((resolve) => {
      let done = false;
      const close = (v) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(v);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
      const card = h('div', { class: 'brain-modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h4', {}, title));
      const overlay = h('div', { class: 'brain-modal', onclick: (e) => { if (e.target === overlay) close(null); } }, card);
      buildBody(card, close);
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      const f = card.querySelector('input,textarea');
      if (f) setTimeout(() => f.focus(), 30);
    });
  }
  const askText = (title, placeholder = '', okLabel = 'OK') => modal(title, (card, close) => {
    const ta = h('textarea', { class: 'brain-in', rows: '3', placeholder });
    const ok = () => { const v = ta.value.trim(); if (v) close(v); else ta.focus(); };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ok(); });
    card.append(ta, h('div', { class: 'brain-actions' },
      h('button', { class: 'brain-btn brain-primary', type: 'button', onclick: ok }, okLabel),
      h('button', { class: 'brain-btn', type: 'button', onclick: () => close(null) }, 'Cancel')));
  });

  async function pruneFlow(n) {
    const reason = await askText(`Prune "${clip(n.title, 60)}"?`, 'Why forget this? (stored in the graveyard)', 'Prune');
    if (!reason) return;
    if (state.selected === n.id) state.selected = null;
    await act(async () => {
      await model.brainPrune(store, n.id, reason, 'saied');
      await auditLog('brain.prune', n.title);
    }, 'Memory pruned');
  }

  async function linkFlow(n) {
    const other = await modal(`Link "${clip(n.title, 50)}" to…`, (card, close) => {
      const input = h('input', { class: 'brain-in', type: 'search', placeholder: 'Search memories…' });
      const list = h('div', { class: 'brain-picker' });
      const draw = () => {
        const q = input.value.trim();
        const linked = new Set(n.links || []);
        let cands = brain.nodes.filter((x) => x.id !== n.id && !linked.has(x.id));
        if (q) {
          const hits = new Set(model.recall(brain, q, { limit: 60 }).map((x) => x.id));
          const ql = q.toLowerCase();
          cands = cands.filter((x) => hits.has(x.id) || String(x.title).toLowerCase().includes(ql));
        } else {
          cands.sort((p, r) => strengthOf(r) - strengthOf(p));
        }
        list.replaceChildren(...(cands.length ? cands.slice(0, 40).map((x) => h('button', {
          class: 'brain-linkbtn', type: 'button', onclick: () => close(x.id),
        }, h('i', { class: 'brain-dot', style: `width:8px;height:8px;border-radius:50%;flex:none;background:${colorOf(x.type)}` }),
        h('span', { class: 'brain-lt' }, x.title || '(untitled)'))) : [h('div', { class: 'brain-muted' }, 'Nothing to link.')]));
      };
      input.addEventListener('input', draw);
      card.append(input, list, h('div', { class: 'brain-actions' }, h('button', { class: 'brain-btn', type: 'button', onclick: () => close(null) }, 'Cancel')));
      draw();
    });
    if (!other) return;
    await act(() => model.brainLink(store, n.id, other), 'Linked');
  }

  // ---------- skeleton ----------
  const headStats = h('span', { class: 'brain-head-stats' });
  const head = h('div', { class: 'brain-head' }, h('h2', {}, 'Claude’s brain'), headStats);

  const canvas = h('canvas', { class: 'brain-canvas', 'aria-label': 'Memory graph' });
  const tip = h('div', { class: 'brain-tip', role: 'tooltip' });
  const search = h('input', { class: 'brain-search', type: 'search', placeholder: 'Search memories…', 'aria-label': 'Search memories' });
  const chipsWrap = h('div', { style: 'display:contents' });
  const hubChip = h('button', { class: 'brain-chip', type: 'button', title: 'Show project hubs' }, '◎ projects');
  const fitBtn = h('button', { class: 'brain-chip brain-on', type: 'button', title: 'Fit graph to view' }, '⤢ fit');
  const toolbar = h('div', { class: 'brain-toolbar' }, search, chipsWrap, hubChip, fitBtn);
  const emptyLayer = h('div', { class: 'brain-empty', hidden: '' });
  const matchNote = h('div', { class: 'brain-match-note' });
  const hint = h('div', { class: 'brain-hint' }, 'drag to pan · scroll/pinch to zoom · click a memory');
  const detail = h('aside', { class: 'brain-detail', hidden: '', 'aria-label': 'Memory detail' });
  const stage = h('section', { class: 'brain-stage' }, canvas, toolbar, emptyLayer, tip, hint, matchNote, detail);

  const tabsBar = h('div', { class: 'brain-tabs', role: 'tablist' });
  const pane = h('div', { class: 'brain-pane', role: 'tabpanel' });
  const side = h('section', { class: 'brain-side' }, tabsBar, pane);

  const view = h('div', { class: 'brain-root' }, head, h('div', { class: 'brain-grid' }, stage, side));
  root.replaceChildren(view);

  // ---------- graph engine ----------
  const g = canvas.getContext('2d');
  const sim = { nodes: [], links: [], alpha: 0, alphaTarget: 0 };
  const simById = new Map();
  const cam = { k: 1, tx: 0, ty: 0 };
  let W = 0, H = 0, dpr = 1, raf = 0, destroyed = false, userMoved = false, fittedOnce = false;
  let drag = null; // {kind:'node'|'pan'|'pinch', ...}
  const pointers = new Map();

  function rebuildGraph() {
    const keep = new Map(simById);
    simById.clear();
    const nodes = [];
    const visible = brain.nodes.filter((n) => state.types.has(n.type));
    let i = 0;
    const place = (id, near) => {
      const old = keep.get(id);
      if (old) return { x: old.x, y: old.y, vx: old.vx, vy: old.vy };
      if (near) return { x: near.x + (Math.random() - 0.5) * 40, y: near.y + (Math.random() - 0.5) * 40, vx: 0, vy: 0 };
      const ang = i * 2.39996, rad = 14 * Math.sqrt(i + 1);
      i++;
      return { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, vx: 0, vy: 0 };
    };
    for (const n of visible) {
      const s = strengthOf(n);
      const near = (n.links || []).map((l) => keep.get(l)).find(Boolean);
      const sn = { id: n.id, mem: n, s, r: 6 + 10 * s, color: colorOf(n.type), ax: 0, ay: 0, ...place(n.id, near) };
      if (!Number.isFinite(sn.x) || !Number.isFinite(sn.y)) { sn.x = 0; sn.y = 0; }
      nodes.push(sn);
      simById.set(n.id, sn);
    }
    const links = [];
    for (const [a, b] of brainEdges(brain)) {
      const s = simById.get(a), t = simById.get(b);
      if (s && t) links.push({ s, t, hub: false });
    }
    if (state.hubs) {
      const projs = new Map();
      for (const sn of nodes) for (const p of sn.mem.projects || []) {
        if (!projs.has(p)) projs.set(p, []);
        projs.get(p).push(sn);
      }
      for (const [p, members] of projs) {
        const id = `hub:${p}`;
        const cx = members.reduce((a2, m) => a2 + m.x, 0) / members.length;
        const cy = members.reduce((a2, m) => a2 + m.y, 0) / members.length;
        const old = keep.get(id);
        const hub = { id, hub: true, label: p, s: 1, r: 11, color: mutedColor, ax: 0, ay: 0,
          x: old ? old.x : cx + 1, y: old ? old.y : cy + 1, vx: old ? old.vx : 0, vy: old ? old.vy : 0 };
        nodes.push(hub);
        simById.set(id, hub);
        for (const m of members) links.push({ s: hub, t: m, hub: true });
      }
    }
    sim.nodes = nodes;
    sim.links = links;
    if (state.selected && !byId(state.selected)) closeDetail();
    kick(keep.size ? 0.5 : 1);
  }

  function neighbors(id) {
    const out = new Set();
    for (const l of sim.links) {
      if (l.s.id === id) out.add(l.t.id);
      else if (l.t.id === id) out.add(l.s.id);
    }
    return out;
  }

  function settleSync(maxTicks = 500) {
    let t = 0;
    while (sim.alpha > SIM.alphaMin && t++ < maxTicks) simStep(sim);
    sim.alpha = 0;
  }

  function kick(alpha) {
    sim.alpha = Math.max(sim.alpha, alpha);
    if (reduced && !drag) {
      settleSync();
      if (!userMoved) fit(false);
      draw();
    } else schedule();
  }

  function schedule() {
    if (!raf && !destroyed) raf = requestAnimationFrame(frame);
  }
  function requestDraw() { schedule(); }

  function frame() {
    raf = 0;
    if (destroyed) return;
    if (!canvas.isConnected) { destroy(); return; }
    const running = sim.alpha > SIM.alphaMin || sim.alphaTarget > 0;
    if (running && !(reduced && drag)) { simStep(sim); simStep(sim); }
    if (!running && !fittedOnce && !userMoved && sim.nodes.length) { fittedOnce = true; fit(true); }
    draw();
    if (sim.alpha > SIM.alphaMin || sim.alphaTarget > 0) schedule();
    else if (sim.alpha) sim.alpha = 0;
  }

  function fit(soft) {
    if (!sim.nodes.length || !W || !H) { cam.k = 1; cam.tx = W / 2; cam.ty = H / 2; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of sim.nodes) {
      x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r);
      x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r);
    }
    const pad = 60;
    const k = Math.max(0.2, Math.min(2.2, Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2 - 40) / Math.max(1, y1 - y0))));
    cam.k = soft ? Math.min(cam.k || k, k) : k;
    cam.tx = W / 2 - ((x0 + x1) / 2) * cam.k;
    cam.ty = H / 2 + 20 - ((y0 + y1) / 2) * cam.k;
  }

  function centerOn(id) {
    const n = simById.get(id);
    if (!n || !W) return;
    userMoved = true;
    const offX = W > 860 && !detail.hidden ? -170 : 0;
    cam.tx = W / 2 + offX - n.x * cam.k;
    cam.ty = (W <= 860 ? H * 0.4 : H / 2) - n.y * cam.k;
    requestDraw();
  }

  const toWorld = (sx, sy) => ({ x: (sx - cam.tx) / cam.k, y: (sy - cam.ty) / cam.k });

  function hit(sx, sy) {
    const p = toWorld(sx, sy);
    const slop = 4 / cam.k;
    for (let i = sim.nodes.length - 1; i >= 0; i--) {
      const n = sim.nodes[i];
      if (n.dim) continue;
      const dx = n.x - p.x, dy = n.y - p.y;
      if (dx * dx + dy * dy <= (n.r + slop + 3) ** 2) return n;
    }
    return null;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
    if (W && H) { cam.tx += (nw - W) / 2; cam.ty += (nh - H) / 2; } else { cam.tx = nw / 2; cam.ty = nh / 2; }
    W = nw; H = nh;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    draw();
  }

  function draw() {
    if (!W || !H) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!sim.nodes.length) return;
    const focus = state.hover?.id || state.selected;
    const nb = focus ? neighbors(focus) : null;
    const m = state.matches;
    for (const n of sim.nodes) n.dim = !!(m && !n.hub && !m.has(n.id));

    g.save();
    g.translate(cam.tx, cam.ty);
    g.scale(cam.k, cam.k);

    // links
    g.lineCap = 'round';
    for (const l of sim.links) {
      const hot = focus && (l.s.id === focus || l.t.id === focus);
      const dim = l.s.dim || l.t.dim;
      g.globalAlpha = hot ? 0.85 : dim ? 0.04 : l.hub ? 0.12 : 0.22 * Math.min(l.s.s, l.t.s) + 0.08;
      g.strokeStyle = hot ? (l.s.id === focus ? l.t.color : l.s.color) : l.hub ? mutedColor : '#c7d2fe';
      g.lineWidth = (hot ? 1.8 : 1) / Math.sqrt(cam.k);
      if (l.hub) g.setLineDash([3 / cam.k, 4 / cam.k]);
      g.beginPath(); g.moveTo(l.s.x, l.s.y); g.lineTo(l.t.x, l.t.y); g.stroke();
      if (l.hub) g.setLineDash([]);
    }

    // nodes
    const glow = sim.nodes.length < 220;
    for (const n of sim.nodes) {
      const isSel = n.id === state.selected, isHov = n.id === state.hover?.id;
      const faded = focus && !isSel && !isHov && !nb.has(n.id) && n.id !== focus;
      let alpha = n.hub ? 0.9 : 0.18 + 0.82 * n.s;
      if (n.dim) alpha = 0.06;
      else if (faded) alpha *= 0.35;
      g.globalAlpha = alpha;
      if (n.hub) {
        g.fillStyle = 'rgba(10,15,27,.9)';
        g.strokeStyle = mutedColor;
        g.lineWidth = 1.5 / cam.k;
        g.beginPath(); g.arc(n.x, n.y, n.r, 0, Math.PI * 2); g.fill(); g.stroke();
        g.beginPath(); g.arc(n.x, n.y, n.r * 0.35, 0, Math.PI * 2); g.fillStyle = mutedColor; g.fill();
        continue;
      }
      if (glow && !n.dim) { g.shadowColor = n.color; g.shadowBlur = 4 + 14 * n.s; }
      g.fillStyle = n.color;
      g.beginPath(); g.arc(n.x, n.y, n.r, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
      if (n.s < 0.25 && !n.dim) { // fading out: dashed halo
        g.globalAlpha = 0.35;
        g.strokeStyle = n.color;
        g.lineWidth = 1 / cam.k;
        g.setLineDash([2 / cam.k, 3 / cam.k]);
        g.beginPath(); g.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
      }
      if (n.mem.pinned) {
        g.globalAlpha = n.dim ? 0.1 : 0.9;
        g.strokeStyle = n.color;
        g.lineWidth = 1.6 / cam.k;
        g.beginPath(); g.arc(n.x, n.y, n.r + 3.5, 0, Math.PI * 2); g.stroke();
      }
      if (isSel || isHov) {
        g.globalAlpha = 1;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2 / cam.k;
        g.beginPath(); g.arc(n.x, n.y, n.r + (n.mem.pinned ? 7 : 4.5), 0, Math.PI * 2); g.stroke();
      }
    }

    // labels (screen-size text)
    g.shadowBlur = 0;
    const fs = 11 / cam.k;
    g.font = `500 ${fs}px system-ui,-apple-system,Segoe UI,sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const n of sim.nodes) {
      const isFocus = n.id === state.selected || n.id === state.hover?.id;
      const show = n.hub || isFocus || (m && !n.dim) || (cam.k > 1.35 && !n.dim) || (focus && nb.has(n.id) && !n.dim);
      if (!show) continue;
      const label = n.hub ? n.label : clip(n.mem.title || '', isFocus ? 48 : 26);
      g.globalAlpha = n.dim ? 0.15 : isFocus ? 1 : 0.8;
      g.lineWidth = 3 / cam.k;
      g.strokeStyle = 'rgba(7,11,20,.85)';
      g.strokeText(label, n.x, n.y + n.r + 4 / cam.k);
      g.fillStyle = n.hub ? (TYPE_FALLBACK.pattern) : '#e8eef7';
      g.fillText(label, n.x, n.y + n.r + 4 / cam.k);
    }
    g.restore();
    g.globalAlpha = 1;
  }

  // ---------- interactions ----------
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function showTip(n, p) {
    if (!n || n.hub && !n.label) { tip.style.display = 'none'; return; }
    if (n.hub) {
      tip.replaceChildren(h('div', { class: 'brain-tip-t' }, n.label), h('div', { class: 'brain-tip-m' }, 'project hub'));
    } else {
      tip.replaceChildren(
        h('div', { class: 'brain-tip-t' }, n.mem.title || '(untitled)'),
        h('div', { class: 'brain-tip-m' }, `${n.mem.type} · strength ${pct(n.s)}${n.mem.pinned ? ' · pinned' : ''}`));
    }
    tip.style.display = 'block';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = p.x + 14, y = p.y + 14;
    if (x + tw > W - 6) x = p.x - tw - 14;
    if (y + th > H - 6) y = p.y - th - 14;
    tip.style.left = `${Math.max(6, x)}px`;
    tip.style.top = `${Math.max(6, y)}px`;
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    pointers.set(e.pointerId, p);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    tip.style.display = 'none';
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (drag?.kind === 'node') { drag.node.fixed = false; sim.alphaTarget = 0; }
      drag = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: cam.k, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, tx0: cam.tx, ty0: cam.ty, moved: true };
      return;
    }
    if (pointers.size > 2) return;
    const n = hit(p.x, p.y);
    if (n) {
      const w = toWorld(p.x, p.y);
      drag = { kind: 'node', node: n, start: p, ox: n.x - w.x, oy: n.y - w.y, moved: false };
    } else {
      drag = { kind: 'pan', start: p, tx0: cam.tx, ty0: cam.ty, moved: false };
    }
    canvas.classList.add('brain-grabbing');
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (!drag) {
      if (e.pointerType === 'touch') return;
      const n = hit(p.x, p.y);
      if ((n?.id || null) !== (state.hover?.id || null)) { state.hover = n; requestDraw(); }
      canvas.classList.toggle('brain-pointer', !!n);
      showTip(n, p);
      return;
    }
    if (drag.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = Math.max(0.15, Math.min(5, drag.k0 * (d / drag.d0)));
      const wx = (drag.mid0.x - drag.tx0) / drag.k0, wy = (drag.mid0.y - drag.ty0) / drag.k0;
      cam.k = k; cam.tx = mid.x - wx * k; cam.ty = mid.y - wy * k;
      userMoved = true;
      requestDraw();
      return;
    }
    const dist = Math.hypot(p.x - drag.start.x, p.y - drag.start.y);
    if (!drag.moved && dist < 4) return;
    drag.moved = true;
    if (drag.kind === 'pan') {
      cam.tx = drag.tx0 + (p.x - drag.start.x);
      cam.ty = drag.ty0 + (p.y - drag.start.y);
      userMoved = true;
      requestDraw();
    } else if (drag.kind === 'node') {
      const w = toWorld(p.x, p.y);
      const n = drag.node;
      n.fixed = true; n.fx = w.x + drag.ox; n.fy = w.y + drag.oy;
      n.x = n.fx; n.y = n.fy;
      if (!reduced) { sim.alphaTarget = 0.25; sim.alpha = Math.max(sim.alpha, 0.25); }
      requestDraw();
    }
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    canvas.classList.remove('brain-grabbing');
    if (!drag) return;
    if (drag.kind === 'pinch') {
      if (pointers.size === 0) drag = null;
      else {
        const [rest] = [...pointers.values()];
        drag = { kind: 'pan', start: rest, tx0: cam.tx, ty0: cam.ty, moved: true };
      }
      return;
    }
    const d = drag;
    drag = null;
    if (d.kind === 'node') {
      d.node.fixed = false;
      sim.alphaTarget = 0;
      if (d.moved) { kick(0.3); return; }
      if (e.type === 'pointerup') {
        if (d.node.hub) { search.value = d.node.label; onSearch(); } else select(d.node.id);
      }
    } else if (d.kind === 'pan' && !d.moved && e.type === 'pointerup') {
      if (state.selected) closeDetail();
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch' && !drag) { state.hover = null; tip.style.display = 'none'; requestDraw(); }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
    const k = Math.max(0.15, Math.min(5, cam.k * f));
    const w = toWorld(p.x, p.y);
    cam.k = k; cam.tx = p.x - w.x * k; cam.ty = p.y - w.y * k;
    userMoved = true;
    requestDraw();
  }, { passive: false });

  fitBtn.addEventListener('click', () => { fit(false); userMoved = true; requestDraw(); });
  hubChip.addEventListener('click', () => {
    state.hubs = !state.hubs;
    lsSet(HUB_KEY, state.hubs ? '1' : '0');
    hubChip.classList.toggle('brain-on', state.hubs);
    rebuildGraph();
  });
  hubChip.classList.toggle('brain-on', state.hubs);

  function renderChips() {
    chipsWrap.replaceChildren(...model.BRAIN_TYPES.map((t) => {
      const count = brain.nodes.filter((n) => n.type === t).length;
      const chip = h('button', {
        class: `brain-chip${state.types.has(t) ? ' brain-on' : ''}`, type: 'button', title: `Toggle ${t}`,
        onclick: () => {
          if (state.types.has(t)) state.types.delete(t); else state.types.add(t);
          renderChips();
          rebuildGraph();
        },
      }, h('i', { class: 'brain-dot', style: `background:${colorOf(t)}` }), `${t} ${count}`);
      return chip;
    }));
  }

  let searchTimer = 0;
  function onSearch() {
    const q = search.value.trim();
    state.query = q;
    if (!q) { state.matches = null; matchNote.textContent = ''; requestDraw(); return; }
    const ids = new Set();
    try { for (const n of model.recall(brain, q, { limit: 200 })) ids.add(n.id); } catch { /* ignore */ }
    const ql = q.toLowerCase();
    for (const n of brain.nodes) {
      if (String(n.title || '').toLowerCase().includes(ql) || (n.tags || []).some((t) => String(t).toLowerCase() === ql)
        || (n.projects || []).some((p) => String(p).toLowerCase() === ql)) ids.add(n.id);
    }
    state.matches = ids;
    matchNote.textContent = ids.size ? `${ids.size} match${ids.size === 1 ? '' : 'es'}` : 'no matches';
    requestDraw();
  }
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(onSearch, 120); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; onSearch(); }
    if (e.key === 'Enter' && state.matches && state.matches.size) {
      const first = [...state.matches].map((id) => simById.get(id)).find(Boolean);
      if (first) { select(first.id); centerOn(first.id); }
    }
  });

  // ---------- detail panel ----------
  function select(id) {
    state.selected = id;
    state.editing = false;
    renderDetail();
    requestDraw();
  }
  function closeDetail() {
    state.selected = null;
    state.editing = false;
    detail.hidden = true;
    detail.replaceChildren();
    requestDraw();
  }
  const selectAndCenter = (id) => {
    const m = byId(id);
    if (!m) return;
    if (!state.types.has(m.type)) { state.types.add(m.type); renderChips(); rebuildGraph(); }
    select(id);
    centerOn(id);
    if (window.innerWidth <= 860) stage.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  function memButton(n, extra) {
    return h('button', { class: 'brain-linkbtn', type: 'button', onclick: () => selectAndCenter(n.id) },
      h('i', { style: `width:8px;height:8px;border-radius:50%;flex:none;background:${colorOf(n.type)};opacity:${0.3 + 0.7 * strengthOf(n)}` }),
      h('span', { class: 'brain-lt' }, n.title || '(untitled)'),
      extra ? h('span', { class: 'brain-muted', style: 'font-size:.72rem' }, extra) : null);
  }

  function renderDetail() {
    const n = byId(state.selected);
    if (!n) { closeDetail(); return; }
    detail.hidden = false;
    detail.scrollTop = 0;
    if (state.editing) { renderEdit(n); return; }
    const s = strengthOf(n);
    const confLabel = h('span', { class: 'brain-muted', style: 'font-size:.78rem' }, pct(n.confidence ?? 0.6));
    const conf = h('input', {
      class: 'brain-range', type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Confidence',
      props: { value: String(n.confidence ?? 0.6) },
      oninput: (e) => { confLabel.textContent = pct(Number(e.target.value)); },
      onchange: (e) => act(() => model.brainUpdate(store, n.id, { confidence: Number(e.target.value) }), 'Confidence saved'),
    });
    const linked = (n.links || []).map(byId).filter(Boolean);
    detail.replaceChildren(
      h('div', { class: 'brain-d-top' },
        h('h3', { class: 'brain-d-title' }, n.title || '(untitled)'),
        h('button', { class: 'brain-x', type: 'button', 'aria-label': 'Close', onclick: closeDetail }, '×')),
      h('div', { class: 'brain-type' }, h('i', { style: `width:9px;height:9px;border-radius:50%;background:${colorOf(n.type)}` }),
        n.type, n.pinned ? ' · pinned' : '', n.source ? ` · by ${n.source}` : '', n.status ? ` · ${n.status}` : ''),
      n.body ? h('p', { class: 'brain-body' }, n.body) : h('p', { class: 'brain-body brain-body-empty' }, 'No body.'),
      (n.tags?.length || n.projects?.length) ? h('div', { class: 'brain-tags' },
        (n.projects || []).map((p) => h('span', { class: 'brain-tag brain-proj' }, p)),
        (n.tags || []).map((t) => h('span', { class: 'brain-tag' }, `#${t}`))) : null,
      h('dl', { class: 'brain-kv' },
        h('dt', {}, 'Strength'), h('dd', { style: 'display:flex;gap:8px;align-items:center' },
          h('div', { class: 'brain-meter', style: 'flex:1' }, h('i', { style: `width:${Math.round(s * 100)}%` })), h('span', {}, pct(s))),
        h('dt', {}, 'Confidence'), h('dd', { style: 'display:flex;gap:8px;align-items:center' }, conf, confLabel),
        h('dt', {}, 'Uses'), h('dd', {}, String(n.uses || 0)),
        h('dt', {}, 'Created'), h('dd', { title: fmtDate(n.created) }, relTime(n.created)),
        h('dt', {}, 'Touched'), h('dd', { title: fmtDate(n.touched) }, relTime(n.touched))),
      h('div', { class: 'brain-sec-t' }, `Linked memories (${linked.length})`),
      linked.length ? h('div', { class: 'brain-links' }, linked.map((x) => memButton(x, pct(strengthOf(x)))))
        : h('div', { class: 'brain-muted' }, 'Not linked to anything yet.'),
      h('div', { class: 'brain-actions' },
        h('button', { class: 'brain-btn', type: 'button', onclick: () => act(() => model.brainUpdate(store, n.id, { pinned: !n.pinned }), n.pinned ? 'Unpinned' : 'Pinned') }, n.pinned ? 'Unpin' : 'Pin'),
        h('button', { class: 'brain-btn', type: 'button', onclick: () => { state.editing = true; renderDetail(); } }, 'Edit'),
        h('button', { class: 'brain-btn', type: 'button', onclick: () => linkFlow(n) }, 'Link to…'),
        h('button', { class: 'brain-btn brain-danger', type: 'button', onclick: () => pruneFlow(n) }, 'Prune…')),
    );
  }

  function typeSelect(value) {
    return h('select', { class: 'brain-in', props: { value } },
      model.BRAIN_TYPES.map((t) => h('option', { value: t, ...(t === value ? { selected: '' } : {}) }, t)));
  }

  function renderEdit(n) {
    const title = h('input', { class: 'brain-in', type: 'text', props: { value: n.title || '' } });
    const type = typeSelect(n.type);
    type.value = n.type;
    const body = h('textarea', { class: 'brain-in', rows: '6', props: { value: n.body || '' } });
    const tags = h('input', { class: 'brain-in', type: 'text', placeholder: 'comma, separated', props: { value: (n.tags || []).join(', ') } });
    const projects = h('input', { class: 'brain-in', type: 'text', placeholder: 'project slugs', list: 'brain-projects', props: { value: (n.projects || []).join(', ') } });
    const save = async () => {
      if (!title.value.trim()) { toast('Title is required', 'error'); title.focus(); return; }
      state.editing = false;
      await act(() => model.brainUpdate(store, n.id, {
        title: title.value.trim(), body: body.value, type: type.value, tags: splitList(tags.value), projects: splitList(projects.value),
      }), 'Memory saved');
    };
    detail.replaceChildren(
      h('div', { class: 'brain-d-top' }, h('h3', { class: 'brain-d-title' }, 'Edit memory'),
        h('button', { class: 'brain-x', type: 'button', 'aria-label': 'Cancel', onclick: () => { state.editing = false; renderDetail(); } }, '×')),
      h('div', { class: 'brain-form', style: 'margin-top:10px' },
        h('label', {}, 'Title', title), h('label', {}, 'Type', type), h('label', {}, 'Body', body),
        h('label', {}, 'Tags', tags), h('label', {}, 'Projects', projects), projectList(),
        h('div', { class: 'brain-actions' },
          h('button', { class: 'brain-btn brain-primary', type: 'button', onclick: save }, 'Save'),
          h('button', { class: 'brain-btn', type: 'button', onclick: () => { state.editing = false; renderDetail(); } }, 'Cancel'))),
    );
    title.focus();
  }

  function allProjects() {
    const set = new Set(knownProjects);
    for (const n of brain.nodes) for (const p of n.projects || []) set.add(p);
    for (const j of brain.journal) if (j.project) set.add(j.project);
    return [...set].sort();
  }
  function projectList() {
    return h('datalist', { id: 'brain-projects' }, allProjects().map((p) => h('option', { value: p })));
  }

  // ---------- tabs ----------
  function renderTabs() {
    const pc = safePrune().length;
    tabsBar.replaceChildren(...TABS.map((t) => h('button', {
      class: `brain-tab${state.tab === t.id ? ' brain-on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(state.tab === t.id),
      onclick: () => { state.tab = t.id; lsSet(TAB_KEY, t.id); renderTabs(); renderPane(); },
    }, t.label, t.id === 'prune' && pc ? h('span', { class: 'brain-badge' }, String(pc)) : null)));
  }
  function safePrune() { try { return model.pruneCandidates(brain); } catch { return []; } }

  function renderPane() {
    const fn = { journal: paneJournal, prune: panePrune, graveyard: paneGraveyard, stats: paneStats, add: paneAdd }[state.tab] || paneJournal;
    pane.replaceChildren(...[].concat(fn()));
  }

  function paneJournal() {
    const ta = h('textarea', { class: 'brain-in', rows: '2', placeholder: 'Add a thought to the journal…' });
    const proj = h('input', { class: 'brain-in', type: 'text', placeholder: 'project (optional)', list: 'brain-projects' });
    const add = async () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      await act(() => model.brainThink(store, text, { project: proj.value.trim() || null, agent: 'saied' }), 'Thought added');
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(); });
    const items = [...brain.journal].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    return [
      h('div', { class: 'brain-form', style: 'margin-bottom:12px' }, ta,
        h('div', { style: 'display:flex;gap:6px' }, proj, projectList(),
          h('button', { class: 'brain-btn brain-primary', type: 'button', onclick: add }, 'Think'))),
      items.length ? h('ul', { class: 'brain-list' }, items.map((j) => h('li', { class: 'brain-item' },
        h('div', { class: 'brain-item-meta' },
          h('span', { title: fmtDate(j.ts) }, relTime(j.ts)),
          h('span', { class: 'brain-agent' }, j.agent || 'claude'),
          j.project ? h('span', { class: 'brain-p' }, j.project) : null),
        h('div', { class: 'brain-item-text' }, j.text || ''))))
        : h('p', { class: 'brain-muted' }, 'The journal is empty. Agents add stream-of-consciousness notes here with ', h('code', {}, 'mc brain think "…"'), '.'),
    ];
  }

  function panePrune() {
    const cands = safePrune();
    if (!cands.length) return h('p', { class: 'brain-muted' }, 'Nothing is fading. Memories show up here when their strength drops below 25% or they are marked stale.');
    return [
      h('p', { class: 'brain-muted', style: 'margin:0 0 10px' }, `${cands.length} memor${cands.length === 1 ? 'y is' : 'ies are'} fading. Keep reinforces it (+10% confidence); Prune forgets it.`),
      h('ul', { class: 'brain-list' }, cands.map(({ n, s }) => h('li', { class: 'brain-item' },
        h('div', { class: 'brain-item-row' },
          h('i', { style: `width:9px;height:9px;border-radius:50%;flex:none;background:${colorOf(n.type)};opacity:${0.3 + 0.7 * s}` }),
          h('div', { class: 'brain-grow' }, h('button', { class: 'brain-clip', type: 'button', onclick: () => selectAndCenter(n.id) }, n.title || '(untitled)'))),
        h('div', { class: 'brain-item-row', style: 'margin-top:6px' },
          h('div', { class: 'brain-meter brain-grow' }, h('i', { style: `width:${Math.max(2, Math.round(s * 100))}%` })),
          h('span', { class: 'brain-muted', style: 'font-size:.74rem;width:34px;text-align:right' }, pct(s)),
          h('button', { class: 'brain-btn brain-sm', type: 'button', onclick: () => act(() => model.brainUpdate(store, n.id, {
            confidence: Math.min(1, Math.round(((n.confidence ?? 0.6) + 0.1) * 100) / 100), ...(n.status === 'stale' ? { status: 'active' } : {}),
          }), 'Kept') }, 'Keep'),
          h('button', { class: 'brain-btn brain-sm brain-danger', type: 'button', onclick: () => pruneFlow(n) }, 'Prune')),
        h('div', { class: 'brain-item-meta', style: 'margin:4px 0 0' }, n.type, `touched ${relTime(n.touched || n.created)}`, `${n.uses || 0} uses`, n.status === 'stale' ? 'stale' : null)))),
    ];
  }

  function paneGraveyard() {
    if (!brain.pruned.length) return h('p', { class: 'brain-muted' }, 'Nothing has been forgotten yet. When a memory is pruned (', h('code', {}, 'mc brain prune <id> "reason"'), '), its title and the reason are kept here.');
    return h('ul', { class: 'brain-list' }, brain.pruned.map((p) => h('li', { class: 'brain-item', style: 'opacity:.85' },
      h('div', { class: 'brain-item-meta' },
        h('span', { style: `color:${colorOf(p.type)}` }, p.type || 'memory'),
        h('span', { title: fmtDate(p.ts) }, relTime(p.ts)),
        h('span', { class: 'brain-agent' }, `by ${p.by || 'claude'}`)),
      h('div', { class: 'brain-item-text', style: 'text-decoration:line-through;text-decoration-color:rgba(255,255,255,.25)' }, p.title || '(untitled)'),
      p.reason ? h('div', { class: 'brain-muted', style: 'margin-top:4px;font-size:.8rem;white-space:pre-wrap;overflow-wrap:anywhere' }, `— ${p.reason}`) : null)));
  }

  function paneStats() {
    const N = brain.nodes;
    if (!N.length) return h('p', { class: 'brain-muted' }, 'No memories yet, so there is nothing to measure.');
    const ss = N.map(strengthOf);
    const avg = ss.reduce((a, b) => a + b, 0) / N.length;
    const counts = model.BRAIN_TYPES.map((t) => [t, N.filter((n) => n.type === t).length]);
    const maxC = Math.max(1, ...counts.map((c) => c[1]));
    const bins = new Array(10).fill(0);
    for (const s of ss) bins[Math.min(9, Math.floor(s * 10))]++;
    const maxB = Math.max(1, ...bins);
    const mostUsed = [...N].sort((a, b) => (b.uses || 0) - (a.uses || 0)).filter((n) => n.uses).slice(0, 5);
    const newest = [...N].sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, 5);
    return [
      h('div', { class: 'brain-stat-cards' },
        h('div', { class: 'brain-card' }, h('b', {}, String(N.length)), h('span', {}, 'memories')),
        h('div', { class: 'brain-card' }, h('b', {}, pct(avg)), h('span', {}, 'avg strength')),
        h('div', { class: 'brain-card' }, h('b', {}, String(N.filter((n) => n.pinned).length)), h('span', {}, 'pinned'))),
      h('div', { class: 'brain-sec-t' }, 'By type'),
      h('div', { class: 'brain-bars' }, counts.map(([t, c]) => h('div', { class: 'brain-bar' },
        h('span', {}, t),
        h('div', { class: 'brain-bar-track' }, h('i', { style: `width:${(c / maxC) * 100}%;background:${colorOf(t)}` })),
        h('span', { class: 'brain-bar-n' }, String(c))))),
      h('div', { class: 'brain-sec-t' }, 'Strength distribution'),
      h('div', { class: 'brain-hist', role: 'img', 'aria-label': `Strength histogram: ${bins.join(', ')}` }, bins.map((b, i) => h('div', {
        title: `${i * 10}–${i * 10 + 10}%: ${b}`,
        style: `height:${(b / maxB) * 100}%;background:${i < 3 ? 'var(--b-magenta)' : i < 6 ? 'var(--b-amber)' : 'var(--b-green)'};opacity:${b ? 0.85 : 0.15}`,
      }))),
      h('div', { class: 'brain-hist-axis' }, h('span', {}, '0%'), h('span', {}, 'fading ← strength → strong'), h('span', {}, '100%')),
      h('div', { class: 'brain-sec-t' }, 'Most used'),
      mostUsed.length ? h('div', { class: 'brain-links' }, mostUsed.map((n) => memButton(n, `${n.uses}×`))) : h('div', { class: 'brain-muted' }, 'No memory has been recalled yet.'),
      h('div', { class: 'brain-sec-t' }, 'Newest'),
      h('div', { class: 'brain-links' }, newest.map((n) => memButton(n, relTime(n.created)))),
    ];
  }

  function paneAdd() {
    const title = h('input', { class: 'brain-in', type: 'text', placeholder: 'One-line memory', required: '' });
    const type = typeSelect('insight');
    type.value = 'insight';
    const body = h('textarea', { class: 'brain-in', rows: '4', placeholder: 'Details, evidence, when it applies…' });
    const tags = h('input', { class: 'brain-in', type: 'text', placeholder: 'comma, separated' });
    const projects = h('input', { class: 'brain-in', type: 'text', placeholder: 'project slugs', list: 'brain-projects' });
    const confLabel = h('span', {}, '70%');
    const conf = h('input', { class: 'brain-range', type: 'range', min: '0', max: '1', step: '0.05', props: { value: '0.7' },
      oninput: (e) => { confLabel.textContent = pct(Number(e.target.value)); } });
    const pinned = h('input', { type: 'checkbox' });
    const submit = async (e) => {
      e?.preventDefault?.();
      const t = title.value.trim();
      if (!t) { toast('Title is required', 'error'); title.focus(); return; }
      const node = await act(async () => {
        const nn = await model.brainAdd(store, {
          type: type.value, title: t, body: body.value, tags: splitList(tags.value), projects: splitList(projects.value),
          confidence: Number(conf.value), pinned: pinned.checked, source: 'saied',
        });
        await auditLog('brain.add', t);
        return nn;
      }, 'Memory added');
      if (node) { select(node.id); setTimeout(() => centerOn(node.id), reduced ? 0 : 400); }
    };
    return h('form', { class: 'brain-form', onsubmit: submit },
      h('label', {}, 'Title', title),
      h('label', {}, 'Type', type),
      h('label', {}, 'Body', body),
      h('label', {}, 'Tags', tags),
      h('label', {}, 'Projects', projects), projectList(),
      h('label', {}, h('span', {}, 'Confidence ', confLabel), conf),
      h('label', { class: 'brain-row' }, pinned, 'Pinned (never decays)'),
      h('div', { class: 'brain-actions' }, h('button', { class: 'brain-btn brain-primary', type: 'submit' }, 'Add memory')));
  }

  // ---------- header + empty state ----------
  function renderHead() {
    const N = brain.nodes.length;
    const M = brainEdges(brain).length;
    const last = brain.journal.reduce((a, j) => (!a || String(j.ts) > a ? j.ts : a), null);
    headStats.replaceChildren('· ', h('b', {}, String(N)), ` memor${N === 1 ? 'y' : 'ies'} · `, h('b', {}, String(M)), ` link${M === 1 ? '' : 's'} · last thought `,
      h('b', { title: last ? fmtDate(last) : '' }, last ? relTime(last) : 'never'));
  }

  function renderEmpty() {
    const empty = !brain.nodes.length;
    emptyLayer.hidden = !empty;
    hint.style.display = empty ? 'none' : '';
    if (!empty) return;
    emptyLayer.replaceChildren(h('div', { class: 'brain-empty-card' },
      h('div', { class: 'brain-empty-orb', 'aria-hidden': 'true' }),
      h('h3', {}, 'A quiet mind, for now'),
      h('p', {}, 'This is where Claude keeps what it learns across sessions: principles, insights, patterns, facts, ideas and open questions. Memories grow stronger when they are used and fade when they are not.'),
      h('p', {}, 'Agents write to it from the CLI:'),
      h('code', { class: 'brain-code' },
        h('span', {}, '# remember something\n'), 'mc brain add "Ship small PRs" --type insight --tags process\n',
        h('span', {}, '# think out loud in the journal\n'), 'mc brain think "VASMA prod is stale" --project vasma\n',
        h('span', {}, '# forget, with a reason\n'), 'mc brain prune <id> "superseded"   ', h('span', {}, '(or just `mc brain prune` to list weak ones)')),
      h('p', {}, 'You can also add one yourself in the ', h('b', {}, 'Add memory'), ' tab.')));
  }

  // ---------- refresh ----------
  async function refresh() {
    await load();
    renderHead();
    renderEmpty();
    renderChips();
    renderTabs();
    renderPane();
    rebuildGraph();
    if (state.query) onSearch();
    if (state.selected) { if (byId(state.selected)) renderDetail(); else closeDetail(); }
  }

  // ---------- lifecycle ----------
  let ro = null;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ro) ro.disconnect();
    clearTimeout(searchTimer);
  }
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => {
      if (!canvas.isConnected) { destroy(); return; }
      resize();
      if (!userMoved && !sim.alpha) fit(false);
      requestDraw();
    });
    ro.observe(stage);
  }
  resize();
  await refresh();
  return destroy;
}
