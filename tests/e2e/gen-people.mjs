// Generate N fictional people files: node tests/e2e/gen-people.mjs <dir> [N]. Used by perf.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function generate(out, N = 1000) {
mkdirSync(out + '/people', { recursive: true });
const first = ['Alex', 'Sam', 'Lou', 'Noa', 'Eli', 'Ana', 'Tom', 'Ines', 'Hugo', 'Lea', 'Max', 'Zoe', 'Paul', 'Jade', 'Leo', 'Mia'];
const last = ['Martin', 'Bernard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Roux', 'Fournier', 'Morel', 'Girard'];
const cities = ['Lyon', 'Paris', 'Nantes', 'Lille', 'Bordeaux', ''];
const types = ['seen', 'call', 'message'];
  let seed = 1; const rnd = n => { seed = (seed * 16807) % 2147483647; return seed % n; };
const day = back => new Date(Date.UTC(2026, 8, 27) - back * 864e5).toISOString().slice(0, 10);
for (let i = 0; i < +N; i++) {
  const name = `${first[rnd(16)]} ${last[rnd(12)]} ${i}`;
  const contacts = Array.from({ length: rnd(40) }, (_, k) => day(k * 20 + rnd(20))).map(d => `  - {date: ${d}, type: ${types[rnd(3)]}}`);
  const text = `---\nname: ${name}\ngroup: ${['Friends', 'Family', 'Work'][rnd(3)]}\ncity: ${cities[rnd(6)]}\nfrequency_days: ${[14, 30, 60, 90][rnd(4)]}\nbirthday: ${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}\ncontacts:\n${contacts.join('\n') || '  - {date: 2026-01-01, type: seen}'}\n---\n\n## Ask about\n- ${1 + rnd(28)}/${1 + rnd(12)}/2026: Something\n- Their project\n\n## Gift ideas\n- A book\n\n## Notes\nFictional person number ${i}.\n\n## Log\n- ${day(3)} · seen · Coffee\n`;
  writeFileSync(`${out}/people/p-${i}.md`, text);
}
writeFileSync(`${out}/settings.yml`, 'timezone: Europe/Paris\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) generate(process.argv[2], +(process.argv[3] ?? 1000));
