# Mission Control

Saied's command deck and Claude's workstation, shared by both of them. It holds every project's board, agent log and handoff,
approval requests that reach your phone, an encrypted vault for env vars, and Claude's own pruneable brain.

- **App** (`app/`): an installable PWA with no build step. Runs locally with `mc serve` or remotely on GitHub Pages.
- **CLI** (`mc`): how agents read and update everything. See `AGENTS.md`.
- **Deck** (`deck/`): the scroll-animated presentation of what this is and where it's going.
- **Data** (`data/`): a clone of the **private** `mission-control-data` repo. It holds ciphertext only.

## How it stays private

| Layer | What it means |
|---|---|
| End-to-end encryption | Every doc is AES-256-GCM encrypted in your browser or the agent CLI before it leaves the device. GitHub stores only noise. |
| Opaque names | File names are HMACs. The data repo shows neither project names nor how many logs or tasks exist. Commit messages are generic. |
| Private data repo | The ciphertext lives in a private repo that only your fine-grained token can reach. |
| Master passphrase | Unlocks the data key (PBKDF2-SHA256, 600k iterations). It never leaves your device. |
| Separate vault passphrase | Env vars use a second key. **Claude does not have it**, so the agent cannot read the vault, even by accident. |
| Per-use approval | Claude asks for a secret → your phone gets a push → you approve with a time limit → the secret is sealed to Claude's public key for that request only. It is injected as an env var and never printed. Every use is audited. |
| Recovery code | Shown once at setup. It unlocks both keys if you forget a passphrase. Keep it offline. |

The public repo holds only code. GitHub Pages serves the app shell, which shows a lock screen until you unlock it.

## First run (local)

```bash
mc serve            # prints http://127.0.0.1:4317/#claim=…  → open it, set both passphrases, save the recovery code
```

## Remote access (phone)

1. Open the GitHub Pages URL (`https://<you>.github.io/mission-control/`) → Connect.
2. Enter the owner, the repo `mission-control-data`, a fine-grained PAT (Repository access: only `mission-control-data`; Permissions: Contents read/write), and your master passphrase.
3. Install it: iOS Safari → Share → Add to Home Screen (iOS 16.4+ is needed for push); Android Chrome → Install.
4. Settings → Enable notifications.

## Daily use

- **Dashboard:** project heat, what's next, pending approvals, inbox and radar.
- **Quick capture:** "Tell the agents…" leaves a directive that every agent sees in its next `mc brief`.
- **Approvals:** tap the push notification → approve or deny.
- **Brain:** watch Claude's memory graph, prune it, or add to it.

## Development

```bash
npm test              # crypto, web push, model, and the full end-to-end approval flow
node scripts/make-icons.mjs
```

Code layout: `app/js/crypto.js`, `store.js` and `model.js` are shared by the PWA and the CLI (Node ≥ 20, zero dependencies). The spec is in `docs/CONTRACT.md`.
