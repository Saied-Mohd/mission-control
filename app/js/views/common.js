// Small shared view helpers.

import { h, icon, chip, ago } from '../ui.js';
import * as model from '../model.js';

export const KIND_ICON = {
  progress: 'bolt',
  decision: 'check',
  blocker: 'flag',
  handoff: 'handoff',
  question: 'question',
  note: 'note',
  session: 'play',
  audit: 'shield',
};

export function kindBadge(kind, size = 13) {
  return h('span.k', icon(KIND_ICON[kind] || 'spark', size));
}

export function heatChip(summary) {
  const ht = model.heat(summary);
  return chip(ht, 'dot ' + ht, { title: 'Activity heat' });
}

export function statusChip(status) {
  return chip(status || 'active', status || 'active');
}

export function prioChip(p) {
  return chip(p || 'med', p || 'med');
}

/** Git health line from summary/project.health. */
export function gitHealth(health, { long = false } = {}) {
  if (!health) return null;
  const dirtyN = typeof health.dirty === 'number' ? health.dirty : health.dirty ? 1 : 0;
  const parts = [icon('git', 12)];
  if (health.branch) parts.push(h('span.ellipsis', { style: 'max-width:120px' }, health.branch));
  parts.push(dirtyN ? h('span.dirty', { title: 'uncommitted changes' }, typeof health.dirty === 'number' ? `±${dirtyN}` : 'dirty') : h('span.clean', 'clean'));
  if (health.ahead || health.behind) parts.push(h('span.ab', `↑${health.ahead || 0} ↓${health.behind || 0}`));
  if (health.lastCommitTs) parts.push(h('span.ab', { title: health.lastCommitMsg || '' }, ago(health.lastCommitTs)));
  if (long && health.lastCommitMsg) parts.push(h('span.ab.ellipsis', { style: 'max-width:280px' }, '“' + health.lastCommitMsg + '”'));
  return h('span.git', parts);
}

export function projectSelect(projects, value = '', { allLabel = 'No project', cls = 'input' } = {}) {
  return h('select.' + cls.split(' ').join('.'), { 'aria-label': 'Project' },
    h('option', { value: '' }, allLabel),
    projects.map((p) => h('option', { value: p.slug, selected: p.slug === value }, p.name)));
}

export function daysClass(d) {
  if (d < 0) return 'd-over';
  if (d <= 3) return 'd-hot';
  if (d <= 14) return 'd-soon';
  if (d <= 45) return 'd-mid';
  return 'd-far';
}

export function daysText(d) {
  if (d < 0) return `${-d}d overdue`;
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `${d} days`;
}

export function projectName(projects, slug) {
  if (!slug) return null;
  return projects.find((p) => p.slug === slug)?.name || slug;
}

export function projLink(projects, slug) {
  if (!slug) return null;
  return h('a', { href: `#/p/${encodeURIComponent(slug)}` }, projectName(projects, slug));
}

export const emptyIndex = () => ({ order: [], projects: {}, activity: [] });

/** Run fn every `ms` while the page is visible; returns a stop function. */
export function poll(fn, ms) {
  const t = setInterval(() => {
    if (document.visibilityState === 'visible') fn();
  }, ms);
  const onVis = () => document.visibilityState === 'visible' && fn();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    clearInterval(t);
    document.removeEventListener('visibilitychange', onVis);
  };
}

/** Simple touch pull-to-refresh on window scroll. Returns cleanup. */
export function pullToRefresh(indicator, onRefresh) {
  let y0 = null;
  let dy = 0;
  const start = (e) => {
    if (window.scrollY > 0 || e.touches.length !== 1) return (y0 = null);
    y0 = e.touches[0].clientY;
    dy = 0;
  };
  const move = (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    indicator.style.height = Math.min(56, dy / 2) + 'px';
  };
  const end = async () => {
    if (y0 === null) return;
    y0 = null;
    if (dy > 90) {
      indicator.style.height = '40px';
      try {
        await onRefresh();
      } finally {
        indicator.style.height = '0';
      }
    } else indicator.style.height = '0';
  };
  window.addEventListener('touchstart', start, { passive: true });
  window.addEventListener('touchmove', move, { passive: true });
  window.addEventListener('touchend', end);
  return () => {
    window.removeEventListener('touchstart', start);
    window.removeEventListener('touchmove', move);
    window.removeEventListener('touchend', end);
  };
}

/** Is a secret request's grant still active? */
export function grantActive(r, at = Date.now()) {
  if (r.type !== 'secret' || r.status !== 'approved') return false;
  const ttl = model.TTL[r.ttl] || model.TTL.once;
  return Date.parse(r.resolvedAt) + ttl.ms > at;
}
