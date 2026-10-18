// mc command implementations. Every data command runs inside tx() (pull → change → commit → push).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import * as M from '../app/js/model.js';
import { b64, generateAgentKeys, openSealed } from '../app/js/crypto.js';
import { loadConfig, saveConfig, ROOT, CONFIG_FILE, agentName } from './config.js';
import { tx, git, hasRemote, pull, push, commit, withLock } from './gitstore.js';
import { generateVapid } from './webpush.js';
import { notifyAll } from './notify.js';
import { c, ago, shortId, table, fail, list } from './util.js';

const out = (s = '') => process.stdout.write(s + '\n');
const json = (v) => out(JSON.stringify(v, null, 2));
const KIND_COLOR = { progress: c.green, decision: c.cyan, blocker: c.red, handoff: c.magenta, question: c.amber, note: c.dim, session: c.dim };
const HEAT_COLOR = { hot: c.red, warm: c.amber, cool: c.cyan, cold: c.dim };
const appUrl = (cfg, route = '') => (cfg.appUrl || `http://127.0.0.1:${cfg.port || 4317}/`) + route;

async function slugOf(store, q) {
  if (!q) fail('project required');
  return M.resolveSlug(store, q);
}

// ------------------------------------------------------------------ init

export async function init({ flags }) {
  const existing = loadConfig({ required: false });
  if (existing && !flags.force) fail(`Already initialised (${CONFIG_FILE}). Use --force to re-create agent keys.`);
  const dataDir = path.resolve(flags.data || path.join(ROOT, 'data'));
  fs.mkdirSync(path.join(dataDir, 'store'), { recursive: true });
  if (!fs.existsSync(path.join(dataDir, '.git'))) {
    git(dataDir, ['init', '--quiet', '-b', 'main']);
  }
  if (flags.remote && !hasRemote(dataDir)) git(dataDir, ['remote', 'add', 'origin', flags.remote]);

  const keysFile = path.join(dataDir, 'keys.json');
  let dek;
  if (fs.existsSync(keysFile) && existing?.dek) {
    dek = existing.dek; // re-key agent only
  } else if (fs.existsSync(keysFile)) {
    fail('keys.json exists but no local DEK. Ask Saied for a device key (mc pair) or re-init a fresh data dir.');
  } else {
    dek = b64.encode(crypto.randomBytes(32));
  }
  const agent = await generateAgentKeys();
  const vapid = existing?.vapid && !flags['new-vapid'] ? existing.vapid : generateVapid();

  const keys = fs.existsSync(keysFile)
    ? JSON.parse(fs.readFileSync(keysFile, 'utf8'))
    : { v: 1, claimed: false, createdAt: new Date().toISOString(), dek: null, vault: null };
  keys.agent = { name: 'claude', publicJwk: agent.publicJwk };
  keys.vapidPublicKey = vapid.publicKey;
  fs.writeFileSync(keysFile, JSON.stringify(keys, null, 2) + '\n');
  fs.writeFileSync(
    path.join(dataDir, 'README.md'),
    '# mission-control-data\n\nEncrypted storage for Mission Control. Every file is AES-256-GCM ciphertext with an opaque name.\nNothing here is readable without the key. Do not edit by hand.\n',
  );
  commit(dataDir, 'mc: init');

  saveConfig({
    ...(existing || {}),
    v: 1,
    dataDir,
    dek,
    agent,
    vapid,
    vapidSubject: existing?.vapidSubject || 'mailto:mission-control@localhost',
    port: existing?.port || 4317,
  });
  out(c.green('✓ Mission Control initialised'));
  out(`  data dir   ${dataDir}`);
  out(`  agent keys ${CONFIG_FILE} (chmod 600)`);
  if (!keys.claimed) out(`\nNext: ${c.bold('mc serve')} and open the claim link it prints to set your passphrases.`);
}

// ------------------------------------------------------------------ overview

export async function status({ flags }) {
  const cfg = loadConfig();
  await tx(cfg, async (store) => {
    const [projects, req, inbox, feed] = await Promise.all([
      M.listProjects(store),
      store.get(M.DOC.requests, { items: [] }),
      store.get(M.DOC.inbox, { items: [] }),
      M.radarFeed(store),
    ]);
    const pending = req.items.filter((r) => r.status === 'pending');
    const open = inbox.items.filter((i) => i.status === 'open');
    const soon = feed.filter((r) => M.daysUntil(r.date) <= 14);
    if (flags.json) return json({ projects, pending, inbox: open, radar: soon });
    out(c.bold('MISSION CONTROL') + c.dim(`  ${new Date().toDateString()}`));
    if (pending.length) out(c.amber(`\n⏳ ${pending.length} pending approval(s)`) + c.dim(`  ${appUrl(cfg, '#/approvals')}`));
    for (const r of pending) out(`   ${shortId(r.id)} ${r.type} ${r.secrets?.join(',') || r.text} ${c.dim(r.project || '')}`);
    if (open.length) {
      out(c.cyan(`\n📥 Inbox (${open.length} open)`));
      for (const i of open.slice(0, 8)) out(`   ${shortId(i.id)} ${c.dim(i.from + ':')} ${i.text}${i.project ? c.dim(' [' + i.project + ']') : ''}`);
    }
    if (soon.length) {
      out(c.magenta('\n📡 Radar'));
      for (const r of soon) {
        const d = M.daysUntil(r.date);
        out(`   ${(d < 0 ? c.red : d <= 3 ? c.amber : c.dim)(String(d).padStart(3) + 'd')} ${r.date} ${r.text} ${c.dim(r.project || '')}`);
      }
    }
    out(c.bold('\nProjects'));
    out(
      table(
        projects.map((p) => {
          const h = M.heat(p);
          return {
            slug: p.slug,
            heat: HEAT_COLOR[h](h),
            status: p.status,
            tasks: `${p.doing}/${p.open}`,
            next: (p.next || '').slice(0, 48),
            last: c.dim(ago(p.lastActivity || p.health?.lastCommitTs)),
          };
        }),
        ['slug', 'heat', 'status', 'tasks', 'next', 'last'],
      ),
    );
  }, { write: false });
}

