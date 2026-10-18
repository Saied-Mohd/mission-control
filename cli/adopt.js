// mc adopt — wire project repos into Mission Control so ANY agent working inside them keeps it current.
//   1. a managed "Mission Control" section in the repo's router file (CLAUDE.md / AGENTS.md)
//   2. a git post-commit hook that logs every commit to the project's agent log
// mc hook — entry points for those hooks and for global Claude Code hooks (SessionStart / SessionEnd).
// mc hooks install — registers the Claude Code hooks in ~/.claude/settings.json.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as M from '../app/js/model.js';
import { loadConfig, CONFIG_DIR, ROOT } from './config.js';
import { tx } from './gitstore.js';
import { c, fail } from './util.js';

const MC_BIN = fileURLToPath(new URL('../bin/mc.js', import.meta.url));
const NODE = process.execPath;
const BEGIN = '<!-- mission-control:begin';
const END = '<!-- mission-control:end -->';
const HOOK_MARK = '# mission-control:post-commit';
const WORKSPACE = path.dirname(ROOT); // ~/App Development

const out = (s = '') => process.stdout.write(s + '\n');

export function section(p) {
  const repoMemory = p.routerFile && !/^(CLAUDE|AGENTS)\.md$/.test(p.routerFile) ? `\nThis repo's own notes/memory: \`${p.routerFile}\`. Mission Control does not replace it.\n` : '';
  return `${BEGIN} (managed by \`mc adopt\`; edits inside this block are overwritten) -->
## Mission Control: keep it current, whatever agent you are

This repo is tracked in Saied's Mission Control as project **\`${p.slug}\`**. It is the shared board, agent log and handoff
that every agent and session (Claude, Codex, Cursor, anything) reads and updates. The CLI is \`mc\` (\`~/.local/bin/mc\`, see \`mc help\`).
${repoMemory}
1. **Start:** \`mc session start ${p.slug} "<goal>"\` prints the last handoff, board, hard rules and Saied's open directives.
   (Claude Code loads this automatically through a SessionStart hook.)
2. **While working:** \`mc task start|done ${p.slug} <id>\`, \`mc task add ${p.slug} "…"\`, and
   \`mc log ${p.slug} "…" --kind progress|decision|blocker\` for milestones and decisions. Commits are logged automatically.
3. **Need Saied?** \`mc ask "…" --project ${p.slug}\` (reaches his phone). Deploys, destructive or public actions:
   \`mc request action "…" --project ${p.slug} --wait\`.
4. **Secrets:** never read \`.env\` files or paste secret values. Use \`mc secret request NAME --project ${p.slug} --reason "…" --wait\`,
   then \`mc secret exec NAME -- <cmd>\`.
5. **Before you stop (always):** \`mc handoff ${p.slug} "<state, what's uncommitted, exact next step>"\`.

Full protocol: \`${path.join(ROOT, 'AGENTS.md')}\`
${END}`;
}

function upsertSection(file, text) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const re = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const next = re.test(cur) ? cur.replace(re, () => text) : cur ? `${cur.replace(/\s*$/, '')}\n\n${text}\n` : `${text}\n`;
  if (next === cur) return 'unchanged';
  fs.writeFileSync(file, next);
  return cur ? (re.test(cur) ? 'updated' : 'appended') : 'created';
}

function removeSection(file) {
  if (!fs.existsSync(file)) return false;
  const cur = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`\\n*${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`);
  if (!re.test(cur)) return false;
  const next = cur.replace(re, '\n').replace(/\n{3,}$/, '\n');
  if (!next.trim()) fs.unlinkSync(file);
  else fs.writeFileSync(file, next);
  return true;
}

/** Git repos at a root and one level below (e.g. VASMA/v0-VASMA-Supabase, NetKVM/NetKVM). */
function gitRepos(root) {
  const found = [];
  if (fs.existsSync(path.join(root, '.git'))) found.push(root);
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules' && fs.existsSync(path.join(root, d.name, '.git'))) found.push(path.join(root, d.name));
  }
  return found;
}

function gitDir(repo) {
  return path.resolve(repo, execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repo, encoding: 'utf8' }).trim());
}

function installCommitHook(repo, slug) {
  const hook = path.join(gitDir(repo), 'hooks', 'post-commit');
  if (fs.existsSync(hook) && !fs.readFileSync(hook, 'utf8').includes(HOOK_MARK)) return `has its own post-commit (add: "${NODE}" "${MC_BIN}" hook commit ${slug} &)`;
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(
    hook,
    `#!/bin/sh
${HOOK_MARK} (managed by mc adopt) — logs this commit to Mission Control in the background.
"${NODE}" "${MC_BIN}" hook commit ${slug} >/dev/null 2>&1 &
exit 0
`,
    { mode: 0o755 },
  );
  return 'post-commit hook';
}

