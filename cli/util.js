// Small CLI helpers: arg parsing, colors, formatting.

export function parseArgs(argv) {
  const pos = [];
  const flags = {};
  let rest = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      rest = argv.slice(i + 1);
      break;
    }
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) flags[k] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (/^-[a-z]$/i.test(a)) {
      const k = { n: 'limit', k: 'kind', p: 'project', c: 'col', j: 'json' }[a[1]] || a[1];
      if (k === 'json') flags.json = true;
      else flags[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, flags, rest };
}

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  dim: wrap('2'),
  bold: wrap('1'),
  cyan: wrap('36'),
  amber: wrap('33'),
  magenta: wrap('35'),
  green: wrap('32'),
  red: wrap('31'),
};

export function ago(ts, at = Date.now()) {
  if (!ts) return 'never';
  const s = Math.round((at - Date.parse(ts)) / 1000);
  const f = (n, u) => `${n}${u} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return f(Math.round(s / 60), 'm');
  if (s < 86400) return f(Math.round(s / 3600), 'h');
  if (s < 86400 * 60) return f(Math.round(s / 86400), 'd');
  return f(Math.round(s / (86400 * 30)), 'mo');
}

export const shortId = (id) => id.slice(-6);

export function table(rows, cols) {
  const strip = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');
  const w = cols.map((k) => Math.max(...rows.map((r) => strip(r[k]).length), 0));
  return rows.map((r) => cols.map((k, i) => String(r[k] ?? '') + ' '.repeat(Math.max(0, w[i] - strip(r[k]).length))).join('  ').trimEnd()).join('\n');
}

export function fail(msg) {
  const e = new Error(msg);
  e.user = true;
  throw e;
}

export function list(v) {
  if (!v || v === true) return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}