/** Everything a fresh agent session needs to pick up a project. */
export async function brief({ pos, flags }) {
  const cfg = loadConfig();
  await tx(cfg, async (store) => {
    if (!pos[0]) return globalBrief(store, flags);
    const slug = await slugOf(store, pos[0]);
    const [p, log, inbox, reqs, brain, feed] = await Promise.all([
      M.getProject(store, slug),
      M.getLog(store, slug),
      store.get(M.DOC.inbox, { items: [] }),
      store.get(M.DOC.requests, { items: [] }),
      store.get(M.DOC.brain, M.emptyBrain()),
      M.radarFeed(store),
    ]);
    const n = Number(flags.limit || 12);
    const directives = inbox.items.filter((i) => i.status === 'open' && (i.project === slug || !i.project));
    const myReqs = reqs.items.filter((r) => r.project === slug).slice(0, 5);
    const memories = M.recall(brain, `${p.name} ${p.tags.join(' ')} ${p.stack.join(' ')}`, { project: slug, limit: 6 });
    const pins = brain.nodes.filter((m) => m.pinned);
    const radar = feed.filter((r) => r.project === slug && M.daysUntil(r.date) <= 30);
    if (flags.json) return json({ project: p, log: log.entries.slice(-n), directives, requests: myReqs, memories, pins, radar });

    out(`# ${p.name}  ${c.dim(`(${slug}, ${p.status})`)}`);
    if (p.tagline) out(p.tagline);
    out(c.dim(`path: ${p.path || '—'}   repo: ${p.repo || '—'}`));
    if (p.routerFile) out(c.amber(`Read first: ${path.join(p.path || '', p.routerFile)}`));
    if (p.health) out(c.dim(`git: ${p.health.branch} · ${p.health.dirty} uncommitted · last commit ${ago(p.health.lastCommitTs)} "${p.health.lastCommitMsg}"`));
    if (p.rules?.length) {
      out(c.bold('\n## Rules (hard)'));
      for (const r of p.rules) out(`- ${r}`);
    }
    for (const pin of pins) out(c.dim(`- [principle] ${pin.title}`));
    out(c.bold('\n## Handoff'));
    out(p.handoff ? `${c.dim(`${p.handoff.agent}, ${ago(p.handoff.ts)}:`)}\n${p.handoff.text}` : c.dim('(none yet — write one with mc handoff before you stop)'));
    if (directives.length) {
      out(c.bold('\n## Directives from Saied (open)'));
      for (const d of directives) out(`- [${shortId(d.id)}] ${d.text}${d.project ? '' : c.dim(' (global)')}`);
    }
    out(c.bold('\n## Board'));
    for (const col of M.COLUMNS.filter((x) => x.id !== 'done')) {
      const ts = p.board.tasks.filter((t) => t.col === col.id);
      if (!ts.length) continue;
      out(c.cyan(`${col.label}:`));
      for (const t of ts) out(`  ${shortId(t.id)} ${t.prio === 'urgent' || t.prio === 'high' ? c.amber('!' + t.prio) + ' ' : ''}${t.title}${t.note ? c.dim(' — ' + t.note.slice(0, 80)) : ''}`);
    }
    const done = p.board.tasks.filter((t) => t.col === 'done').slice(-3);
    if (done.length) out(c.dim('Recently done: ' + done.map((t) => t.title).join(' · ')));
    if (radar.length) {
      out(c.bold('\n## Radar'));
      for (const r of radar) out(`- ${r.date} (${M.daysUntil(r.date)}d) ${r.text}`);
    }
    if (myReqs.length) {
      out(c.bold('\n## Requests'));
      for (const r of myReqs) out(`- ${shortId(r.id)} ${r.status} ${r.type} ${r.secrets?.join(',') || r.text} ${c.dim(ago(r.ts))}`);
    }
    out(c.bold(`\n## Recent log (last ${n})`));
    for (const e of log.entries.slice(-n)) out(`${c.dim(e.ts.slice(0, 16).replace('T', ' '))} ${KIND_COLOR[e.kind]?.(e.kind.padEnd(8)) ?? e.kind} ${c.dim(e.agent + ':')} ${e.text}`);
    if (memories.length) {
      out(c.bold('\n## Relevant memories'));
      for (const m of memories) out(`- ${c.dim(shortId(m.id) + ' ' + m.type)} ${m.title}${m.body ? c.dim(' — ' + m.body.slice(0, 140)) : ''}`);
    }
    if (p.notes) out(c.bold('\n## Notes') + '\n' + p.notes);
    out(c.dim(`\nWhen you finish: mc log ${slug} "…" · mc handoff ${slug} "…" · tasks: mc task mv ${slug} <id> done`));
  }, { write: false });
}

async function globalBrief(store, flags) {
  const [projects, inbox, reqs, brain, feed] = await Promise.all([
    M.listProjects(store),
    store.get(M.DOC.inbox, { items: [] }),
    store.get(M.DOC.requests, { items: [] }),
    store.get(M.DOC.brain, M.emptyBrain()),
    M.radarFeed(store),
  ]);
  const data = {
    pins: brain.nodes.filter((m) => m.pinned),
    lastThought: brain.journal[0] || null,
    directives: inbox.items.filter((i) => i.status === 'open' && i.from !== 'claude'),
    questions: inbox.items.filter((i) => i.status === 'open' && i.from === 'claude'),
    pending: reqs.items.filter((r) => r.status === 'pending'),
    radar: feed.filter((r) => M.daysUntil(r.date) <= 14),
    hot: projects.filter((p) => ['hot', 'warm'].includes(M.heat(p))),
  };
  if (flags.json) return json(data);
  out(c.bold('# Mission Control — session brief'));
  out(c.dim('You are the head agent. Read a project brief before touching that repo: mc brief <project>'));
  out(c.bold('\n## Principles'));
  for (const m of data.pins) out(`- ${m.title}${m.body ? c.dim(' — ' + m.body.slice(0, 160)) : ''}`);
  if (data.lastThought) out(c.dim(`\nLast thought (${ago(data.lastThought.ts)}): ${data.lastThought.text}`));
  if (data.directives.length) {
    out(c.bold('\n## Saied says'));
    for (const d of data.directives) out(`- [${shortId(d.id)}] ${d.text}${d.project ? c.dim(' [' + d.project + ']') : ''}`);
  }
  if (data.pending.length) out(c.amber(`\n${data.pending.length} request(s) waiting on Saied.`));
  if (data.questions.length) out(c.dim(`${data.questions.length} open question(s) you asked Saied.`));
  if (data.radar.length) {
    out(c.bold('\n## Radar (≤14d)'));
    for (const r of data.radar) out(`- ${r.date} (${M.daysUntil(r.date)}d) ${r.text} ${c.dim(r.project || '')}`);
  }
  out(c.bold('\n## Projects'));
  for (const p of projects) {
    const h = M.heat(p);
    out(`- ${HEAT_COLOR[h](h.padEnd(4))} ${p.slug.padEnd(22)} ${c.dim(p.status.padEnd(8))} ${p.next || c.dim('—')}`);
  }
}