function removeCommitHook(repo) {
  const hook = path.join(gitDir(repo), 'hooks', 'post-commit');
  if (fs.existsSync(hook) && fs.readFileSync(hook, 'utf8').includes(HOOK_MARK)) {
    fs.unlinkSync(hook);
    return true;
  }
  return false;
}

/** Router files to manage at a root: existing CLAUDE.md / AGENTS.md, else create AGENTS.md + a CLAUDE.md that imports it. */
function routerTargets(root) {
  // a CLAUDE.md that only imports AGENTS.md already gets the section through the import
  const importOnly = (f) => /^\s*@AGENTS\.md\s*$/.test(fs.readFileSync(f, 'utf8').replace(/<!-- mission-control:begin[\s\S]*?<!-- mission-control:end -->/, ''));
  const t = ['CLAUDE.md', 'AGENTS.md'].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f) && !importOnly(f));
  return t.length ? t : null;
}

function isSuperseded(file) {
  // e.g. VASMA/CLAUDE.md that just says "superseded by AGENTS.md": don't bloat it.
  const s = fs.readFileSync(file, 'utf8');
  return s.length < 1500 && /supersed|see AGENTS\.md|moved to AGENTS\.md/i.test(s) && fs.existsSync(path.join(path.dirname(file), 'AGENTS.md'));
}

const rootsOf = (p) => [p.path, ...(p.paths || [])].filter(Boolean).filter((r) => fs.existsSync(r));

export async function adopt({ pos, flags }) {
  const cfg = loadConfig();
  const projects = await tx(cfg, async (store) => {
    const slugs = flags.all ? (await M.listProjects(store)).map((p) => p.slug) : [await M.resolveSlug(store, pos[0] || fail('mc adopt <project> | --all  [--remove] [--no-hook]'))];
    return Promise.all(slugs.map((s) => M.getProject(store, s)));
  }, { write: false });

  for (const p of projects) {
    if (p.slug === 'mission-control') continue; // this repo IS the protocol
    const roots = rootsOf(p);
    if (!roots.length) {
      out(c.dim(`${p.slug}: no path on disk, skipped`));
      continue;
    }
    for (const root of roots) {
      const rel = path.relative(WORKSPACE, root) || root;
      const did = [];
      if (flags.remove) {
        for (const f of ['CLAUDE.md', 'AGENTS.md']) if (removeSection(path.join(root, f))) did.push(`section removed from ${f}`);
        for (const r of gitRepos(root)) if (removeCommitHook(r)) did.push(`hook removed (${path.relative(root, r) || '.'})`);
        out(`${c.cyan(p.slug.padEnd(22))} ${rel}: ${did.join(', ') || 'nothing to remove'}`);
        continue;
      }
      const text = section(p);
      const targets = routerTargets(root);
      if (targets) {
        for (const f of targets) {
          if (isSuperseded(f)) continue;
          did.push(`${path.basename(f)} ${upsertSection(f, text)}`);
        }
      } else {
        did.push(`AGENTS.md ${upsertSection(path.join(root, 'AGENTS.md'), text)}`);
        const claude = path.join(root, 'CLAUDE.md');
        if (!fs.existsSync(claude)) {
          fs.writeFileSync(claude, '@AGENTS.md\n');
          did.push('CLAUDE.md → @AGENTS.md');
        }
      }
      // nested repos with their own router (VASMA/v0-VASMA-Supabase/AGENTS.md) get the section too
      for (const r of gitRepos(root).filter((r) => r !== root)) {
        for (const f of ['CLAUDE.md', 'AGENTS.md'].map((x) => path.join(r, x)).filter((x) => fs.existsSync(x) && !isSuperseded(x))) {
          did.push(`${path.relative(root, f)} ${upsertSection(f, text)}`);
        }
      }
      if (!flags['no-hook']) for (const r of gitRepos(root)) did.push(`${installCommitHook(r, p.slug)}${r === root ? '' : ` (${path.relative(root, r)})`}`);
      out(`${c.green('✓')} ${c.cyan(p.slug.padEnd(20))} ${rel}: ${did.join(' · ')}`);
    }
  }
}

// ------------------------------------------------------------------ hooks

function readStdin() {
  if (process.stdin.isTTY) return {};
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

const SESSIONS = path.join(CONFIG_DIR, 'sessions.json');
function sessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS, 'utf8'));
  } catch {
    return {};
  }
}
function saveSessions(s) {
  const cutoff = Date.now() - 7 * 86400000;
  for (const [k, v] of Object.entries(s)) if (Date.parse(v.start) < cutoff) delete s[k];
  fs.writeFileSync(SESSIONS, JSON.stringify(s), { mode: 0o600 });
}

