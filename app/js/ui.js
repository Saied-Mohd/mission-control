// Tiny DOM toolkit: h(), icons, toasts, modals, confirm, time formatting, markdown-lite.
// Nothing here ever assigns innerHTML with untrusted text; everything is built as DOM nodes.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'g', 'line', 'rect', 'polyline', 'polygon', 'ellipse', 'defs', 'linearGradient', 'radialGradient', 'stop', 'text']);

/**
 * h('div.card#id', { onclick, class, style, dataset, ...attrs }, ...children)
 * Children: strings/numbers become text nodes, arrays are flattened, null/false/undefined skipped.
 */
export function h(tag, props, ...children) {
  if (props instanceof Node || typeof props !== 'object' || props === null || Array.isArray(props)) {
    if (props !== undefined && props !== null) children.unshift(props);
    props = {};
  }
  const m = String(tag).match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/);
  if (!m) throw new Error(`h(): bad tag "${tag}"`);
  const name = (m && m[1]) || 'div';
  const isSvg = SVG_TAGS.has(name);
  const el = isSvg ? document.createElementNS(SVG_NS, name) : document.createElement(name);
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  append(el, children);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') {
      for (const c of String(v).split(/\s+/).filter(Boolean)) el.classList.add(c);
    } else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else for (const [sk, sv] of Object.entries(v)) {
        if (sv === undefined || sv === null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    } else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v)) if (dv !== undefined && dv !== null) el.dataset[dk] = dv;
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'ref' && typeof v === 'function') {
      v(el);
    } else if (!isSvg && k === 'value') {
      el.value = v;
    } else if (!isSvg && (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'indeterminate')) {
      el[k] = v === '' ? true : !!v; // attribute-style '' means true
      if (el[k] && k !== 'indeterminate') el.setAttribute(k, '');
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

// ---------------- icons (stroke, 24 grid) ----------------

const ICONS = {
  dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  approvals: 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6zM9 12l2 2 4-4',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  radar: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M12 12L18 6',
  vault: 'M4 5h16v14H4zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 9V7M12 17v-2M4 9H2M4 15H2',
  brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  deck: 'M3 4h18v12H3zM8 20h8M12 16v4',
  settings: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  search: 'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-5-5',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  key: 'M8 15m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M11 12l9-9M17 6l3 3M15 8l2 2',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  send: 'M4 12l16-8-6 16-3-7z',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  git: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  folder: 'M3 6h6l2 2h10v11H3z',
  flag: 'M5 21V4h11l-1 4 4 4H5',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  download: 'M12 4v12M6 10l6 6 6-6M4 20h16',
  upload: 'M12 20V8M6 14l6-6 6 6M4 4h16',
  command: 'M9 9h6v6H9zM9 9V6a3 3 0 1 0-3 3zM15 9V6a3 3 0 1 1 3 3zM9 15v3a3 3 0 1 1-3-3zM15 15v3a3 3 0 1 0 3-3z',
  power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  board: 'M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v13h-4z',
  log: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',
  handoff: 'M4 12h12M12 6l6 6-6 6M20 4v16',
  info: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v6M12 7h.01',
  wifiOff: 'M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.7M16.8 11.2A10 10 0 0 1 19 12.9M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M2 2l20 20',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  clock: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2',
  question: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  note: 'M5 4h10l4 4v12H5zM14 4v5h5',
  play: 'M7 4l12 8-12 8z',
  user: 'M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0',
};

export function icon(name, size = 18, cls = '') {
  const d = ICONS[name] || ICONS.info;
  return h('svg', {
    class: 'ico ' + cls,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }, h('path', { d }));
}

// ---------------- toasts ----------------

let toastHost;
function host() {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

/** toast(msg, { kind: 'info'|'ok'|'warn'|'error', timeout, action: {label, onClick} }) */
export function toast(msg, opts = {}) {
  if (typeof opts === 'string') opts = { kind: opts };
  const { kind = 'info', timeout = kind === 'error' ? 7000 : 3500, action } = opts;
  const el = h(`div.toast.toast-${kind}`,
    h('span.toast-dot'),
    h('span.toast-msg', String(msg instanceof Error ? msg.message : msg)),
    action && h('button.btn.btn-ghost.btn-sm', { onclick: () => { action.onClick(); close(); } }, action.label),
    h('button.toast-x', { 'aria-label': 'Dismiss', onclick: () => close() }, icon('x', 14)),
  );
  host().appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  let t = setTimeout(close, timeout);
  el.addEventListener('pointerenter', () => clearTimeout(t));
  el.addEventListener('pointerleave', () => { t = setTimeout(close, 1500); });
  function close() {
    clearTimeout(t);
    el.classList.remove('in');
    setTimeout(() => el.remove(), 220);
  }
  return close;
}

/** Report an error as a toast; returns undefined so it can be used in .catch(). */
export function fail(e, prefix = '') {
  console.error(e);
  const m = e?.message || String(e);
  toast((prefix ? prefix + ': ' : '') + m, { kind: 'error' });
}

// ---------------- modal / sheet ----------------

let modalDepth = 0;
const openModals = []; // stack of finish fns, topmost last

/** Close every open modal (used on lock so no decrypted content stays on screen). */
export function closeAllModals() {
  for (const fin of [...openModals].reverse()) fin(null);
}

/**
 * modal(title, contentEl, actions) → Promise<value|null>
 * actions: [{ label, value, kind: 'primary'|'danger'|'ghost', onClick?: async () => any|false }]
 * onClick returning false keeps the modal open (validation); otherwise the modal resolves with
 * its return value (if not undefined) or action.value. Escape / backdrop resolve null.
 */
export function modal(title, contentEl, actions = [{ label: 'Close', value: null, kind: 'ghost' }], opts = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      modalDepth--;
      const i = openModals.indexOf(finish);
      if (i >= 0) openModals.splice(i, 1);
      back.classList.remove('in');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => back.remove(), 200);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch {}
      resolve(v);
    };
    const btns = actions.map((a) =>
      h(`button.btn.btn-${a.kind || 'ghost'}`, {
        type: 'button',
        onclick: async (e) => {
          const b = e.currentTarget;
          if (a.onClick) {
            b.disabled = true;
            b.classList.add('busy');
            let out;
            try {
              out = await a.onClick();
            } catch (err) {
              fail(err);
              out = false;
            }
            b.disabled = false;
            b.classList.remove('busy');
            if (out === false) return;
            finish(out === undefined ? a.value : out);
          } else finish(a.value);
        },
      }, a.label));
    const dialog = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, class: opts.wide ? 'modal-wide' : '' },
      h('div.modal-grab'),
      h('header.modal-head', h('h2', title), h('button.icon-btn', { 'aria-label': 'Close', onclick: () => finish(null) }, icon('x'))),
      h('div.modal-body', contentEl),
      btns.length ? h('footer.modal-foot', btns) : null,
    );
    const back = h('div.modal-back', { onpointerdown: (e) => { if (e.target === back) back._down = true; }, onclick: (e) => { if (e.target === back && back._down) finish(null); back._down = false; } }, dialog);
    const onKey = (e) => {
      if (openModals[openModals.length - 1] !== finish) return; // only the topmost modal reacts
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        const primary = btns.find((b, i) => actions[i].kind === 'primary');
        if (primary) { e.preventDefault(); primary.click(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    modalDepth++;
    openModals.push(finish);
    document.body.appendChild(back);
    requestAnimationFrame(() => {
      back.classList.add('in');
      const f = dialog.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select');
      if (f && !opts.noAutofocus) f.focus();
    });
    if (opts.onOpen) opts.onOpen({ close: finish, dialog });
  });
}