// ------------------------------------------------------------------ projects

export async function project({ pos, flags }) {
  const cfg = loadConfig();
  const sub = pos[0] || 'ls';
  await tx(cfg, async (store) => {
    if (sub === 'ls') {
      const ps = await M.listProjects(store);
      if (flags.json) return json(ps);
      out(table(ps.map((p) => ({ slug: p.slug, name: p.name, status: p.status, open: p.open, tagline: c.dim((p.tagline || '').slice(0, 60)) })), ['slug', 'name', 'status', 'open', 'tagline']));
    } else if (sub === 'add') {
      const name = pos[1] || fail('mc project add "<name>" [--slug s --path p --repo url --tagline t --status s --color #hex --tags a,b --stack a,b]');
      const p = await M.createProject(store, {
        name,
        slug: flags.slug,
        path: flags.path ? path.resolve(flags.path) : '',
        repo: flags.repo || '',
        tagline: flags.tagline || '',
        status: flags.status || 'active',
        color: flags.color || '#5ee7ff',
        tags: list(flags.tags),
        stack: list(flags.stack),
      });
      await M.appendLog(store, p.slug, { kind: 'note', text: `Project added to Mission Control`, agent: agentName() });
      out(c.green(`✓ ${p.slug}`));
    } else if (sub === 'show') {
      const slug = await slugOf(store, pos[1]);
      const p = await M.getProject(store, slug);
      json(flags.full ? p : { ...p, board: `${p.board.tasks.length} tasks (mc task ls ${slug})` });
    } else if (sub === 'set') {
      const slug = await slugOf(store, pos[1]);
      const field = pos[2];
      const value = pos.slice(3).join(' ');
      const allowed = ['name', 'tagline', 'status', 'color', 'path', 'paths', 'repo', 'notes', 'routerFile', 'tags', 'stack', 'rules'];
      if (!allowed.includes(field)) fail(`field must be one of ${allowed.join(', ')}`);
      if (field === 'status' && !M.PROJECT_STATUSES.includes(value)) fail(`status must be one of ${M.PROJECT_STATUSES.join(', ')}`);
      await M.saveProject(store, slug, (p) => {
        if (['tags', 'stack'].includes(field)) p[field] = list(value);
        else if (field === 'paths') p.paths = list(value).map((x) => path.resolve(x));
        else if (field === 'rules') p.rules = [...(p.rules || []), value];
        else p[field] = value;
      });
      out(c.green(`✓ ${slug}.${field} updated`));
    } else if (sub === 'link') {
      const slug = await slugOf(store, pos[1]);
      await M.saveProject(store, slug, (p) => {
        p.links.push({ label: pos[2], url: pos[3] });
      });
      out(c.green('✓ link added'));
    } else if (sub === 'rm') {
      const slug = await slugOf(store, pos[1]);
      if (!flags.yes) fail(`This deletes ${slug}'s board and log. Re-run with --yes.`);
      await M.deleteProject(store, slug);
      out(c.green(`✓ removed ${slug}`));
    } else fail('mc project ls|add|show|set|link|rm');
  }, { write: sub !== 'ls' && sub !== 'show' });
}

// ------------------------------------------------------------------ log / handoff / session

export async function log({ pos, flags }) {
  const cfg = loadConfig();
  if (pos[0] === 'show' || pos[0] === 'tail') {
    return tx(cfg, async (store) => {
      const slug = await slugOf(store, pos[1]);
      const { entries } = await M.getLog(store, slug);
      const sel = entries.filter((e) => !flags.kind || e.kind === flags.kind).slice(-Number(flags.limit || 20));
      if (flags.json) return json(sel);
      for (const e of sel) out(`${c.dim(e.ts.slice(0, 16).replace('T', ' '))} ${KIND_COLOR[e.kind]?.(e.kind.padEnd(8)) ?? e.kind} ${c.dim(e.agent + ':')} ${e.text}`);
    }, { write: false });
  }
  const text = pos.slice(1).join(' ');
  if (!pos[0] || !text) fail('mc log <project> "<what happened>" [--kind progress|decision|blocker|question|note] [--files a,b]');
  await tx(cfg, async (store) => {
    const slug = await slugOf(store, pos[0]);
    const kind = flags.kind || 'progress';
    await M.appendLog(store, slug, { kind, text, agent: agentName(), files: list(flags.files) });
    if (kind === 'blocker' || kind === 'question') {
      await notifyAll(cfg, store, { title: `${kind === 'blocker' ? '⛔ Blocker' : '❓ Question'} · ${slug}`, body: text.slice(0, 180), url: `#/p/${slug}`, tag: `log-${slug}`, kind }, kind === 'blocker' ? 'blockers' : 'questions');
    }
    out(c.green(`✓ logged to ${slug}`));
  });
}

export async function handoff({ pos }) {
  const cfg = loadConfig();
  const text = pos.slice(1).join(' ') || (!process.stdin.isTTY ? fs.readFileSync(0, 'utf8') : '');
  if (!pos[0] || !text.trim()) fail('mc handoff <project> "<state + exact next step for the next agent>"   (or pipe markdown on stdin)');
  await tx(cfg, async (store) => {
    const slug = await slugOf(store, pos[0]);
    await M.setHandoff(store, slug, text, agentName());
    await notifyAll(cfg, store, { title: `🤝 Handoff · ${slug}`, body: text.slice(0, 180), url: `#/p/${slug}`, tag: `handoff-${slug}`, kind: 'handoff', urgency: 'normal' }, 'handoffs');
    out(c.green(`✓ handoff saved for ${slug}`));
  });
}