/** Run an mc command fully detached so hooks return instantly. */
function detached(...args) {
  spawn(NODE, [MC_BIN, ...args], { detached: true, stdio: 'ignore', env: { ...process.env, NO_COLOR: '1' } }).unref();
}

/** Longest project root that contains dir. */
async function projectForDir(store, dir) {
  const real = (d) => {
    try {
      return fs.realpathSync(d);
    } catch {
      return path.resolve(d);
    }
  };
  const cwd = real(dir);
  let best = null;
  for (const s of (await M.listProjects(store)).map((x) => x.slug)) {
    const p = await M.getProject(store, s);
    for (const r of rootsOf(p)) {
      const rr = real(r);
      if ((cwd === rr || cwd.startsWith(rr + path.sep)) && (!best || rr.length > best.len)) best = { p, len: rr.length };
    }
  }
  return best?.p || null;
}

export async function hook({ pos }) {
  const event = pos[0];
  const cfg = loadConfig({ required: false });
  if (!cfg) return;
  process.env.NO_COLOR = '1';

  if (event === 'commit') {
    // git post-commit (runs in the repo). Skip mid-rebase/cherry-pick noise.
    const g = (a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const gd = g(['rev-parse', '--git-dir']);
    if (['rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD'].some((f) => fs.existsSync(path.join(gd, f)))) return;
    const [hash, subject] = g(['log', '-1', '--format=%h%x00%s']).split('\0');
    const branch = g(['rev-parse', '--abbrev-ref', 'HEAD']);
    const files = g(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n').filter(Boolean);
    const { log } = await import('./commands.js');
    process.env.MC_AGENT = process.env.MC_AGENT || 'git';
    await log({ pos: [pos[1], `Commit ${hash} on ${branch}: ${subject} (${files.length} file${files.length === 1 ? '' : 's'})`], flags: { kind: 'progress', files: files.slice(0, 20).join(',') } });
    return;
  }

  const input = readStdin();
  const dir = input.cwd || process.cwd();

  if (event === 'session-start') {
    process.env.MC_OFFLINE = '1'; // the mc-serve service keeps data/ fresh; keep startup instant
    const isWorkspaceRoot = path.resolve(dir) === WORKSPACE;
    const p = isWorkspaceRoot ? null : await tx(cfg, (store) => projectForDir(store, dir), { write: false, offline: true });
    const { brief } = await import('./commands.js');
    if (p) {
      out(`[Mission Control] This session is in project "${p.slug}". Brief below. Keep the board and log current with mc, and write \`mc handoff ${p.slug} "…"\` before you stop.\n`);
      await brief({ pos: [p.slug], flags: { limit: 10 } });
      if (input.session_id) {
        const s = sessions();
        s[input.session_id] = { slug: p.slug, start: new Date().toISOString() };
        saveSessions(s);
      }
      if (input.source !== 'resume' && input.source !== 'compact') detached('log', p.slug, `Session started (${process.env.MC_AGENT || 'claude'} · ${input.source || 'startup'})`, '--kind', 'session');
    } else if (isWorkspaceRoot) {
      out('[Mission Control] You are the head agent for every project in this folder. Global brief below. Use `mc brief <project>` before working in a repo.\n');
      await brief({ pos: [], flags: {} });
    }
    return;
  }

  if (event === 'session-end') {
    const s = sessions();
    const rec = input.session_id && s[input.session_id];
    if (!rec) return;
    delete s[input.session_id];
    saveSessions(s);
    const p = await tx(cfg, (store) => M.getProject(store, rec.slug), { write: false, offline: true });
    const handedOff = p?.handoff && Date.parse(p.handoff.ts) >= Date.parse(rec.start);
    if (!handedOff) detached('log', rec.slug, `Session ended without a handoff (${input.reason || 'exit'}). The next agent should check git status and the log.`, '--kind', 'note');
    return;
  }
  fail('mc hook commit <slug> | session-start | session-end');
}

/** Register global Claude Code hooks in ~/.claude/settings.json (idempotent). */
export async function hooksInstall({ flags }) {
  const file = path.join(os.homedir(), '.claude', 'settings.json');
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const backup = file + '.bak-mc';
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const cmd = (ev) => `"${NODE}" "${MC_BIN}" hook ${ev}`;
  settings.hooks = settings.hooks || {};
  for (const [event, sub, timeout] of [['SessionStart', 'session-start', 20], ['SessionEnd', 'session-end', 10]]) {
    const list = (settings.hooks[event] = (settings.hooks[event] || []).filter((g) => !JSON.stringify(g).includes('mc.js" hook')));
    if (!flags.remove) list.push({ hooks: [{ type: 'command', command: cmd(sub), timeout }] });
    if (!list.length) delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  out(c.green(`✓ Claude Code hooks ${flags.remove ? 'removed from' : 'installed in'} ${file}`) + c.dim(fs.existsSync(backup) ? `  (backup: ${backup})` : ''));
}
