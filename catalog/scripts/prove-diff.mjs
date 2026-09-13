#!/usr/bin/env node
/**
 * Prove that a script which rewrote a data file changed ONLY what it meant to.
 *
 * The failure this exists to catch: a bake script that reads a file, builds a
 * new object, writes it back, and silently drops a field it did not know about.
 * Nothing throws, the file looks fine, and a month later something is missing.
 *
 * Usage:
 *   node scripts/prove-diff.mjs before.json after.json --expect providers,checkedAt
 *
 * Walks BOTH objects key by key, to any depth, and reports every difference
 * split into three buckets:
 *   EXPECTED  — a path matching --expect
 *   REMOVED   — a key that existed before and does not now  (always a failure)
 *   UNEXPECTED— any other change                            (always a failure)
 *
 * Exits non-zero unless every change was expected and nothing was dropped.
 */
import { readFileSync } from 'node:fs';

const [beforePath, afterPath, ...rest] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('usage: prove-diff.mjs <before.json> <after.json> [--expect a,b.c]');
  process.exit(2);
}
const expectArg = rest.includes('--expect') ? rest[rest.indexOf('--expect') + 1] : '';
const expected = expectArg.split(',').map(s => s.trim()).filter(Boolean);

const load = p => JSON.parse(readFileSync(p, 'utf8'));

/** A path is expected if it equals, or sits underneath, a declared field. */
const isExpected = path => expected.some(e => {
  // Array indices are wildcards: "shows.3.providers" matches "shows.providers".
  const generic = path.replace(/\.\d+(?=\.|$)/g, '');
  return generic === e || generic.startsWith(e + '.') ||
         path === e || path.startsWith(e + '.');
});

const kind = v => Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
const show = v => {
  const s = JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 70 ? s.slice(0, 67) + '…' : s;
};

const diffs = [];
function walk(a, b, path = '') {
  const at = kind(a), bt = kind(b);

  if (at === 'object' && bt === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in b))      diffs.push({ type: 'REMOVED', path: p, from: a[k], to: undefined });
      else if (!(k in a)) diffs.push({ type: 'ADDED',   path: p, from: undefined, to: b[k] });
      else walk(a[k], b[k], p);
    }
    return;
  }

  if (at === 'array' && bt === 'array') {
    if (a.length !== b.length) {
      diffs.push({ type: a.length > b.length ? 'REMOVED' : 'ADDED',
                   path: `${path}.length`, from: a.length, to: b.length });
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const p = `${path}.${i}`;
      if (i >= b.length)      diffs.push({ type: 'REMOVED', path: p, from: a[i], to: undefined });
      else if (i >= a.length) diffs.push({ type: 'ADDED',   path: p, from: undefined, to: b[i] });
      else walk(a[i], b[i], p);
    }
    return;
  }

  if (at !== bt || JSON.stringify(a) !== JSON.stringify(b)) {
    diffs.push({ type: 'CHANGED', path, from: a, to: b });
  }
}

walk(load(beforePath), load(afterPath));

const removed    = diffs.filter(d => d.type === 'REMOVED');
const unexpected = diffs.filter(d => d.type !== 'REMOVED' && !isExpected(d.path));
const ok         = diffs.filter(d => d.type !== 'REMOVED' && isExpected(d.path));

const C = { r: s => `\x1b[31m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`,
            y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` };

console.log(`${beforePath} → ${afterPath}`);
console.log(`expected to change: ${expected.length ? expected.join(', ') : C.y('(nothing declared)')}\n`);

if (ok.length) {
  console.log(C.g(`${ok.length} expected change(s)`));
  for (const d of ok.slice(0, 20)) console.log(C.d(`  ${d.path}: ${show(d.from)} → ${show(d.to)}`));
  if (ok.length > 20) console.log(C.d(`  …and ${ok.length - 20} more`));
}

if (removed.length) {
  console.log(C.r(`\n${removed.length} KEY(S) DISAPPEARED — this is the silent-deletion bug`));
  for (const d of removed) console.log(C.r(`  ${d.path}  was ${show(d.from)}`));
}

if (unexpected.length) {
  console.log(C.r(`\n${unexpected.length} UNDECLARED change(s)`));
  for (const d of unexpected) console.log(C.r(`  ${d.type} ${d.path}: ${show(d.from)} → ${show(d.to)}`));
}

if (!diffs.length) console.log(C.y('identical — the script changed nothing at all'));

const bad = removed.length + unexpected.length;
console.log(bad ? C.r(`\nFAIL: ${bad} problem(s)`) : C.g('\nPASS: only the declared fields changed, nothing was dropped'));
process.exit(bad ? 1 : 0);
