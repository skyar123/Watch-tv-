#!/usr/bin/env node
/**
 * Prove the contrastive model does what the additive one could not.
 *
 * The case that matters: someone who likes SOME dramas and hides OTHER dramas.
 * An additive model lands near zero by coincidence and cannot tell that apart
 * from "drama has never come up". A log-odds ratio scores it zero and means it.
 */
import { readFileSync } from 'node:fs';
import { hydrate } from '../src/lib/catalogue.js';
import { buildTaste, buildIdf, scoreShow, explainTaste, prettyFeature } from '../src/lib/taste.js';

const load = p => JSON.parse(readFileSync(p, 'utf8')).shows.map(hydrate);
const catalogue = [...load('public/catalogue-core.json'), ...load('public/catalogue.json')];
buildIdf(catalogue);
const byName = n => catalogue.find(s => s.name === n);

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
};

const profile = (likes, hides) => ({
  watched: {}, taste: { explicit: {} },
  saved: Object.fromEntries(likes.map(n => [byName(n).key, { addedAt: Date.now(), viaSwipe: true }])),
  notForMe: Object.fromEntries(hides.map(n => [byName(n).key, Date.now()])),
});
const showsByKey = new Map(catalogue.map(s => [s.key, s]));

console.log('1. a feature on BOTH sides must score ~zero, not cancel by luck');
// Liked and hidden are all Drama. Drama therefore says nothing.
const mixed = buildTaste(
  profile(['Breaking Bad', 'The Wire'], ['Grey\'s Anatomy', 'Scandal']), showsByKey);
const drama = mixed.weights['genre:Drama'] ?? 0;
check('genre:Drama is uninformative', Math.abs(drama) < 0.35, `weight ${drama.toFixed(3)}`);
const crime = mixed.weights['genre:Crime'] ?? 0;
check('genre:Crime, only on the liked side, is positive', crime > 0.3, `weight ${crime.toFixed(3)}`);
const nrl = explainTaste(mixed).neutral.map(n => n.label);
check('and it is reported as neutral, not silently dropped', nrl.length > 0, nrl.join(', ') || 'none');

console.log('\n2. hiding teaches as much as liking');
const sciFiFan = buildTaste(profile(['Firefly', 'Battlestar Galactica'], ['Friends', 'Frasier']), showsByKey);
const sci = sciFiFan.weights['genre:Science-Fiction'] ?? 0;
const com = sciFiFan.weights['genre:Comedy'] ?? 0;
check('science-fiction positive', sci > 0.4, sci.toFixed(2));
check('comedy negative', com < -0.4, com.toFixed(2));
const sitcom = scoreShow(byName('Seinfeld'), sciFiFan);
check('a sitcom scores negative for them', sitcom.score < 0, `${sitcom.score.toFixed(2)} — ${sitcom.reason}`);

console.log('\n3. one swipe is a hint, not a law');
const single = buildTaste(profile(['Chernobyl'], []), showsByKey);
const many = buildTaste(profile(['Chernobyl', 'Band of Brothers', 'The Pacific', 'Generation Kill'], []), showsByKey);
const w1 = Math.abs(single.weights['genre:Drama'] ?? 0);
const w4 = Math.abs(many.weights['genre:Drama'] ?? 0);
check('four sightings outweigh one', w4 > w1 * 1.5, `${w1.toFixed(2)} → ${w4.toFixed(2)}`);

console.log('\n4. recent swipes outweigh old ones');
const old = { ...profile(['Firefly'], []), saved: {
  [byName('Firefly').key]: { addedAt: Date.now() - 1000 * 86400000, viaSwipe: true } } };
const fresh = profile(['Firefly'], []);
const wOld = Math.abs(buildTaste(old, showsByKey).weights['genre:Science-Fiction'] ?? 0);
const wNew = Math.abs(buildTaste(fresh, showsByKey).weights['genre:Science-Fiction'] ?? 0);
check('a swipe from three years ago counts for less', wNew > wOld * 2, `${wOld.toFixed(3)} vs ${wNew.toFixed(3)}`);

console.log('\n5. all likes and no hides is a weaker profile, and says so');
const onesided = buildTaste(profile(['Firefly', 'Chernobyl', 'The Wire', 'Fargo',
  'Sherlock', 'Dexter', 'Vikings', 'House', 'Lost', 'Heroes', 'Bones', 'Monk'], []), showsByKey);
const balanced = buildTaste(profile(['Firefly', 'Chernobyl', 'The Wire', 'Fargo', 'Sherlock', 'Dexter'],
  ['Friends', 'Frasier', 'Seinfeld', 'Cheers', 'Bones', 'Monk']), showsByKey);
const c1 = scoreShow(byName('Battlestar Galactica'), onesided).confidence;
const c2 = scoreShow(byName('Battlestar Galactica'), balanced).confidence;
check('one-sided profile is not called good', c1 !== 'good', `split ${onesided.split.toFixed(2)} → ${c1}`);
check('balanced profile is', c2 === 'good', `split ${balanced.split.toFixed(2)} → ${c2}`);

console.log('\n6. what the model believes, in words');
const e = explainTaste(balanced);
console.log('   likes:   ' + e.likes.map(x => `${x.label} ${x.weight > 0 ? '+' : ''}${x.weight}`).join(', '));
console.log('   avoids:  ' + e.dislikes.map(x => `${x.label} ${x.weight}`).join(', '));
console.log('   neutral: ' + (e.neutral.map(x => x.label).join(', ') || '(none)'));
check('it can state both sides', e.likes.length > 0 && e.dislikes.length > 0);

console.log(`\n${fails ? `${fails} failure(s)` : 'the model distinguishes'}`);
process.exit(fails ? 1 : 0);
