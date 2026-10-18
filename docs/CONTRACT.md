# Mission Control — internal contract

This is the spec that the app (PWA), the CLI (`mc`) and the local server must all follow. Change it here first.

## Layout

```
Mission Control/            public repo  (GitHub Pages serves app/)
  app/                      the PWA (static, no build step, ES modules)
    js/crypto.js            shared WebCrypto primitives (also imported by Node)
    js/store.js             encrypted doc store over an adapter
    js/model.js             domain model: ALL mutations go through here
  bin/mc.js, cli/           agent CLI + local server (Node ≥ 20, zero deps)
  deck/                     HTML deck (gitignored; published *encrypted* into the data repo)
  data/                     clone of the PRIVATE data repo (gitignored)
```

Data repo (`mission-control-data`, private) contains only:

```
keys.json                   wrapped keys + public keys (no secrets in clear)
store/<24 hex>.enc          one encrypted doc each; name = HMAC(nameKey, logical)[:12 bytes]
```

## Keys (`keys.json`)

```jsonc
{
  "v": 1,
  "claimed": true,                  // false until Saied sets passphrases in the browser
  "createdAt": "ISO",
  "agent": { "name": "claude", "publicJwk": {/* ECDH P-256 */} },
  "vapidPublicKey": "base64url uncompressed P-256 point",
  "dek":   { "passphrase": Box, "recovery": Box },   // label "mc-dek"
  "vault": { "passphrase": Box, "recovery": Box }    // label "mc-vault"
}
```

`Box` = output of `wrapWithSecret(raw, secret, label)`. Master passphrase unlocks the DEK. The vault passphrase unlocks the VaultKey.
The recovery code (`newRecoveryCode()`) unlocks both. **The agent's local config holds the raw DEK but never the VaultKey.**

## Logical docs (`model.DOC`)

| logical | key | shape |
|---|---|---|
| `index` | data | `{ order:[slug], projects:{slug:Summary}, activity:[Activity] }` |
| `project/<slug>` | data | Project (see `emptyProject`) incl. `board.tasks[]`, `handoff` |
| `log/<slug>` | data | `{ entries:[{id,ts,kind,agent,text,files,tasks}] }` oldest→newest |
| `brain` | data | `{ nodes[], journal[], pruned[] }` |
| `requests` | data | `{ items:[Request] }` newest first |
| `inbox` | data | `{ items:[{id,ts,from,text,project,status,reply}] }` |
| `radar` | data | `{ items:[{id,date,text,project,kind}] }` |
| `audit` | data | `{ items:[{ts,actor,action,target,project}] }` |
| `vault` | **vault** | `{ items:[{name,value,projects,note,expiresAt,updated}] }` |
| `vault-index` | data | same minus `value` (agent can see names, never values) |
| `push-subs` | data | `{ items:[{id,endpoint,keys:{p256dh,auth},device,created}] }` |
| `grant/<requestId>` | data | `{ box: sealToPublic(agentPub, {requestId, secrets:{NAME:value}}), expiresAt, uses, used, created }` |
| `deck` | data | `{ html, updated }` |
| `settings` | data | `{ notify:{requests,questions,blockers,handoffs,radar} }` |

AAD for every doc = its logical name. Vault doc is encrypted with the vault key; everything else with the data key.

## Requests

```jsonc
{ "id":"q…", "ts", "type":"secret"|"action", "project", "reason", "secrets":["NAME"], "text", "ttl":"once"|"1h"|"24h"|"7d",
  "agent", "agentPublicJwk", "status":"pending"|"approved"|"denied"|"revoked"|"expired", "note", "resolvedAt", "resolvedBy" }
```

Approve secret in the app: unlock vault, for that request build `{requestId, secrets:{NAME:value}}`, `sealToPublic(req.agentPublicJwk || keys.agent.publicJwk, …)`,
`store.put(DOC.grant(id), { box, expiresAt: now+TTL[ttl].ms, uses: TTL[ttl].uses, used: 0, created })`, then `resolveRequest(store, id, {status:'approved', ttl, note})`.
Revoke = `store.remove(DOC.grant(id))` + status `revoked`. `type:"action"` approvals (deploys, destructive ops, posting) just resolve with a status and note.

## Local server (`mc serve`, 127.0.0.1 only)

Every `/api/*` request must carry header `X-MC: 1` and Host must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding and CSRF guard).

| method | path | body / result |
|---|---|---|
| GET | `/api/info` | `{ mode:"local", claimed, hasRemote, remote }` |
| GET | `/api/file?path=P` | `{ text, version }` or 404 |
| PUT | `/api/file` | `{ path, text, version|null }` → `{ version }`; 409 on stale version |
| DELETE | `/api/file` | `{ path, version }` → `{ ok }` |
| POST | `/api/claim` | `{ token }` → `{ dek: b64 }` only while `keys.json.claimed === false` |
| POST | `/api/sync` | commit + pull + push now → `{ ok, status }` |
| POST | `/api/notify` | `{ title, body, url, tag }` → sends push to all subs (used by the app's "test push" button) |

`P` is `keys.json` or `store/<24 hex>.enc`. Writes are committed (generic message) and pushed, debounced by about 2 seconds.
Static: `/` serves `app/`, and `/deck/` serves `deck/`.

## GitHub mode (remote, GitHub Pages)

The app talks to `https://api.github.com/repos/<owner>/<data-repo>/contents/<P>` with a fine-grained PAT (Contents: read/write, that one repo only).
`version` = blob sha. A 409 or 422 on PUT means a ConflictError. The PAT is stored in localStorage, encrypted with the data key. `keys.json` (wrapped, safe) is cached locally,
so unlock works offline-first: passphrase → DEK → dataKey → decrypt PAT.

## Push

Payload JSON: `{ title, body, url, tag, kind, urgency }`. The service worker shows the notification. Clicking it focuses or opens `url` (a hash route such as `#/approvals`).
The agent sends pushes directly from the CLI (VAPID private key in `~/.config/mission-control/agent.json`).

## App routes

`#/` dashboard · `#/p/<slug>` project (Board · Log · Handoff · Info) · `#/approvals` · `#/inbox` · `#/radar` · `#/vault` · `#/brain` · `#/activity` · `#/deck` · `#/settings`
