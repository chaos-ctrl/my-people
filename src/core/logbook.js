// The "## Log" section: one line per contact that has a note, newest first.
//   - 2026-09-20 · seen · Dinner, talked about his move

import { parsePersonFile, withSection, sectionText } from './person-file.js';

const LINE = /^[-*+]\s+(\d{4}-\d{2}-\d{2})\s*[·|•:–-]\s*(?:(seen|call|message)\s*[·|•:–-]\s*)?(.*)$/i;

export function parseLogLine(line) {
  const m = String(line).trim().match(LINE);
  if (!m) return null;
  return { date: m[1], type: m[2]?.toLowerCase() ?? null, note: m[3].trim() };
}

export const formatLogLine = ({ date, type, note }) => `- ${date}${type ? ` · ${type}` : ''} · ${String(note).replace(/\s*\n\s*/g, ' ').trim()}`;

/** Parsed entries of a file's Log section (unparseable lines are skipped). */
export function logEntries(file) {
  return sectionText(file, 'log').split('\n').map(parseLogLine).filter(Boolean);
}

/** File with a note line inserted in date order (newest first). */
export function withLogEntry(file, entry) {
  if (!String(entry.note ?? '').trim()) return file;
  const lines = sectionText(file, 'log').split('\n').filter(l => l.trim() !== '');
  let i = lines.findIndex(l => { const e = parseLogLine(l); return e && e.date <= entry.date; });
  if (i < 0) i = lines.length;
  lines.splice(i, 0, formatLogLine(entry));
  return withSection(file, 'log', lines.join('\n'));
}

/** File without the first note line for this date (and type, when the line has one). */
export function withoutLogEntry(file, { date, type }) {
  const lines = sectionText(file, 'log').split('\n');
  const i = lines.findIndex(l => { const e = parseLogLine(l); return e && e.date === date && (!e.type || e.type === type); });
  if (i < 0) return file;
  lines.splice(i, 1);
  return withSection(file, 'log', lines.filter(l => l.trim() !== '').join('\n'));
}

export { parsePersonFile };
