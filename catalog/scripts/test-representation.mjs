#!/usr/bin/env node
/**
 * The filter that returned one show.
 *
 * Two things must hold. It has to return a useful number of shows — that was
 * the whole complaint — and the narrow tier has to actually be narrow, because
 * a "queer stories" filter full of mainstream shows with a gay best friend is
 * its own kind of erasure, not a fix.
 */
import { loadRepresentation, getRepresentation, representationCounts } from '../src/lib/representation.js';
import { readFileSync } from 'node:fs';
import { hydrate } from '../src/lib/catalogue.js';
import { MOOD_BY_ID, pickForMood } from '../src/lib/moods.js';

const load = p => JSON.parse(readFileSync(p, 'utf8')).shows.map(hydrate);
const catalogue = [...load('public/catalogue-core.json'), ...load('public/catalogue.json')];

let fails = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };

// Node needs an import attribute for JSON modules; the app's Vite build does
// not. Read it here and hand it in rather than writing source that only
// compiles in one of the two.
const doc = JSON.parse(readFileSync('src/data/representation.json', 'utf8'));
const { count } = await loadRepresentation(doc);
const counts = representationCounts();
console.log(`index: ${count} shows`);
console.log(`  queer      ${counts.queer.about} about · ${counts.queer.features} featuring`);
console.log(`  disability ${counts.disability.about} about · ${counts.disability.features} featuring`);

console.log('\n1. the filter returns a usable list');
const ctx = { saved: {}, notForMe: {}, seen: {}, hideUnavailable: false,
              watchedByShow: () => new Set(), availabilityFor: () => ({ known: false, onMine: [] }) };
const narrow = pickForMood('queer', catalogue, ctx);
const wide = pickForMood('queer', catalogue, { ...ctx, wideRepresentation: true });
check('narrow queer filter is no longer a dead end', narrow.length >= 20, `${narrow.length} shows`);
check('widening adds substantially more', wide.length > narrow.length * 5, `${wide.length} shows`);
console.log('   narrow: ' + narrow.slice(0, 8).map(p => p.show.name).join(' · '));

const dis = pickForMood('disability', catalogue, ctx);
check('disability filter works too', dis.length >= 15, `${dis.length} shows`);
console.log('   ' + dis.slice(0, 6).map(p => p.show.name).join(' · '));

console.log('\n2. the narrow tier is actually narrow');
// Shows that are famously mainstream-with-a-queer-character must NOT be in the
// narrow list. This is the precision test the whole tiering exists for.
const shouldBeWideOnly = ['Scandal', 'Dawson\'s Creek', 'General Hospital', 'Superstore', 'The 100'];
const narrowNames = new Set(narrow.map(p => p.show.name));
for (const n of shouldBeWideOnly) {
  const inCatalogue = catalogue.some(s => s.name === n);
  if (!inCatalogue) continue;
  check(`${n} is not in the narrow list`, !narrowNames.has(n));
}
const wideNames = new Set(wide.map(p => p.show.name));
check('but they do appear when widened',
  shouldBeWideOnly.some(n => wideNames.has(n)),
  shouldBeWideOnly.filter(n => wideNames.has(n)).join(', ') || 'none');

console.log('\n3. hand-checked notes still win');
const sense8 = catalogue.find(s => s.name === 'Sense8');
const rep = getRepresentation(sense8.tvmazeId);
check('Sense8 keeps its hand-written note', rep?.queer?.tier === 'checked', rep?.queer?.tier);
check('and the note is the sentence shown', /Nomi/.test(rep.queer.why || ''), (rep.queer.why || '').slice(0, 54));

console.log('\n4. every claim carries its source');
const sampled = catalogue.filter(s => getRepresentation(s.tvmazeId, { wide: true })?.queer).slice(0, 60);
const sourced = sampled.filter(s => {
  const r = getRepresentation(s.tvmazeId, { wide: true }).queer;
  return r.tier === 'checked' || (r.source && r.why);
});
check('all sampled entries state a source', sourced.length === sampled.length,
  `${sourced.length}/${sampled.length}`);

console.log(`\n${fails ? `${fails} failure(s)` : 'the filter works, and the narrow tier stays narrow'}`);
process.exit(fails ? 1 : 0);