export async function session({ pos, flags }) {
  const cfg = loadConfig();
  const [sub, proj] = pos;
  if (sub !== 'start' || !proj) fail('mc session start <project> ["goal"]   (logs the start and prints the brief)');
  await tx(cfg, async (store) => {
    const slug = await slugOf(store, proj);
    await M.appendLog(store, slug, { kind: 'session', text: `Session started${pos[2] ? ': ' + pos.slice(2).join(' ') : ''}`, agent: agentName() });
  });
  return brief({ pos: [proj], flags });
}

// ------------------------------------------------------------------ tasks

export async function task({ pos, flags }) {
  const cfg = loadConfig();
  const [sub, proj, ...rest] = pos;
  const by = agentName();
  await tx(cfg, async (store) => {
    const slug = await slugOf(store, proj);
    if (sub === 'ls') {
      const p = await M.getProject(store, slug);
      const ts = p.board.tasks.filter((t) => (flags.col ? t.col === flags.col : flags.all || t.col !== 'done'));
      if (flags.json) return json(ts);
      for (const col of M.COLUMNS) {
        const items = ts.filter((t) => t.col === col.id);
        if (!items.length) continue;
        out(c.cyan(col.label));
        for (const t of items) out(`  ${shortId(t.id)} ${c.dim('[' + t.prio + ']')} ${t.title}${t.note ? c.dim(' — ' + t.note) : ''}`);
      }
    } else if (sub === 'add') {
      const title = rest.join(' ') || fail('mc task add <project> "<title>" [--col next --prio med --note ""]');
      const t = await M.addTask(store, slug, { title, col: flags.col || 'next', prio: flags.prio || 'med', note: flags.note || '', tags: list(flags.tags), by });
      out(c.green(`✓ ${shortId(t.id)} ${t.title} → ${t.col}`));
    } else if (sub === 'mv' || sub === 'move') {
      const [id, col] = rest;
      if (!id || !col) fail('mc task mv <project> <id> <backlog|next|doing|review|done>');
      const t = await M.updateTask(store, slug, id, { col }, by);
      out(c.green(`✓ ${t.title} → ${col}`));
    } else if (sub === 'done' || sub === 'start') {
      const t = await M.updateTask(store, slug, rest[0] || fail(`mc task ${sub} <project> <id>`), { col: sub === 'done' ? 'done' : 'doing' }, by);
      out(c.green(`✓ ${t.title} → ${t.col}`));
    } else if (sub === 'edit') {
      const patch = {};
      for (const k of ['title', 'note', 'prio', 'col']) if (flags[k]) patch[k] = flags[k];
      const t = await M.updateTask(store, slug, rest[0], patch, by);
      out(c.green(`✓ ${shortId(t.id)} updated`));
    } else if (sub === 'rm') {
      await M.removeTask(store, slug, rest[0]);
      out(c.green('✓ removed'));
    } else fail('mc task ls|add|mv|start|done|edit|rm <project> …');
  }, { write: sub !== 'ls' });
}

// ------------------------------------------------------------------ inbox / ask / radar

export async function inbox({ pos, flags }) {
  const cfg = loadConfig();
  const sub = pos[0] || 'ls';
  await tx(cfg, async (store) => {
    if (sub === 'ls') {
      const d = await store.get(M.DOC.inbox, { items: [] });
      const items = d.items.filter((i) => flags.all || i.status === 'open');
      if (flags.json) return json(items);
      if (!items.length) return out(c.dim('Inbox zero.'));
      for (const i of items) out(`${shortId(i.id)} ${c.dim(ago(i.ts))} ${i.from === 'claude' ? c.amber('you asked:') : c.cyan(i.from + ':')} ${i.text}${i.project ? c.dim(' [' + i.project + ']') : ''}${i.reply ? '\n       ↳ ' + i.reply : ''}`);
    } else if (sub === 'done') {
      await M.resolveInbox(store, pos[1], agentName(), pos.slice(2).join(' ') || flags.reply || '');
      out(c.green('✓ marked done'));
    } else if (sub === 'add') {
      await M.addInbox(store, { from: flags.from || agentName(), text: pos.slice(1).join(' '), project: flags.project ? await slugOf(store, flags.project) : null });
      out(c.green('✓ added'));
    } else fail('mc inbox [ls|add|done <id> "reply"]');
  }, { write: sub !== 'ls' });
}

/** Ask Saied a question; it lands in his inbox and pushes to his phone. */
export async function ask({ pos, flags }) {
  const cfg = loadConfig();
  const text = pos.join(' ') || fail('mc ask "<question>" [--project p]');
  await tx(cfg, async (store) => {
    const project = flags.project ? await slugOf(store, flags.project) : null;
    const item = await M.addInbox(store, { from: agentName(), text, project });
    const r = await notifyAll(cfg, store, { title: `❓ ${project || 'Claude'} asks`, body: text.slice(0, 200), url: '#/inbox', tag: item.id, kind: 'question' }, 'questions');
    out(c.green(`✓ asked (${shortId(item.id)})`) + c.dim(r.sent ? ` · pushed to ${r.sent} device(s)` : ''));
  });
}

