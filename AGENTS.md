# AGENTS.md — Mission Control operating protocol

You are an agent working for Saied across many projects. Mission Control is the shared source of truth for
boards, agent logs, handoffs, approvals, secrets and the agent brain. **Use `mc` for all of it.**
(`~/.local/bin/mc` → `bin/mc.js`; Node ≥ 20 at `~/.local/bin/node`.)

## Every session

1. `mc brief`: global brief with principles, Saied's open directives, radar, pending approvals and project heat.
2. Before touching a repo: `mc session start <project> "<goal>"`. This prints the handoff, hard rules, board, recent log
   and relevant memories, and tells you which router file to read (`CLAUDE.md` / `AGENTS.md` inside that repo).
   That repo's own memory system still applies. Mission Control does not replace it.
3. While working:
   - `mc task start|done <project> <id>` and `mc task add <project> "…"` keep the board true.
   - `mc log <project> "…" --kind progress|decision|blocker|question` records milestones and decisions, not keystrokes.
   - Blocked on Saied? Use `mc ask "…" --project p` (it reaches his phone). Don't sit idle. Pick other work.
4. Before you stop, **always** run `mc handoff <project> "<where it stands, what's uncommitted, the exact next step>"`.
   Write it for a fresh agent with zero context. This is what makes sessions continuous.

## Hard rules

- **Secrets:** never read `.env` files, keychains or the vault to get a credential. Request it:
  `mc secret request NAME --project p --reason "…" [--ttl once] --wait`. After approval, use
  `mc secret exec NAME -- <cmd>` (injected as env) or `mc secret write-env NAME path/.env`.
  **Never print, echo, log or paste a secret value**: transcripts are stored in plain text (that is how old Telegram tokens leaked).
- **Consequential actions** (prod deploys, destructive git/db ops, publishing or posting publicly, spending money, emailing people):
  `mc request action "…" --project p --wait`, or get explicit approval from Saied in direct chat. A push tap is fine for these.
  A project's own stricter rules win (e.g. 4MUL8R: prod deploys need direct-chat auth, not Telegram).
- Projects tagged `private` are never published or mentioned in public artifacts.
- Never write plaintext project data into this public repo. Everything lives in the encrypted `data/` repo through `mc`.
- Don't edit `data/` by hand.

## Your brain

`mc brain` is your own long-term memory, separate from per-repo memories. Use it to think, not only to store.
- `mc brain recall "<topic>"` before deciding something non-trivial. Recall reinforces what it finds.
- `mc brain add "<lesson>" --type insight|pattern|principle|fact|idea|question --body "…" --projects p --tags …`
  when you learn something that will matter again: a preference of Saied's, a gotcha, a cross-project pattern.
- `mc brain think "…"` for journal reflections at session end: what went well, what you'd do differently.
- `mc brain prune`: weak, stale or wrong memories decay. Review candidates every few sessions and prune with a reason.
  Forgetting wrong things matters as much as remembering. Pinned principles never decay. Pin sparingly.
- Strength = confidence × recency (type-specific half-life) × usage. Update confidence when evidence changes.

## Upkeep

- `mc scan` refreshes git health (branch, uncommitted, last commit) for every project. Run it at the start of a long session.
- `mc radar add YYYY-MM-DD "…" --project p` whenever you learn a date (token expiry, deadline). `mc radar check` pushes what's due.
- New project? `mc project add "<Name>" --path … --repo … --tagline … --tags …`, then `mc adopt <slug>`. That adds the Mission Control
  section to the repo's CLAUDE.md/AGENTS.md and a post-commit hook that logs commits. Extra folders: `mc project set <p> paths a,b`.
- Global Claude Code hooks (`mc hooks install`) inject the project brief at SessionStart for any session inside a project folder,
  and log "ended without a handoff" at SessionEnd. Repo-specific agents therefore stay in sync automatically.
- The deck lives in `deck/index.html`. After changing it, run `mc deck publish` so it shows in the app.

## Architecture (short)

See `docs/CONTRACT.md` (data model and APIs) and `README.md`. Shared code: `app/js/{crypto,store,model}.js` is used by
both the PWA and the CLI. Change the model there, never fork logic. Run tests with `npm test` before committing.
