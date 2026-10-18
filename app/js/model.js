// Domain model shared by the app and the CLI. Every mutation goes through here so
// Saied (PWA) and agents (CLI) produce identical data.

export const COLUMNS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'next', label: 'Next' },
  { id: 'doing', label: 'Doing' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];
export const COLUMN_IDS = COLUMNS.map((c) => c.id);
export const LOG_KINDS = ['progress', 'decision', 'blocker', 'handoff', 'question', 'note', 'session'];
export const PROJECT_STATUSES = ['active', 'paused', 'idea', 'shipped', 'archived'];
export const BRAIN_TYPES = ['principle', 'insight', 'pattern', 'fact', 'idea', 'question'];
export const PRIORITIES = ['low', 'med', 'high', 'urgent'];

export const DOC = {
  index: 'index',
  project: (slug) => `project/${slug}`,
  log: (slug) => `log/${slug}`,
  brain: 'brain',
  requests: 'requests',
  inbox: 'inbox',
  radar: 'radar',
  audit: 'audit',
  vault: 'vault',
  vaultIndex: 'vault-index',
  pushSubs: 'push-subs',
  grant: (id) => `grant/${id}`,
  deck: 'deck',
  settings: 'settings',
};

const LIMITS = { activity: 250, log: 1500, audit: 1500, journal: 400, pruned: 500 };

export const now = () => new Date().toISOString();

