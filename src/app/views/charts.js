// Small SVG charts built with DOM calls (the CSP forbids inline styles and scripts).
// Colours are CSS roles (--series-*, --grid, --axis-text) defined in app.css for light and dark.

import { h } from '../dom.js';
import { daysBetween, addDays, formatShortDate } from '../../core/dates.js';
import { timeline } from '../../core/model.js';

const NS = 'http://www.w3.org/2000/svg';
const LANES = [['seen', 'Seen', 'series-1'], ['call', 'Call', 'series-2'], ['message', 'Message', 'series-3']];

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const tip = text => svg('title', {}, text);

/**
 * One lane per contact type, a mark per contact, over the last three years (or since the first contact).
 * Shapes differ per lane (circle, square, diamond) so identity never rests on colour alone.
 */
export function timelineChart(person, today) {
  const items = timeline(person).filter(t => t.logged);
  if (!items.length) return null;
  const first = items[items.length - 1].date;
  // At least the last year; at most the last three; otherwise from the first contact.
  const oneYear = addDays(today, -365), threeYears = addDays(today, -3 * 365);
  const start = first >= oneYear ? oneYear : first < threeYears ? threeYears : first;
  const span = Math.max(30, daysBetween(start, today));
  const W = 600, L = 70, R = 12, T = 8, lane = 26, H = T + lane * LANES.length + 24;
  const x = d => L + (daysBetween(start, d) / span) * (W - L - R);
  const shapes = {
    seen: (cx, cy) => svg('circle', { cx, cy, r: 5 }),
    call: (cx, cy) => svg('rect', { x: cx - 4.5, y: cy - 4.5, width: 9, height: 9, rx: 1.5 }),
    message: (cx, cy) => svg('path', { d: `M${cx} ${cy - 6}L${cx + 6} ${cy}L${cx} ${cy + 6}L${cx - 6} ${cy}Z` }),
  };
  const years = [];
  for (let y = +start.slice(0, 4) + 1; y <= +today.slice(0, 4); y++) years.push(`${y}-01-01`);

  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-labelledby': 'tl-title' },
    svg('title', { id: 'tl-title' }, `Contacts with ${person.name} since ${formatShortDate(start, true)}: ${items.filter(i => i.date >= start).length} in total.`),
    years.map(y => [
      svg('line', { x1: x(y), x2: x(y), y1: T, y2: T + lane * LANES.length, class: 'grid' }),
      svg('text', { x: x(y) + 3, y: H - 8, class: 'axis' }, y.slice(0, 4)),
    ]),
    LANES.map(([type, label, cls], i) => {
      const cy = T + lane * i + lane / 2;
      return svg('g', { class: cls },
        svg('line', { x1: L, x2: W - R, y1: cy, y2: cy, class: 'lane' }),
        svg('text', { x: 0, y: cy + 4, class: 'lane-label' }, label),
        items.filter(t => t.type === type && t.date >= start).map(t => {
          const mark = shapes[type](x(t.date), cy);
          mark.setAttribute('class', 'mark');
          mark.append(tip(`${formatShortDate(t.date, true)} · ${label}${t.note ? ` · ${t.note}` : ''}`));
          return mark;
        }));
    }),
    svg('text', { x: W - R, y: H - 8, class: 'axis', 'text-anchor': 'end' }, 'today'));
  return h('figure.chart-box', chart);
}

/**
 * Vertical bars, one series. `data`: [{label, value, title}]. The numbers are also given as text
 * (a caption list), so the chart never carries information alone.
 */
export function barChart(data, { title, unit = '' } = {}) {
  const W = 600, H = 170, L = 8, R = 8, T = 18, B = 26;
  const max = Math.max(1, ...data.map(d => d.value));
  const bw = (W - L - R) / data.length;
  const y = v => T + (H - T - B) * (1 - v / max);
  const peak = data.reduce((a, d, i) => (d.value > data[a].value ? i : a), 0);
  return h('figure.chart-box',
    svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': title },
      svg('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'baseline' }),
      data.map((d, i) => {
        const bx = L + i * bw + 3, w = Math.max(2, bw - 6);
        const top = y(d.value);
        const hgt = H - B - top;
        const g = svg('g', { class: 'series-1 barg' },
          svg('rect', { x: L + i * bw, y: T, width: bw, height: H - T - B, class: 'hit' }),
          d.value > 0 && svg('path', { class: 'mark', d: `M${bx} ${H - B}V${top + Math.min(4, hgt)}Q${bx} ${top} ${bx + Math.min(4, w / 2)} ${top}H${bx + w - Math.min(4, w / 2)}Q${bx + w} ${top} ${bx + w} ${top + Math.min(4, hgt)}V${H - B}Z` }),
          (i === peak || i === data.length - 1) && d.value > 0 && svg('text', { x: bx + w / 2, y: top - 5, class: 'value', 'text-anchor': 'middle' }, String(d.value)),
          svg('text', { x: bx + w / 2, y: H - 9, class: 'axis', 'text-anchor': 'middle' }, d.label));
        g.append(tip(d.title ?? `${d.label}: ${d.value}${unit}`));
        return g;
      })),
    h('figcaption.hint', title));
}
