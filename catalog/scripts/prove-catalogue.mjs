#!/usr/bin/env node
/**
 * Prove a re-bake of the catalogue did what it claimed.
 *
 * prove-diff.mjs is the general tool, but it cannot make the two claims that
 * matter here on its own, for two structural reasons:
 *
 *   1. The catalogue is ONE set of shows split across two files by popularity.
 *      A show that moves from the core to the tail looks like a deletion from
 *      one file and an insertion into the other, and neither is true.
 *   2. The interesting claim is not "field X changed". It is "nothing that was
 *      in the index fell out, and everything new got in for the stated reason".
 *
 * So this merges the tiers and checks, per show:
 *   • DROPPED   a show that was in the index and is not now,  always a failure
 *               unless the filter was deliberately tightened, which it was not
 *   • ADDED     a show that is new. Each one must satisfy the reason given on
 *               the command line, or it got in by accident
 *   • CHANGED   a show in both whose fields moved, split into the fields the
 *               bake meant to add and everything else (TVmaze's own edits)
 *
 * Usage:
 *   node scripts/prove-catalogue.mjs --added-because recent --new-fields f,a
 */
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i === -1 ? d : (args[i + 1] ?? true); };
const NEW_FIELDS = String(flag('--new-fields', 'f,a')).split(',').filter(Boolean);
const REASON = flag('--added-because', 'recent');
const RECENT_MONTHS = Number(flag('--months', 24));
const RECENT_WEIGHT = Number(flag('--weight', 40));

const C = { r: s => `\x1b[31m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`,
            y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` };

const FILES = [['public/catalogue-core.json', 'core'], ['public/catalogue.json', 'tail']];
for (const [f] of FILES) {
  if (!existsSync(f + '.prev')) {
    console.error(`no ${f}.prev — nothing to compare against. Re-bake first.`);
    process.exit(2);
  }
}

/** Merge both tiers into one id → row map, and remember which tier each was in. */
const read = suffix => {
  const byId = new Map();
  let meta = null;
  for (const [f, tier] of FILES) {
    const doc = JSON.parse(readFileSync(f + suffix, 'utf8'));
    meta = doc;
    for (const s of doc.shows) byId.set(s.i, { ...s, __tier: tier });
  }
  return { byId, meta };
};

const before = read('.prev');
const after  = read('');

console.log(`before: ${before.byId.size} shows   (${before.meta.filter})`);
console.log(`after:  ${after.byId.size} shows   (${after.meta.filter})\n`);

/* ── 1. did anything fall out of the index? ─────────────────────────────── */
/**
 * With membership sticky, the only legitimate way to leave the index is for
 * TVmaze to delete the show. That is checkable rather than assumable, so it is
 * checked: every dropped id is fetched, and a 404 is forgiven while anything
 * still live is a failure. There are only ever a handful, so the calls are
 * cheap; above a hundred something is wrong with the bake and asking TVmaze
 * about each one is not the right response, so it stops and says so.
 */
const dropped = [...before.byId.values()].filter(s => !after.byId.has(s.i));
let unforgiven = dropped;
if (dropped.length) {
  console.log(`${dropped.length} show(s) left the index — asking TVmaze whether each still exists`);
  if (dropped.length > 100) {
    console.log(C.r(`  too many to be upstream deletions; not checking. The bake dropped them.`));
    for (const s of dropped.slice(0, 25)) console.log(C.r(`  ${s.i}  ${s.n}  (${s.p ?? '?'}, w=${s.w ?? 0}, r=${s.r ?? '-'})`));
    console.log(C.r(`  …and ${dropped.length - 25} more`));
  } else {
    const gone = new Set();
    for (const s of dropped) {
      try {
        const res = await fetch(`https://api.tvmaze.com/shows/${s.i}`,
          { headers: { 'User-Agent': 'tonight/prove-catalogue' }, signal: AbortSignal.timeout(15000) });
        if (res.status === 404) gone.add(s.i);
      } catch { /* a failed check is not a pass: it stays unforgiven */ }
    }
    for (const s of dropped) {
      const why = gone.has(s.i) ? C.g('deleted from TVmaze, a legitimate drop')
                                : C.r('STILL ON TVMAZE, the bake lost it');
      console.log(`  ${s.i}  ${String(s.n).slice(0, 40).padEnd(40)} ${why}`);
    }
    unforgiven = dropped.filter(s => !gone.has(s.i));
  }
} else {
  console.log(C.g('0 shows dropped: the index only grew, which is what sticky membership should do'));
}

