#!/usr/bin/env node
/**
 * Prove every hand-curated annotation points at the show it claims to.
 *
 * The first draft of curated.js had nine wrong ids out of eleven, written from
 * memory. They would have attached careful representation notes to Ninja
 * Warrior Hungary. This script exists so that can never ship.
 */
import { ENDINGS, CONTENT, REPRESENTATION } from '../src/data/curated.js';

const norm = s => String(s).toLowerCase().replace(/\s*\(\d{4}\)$/, '').replace(/[^a-z0-9]/g, '');
let bad = 0, n = 0;

for (const [table, rows] of Object.entries({ ENDINGS, CONTENT, REPRESENTATION })) {
  for (const [id, entry] of Object.entries(rows)) {
    n++;
    const res = await fetch(`https://api.tvmaze.com/shows/${id}`);
    if (!res.ok) { bad++; console.log(`✗ ${table} ${id}: HTTP ${res.status}`); continue; }
    const show = await res.json();
    if (!entry.name) { bad++; console.log(`✗ ${table} ${id}: no name field to check against (${show.name})`); continue; }
    const ok = norm(show.name) === norm(entry.name);
    if (!ok) { bad++; console.log(`✗ ${table} ${id}: claims "${entry.name}" but TVmaze says "${show.name}"`); }
    else console.log(`✓ ${table} ${String(id).padEnd(6)} ${show.name}`);
    if (!entry.checked) { bad++; console.log(`✗ ${table} ${id}: missing "checked" date`); }
  }
}
console.log(`\n${n - bad}/${n} annotations verified`);
process.exit(bad ? 1 : 0);