export async function radar({ pos, flags }) {
  const cfg = loadConfig();
  const sub = pos[0] || 'ls';
  await tx(cfg, async (store) => {
    if (sub === 'ls') {
      const feed = await M.radarFeed(store);
      if (flags.json) return json(feed);
      for (const r of feed) out(`${String(M.daysUntil(r.date)).padStart(4)}d ${r.date} ${shortId(r.id)} ${r.text} ${c.dim(r.project || '')}`);
    } else if (sub === 'add') {
      const [, date, ...t] = pos;
      const item = await M.addRadar(store, { date, text: t.join(' '), project: flags.project ? await slugOf(store, flags.project) : null, kind: flags.kind || 'deadline' });
      out(c.green(`✓ ${item.date} ${item.text}`));
    } else if (sub === 'rm') {
      await M.removeRadar(store, pos[1]);
      out(c.green('✓ removed'));
    } else if (sub === 'check') {
      // Push anything due within --days (default 3). Intended for a daily timer.
      const days = Number(flags.days || 3);
      const due = (await M.radarFeed(store)).filter((r) => M.daysUntil(r.date) <= days);
      for (const r of due) {
        const d = M.daysUntil(r.date);
        await notifyAll(cfg, store, { title: `📡 ${d < 0 ? 'Overdue' : d === 0 ? 'Today' : `In ${d}d`}: ${r.text}`, body: `${r.date}${r.project ? ' · ' + r.project : ''}`, url: '#/radar', tag: `radar-${r.id}`, kind: 'radar' }, 'radar');
      }
      out(`${due.length} radar item(s) due within ${days}d`);
    } else fail('mc radar [ls|add YYYY-MM-DD "text" --project p|rm <id>|check --days 3]');
  }, { write: sub !== 'ls' });
}

// ------------------------------------------------------------------ approvals

export async function request({ pos, flags }) {
  const cfg = loadConfig();
  const sub = pos[0];
  if (sub === 'action') {
    const text = pos.slice(1).join(' ') || fail('mc request action "<what you want to do>" --project p [--wait]');
    const req = await tx(cfg, async (store) => {
      const project = flags.project ? await slugOf(store, flags.project) : null;
      const r = await M.createRequest(store, { type: 'action', project, text, reason: flags.reason || '', agent: agentName() });
      await notifyAll(cfg, store, { title: `🛂 Approval needed${project ? ' · ' + project : ''}`, body: text.slice(0, 200), url: '#/approvals', tag: r.id, kind: 'request' }, 'requests');
      return r;
    });
    out(c.green(`✓ request ${req.id} sent to Saied`));
    if (flags.wait) return waitFor(cfg, req.id, flags);
    return;
  }
  if (sub === 'status' || sub === 'wait') {
    const id = pos[1] || fail(`mc request ${sub} <id>`);
    if (sub === 'wait') return waitFor(cfg, id, flags);
    return tx(cfg, async (store) => {
      const r = (await store.get(M.DOC.requests, { items: [] })).items.find((x) => x.id === id || x.id.endsWith(id));
      if (!r) fail(`no request ${id}`);
      flags.json ? json(r) : out(`${r.id} ${r.status}${r.note ? ' — ' + r.note : ''}`);
    }, { write: false });
  }
  if (sub === 'ls' || !sub) {
    return tx(cfg, async (store) => {
      const d = await store.get(M.DOC.requests, { items: [] });
      const items = d.items.filter((r) => flags.all || ['pending', 'approved'].includes(r.status)).slice(0, 30);
      if (flags.json) return json(items);
      for (const r of items) out(`${r.id} ${(r.status === 'pending' ? c.amber : r.status === 'approved' ? c.green : c.dim)(r.status.padEnd(8))} ${r.type.padEnd(6)} ${r.secrets?.join(',') || r.text} ${c.dim((r.project || '') + ' ' + ago(r.ts))}${r.note ? '\n   ↳ ' + r.note : ''}`);
    }, { write: false });
  }
  fail('mc request action "<text>" --project p [--wait] | status <id> | wait <id> | ls');
}

async function waitFor(cfg, id, flags) {
  const timeout = Number(flags.timeout || 600) * 1000;
  const start = Date.now();
  process.stderr.write(c.dim(`waiting for Saied (${Math.round(timeout / 60000)}m max)… `));
  for (;;) {
    const r = await tx(cfg, async (store) => (await store.get(M.DOC.requests, { items: [] })).items.find((x) => x.id === id || x.id.endsWith(id)), { write: false });
    if (!r) fail(`no request ${id}`);
    if (r.status !== 'pending') {
      process.stderr.write('\n');
      out(`${r.status === 'approved' ? c.green('APPROVED') : c.red(r.status.toUpperCase())}${r.note ? ' — ' + r.note : ''}`);
      process.exitCode = r.status === 'approved' ? 0 : 3;
      return r;
    }
    if (Date.now() - start > timeout) {
      process.stderr.write('\n');
      out(c.amber('still pending (timed out waiting) — check later with mc request status ' + shortId(r.id)));
      process.exitCode = 4;
      return r;
    }
    await new Promise((res) => setTimeout(res, 15000));
    pull(cfg.dataDir, { force: true });
  }
}

// ------------------------------------------------------------------ secrets (agent never sees the vault)