export const isModalOpen = () => modalDepth > 0;

export function confirm(msg, { okLabel = 'Confirm', danger = false, title = 'Are you sure?' } = {}) {
  return modal(title, h('p.confirm-msg', msg), [
    { label: 'Cancel', value: false, kind: 'ghost' },
    { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' },
  ]).then((v) => v === true);
}

/** prompt-like helper returning the trimmed string or null. */
export async function ask(title, { label = '', value = '', placeholder = '', multiline = false, okLabel = 'Save', type = 'text' } = {}) {
  const input = multiline
    ? h('textarea.input', { rows: 6, placeholder, value })
    : h('input.input', { type, placeholder, value, autocomplete: 'off' });
  const v = await modal(title, h('label.field', label && h('span.label', label), input), [
    { label: 'Cancel', value: null },
    { label: okLabel, kind: 'primary', onClick: () => input.value.trim() || false },
  ]);
  return v;
}

// ---------------- time ----------------

const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' }) : null;

export function ago(ts, at = Date.now()) {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!t) return '—';
  const s = Math.round((t - at) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  const units = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2592000], ['year', 31536000]];
  let unit = 'minute';
  let div = 60;
  for (const [u, d] of units) if (abs >= d) { unit = u; div = d; }
  const n = Math.round(s / div);
  return rtf ? rtf.format(n, unit) : `${Math.abs(n)} ${unit}${Math.abs(n) === 1 ? '' : 's'} ${n < 0 ? 'ago' : 'from now'}`;
}