/* ── 2. did every new show get in for the declared reason? ──────────────── */
const cutoff = (() => { const d = new Date(); d.setMonth(d.getMonth() - RECENT_MONTHS); return d.toISOString().slice(0, 10); })();
const satisfiesReason = s => {
  if (REASON !== 'recent') return true;
  // Either it would have passed the OLD rule anyway (TVmaze added a rating or
  // weight since the last bake, which is not this change's doing), or it is
  // recent and cleared the recency bar.
  const oldRule = s.r != null || (s.w ?? 0) >= 60;
  const recent = s.f && s.f >= cutoff && ((s.w ?? 0) >= RECENT_WEIGHT || s.a);
  return oldRule || recent;
};
const added = [...after.byId.values()].filter(s => !before.byId.has(s.i));
const unexplained = added.filter(s => !satisfiesReason(s));
console.log(`\n${added.length} show(s) added`);
if (unexplained.length) {
  console.log(C.r(`  ${unexplained.length} of them do NOT satisfy "${REASON}" — they got in by accident`));
  for (const s of unexplained.slice(0, 25)) console.log(C.r(`    ${s.i}  ${s.n}  (p=${s.f || s.p || '?'}, w=${s.w ?? 0}, r=${s.r ?? '-'}, airing=${s.a ? 'y' : 'n'})`));
} else {
  console.log(C.g(`  all ${added.length} satisfy "${REASON}"`));
}
const byOld = added.filter(s => s.r != null || (s.w ?? 0) >= 60).length;
console.log(C.d(`  ${added.length - byOld} admitted by the recency exemption, ${byOld} would have passed the old rule too`));

/* ── 3. what changed on the shows that were already there? ──────────────── */
const fieldChanges = new Map();   // field → count
const sampled = [];
let movedTier = 0;
for (const [id, a] of before.byId) {
  const b = after.byId.get(id);
  if (!b) continue;
  if (a.__tier !== b.__tier) movedTier++;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === '__tier') continue;
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    fieldChanges.set(k, (fieldChanges.get(k) || 0) + 1);
    if (!NEW_FIELDS.includes(k) && sampled.length < 12) {
      sampled.push(`  ${a.n}: ${k} ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
    }
  }
}
console.log(`\nfields that moved on shows present in both (${before.byId.size - dropped.length} shows):`);
for (const [k, n] of [...fieldChanges].sort((a, b) => b[1] - a[1])) {
  const declared = NEW_FIELDS.includes(k);
  console.log(`  ${k.padEnd(4)} ${String(n).padStart(6)}  ${declared ? C.g('declared new field') : C.y("TVmaze's own edits since the last bake")}`);
}
if (sampled.length) {
  console.log(C.d('\n  a sample of the undeclared ones, to confirm they are upstream edits and not corruption:'));
  for (const l of sampled) console.log(C.d(l));
}
console.log(C.d(`\n  ${movedTier} shows moved between the core and tail files (a sort change, not a data change)`));

/* ── verdict ────────────────────────────────────────────────────────────── */
const bad = unforgiven.length + unexplained.length;
console.log(bad
  ? C.r(`\nFAIL: ${unforgiven.length} lost from the index, ${unexplained.length} added without a reason`)
  : C.g(`\nPASS: nothing was lost (${dropped.length} deleted upstream), and every one of the ` +
        `${added.length} new shows got in for the declared reason`));
process.exit(bad ? 1 : 0);
