// Reading the checked-out data repository from disk.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseYaml } from '../../src/core/yaml-edit.js';
import { resolveSettings } from '../../src/core/settings.js';

export async function readText(path, fallback = null) {
  try { return await readFile(path, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

/** settings.yml merged over defaults. A broken file stops the job with a clear message. */
export async function loadSettings(dir) {
  const text = await readText(join(dir, 'settings.yml'), '');
  try { return resolveSettings(text ? parseYaml(text) : {}); }
  catch (e) { throw new Error(`settings.yml can't be read: ${e.message}`); }
}

/** All people/*.md files as [{slug, text}]. */
export async function loadPeople(dir) {
  let names = [];
  try { names = await readdir(join(dir, 'people')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const files = names.filter(n => n.endsWith('.md')).sort();
  return Promise.all(files.map(async n => ({ slug: n.slice(0, -3), text: await readFile(join(dir, 'people', n), 'utf8') })));
}

export const writeText = (path, text) => writeFile(path, text, 'utf8');

/** Minimal "--flag value" / "--flag" argument reader. */
export function args(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}
