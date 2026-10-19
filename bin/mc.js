#!/usr/bin/env node
// mc — Mission Control CLI for agents. Run `mc help`.

import * as cmd from '../cli/commands.js';
import { parseArgs, c } from '../cli/util.js';

const HELP = `${c.bold('mc')} — Mission Control (agent CLI)

${c.bold('Start every session')}
  mc brief                         global brief: principles, Saied's directives, radar, projects
  mc session start <project> [goal]  log a session start + print the project brief
  mc brief <project>               handoff, rules, board, log, memories for one project

${c.bold('While working')}
  mc log <project> "<text>" [--kind progress|decision|blocker|question|note] [--files a,b]
  mc task ls|add|start|mv|done|edit|rm <project> …
  mc ask "<question>" [--project p]                 → Saied's inbox + push
  mc request action "<what>" --project p [--wait]   → approval for deploys/destructive/posting

${c.bold('Before you stop')}
  mc handoff <project> "<where it stands + exact next step>"   (or pipe markdown on stdin)

${c.bold('Secrets')} ${c.dim('(you never see the vault; Saied approves each use)')}
  mc secret ls                                     names only
  mc secret request NAME[,NAME] --project p --reason "<why>" [--ttl once|1h|24h|7d] [--wait]
  mc secret exec NAME[,NAME] -- <cmd> [args]      inject as env vars; values never printed
  mc secret write-env NAME[,NAME] <path/.env>     write to a git-ignored .env (0600)
  mc secret grants

${c.bold('Brain')} ${c.dim('(your own memory — keep it sharp)')}
  mc brain recall "<query>" [--project p]    mc brain add "<title>" --type insight --body "" [--tags] [--projects] [--pin]
  mc brain think "<reflection>"             mc brain journal | ls | show <id> | stats
  mc brain update <id> --confidence 0.9     mc brain link <a> <b> | pin <id> | unpin <id>
  mc brain prune                            list weak memories;  mc brain prune <id> "<reason>"

${c.bold('Overview & upkeep')}
  mc status | mc inbox [ls|add|done <id> "reply"] | mc radar [ls|add|rm|check]
  mc project ls|add|show|set|link|rm  (set <p> rules --replace=true "…" starts the rule list over) | mc scan (git health) | mc notify "<title>" "<body>"
  mc request ls|status|wait <id> | mc deck publish | mc sync | mc doctor | mc config [key value]
  mc adopt <project>|--all [--remove]          wire repos: router section + commit logging
  mc hooks install [--remove]                   Claude Code SessionStart/End hooks (global)
  mc guard install <repo…> | scan <repo>        secret-scanning pre-commit hook
  mc init [--data dir] [--remote url] | mc serve [--port 4317] | mc seed <file.json>

Flags: --json for machine output. Env: MC_AGENT=<name> (default claude), MC_OFFLINE=1.`;

const ROUTES = {
  init: cmd.init,
  status: cmd.status,
  brief: cmd.brief,
  project: cmd.project,
  projects: (a) => cmd.project({ ...a, pos: ['ls', ...a.pos] }),
  log: cmd.log,
  handoff: cmd.handoff,
  session: cmd.session,
  task: cmd.task,
  inbox: cmd.inbox,
  ask: cmd.ask,
  radar: cmd.radar,
  request: cmd.request,
  secret: cmd.secret,
  brain: cmd.brain,
  scan: cmd.scan,
  notify: cmd.notify,
  deck: cmd.deck,
  sync: cmd.sync,
  seed: cmd.seed,
  doctor: cmd.doctor,
  config: cmd.config,
  adopt: async (a) => (await import('../cli/adopt.js')).adopt(a),
  hook: async (a) => (await import('../cli/adopt.js')).hook(a),
  hooks: async (a) => (await import('../cli/adopt.js')).hooksInstall(a),
  guard: async (a) => (await import('../cli/guard.js')).guard(a),
  serve: async (a) => (await import('../cli/server.js')).serve(a),
};

// Piping into head/grep closes stdout early; that's not an error.
process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0);
});

const [name, ...argv] = process.argv.slice(2);
if (!name || name === 'help' || name === '--help' || name === '-h') {
  console.log(HELP);
} else if (!ROUTES[name]) {
  console.error(`unknown command "${name}". Try: mc help`);
  process.exitCode = 2;
} else {
  try {
    await ROUTES[name](parseArgs(argv));
  } catch (e) {
    console.error(c.red('mc: ') + (e.user || e.message === 'BAD_SECRET' ? e.message : e.stack || e.message));
    process.exitCode = process.exitCode || 1;
  }
}
