// Agent-side configuration. Lives OUTSIDE the repo (~/.config/mission-control, chmod 600).
// Holds the DEK (agent can read/write docs), the agent's ECDH private key (opens grants),
// and the VAPID private key (sends pushes). It never holds the vault key.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_DIR = process.env.MC_HOME || path.join(os.homedir(), '.config', 'mission-control');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'agent.json');

export function loadConfig({ required = true } = {}) {
  if (!fs.existsSync(CONFIG_FILE)) {
    if (!required) return null;
    throw new Error(`Not initialised: ${CONFIG_FILE} missing. Run: mc init`);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (process.env.MC_DATA) cfg.dataDir = path.resolve(process.env.MC_DATA);
  return cfg;
}

export function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(CONFIG_DIR, 0o700);
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_FILE);
}

export const agentName = () => process.env.MC_AGENT || 'claude';