export function newId(prefix = '') {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}${t}${r}`;
}

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

const DAY = 86400000;

/** hot | warm | cool | cold, from the most recent of log activity and last commit. */
export function heat(summary, at = Date.now()) {
  const ts = Math.max(Date.parse(summary.lastActivity || 0) || 0, Date.parse(summary.health?.lastCommitTs || 0) || 0);
  if (!ts) return 'cold';
  const d = (at - ts) / DAY;
  if (d < 3) return 'hot';
  if (d < 14) return 'warm';
  if (d < 45) return 'cool';
  return 'cold';
}

export function emptyProject(slug, fields = {}) {
  return {
    slug,
    name: fields.name || slug,
    tagline: '',
    status: 'active',
    color: '#5ee7ff',
    path: '',
    repo: '',
    stack: [],
    tags: [],
    links: [],
    rules: [],
    notes: '',
    handoff: null,
    board: { tasks: [] },
    health: null,
    createdAt: now(),
    updatedAt: now(),
    ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    slug,
  };
}

export function summarize(p, prev = {}) {
  const tasks = p.board?.tasks || [];
  return {
    ...prev,
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    status: p.status,
    color: p.color,
    tags: p.tags,
    open: tasks.filter((t) => t.col !== 'done').length,
    doing: tasks.filter((t) => t.col === 'doing').length,
    done: tasks.filter((t) => t.col === 'done').length,
    next: tasks.find((t) => t.col === 'doing')?.title || tasks.find((t) => t.col === 'next')?.title || null,
    handoff: p.handoff ? { ts: p.handoff.ts, agent: p.handoff.agent, text: p.handoff.text.slice(0, 280) } : null,
    health: p.health,
    updatedAt: p.updatedAt,
  };
}

function emptyIndex() {
  return { v: 1, order: [], projects: {}, activity: [] };
}

// ---------------- projects ----------------

export async function listProjects(store) {
  const idx = await store.get(DOC.index, emptyIndex());
  return idx.order.map((s) => idx.projects[s]).filter(Boolean);
}

export async function getProject(store, slug) {
  return store.get(DOC.project(slug), null);
}

/** Resolve a loose name ("drm", "Social Media") to a slug. */
export async function resolveSlug(store, query) {
  const idx = await store.get(DOC.index, emptyIndex());
  const q = slugify(query);
  if (idx.projects[q]) return q;
  const all = idx.order;
  const hit =
    all.find((s) => s.startsWith(q)) ||
    all.find((s) => s.includes(q)) ||
    all.find((s) => slugify(idx.projects[s].name).includes(q));
  if (!hit) throw new Error(`No project matches "${query}". Known: ${all.join(', ')}`);
  return hit;
}

async function syncIndex(store, project, activity) {
  await store.update(
    DOC.index,
    (idx) => {
      if (!idx.order.includes(project.slug)) idx.order.push(project.slug);
      idx.projects[project.slug] = summarize(project, idx.projects[project.slug]);
      if (activity) {
        idx.projects[project.slug].lastActivity = activity.ts;
        idx.projects[project.slug].lastLine = activity.text.slice(0, 200);
        idx.activity.unshift({ ...activity, slug: project.slug });
        idx.activity = idx.activity.slice(0, LIMITS.activity);
      }
    },
    emptyIndex(),
  );
}

export async function saveProject(store, slug, mutate, activity = null) {
  const p = await store.update(DOC.project(slug), async (p) => {
    if (!p) throw new Error(`Unknown project ${slug}`);
    await mutate(p);
    p.updatedAt = now();
  });
  await syncIndex(store, p, activity);
  return p;
}

export async function createProject(store, fields) {
  const slug = slugify(fields.slug || fields.name);
  const existing = await store.get(DOC.project(slug), null);
  if (existing) throw new Error(`Project ${slug} already exists`);
  const p = emptyProject(slug, fields);
  await store.put(DOC.project(slug), p);
  await syncIndex(store, p, null);
  return p;
}

export async function deleteProject(store, slug) {
  await store.remove(DOC.project(slug));
  await store.remove(DOC.log(slug));
  await store.update(DOC.index, (idx) => {
    idx.order = idx.order.filter((s) => s !== slug);
    delete idx.projects[slug];
  }, emptyIndex());
}

export async function reorderProjects(store, order) {
  await store.update(DOC.index, (idx) => {
    const known = new Set(idx.order);
    idx.order = [...order.filter((s) => known.has(s)), ...idx.order.filter((s) => !order.includes(s))];
  }, emptyIndex());
}

// ---------------- agent log ----------------

export async function getLog(store, slug) {
  return store.get(DOC.log(slug), { entries: [] });
}

export async function appendLog(store, slug, { kind = 'progress', text, agent = 'claude', files = [], tasks = [] }) {
  if (!LOG_KINDS.includes(kind)) throw new Error(`kind must be one of ${LOG_KINDS.join(', ')}`);
  if (!text?.trim()) throw new Error('log text required');
  const entry = { id: newId('l'), ts: now(), kind, agent, text: text.trim(), files, tasks };
  await store.update(DOC.log(slug), (log) => {
    log.entries.push(entry);
    if (log.entries.length > LIMITS.log) log.entries = log.entries.slice(-LIMITS.log);
  }, { entries: [] });
  const p = await getProject(store, slug);
  if (p) await syncIndex(store, p, { id: entry.id, ts: entry.ts, kind, agent, text: entry.text });
  return entry;
}

export async function setHandoff(store, slug, text, agent = 'claude') {
  const ts = now();
  await saveProject(store, slug, (p) => {
    p.handoff = { text: text.trim(), ts, agent };
  });
  return appendLog(store, slug, { kind: 'handoff', text, agent });
}

// ---------------- board ----------------

export async function addTask(store, slug, { title, col = 'next', prio = 'med', note = '', tags = [], by = 'claude' }) {
  if (!COLUMN_IDS.includes(col)) throw new Error(`column must be one of ${COLUMN_IDS.join(', ')}`);
  const task = { id: newId('t'), title: title.trim(), col, prio, note, tags, by, created: now(), updated: now() };
  await saveProject(store, slug, (p) => {
    p.board.tasks.push(task);
  });
  return task;
}

function findTask(p, id) {
  const t = p.board.tasks.find((t) => t.id === id || t.id.endsWith(id));
  if (!t) throw new Error(`No task ${id} in ${p.slug}`);
  return t;
}

export async function updateTask(store, slug, id, patch, by = 'claude') {
  let out;
  let activity = null;
  await saveProject(store, slug, (p) => {
    const t = findTask(p, id);
    if (patch.col && !COLUMN_IDS.includes(patch.col)) throw new Error(`bad column ${patch.col}`);
    if (patch.col && patch.col !== t.col && patch.col === 'done') {
      activity = { id: newId('l'), ts: now(), kind: 'progress', agent: by, text: `Done: ${t.title}` };
    }
    Object.assign(t, patch, { updated: now() });
    if (patch.col === 'done') t.doneAt = now();
    out = t;
  });
  if (activity) {
    await store.update(DOC.log(slug), (log) => {
      log.entries.push({ ...activity, files: [], tasks: [out.id] });
    }, { entries: [] });
    const p = await getProject(store, slug);
    await syncIndex(store, p, activity);
  }
  return out;
}

export async function removeTask(store, slug, id) {
  await saveProject(store, slug, (p) => {
    const t = findTask(p, id);
    p.board.tasks = p.board.tasks.filter((x) => x !== t);
  });
}

// ---------------- inbox (directives & questions) ----------------

export async function addInbox(store, { from = 'saied', text, project = null }) {
  const item = { id: newId('i'), ts: now(), from, text: text.trim(), project, status: 'open' };
  await store.update(DOC.inbox, (d) => {
    d.items.unshift(item);
  }, { items: [] });
  return item;
}

export async function resolveInbox(store, id, by = 'claude', reply = '') {
  await store.update(DOC.inbox, (d) => {
    const it = d.items.find((i) => i.id === id || i.id.endsWith(id));
    if (!it) throw new Error(`No inbox item ${id}`);
    Object.assign(it, { status: 'done', doneBy: by, doneAt: now(), reply });
  }, { items: [] });
}

// ---------------- radar (dated things) ----------------

export async function addRadar(store, { date, text, project = null, kind = 'deadline' }) {
  if (Number.isNaN(Date.parse(date))) throw new Error('date must be YYYY-MM-DD');
  const item = { id: newId('r'), date, text: text.trim(), project, kind, created: now() };
  await store.update(DOC.radar, (d) => {
    d.items.push(item);
    d.items.sort((a, b) => a.date.localeCompare(b.date));
  }, { items: [] });
  return item;
}

export async function removeRadar(store, id) {
  await store.update(DOC.radar, (d) => {
    d.items = d.items.filter((i) => !(i.id === id || i.id.endsWith(id)));
  }, { items: [] });
}

export function daysUntil(date, at = Date.now()) {
  return Math.ceil((Date.parse(date + (date.length === 10 ? 'T23:59:59' : '')) - at) / DAY);
}

/** Radar items plus vault expiries, soonest first. */
export async function radarFeed(store) {
  const radar = await store.get(DOC.radar, { items: [] });
  const vi = await store.get(DOC.vaultIndex, { items: [] });
  const fromVault = vi.items
    .filter((s) => s.expiresAt)
    .map((s) => ({ id: 'vault:' + s.name, date: s.expiresAt.slice(0, 10), text: `${s.name} expires`, project: s.projects?.[0] || null, kind: 'expiry' }));
  return [...radar.items, ...fromVault].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------- requests / approvals ----------------

export async function createRequest(store, { type, project = null, reason = '', secrets = [], text = '', ttl = 'once', agent = 'claude', agentPublicJwk = null }) {
  const req = { id: newId('q'), ts: now(), type, project, reason, secrets, text, ttl, agent, agentPublicJwk, status: 'pending' };
  await store.update(DOC.requests, (d) => {
    d.items.unshift(req);
    d.items = d.items.slice(0, 300);
  }, { items: [] });
  await audit(store, agent, `request.${type}`, type === 'secret' ? secrets.join(',') : text.slice(0, 120), project);
  return req;
}

export async function resolveRequest(store, id, patch, actor = 'saied') {
  let out;
  await store.update(DOC.requests, (d) => {
    const r = d.items.find((i) => i.id === id);
    if (!r) throw new Error(`No request ${id}`);
    Object.assign(r, patch, { resolvedAt: now(), resolvedBy: actor });
    out = r;
  }, { items: [] });
  await audit(store, actor, `request.${patch.status}`, out.type === 'secret' ? out.secrets.join(',') : out.text.slice(0, 120), out.project);
  return out;
}

export const TTL = {
  once: { label: 'Once', ms: 15 * 60000, uses: 1 },
  '1h': { label: '1 hour', ms: 3600000, uses: null },
  '24h': { label: '24 hours', ms: 86400000, uses: null },
  '7d': { label: '7 days', ms: 7 * 86400000, uses: null },
};

// ---------------- audit ----------------

export async function audit(store, actor, action, target = '', project = null) {
  await store.update(DOC.audit, (d) => {
    d.items.unshift({ ts: now(), actor, action, target, project });
    d.items = d.items.slice(0, LIMITS.audit);
  }, { items: [] });
}

// ---------------- brain ----------------

export function emptyBrain() {
  return { v: 1, nodes: [], journal: [], pruned: [], principlesVersion: 1 };
}

/** Memory strength 0..1 = confidence × usage boost × recency decay. Pinned nodes never decay. */
export function strength(n, at = Date.now()) {
  if (n.pinned) return 1;
  const ageDays = (at - Date.parse(n.touched || n.created)) / DAY;
  const halfLife = { principle: 180, fact: 90, pattern: 120, insight: 60, idea: 45, question: 30 }[n.type] || 60;
  const recency = Math.pow(0.5, Math.max(0, ageDays) / halfLife);
  const usage = 1 - Math.exp(-(1 + (n.uses || 0)) / 3);
  return Math.max(0, Math.min(1, (n.confidence ?? 0.6) * (0.35 + 0.65 * recency) * (0.5 + 0.5 * usage) * 1.6));
}

const tokenize = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

export function recall(brain, query, { limit = 8, project = null } = {}) {
  const q = new Set(tokenize(query));
  const at = Date.now();
  return brain.nodes
    .map((n) => {
      const words = tokenize(`${n.title} ${n.body} ${(n.tags || []).join(' ')} ${(n.projects || []).join(' ')}`);
      let hits = 0;
      for (const w of words) if (q.has(w)) hits++;
      const title = tokenize(n.title).filter((w) => q.has(w)).length;
      const proj = project && n.projects?.includes(project) ? 2 : 0;
      const rel = hits + title * 2 + proj;
      return { n, score: rel ? rel * (0.5 + strength(n, at)) : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.n);
}

export async function brainAdd(store, { type = 'insight', title, body = '', tags = [], projects = [], links = [], confidence = 0.7, pinned = false, source = 'claude' }) {
  if (!BRAIN_TYPES.includes(type)) throw new Error(`type must be one of ${BRAIN_TYPES.join(', ')}`);
  const node = { id: newId('m'), type, title: title.trim(), body, tags, projects, links, confidence, pinned, source, uses: 0, created: now(), touched: now() };
  await store.update(DOC.brain, (b) => {
    b.nodes.push(node);
  }, emptyBrain());
  return node;
}

export async function brainUpdate(store, id, patch) {
  let out;
  await store.update(DOC.brain, (b) => {
    const n = b.nodes.find((x) => x.id === id || x.id.endsWith(id));
    if (!n) throw new Error(`No memory ${id}`);
    Object.assign(n, patch, { touched: now() });
    out = n;
  }, emptyBrain());
  return out;
}

/** Mark memories as used (reinforces them). */
export async function brainTouch(store, ids) {
  if (!ids.length) return;
  await store.update(DOC.brain, (b) => {
    for (const n of b.nodes) if (ids.includes(n.id)) {
      n.uses = (n.uses || 0) + 1;
      n.touched = now();
    }
  }, emptyBrain());
}

export async function brainLink(store, a, b) {
  await store.update(DOC.brain, (br) => {
    const na = br.nodes.find((x) => x.id === a || x.id.endsWith(a));
    const nb = br.nodes.find((x) => x.id === b || x.id.endsWith(b));
    if (!na || !nb) throw new Error('both memories must exist');
    na.links = [...new Set([...(na.links || []), nb.id])];
    nb.links = [...new Set([...(nb.links || []), na.id])];
  }, emptyBrain());
}

export async function brainThink(store, text, { project = null, agent = 'claude' } = {}) {
  const entry = { id: newId('j'), ts: now(), text: text.trim(), project, agent };
  await store.update(DOC.brain, (b) => {
    b.journal.unshift(entry);
    b.journal = b.journal.slice(0, LIMITS.journal);
  }, emptyBrain());
  return entry;
}

export function pruneCandidates(brain, threshold = 0.25) {
  const at = Date.now();
  return brain.nodes
    .filter((n) => !n.pinned)
    .map((n) => ({ n, s: strength(n, at) }))
    .filter((x) => x.s < threshold || x.n.status === 'stale')
    .sort((a, b) => a.s - b.s);
}

export async function brainPrune(store, id, reason, by = 'claude') {
  let removed;
  await store.update(DOC.brain, (b) => {
    const n = b.nodes.find((x) => x.id === id || x.id.endsWith(id));
    if (!n) throw new Error(`No memory ${id}`);
    removed = n;
    b.nodes = b.nodes.filter((x) => x !== n);
    for (const o of b.nodes) o.links = (o.links || []).filter((l) => l !== n.id);
    b.pruned.unshift({ id: n.id, type: n.type, title: n.title, reason, by, ts: now() });
    b.pruned = b.pruned.slice(0, LIMITS.pruned);
  }, emptyBrain());
  return removed;
}

// ---------------- vault (app side only; agent never has vaultKey) ----------------

export function vaultIndexFrom(vault) {
  return {
    items: vault.items.map(({ name, projects, note, expiresAt, updated }) => ({ name, projects, note, expiresAt, updated })),
    updated: now(),
  };
}

export function parseDotenv(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out.push({ name: m[1], value: v });
  }
  return out;
}