export async function secret({ pos, flags, rest }) {
  const cfg = loadConfig();
  const sub = pos[0];
  if (sub === 'ls' || !sub) {
    return tx(cfg, async (store) => {
      const vi = await store.get(M.DOC.vaultIndex, { items: [] });
      if (flags.json) return json(vi.items);
      if (!vi.items.length) return out(c.dim('Vault is empty (or not unlocked yet by Saied).'));
      for (const s of vi.items) out(`${s.name.padEnd(32)} ${c.dim((s.projects || []).join(','))}${s.expiresAt ? c.amber(' expires ' + s.expiresAt.slice(0, 10)) : ''}${s.note ? c.dim(' — ' + s.note) : ''}`);
    }, { write: false });
  }
  if (sub === 'request') {
    const names = pos.slice(1).flatMap((n) => list(n));
    if (!names.length || !flags.reason) fail('mc secret request NAME[,NAME] --project p --reason "why" [--ttl once|1h|24h|7d] [--wait]');
    const ttl = flags.ttl || 'once';
    if (!M.TTL[ttl]) fail('ttl must be once|1h|24h|7d');
    const req = await tx(cfg, async (store) => {
      const project = flags.project ? await slugOf(store, flags.project) : null;
      const vi = await store.get(M.DOC.vaultIndex, { items: [] });
      const missing = names.filter((n) => !vi.items.some((s) => s.name === n));
      const r = await M.createRequest(store, { type: 'secret', project, secrets: names, reason: flags.reason, ttl, agent: agentName(), agentPublicJwk: cfg.agent.publicJwk });
      await notifyAll(cfg, store, { title: `🔐 Secret request${project ? ' · ' + project : ''}`, body: `${names.join(', ')} (${M.TTL[ttl].label}) — ${flags.reason}`.slice(0, 220), url: '#/approvals', tag: r.id, kind: 'request' }, 'requests');
      if (missing.length) out(c.amber(`note: not in vault yet: ${missing.join(', ')} — Saied will need to add them`));
      return r;
    });
    out(c.green(`✓ request ${req.id} sent`) + c.dim(` · approve at ${appUrl(cfg, '#/approvals')}`));
    if (flags.wait) return waitFor(cfg, req.id, flags);
    return;
  }
  if (sub === 'exec') {
    const names = list(pos[1]);
    if (!names.length || !rest?.length) fail('mc secret exec NAME[,NAME] [--request id] -- <command> [args…]');
    const secrets = await tx(cfg, (store) => redeemGrant(cfg, store, names, flags.request));
    const child = spawn(rest[0], rest.slice(1), { stdio: 'inherit', env: { ...process.env, ...secrets } });
    return new Promise((resolve) => {
      child.on('exit', (code, sig) => {
        process.exitCode = code ?? (sig ? 1 : 0);
        resolve();
      });
      child.on('error', (e) => {
        process.stderr.write(`mc: ${e.message}\n`);
        process.exitCode = 127;
        resolve();
      });
    });
  }
  if (sub === 'write-env') {
    // Writes approved secrets into a project's .env file (0600) without printing them.
    const names = list(pos[1]);
    const file = pos[2] || fail('mc secret write-env NAME[,NAME] <path/to/.env> [--request id]');
    const secrets = await tx(cfg, (store) => redeemGrant(cfg, store, names, flags.request, `write-env ${file}`));
    const abs = path.resolve(file);
    let text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    for (const [k, v] of Object.entries(secrets)) {
      const line = `${k}=${/[\s#"'$]/.test(v) ? JSON.stringify(v) : v}`;
      const re = new RegExp(`^${k.replace(/[.]/g, '\\.')}=.*$`, 'm');
      text = re.test(text) ? text.replace(re, () => line) : text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n';
    }
    fs.writeFileSync(abs, text, { mode: 0o600 });
    fs.chmodSync(abs, 0o600);
    out(c.green(`✓ wrote ${Object.keys(secrets).join(', ')} to ${abs} (0600)`));
    const dir = path.dirname(abs);
    try {
      execFileSync('git', ['check-ignore', '-q', abs], { cwd: dir, stdio: 'ignore' });
    } catch (e) {
      if (e.status === 1) out(c.red(`⚠ ${path.basename(abs)} is NOT git-ignored in ${dir} — add it to .gitignore before committing!`));
    }
    return;
  }
  if (sub === 'grants') {
    return tx(cfg, async (store) => {
      const reqs = (await store.get(M.DOC.requests, { items: [] })).items.filter((r) => r.type === 'secret' && r.status === 'approved');
      for (const r of reqs) {
        const g = await store.get(M.DOC.grant(r.id), null);
        if (!g) continue;
        const live = Date.parse(g.expiresAt) > Date.now() && (g.uses == null || g.used < g.uses);
        out(`${r.id} ${live ? c.green('live') : c.dim('spent')} ${r.secrets.join(',')} ${c.dim(`used ${g.used}${g.uses ? '/' + g.uses : ''} · expires ${ago(g.expiresAt).replace(' ago', '') }`)}`);
      }
    }, { write: false });
  }
  fail('mc secret ls | request NAME… --project p --reason r [--ttl] [--wait] | exec NAME… -- cmd | write-env NAME… .env | grants');
}

async function redeemGrant(cfg, store, names, requestId, purpose = 'exec') {
  const reqs = (await store.get(M.DOC.requests, { items: [] })).items.filter(
    (r) => r.type === 'secret' && r.status === 'approved' && (!requestId || r.id === requestId || r.id.endsWith(requestId)) && names.every((n) => r.secrets.includes(n)),
  );
  for (const r of reqs) {
    const g = await store.get(M.DOC.grant(r.id), null);
    if (!g) continue;
    if (Date.parse(g.expiresAt) <= Date.now() || (g.uses != null && g.used >= g.uses)) {
      await store.remove(M.DOC.grant(r.id));
      await M.resolveRequest(store, r.id, { status: 'expired' }, 'system');
      continue;
    }
    const sealed = await openSealed(cfg.agent.privateJwk, g.box);
    if (sealed.requestId !== r.id) continue;
    const used = g.used + 1;
    if (g.uses != null && used >= g.uses) await store.remove(M.DOC.grant(r.id));
    else await store.put(M.DOC.grant(r.id), { ...g, used }, (await store.getV(M.DOC.grant(r.id))).version);
    await M.audit(store, agentName(), `secret.${purpose.split(' ')[0]}`, names.join(','), r.project);
    const picked = {};
    for (const n of names) {
      if (sealed.secrets[n] === undefined) fail(`grant ${r.id} lacks ${n}`);
      picked[n] = sealed.secrets[n];
    }
    return picked;
  }
  fail(`No live approval covers ${names.join(', ')}. Ask: mc secret request ${names.join(',')} --project <p> --reason "<why>" --wait`);
}

// ------------------------------------------------------------------ brain

