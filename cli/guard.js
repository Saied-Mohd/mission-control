// mc guard — secret scanning for every repo. `mc guard install <repo…>` adds a pre-commit hook that
// blocks commits whose staged changes contain credentials; `mc guard scan <path>` scans a working tree.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { c, fail } from './util.js';

export const RULES = [
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|github_pat_[A-Za-z0-9_]{60,}/],
  ['Stripe key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Telegram bot token', /\b\d{8,10}:AA[A-Za-z0-9_-]{30,40}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['fal.ai key', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/],
  ['Supabase service JWT', /eyJhbGciOi[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*cm9sZSI6InNlcnZpY2Vfcm9sZS[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{20,}/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['Generic secret assignment', /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*[:=]\s*["']?(?![<{$]|your|xxx|changeme|example|placeholder|\*{3}|process\.env|import\.meta|os\.environ|Deno\.env|getenv|env\.|config\.|settings\.)[A-Za-z0-9_\-+/=.:]{16,}/],
];
const SKIP_FILE = /(^|\/)(\.env\.example|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.(png|jpe?g|gif|webp|ico|pdf|zip|mp[34]|wav|woff2?|ttf|lock)$/i;
const ALLOW = /mc-guard:\s*allow/;

export function scanText(text, file = '') {
  const hits = [];
  if (SKIP_FILE.test(file)) return hits;
  text.split('\n').forEach((line, i) => {
    if (ALLOW.test(line) || line.length > 5000) return;
    for (const [name, re] of RULES) {
      const m = line.match(re);
      if (m) {
        hits.push({ file, line: i + 1, rule: name, preview: m[0].slice(0, 6) + '…' + m[0].slice(-3) });
        break;
      }
    }
  });
  return hits;
}

function report(hits) {
  for (const h of hits) process.stderr.write(`  ${c.red(h.rule)}  ${h.file}:${h.line}  ${c.dim(h.preview)}\n`);
}

/** Scan the staged diff (added lines only). Used by the pre-commit hook. */
export function scanStaged(cwd) {
  const diff = execFileSync('git', ['diff', '--cached', '-U0', '--no-color', '--diff-filter=ACMR'], { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
  const hits = [];
  let file = '';
  let ln = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(6);
    else if (line.startsWith('@@')) ln = Number(line.match(/\+(\d+)/)?.[1] || 0) - 1;
    else if (line.startsWith('+')) {
      ln++;
      hits.push(...scanText(line.slice(1), file).map((h) => ({ ...h, line: ln })));
    }
  }
  return hits;
}

const HOOK = (mc) => `#!/bin/sh
# mc-guard: blocks commits containing credentials. Bypass a false positive with "mc-guard: allow" on that line.
exec "${process.execPath}" "${mc}" guard staged
`;

export async function guard({ pos }) {
  const sub = pos[0];
  if (sub === 'staged') {
    const hits = scanStaged(process.cwd());
    if (!hits.length) return;
    process.stderr.write(c.red(`\n✋ mc-guard blocked this commit: ${hits.length} possible secret(s)\n`));
    report(hits);
    process.stderr.write(c.dim('Move secrets into the Mission Control vault (mc secret …) and load them at runtime. False positive? Add "mc-guard: allow" to that line.\n\n'));
    process.exitCode = 1;
    return;
  }
  if (sub === 'install') {
    const mc = fileURLToPath(new URL('../bin/mc.js', import.meta.url));
    for (const repo of pos.slice(1)) {
      let gitDir;
      try {
        gitDir = path.resolve(repo, execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repo, encoding: 'utf8' }).trim());
      } catch {
        process.stdout.write(c.dim(`skip ${repo} (not a git repo)\n`));
        continue;
      }
      const hook = path.join(gitDir, 'hooks', 'pre-commit');
      if (fs.existsSync(hook) && !fs.readFileSync(hook, 'utf8').includes('mc-guard')) {
        process.stdout.write(c.amber(`skip ${repo} (has its own pre-commit hook; add: node ${mc} guard staged)\n`));
        continue;
      }
      fs.mkdirSync(path.dirname(hook), { recursive: true });
      fs.writeFileSync(hook, HOOK(mc), { mode: 0o755 });
      process.stdout.write(c.green(`✓ guarded ${repo}\n`));
    }
    return;
  }
  if (sub === 'scan') {
    const root = path.resolve(pos[1] || '.');
    let files;
    try {
      files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter(Boolean);
    } catch {
      fail('mc guard scan <git repo path>');
    }
    const hits = [];
    for (const f of files) {
      const abs = path.join(root, f);
      try {
        const st = fs.statSync(abs);
        if (!st.isFile() || st.size > 2 << 20) continue;
        hits.push(...scanText(fs.readFileSync(abs, 'utf8'), f));
      } catch {}
    }
    if (!hits.length) return process.stdout.write(c.green(`✓ ${root}: no secrets found in ${files.length} files\n`));
    process.stdout.write(c.red(`${hits.length} possible secret(s) in ${root}:\n`));
    report(hits);
    process.exitCode = 1;
    return;
  }
  fail('mc guard install <repo…> | scan <repo> | staged');
}
