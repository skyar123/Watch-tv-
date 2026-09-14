#!/usr/bin/env node
/**
 * Run the ranker over the real baked catalogue with a believable history.
 *
 * The point is not that the numbers are big. It is that every pick can be read
 * as a sentence, and that the algorithm is willing to argue AGAINST things —
 * which is the whole difference from an engagement objective.
 */
import { readFileSync } from 'node:fs';
import { hydrate } from '../src/lib/catalogue.js';
import { buildTaste, buildIdf, idfOf } from '../src/lib/taste.js';
import { buildKinship } from '../src/lib/kinship.js';
import { rankCatalogue, rankTogetherCatalogue, appetiteOf, estimateHours } from '../src/lib/rank.js';
import { toShow } from '../src/lib/tvmaze.js';

const load = p => JSON.parse(readFileSync(p, 'utf8')).shows.map(hydrate);
const catalogue = [...load('public/catalogue-core.json'), ...load('public/catalogue.json')];
console.log(`catalogue: ${catalogue.length} shows`);
buildIdf(catalogue);
console.log('how informative is a shared feature? (higher = rarer = more telling)');
for (const f of ['genre:Drama','genre:Comedy','genre:Romance','genre:Science-Fiction',
                 'lang:English','network:HBO','rep:queer','length:half hour'])
  console.log(`  ${f.padEnd(24)} ${idfOf(f).toFixed(2)}`);
console.log();

const full = async id => toShow(await (await fetch(
  `https://api.tvmaze.com/shows/${id}?embed[]=episodes`)).json());

// Skylar: dark sci-fi, finished Westworld and Dark. Anja: comedy + queer.
const byName = async n => {
  const r = await (await fetch('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(n))).json();
  return full(r[0].show.id);
};
const [westworld, dark, heartstopper, bear] =
  await Promise.all([byName('Westworld'), byName('Dark'), byName('Heartstopper'), byName('The Bear')]);

const allWatched = (s) => Object.fromEntries(s.episodes.filter(e => e.type === 'regular').map(e => [e.id, 1]));
const showsByKey = new Map([westworld, dark, heartstopper, bear].map(s => [s.key, s]));

const skylar = {
  watched: { [westworld.key]: allWatched(westworld), [dark.key]: allWatched(dark) },
  saved: {}, notForMe: {}, seen: {}, taste: { explicit: {} },
};
const anja = {
  watched: { [heartstopper.key]: allWatched(heartstopper), [bear.key]: allWatched(bear) },
  saved: {}, notForMe: {}, seen: {}, taste: { explicit: { 'rep:queer': true } },
};

for (const [name, p] of [['Skylar', skylar], ['Anja', anja]]) {
  const a = appetiteOf(p, showsByKey);
  console.log(`${name} appetite: ${a.note}`);
}
console.log();

const tS = buildTaste(skylar, showsByKey);
const tA = buildTaste(anja, showsByKey);
const kS = await buildKinship([westworld, dark]);
const kA = await buildKinship([heartstopper, bear]);
console.log(`kinship: Skylar ${kS.size} related shows, Anja ${kA.size}\n`);

const base = { availabilityFor: () => ({ known: false, onMine: [] }), seen: {}, notForMe: {} };
const withWatched = p => ({
  ...base, watched: p.watched,
  // The languages this person has actually watched in.
  languages: new Set(Object.keys(p.watched).map(k => showsByKey.get(k)?.language).filter(Boolean)),
});

const show = (rows, n = 8) => {
  for (const r of rows.slice(0, n)) {
    const tag = r.explore ? ' [explore]' : '';
    console.log(`  ${r.total.toFixed(1).padStart(6)}  ${r.show.name.slice(0,26).padEnd(28)}${tag}`);
    console.log(`          ${r.reason || '(no reason — would not be shown)'}`);
    const terms = (r.terms || []).slice(0, 4).map(t => `${t.name} ${t.value > 0 ? '+' : ''}${t.value}`).join('  ');
    if (terms) console.log(`          ${terms}`);
    for (const w of (r.warnings || []).slice(0, 1)) console.log(`          ! ${w}`);
  }
};

console.log('── ranked for Skylar (finished Westworld + Dark) ──');
show(rankCatalogue(catalogue, { ...withWatched(skylar), taste: tS, kinship: kS, appetite: appetiteOf(skylar, showsByKey) }));

console.log('\n── ranked for Anja (finished Heartstopper + The Bear) ──');
show(rankCatalogue(catalogue, { ...withWatched(anja), taste: tA, kinship: kA, appetite: appetiteOf(anja, showsByKey) }));

console.log('\n── ranked TOGETHER ──');
const people = [
  { name: 'Skylar', taste: tS, kinship: kS, appetite: appetiteOf(skylar, showsByKey) },
  { name: 'Anja', taste: tA, kinship: kA, appetite: appetiteOf(anja, showsByKey) },
];
show(rankTogetherCatalogue(catalogue, people, { ...base, watched: { ...skylar.watched, ...anja.watched } }), 5);

console.log('\n── does it argue AGAINST things? worst-scoring well-rated shows for Skylar ──');
const all = rankCatalogue(catalogue, { ...withWatched(skylar), taste: tS, kinship: kS, appetite: appetiteOf(skylar, showsByKey) }, { limit: 30000 });
const argued = all.filter(r => r.warnings.length && (r.show.rating ?? 0) >= 8).slice(-4);
for (const r of argued) {
  console.log(`  ${r.show.name.slice(0,26).padEnd(28)} rated ${r.show.rating}`);
  for (const w of r.warnings) console.log(`          ! ${w.slice(0,110)}`);
}
