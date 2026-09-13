#!/usr/bin/env node
/**
 * Exercise the real trailer function against live YouTube.
 *
 * The Breaking Bad case is the point of this file: "El Camino: A Breaking Bad
 * Movie | Official Trailer | Netflix" is an official Netflix trailer whose
 * title contains the show name, and it won before the leading-segment rule.
 */
import { handler } from '../netlify/functions/trailer.js';

const CASES = [
  { name: 'Severance', year: 2022, expect: 'found' },
  { name: 'Breaking Bad', year: 2008, expect: 'found', reject: /el camino/i },
  { name: 'Pose', year: 2018, expect: 'found' },
  { name: 'Heartstopper', year: 2022, expect: 'found' },
  { name: 'Sense8', year: 2015, expect: 'found' },
  // A one-word title with no distinctive results. The right answer is to
  // refuse: "Sherlock Special" is not this show.
  { name: 'Special', year: 2019, expect: 'either', reject: /sherlock/i },
  { name: 'The Last of Us', year: 2023, expect: 'found' },
];

let fails = 0;
for (const c of CASES) {
  await new Promise(r => setTimeout(r, 2600));     // stay under the consent wall
  const res = await handler({ queryStringParameters:
    { name: c.name, year: String(c.year), key: `test:${c.name}` } });
  const b = JSON.parse(res.body);

  if (b.reason === 'youtube_rate_limited') {
    console.log(`~ ${c.name.padEnd(16)} rate limited — the function reported it instead of caching a wall`);
    continue;
  }
  const found = Boolean(b.key);
  const ok = c.expect === 'either' ? true : found === (c.expect === 'found');
  const clean = !c.reject || !c.reject.test(b.title || '');
  if (!ok || !clean) fails++;

  console.log(`${ok && clean ? '✓' : '✗'} ${c.name.padEnd(16)} ` +
    (found ? `${b.key}  ${b.confidence.padEnd(6)} ${String(b.title).slice(0, 46)}` : `no trailer (${b.reason})`));
  if (found) console.log(`   ${b.source} · ${b.why.join(', ')}`);
  if (!clean) console.log(`   ✗ matched the thing it was supposed to reject`);
  if (!found && c.expect === 'either') console.log(`   correctly refused rather than guessing`);
}
console.log(`\n${fails ? `${fails} failure(s)` : 'trailer resolution behaves'}`);
process.exit(fails ? 1 : 0);