export async function brain({ pos, flags }) {
  const cfg = loadConfig();
  const sub = pos[0] || 'stats';
  const write = !['recall', 'ls', 'show', 'stats', 'journal', 'candidates'].includes(sub) || (sub === 'recall' && !flags['no-touch']);
  await tx(cfg, async (store) => {
    const b = await store.get(M.DOC.brain, M.emptyBrain());
    const fmt = (m) => `${c.dim(shortId(m.id))} ${c.cyan(m.type.padEnd(9))} ${(M.strength(m) * 100).toFixed(0).padStart(3)}% ${m.pinned ? c.amber('📌 ') : ''}${m.title}`;
    switch (sub) {
      case 'add': {
        const title = pos.slice(1).join(' ') || fail('mc brain add "<title>" [--type insight] [--body ""] [--tags a,b] [--projects p] [--confidence 0.7] [--pin]');
        const m = await M.brainAdd(store, { type: flags.type || 'insight', title, body: flags.body || '', tags: list(flags.tags), projects: list(flags.projects), confidence: Number(flags.confidence || 0.7), pinned: !!flags.pin, source: agentName() });
        if (flags.link) for (const l of list(flags.link)) await M.brainLink(store, m.id, l);
        return out(c.green(`✓ remembered ${shortId(m.id)}`));
      }
      case 'recall': {
        const hits = M.recall(b, pos.slice(1).join(' '), { limit: Number(flags.limit || 8), project: flags.project });
        if (!flags['no-touch']) await M.brainTouch(store, hits.map((m) => m.id));
        if (flags.json) return json(hits);
        if (!hits.length) return out(c.dim('nothing comes to mind'));
        for (const m of hits) out(fmt(m) + (m.body ? '\n      ' + c.dim(m.body.replace(/\n/g, ' ').slice(0, 220)) : ''));
        return;
      }
      case 'ls':
        for (const m of [...b.nodes].sort((x, y) => M.strength(y) - M.strength(x)).filter((m) => !flags.type || m.type === flags.type)) out(fmt(m));
        return;
      case 'show': {
        const m = b.nodes.find((x) => x.id.endsWith(pos[1]));
        return m ? json({ ...m, strength: M.strength(m) }) : fail('not found');
      }
      case 'think': {
        const text = pos.slice(1).join(' ') || fail('mc brain think "<reflection>" [--project p]');
        await M.brainThink(store, text, { project: flags.project || null, agent: agentName() });
        return out(c.green('✓ noted in journal'));
      }
      case 'journal':
        for (const j of b.journal.slice(0, Number(flags.limit || 10))) out(`${c.dim(j.ts.slice(0, 16).replace('T', ' '))} ${j.project ? c.cyan('[' + j.project + '] ') : ''}${j.text}`);
        return;
      case 'update': {
        const patch = {};
        for (const k of ['title', 'body', 'type']) if (flags[k]) patch[k] = flags[k];
        if (flags.confidence) patch.confidence = Number(flags.confidence);
        if (flags.tags) patch.tags = list(flags.tags);
        if (flags.projects) patch.projects = list(flags.projects);
        await M.brainUpdate(store, pos[1], patch);
        return out(c.green('✓ updated'));
      }
      case 'pin':
      case 'unpin':
        await M.brainUpdate(store, pos[1], { pinned: sub === 'pin' });
        return out(c.green(`✓ ${sub}ned`));
      case 'link':
        await M.brainLink(store, pos[1], pos[2]);
        return out(c.green('✓ linked'));
      case 'candidates':
      case 'prune': {
        if (sub === 'prune' && pos[1]) {
          const reason = pos.slice(2).join(' ') || flags.reason || fail('mc brain prune <id> "<why it no longer serves>"');
          const m = await M.brainPrune(store, pos[1], reason, agentName());
          return out(c.green(`✓ forgot "${m.title}"`));
        }
        const cands = M.pruneCandidates(b, Number(flags.threshold || 0.25));
        if (!cands.length) return out(c.dim('Nothing weak enough to prune. Brain is healthy.'));
        out(c.bold('Prune candidates (weakest first). Forget with: mc brain prune <id> "<reason>"'));
        for (const { n } of cands) out(fmt(n) + c.dim(` · used ${n.uses || 0}× · touched ${ago(n.touched)}`));
        return;
      }
      case 'stats': {
        const by = {};
        for (const m of b.nodes) by[m.type] = (by[m.type] || 0) + 1;
        const avg = b.nodes.length ? b.nodes.reduce((s, m) => s + M.strength(m), 0) / b.nodes.length : 0;
        out(`${b.nodes.length} memories · ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
        out(`avg strength ${(avg * 100).toFixed(0)}% · ${b.journal.length} journal entries · ${b.pruned.length} forgotten · ${M.pruneCandidates(b).length} prune candidates`);
        return;
      }
      default:
        fail('mc brain add|recall|ls|show|think|journal|update|pin|unpin|link|candidates|prune|stats');
    }
  }, { write });
}

// ------------------------------------------------------------------ scan (git health of every project)

function gitHealth(dir) {
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    g(['rev-parse', '--git-dir']);
  } catch {
    return { git: false, path: dir };
  }
  const h = { git: true, path: dir, scannedAt: new Date().toISOString() };
  try {
    h.branch = g(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {}
  try {
    const [ts, msg] = g(['log', '-1', '--format=%cI%x00%s']).split('\0');
    Object.assign(h, { lastCommitTs: ts, lastCommitMsg: msg.slice(0, 120) });
  } catch {}
  try {
    h.dirty = g(['status', '--porcelain']).split('\n').filter(Boolean).length;
  } catch {}
  try {
    const [behind, ahead] = g(['rev-list', '--left-right', '--count', '@{u}...HEAD']).split(/\s+/).map(Number);
    Object.assign(h, { ahead, behind });
  } catch {}
  return h;
}

export async function scan({ flags }) {
  const cfg = loadConfig();
  await tx(cfg, async (store) => {
    for (const p of await M.listProjects(store)) {
      const full = await M.getProject(store, p.slug);
      if (!full.path || !fs.existsSync(full.path)) continue;
      let h = gitHealth(full.path);
      if (!h.git) {
        // some projects keep their repo one level down (e.g. VASMA/v0-VASMA-Supabase)
        const sub = fs.readdirSync(full.path, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(full.path, d.name, '.git')));
        if (sub.length) h = gitHealth(path.join(full.path, sub[0].name));
      }
      await M.saveProject(store, p.slug, (x) => {
        x.health = h;
      });
      if (!flags.quiet) out(`${p.slug.padEnd(22)} ${h.git ? `${h.branch} · ${h.dirty} dirty · ${ago(h.lastCommitTs)}${h.ahead ? c.amber(` · ${h.ahead} unpushed`) : ''}` : c.dim('no git')}`);
    }
  });
}

// ------------------------------------------------------------------ misc

export async function notify({ pos, flags }) {
  const cfg = loadConfig();
  const [title, ...body] = pos;
  if (!title) fail('mc notify "<title>" "<body>" [--url #/p/slug]');
  await tx(cfg, async (store) => {
    const r = await notifyAll(cfg, store, { title, body: body.join(' '), url: flags.url || '#/', tag: flags.tag || 'agent', kind: 'agent' }, 'agent');
    out(r.sent ? c.green(`✓ pushed to ${r.sent} device(s)`) : c.amber(`not sent (${r.skipped || r.error})`));
  });
}

export async function deck({ pos }) {
  const cfg = loadConfig();
  if (pos[0] !== 'publish') fail('mc deck publish   (encrypts deck/index.html into the data repo so the app can show it remotely)');
  const file = path.join(ROOT, 'deck', 'index.html');
  if (!fs.existsSync(file)) fail(`missing ${file}`);
  const html = fs.readFileSync(file, 'utf8');
  await tx(cfg, async (store) => {
    await store.put(M.DOC.deck, { html, updated: new Date().toISOString() }, (await store.getV(M.DOC.deck)).version);
  });
  out(c.green(`✓ deck published (${(html.length / 1024).toFixed(0)} KB, encrypted)`));
}

export async function sync() {
  const cfg = loadConfig();
  await withLock(cfg.dataDir, async () => {
    commit(cfg.dataDir);
    out(`pull: ${pull(cfg.dataDir, { force: true })}`);
    const p = push(cfg.dataDir);
    out(`push: ${p.ok ? 'ok' : p.out}`);
  });
}

export async function seed({ pos, flags }) {
  const cfg = loadConfig();
  const file = pos[0] || fail('mc seed <seed.json>');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  await tx(cfg, async (store) => {
    const known = new Set((await M.listProjects(store)).map((p) => p.slug));
    for (const p of s.projects || []) {
      if (known.has(p.slug) && !flags.force) {
        out(c.dim(`skip ${p.slug} (exists)`));
        continue;
      }
      const { tasks = [], log: entries = [], handoff: ho, ...fields } = p;
      if (known.has(p.slug)) await M.deleteProject(store, p.slug);
      await M.createProject(store, fields);
      await M.saveProject(store, p.slug, (x) => {
        x.board.tasks = tasks.map((t) => ({ id: M.newId('t'), title: t.title, col: t.col || 'backlog', prio: t.prio || 'med', note: t.note || '', tags: t.tags || [], by: 'seed', created: M.now(), updated: M.now() }));
        if (ho) x.handoff = { text: ho, ts: M.now(), agent: 'claude' };
      });
      await store.put(M.DOC.log(p.slug), {
        entries: [
          ...entries.map((e) => ({ id: M.newId('l'), ts: e.ts || M.now(), kind: e.kind || 'note', agent: e.agent || 'history', text: e.text, files: [], tasks: [] })),
          { id: M.newId('l'), ts: M.now(), kind: 'note', agent: 'claude', text: 'Imported into Mission Control', files: [], tasks: [] },
        ],
      });
      const full = await M.getProject(store, p.slug);
      const idx = await store.getV(M.DOC.index);
      idx.value.projects[p.slug] = { ...M.summarize(full, idx.value.projects[p.slug]), lastActivity: entries.at(-1)?.ts || null, lastLine: entries.at(-1)?.text || '' };
      await store.put(M.DOC.index, idx.value, idx.version);
      out(c.green(`✓ ${p.slug}`) + c.dim(` ${tasks.length} tasks, ${entries.length} log`));
    }
    // rebuild the activity feed from every project's log so the dashboard starts with history
    const all = [];
    for (const slug of (await M.listProjects(store)).map((x) => x.slug)) {
      for (const e of (await M.getLog(store, slug)).entries) all.push({ id: e.id, ts: e.ts, kind: e.kind, agent: e.agent, text: e.text, slug });
    }
    await store.update(M.DOC.index, (idx) => {
      idx.activity = all.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 250);
    });
    for (const r of s.radar || []) await M.addRadar(store, { ...r, project: r.project || null });
    const b = await store.get(M.DOC.brain, M.emptyBrain());
    for (const m of s.brain || []) if (!b.nodes.some((n) => n.title === m.title)) await M.brainAdd(store, { ...m, source: 'seed' });
    for (const i of s.inbox || []) await M.addInbox(store, i);
    out(c.green(`✓ radar ${s.radar?.length || 0} · brain ${s.brain?.length || 0} · inbox ${s.inbox?.length || 0}`));
  });
}

export async function doctor() {
  const cfg = loadConfig({ required: false });
  const ok = (b, msg) => out(`${b ? c.green('✓') : c.red('✗')} ${msg}`);
  ok(!!cfg, `agent config ${CONFIG_FILE}`);
  if (!cfg) return;
  const mode = (fs.statSync(CONFIG_FILE).mode & 0o777).toString(8);
  ok(mode === '600', `config permissions ${mode}`);
  ok(fs.existsSync(path.join(cfg.dataDir, '.git')), `data repo ${cfg.dataDir}`);
  const keys = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, 'keys.json'), 'utf8'));
  ok(keys.claimed, `claimed by Saied (passphrases set)`);
  ok(keys.agent?.publicJwk?.x === cfg.agent.publicJwk.x, 'agent key matches keys.json');
  ok(keys.vapidPublicKey === cfg.vapid.publicKey, 'VAPID key matches');
  ok(!('vaultKey' in cfg), 'agent holds no vault key');
  ok(hasRemote(cfg.dataDir), `data remote ${hasRemote(cfg.dataDir) ? git(cfg.dataDir, ['remote', 'get-url', 'origin']) : '(none — local only)'}`);
  await tx(cfg, async (store) => {
    const subs = await store.get(M.DOC.pushSubs, { items: [] });
    ok(subs.items.length > 0, `${subs.items.length} push device(s)`);
    const ps = await M.listProjects(store);
    ok(ps.length > 0, `${ps.length} projects`);
  }, { write: false });
}

export async function config({ pos }) {
  const cfg = loadConfig();
  const [k, v] = pos;
  const allowed = ['appUrl', 'vapidSubject', 'port'];
  if (!k) return json(Object.fromEntries(allowed.map((x) => [x, cfg[x]])));
  if (!allowed.includes(k)) fail(`settable: ${allowed.join(', ')}`);
  cfg[k] = k === 'port' ? Number(v) : v;
  saveConfig(cfg);
  out(c.green(`✓ ${k} = ${cfg[k]}`));
}