export function fmtDate(ts, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!t) return '—';
  return new Date(t).toLocaleDateString(undefined, opts);
}

export function fmtDateTime(ts) {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!t) return '—';
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** <time> element with relative text and absolute title, refreshed by the shell ticker. */
export function timeEl(ts, cls = '') {
  return h('time.rel' + (cls ? '.' + cls : ''), { datetime: ts || '', title: fmtDateTime(ts), dataset: { ts: ts || '' } }, ago(ts));
}

export function refreshTimes(root = document) {
  for (const el of root.querySelectorAll('time.rel[data-ts]')) if (el.dataset.ts) el.textContent = ago(el.dataset.ts);
}

// ---------------- markdown-lite (DOM-built, never innerHTML) ----------------

const SAFE_URL = /^(https?:|mailto:)/i;

export function safeUrl(u) {
  try {
    const s = String(u || '').trim();
    if (!SAFE_URL.test(s)) return null;
    const url = new URL(s);
    return /^(https?:|mailto:)$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function extLink(url, text) {
  const safe = safeUrl(url);
  if (!safe) return document.createTextNode(text || String(url));
  return h('a', { href: safe, target: '_blank', rel: 'noopener noreferrer nofollow' }, text || safe);
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|((?<![\w*])\*[^*\s][^*\n]*\*(?![\w*])|(?<!\w)_[^_\s][^_\n]*_(?!\w))/g;

export function inline(text) {
  const frag = document.createDocumentFragment();
  const s = String(text ?? '');
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
    const tok = m[0];
    if (m[1]) frag.appendChild(h('code', tok.slice(1, -1)));
    else if (m[2]) frag.appendChild(h('strong', inline(tok.slice(2, -2))));
    else if (m[3]) {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      frag.appendChild(extLink(mm[2], mm[1]));
    } else if (m[4]) frag.appendChild(extLink(tok, tok));
    else if (m[5]) frag.appendChild(h('em', tok.slice(1, -1)));
    last = m.index + tok.length;
  }
  if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
  return frag;
}

/** Render a small markdown subset as DOM: paragraphs, headings, lists, code fences, quotes, bold, code, links. */
export function md(text, cls = '') {
  const root = h('div.md' + (cls ? '.' + cls : ''));
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) {
      const p = h('p');
      para.forEach((l, i) => {
        if (i) p.appendChild(h('br'));
        p.appendChild(inline(l));
      });
      root.appendChild(p);
    }
    para = [];
  };
  const flushList = () => { list = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      flushPara(); flushList();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) code.push(lines[i++]);
      root.appendChild(h('pre', h('code', code.join('\n'))));
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const hd = line.match(/^(#{1,4})\s+(.*)$/);
    if (hd) {
      flushPara(); flushList();
      root.appendChild(h('h' + Math.min(6, hd[1].length + 2), inline(hd[2])));
      continue;
    }
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[1]);
      if (!list || list.ordered !== ordered) {
        list = { ordered, el: h(ordered ? 'ol' : 'ul') };
        root.appendChild(list.el);
      }
      const cb = li[2].match(/^\[( |x|X)\]\s+(.*)$/);
      if (cb) list.el.appendChild(h('li.task-li', h('span.cb' + (cb[1] !== ' ' ? '.on' : ''), cb[1] !== ' ' ? '✓' : ''), inline(cb[2])));
      else list.el.appendChild(h('li', inline(li[2])));
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara(); flushList();
      root.appendChild(h('blockquote', inline(line.replace(/^>\s?/, ''))));
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara(); flushList();
      root.appendChild(h('hr'));
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  return root;
}

/** Plain-text excerpt (for cards). */
export function excerpt(text, n = 160) {
  const s = String(text ?? '').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------------- misc helpers ----------------

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function downloadText(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Segmented control. options: [{value,label}] */
export function segmented(options, value, onChange, cls = '') {
  const wrap = h('div.seg' + (cls ? '.' + cls : ''), { role: 'radiogroup' });
  const set = (v) => {
    value = v;
    for (const b of wrap.children) b.classList.toggle('on', b.dataset.value === String(v));
  };
  for (const o of options) {
    wrap.appendChild(h('button', {
      type: 'button',
      role: 'radio',
      dataset: { value: String(o.value) },
      class: String(o.value) === String(value) ? 'on' : '',
      onclick: () => { set(o.value); onChange && onChange(o.value); },
    }, o.label));
  }
  wrap.getValue = () => value;
  wrap.setValue = set;
  return wrap;
}

export function chip(text, cls = '', attrs = {}) {
  return h('span.chip', { ...attrs, class: [cls, attrs.class].filter(Boolean).join(' ') }, text);
}

export function spinner(size = 18) {
  return h('span.spinner', { style: { width: size + 'px', height: size + 'px' }, 'aria-hidden': 'true' });
}

export function empty(title, sub = '', iconName = 'spark') {
  return h('div.empty', icon(iconName, 28), h('div.empty-title', title), sub && h('div.empty-sub', sub));
}

/** Simple field wrapper. */
export function field(label, input, hint = '') {
  return h('label.field', h('span.label', label), input, hint && h('span.hint', hint));
}

/** Rough strength estimate for passphrases: returns { score 0..4, bits, label }. */
export function passStrength(p) {
  const s = String(p || '');
  if (!s) return { score: 0, bits: 0, label: 'empty' };
  let pool = 0;
  if (/[a-z]/.test(s)) pool += 26;
  if (/[A-Z]/.test(s)) pool += 26;
  if (/[0-9]/.test(s)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(s)) pool += 33;
  const uniq = new Set(s).size;
  let bits = s.length * Math.log2(Math.max(pool, 2));
  if (uniq < s.length / 2) bits *= 0.6;
  if (/^(.)\1+$/.test(s) || /^(password|123456|qwerty)/i.test(s)) bits = Math.min(bits, 10);
  const words = s.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3);
  if (words.length >= 4) bits = Math.max(bits, words.length * 11);
  const score = bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, bits: Math.round(bits), label: ['empty', 'weak', 'fair', 'strong', 'excellent'][score] };
}

export function strengthMeter(input) {
  const bar = h('div.meter-bar');
  const lab = h('span.meter-label', '');
  const el = h('div.meter', h('div.meter-track', bar), lab);
  const upd = () => {
    const st = passStrength(input.value);
    bar.style.width = (st.score / 4) * 100 + '%';
    el.dataset.score = st.score;
    lab.textContent = input.value ? `${st.label} · ~${st.bits} bits` : '';
  };
  input.addEventListener('input', upd);
  upd();
  return el;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
