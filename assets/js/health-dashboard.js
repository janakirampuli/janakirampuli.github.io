import { infoFor } from './health-info.js';
import {
  activityTotals, addRegularity, compareWeeks, completeDays, findLevers, peakHeartRate,
  targetGrid, watchPeriod, weeklySummaries,
} from './health-insights.js';

const root = document.getElementById('health-dashboard');
const status = document.getElementById('hd-status');

const DAY_MS = 86400000;
const MOVING_WINDOW = 7;
const MOVING_MIN_POINTS = 3;

const MARGIN = { top: 10, right: 54, bottom: 26, left: 46 };
const PLOT_HEIGHT = 190;
const COLUMN_MAX = 24;

const fixed1 = (v) => v.toFixed(1);
const round = (v) => Math.round(v).toLocaleString();
const hours = (v) => `${v.toFixed(1)} h`;
const bpm = (v) => `${Math.round(v)} bpm`;
const ms = (v) => `${Math.round(v)} ms`;
const compact = (v) => (v >= 10000 ? `${v / 1000}K` : v.toLocaleString());
const clock = (noonMinutes) => {
  const minutes = Math.round(noonMinutes + 720) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (parent) parent.appendChild(node);
  return node;
}

function html(name, className, text, parent) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

let popover = null;
let popoverOwner = null;
let pinned = false;
let hideTimer;

function closeInfo() {
  clearTimeout(hideTimer);
  if (popoverOwner) popoverOwner.setAttribute('aria-expanded', 'false');
  if (popover) popover.hidden = true;
  popoverOwner = null;
  pinned = false;
}

function openInfo(button, name, info) {
  clearTimeout(hideTimer);
  if (popoverOwner && popoverOwner !== button) popoverOwner.setAttribute('aria-expanded', 'false');
  if (!popover) {
    popover = html('div', 'hd hd-info', undefined, document.body);
    popover.setAttribute('role', 'tooltip');
    popover.id = 'hd-info';
    popover.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    popover.addEventListener('mouseleave', () => { if (!pinned) closeInfo(); });
    document.addEventListener('click', (event) => {
      if (popover.contains(event.target) || event.target.closest?.('.hd-info-button')) return;
      closeInfo();
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeInfo(); });
    window.addEventListener('scroll', closeInfo, { passive: true });
    window.addEventListener('resize', closeInfo);
  }
  popover.replaceChildren();
  html('strong', 'hd-info__title', name, popover);
  [['What it is', info.what], ['What good looks like', info.ideal], ['What helps', info.help]].forEach(([label, text]) => {
    if (!text) return;
    html('span', 'hd-info__label', label, popover);
    html('p', 'hd-info__text', text, popover);
  });
  popover.hidden = false;
  popoverOwner = button;
  button.setAttribute('aria-expanded', 'true');

  const margin = 12;
  const rect = button.getBoundingClientRect();
  const box = popover.getBoundingClientRect();
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - box.width - margin));
  const below = rect.bottom + 6;
  const top = below + box.height + margin > window.innerHeight ? Math.max(margin, rect.top - box.height - 6) : below;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

// A function name lets a chart that switches views explain whichever view is showing.
function infoButton(parent, name) {
  const resolve = () => (typeof name === 'function' ? name() : name);
  if (!infoFor(resolve())) return null;
  const button = html('button', 'hd-info-button', 'i', parent);
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-describedby', 'hd-info');
  const label = () => button.setAttribute('aria-label', `About ${resolve()}`);
  label();
  button.addEventListener('mouseenter', () => { if (!pinned) openInfo(button, resolve(), infoFor(resolve())); });
  button.addEventListener('mouseleave', () => {
    if (!pinned) hideTimer = setTimeout(closeInfo, 150);
  });
  button.addEventListener('click', () => {
    if (pinned && popoverOwner === button) {
      closeInfo();
      return;
    }
    openInfo(button, resolve(), infoFor(resolve()));
    pinned = true;
    label();
  });
  return button;
}

const toTime = (date) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time) => new Date(time).toISOString().slice(0, 10);
const shortDate = (date) =>
  new Date(toTime(date)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDate = (date) =>
  new Date(toTime(date)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// Fills missing days with empty rows, so a gap in data stays a gap on the axis.
function fillDays(days) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const filled = [];
  const end = toTime(days[days.length - 1].date);
  for (let t = toTime(days[0].date); t <= end; t += DAY_MS) {
    filled.push(byDate.get(toDate(t)) ?? { date: toDate(t) });
  }
  return filled;
}

function addMovingAverage(days, key) {
  days.forEach((day, index) => {
    const recent = days
      .slice(Math.max(0, index - MOVING_WINDOW + 1), index + 1)
      .map((d) => d[key])
      .filter(Number.isFinite);
    if (recent.length >= MOVING_MIN_POINTS) {
      day[`${key}_ma`] = recent.reduce((a, b) => a + b, 0) / recent.length;
    }
  });
}

function prepare(days) {
  days.forEach((day) => {
    if (Number.isFinite(day.active_kcal) && Number.isFinite(day.basal_kcal)) {
      day.total_kcal = day.active_kcal + day.basal_kcal;
    }
    // Counted from noon, so a night reads as one continuous stretch on the axis.
    if (Number.isFinite(day.bedtime)) day.bed_axis = (day.bedtime + 720) % 1440;
    if (Number.isFinite(day.wake_time)) day.wake_axis = (day.wake_time + 720) % 1440;
  });
  [
    'asleep', 'deep', 'rem', 'core', 'awake', 'in_bed', 'bed_axis', 'wake_axis', 'sleep_hr', 'sleep_hr_low', 'sleep_hrv', 'breath',
    'hr_rest', 'hr_awake', 'hr_workout', 'resting_hr', 'vo2', 'steps', 'active_kcal', 'total_kcal',
    'exercise_min', 'spo2', 'breathing_dist', 'wrist_temp', 'hr_recovery',
  ].forEach((key) => addMovingAverage(days, key));
  addRegularity(days);
}

function niceTicks(min, max, steps = [1, 2, 5, 10], count = 4) {
  const span = max - min || 1;
  const rough = span / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = steps.find((m) => m * power >= rough) * power;
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

function timeTicks(min, max) {
  const ticks = [];
  for (let v = Math.floor(min / 180) * 180; v <= Math.ceil(max / 180) * 180; v += 180) ticks.push(v);
  return ticks;
}

function createPlot(chart, items, width, yTicks, xLabel, inset = 0) {
  const inner = width - MARGIN.left - MARGIN.right;
  const height = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom;
  const node = svg('svg', {
    class: 'hd-plot',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    tabindex: '0',
    'aria-label': chart.title,
  });
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const x = (i) => MARGIN.left + inset + (items.length === 1 ? (inner - 2 * inset) / 2 : (i / (items.length - 1)) * (inner - 2 * inset));
  const y = (v) => MARGIN.top + PLOT_HEIGHT - ((v - yMin) / (yMax - yMin)) * PLOT_HEIGHT;

  yTicks.forEach((tick, index) => {
    svg('line', {
      x1: MARGIN.left,
      x2: width - MARGIN.right,
      y1: y(tick),
      y2: y(tick),
      stroke: index === 0 ? 'var(--hd-axis)' : 'var(--hd-grid)',
      'stroke-width': 1,
    }, node);
    const label = svg('text', { x: MARGIN.left - 8, y: y(tick) + 4, 'text-anchor': 'end' }, node);
    label.textContent = chart.formatAxis(tick);
  });

  const labelCount = Math.max(2, Math.min(7, Math.floor(inner / 90)));
  const seen = new Set();
  for (let n = 0; n < labelCount; n += 1) {
    const i = Math.round((n / (labelCount - 1)) * (items.length - 1));
    if (seen.has(i)) continue;
    seen.add(i);
    const anchor = n === 0 ? 'start' : n === labelCount - 1 ? 'end' : 'middle';
    const label = svg('text', { x: x(i), y: height - 8, 'text-anchor': anchor }, node);
    label.textContent = xLabel(items[i]);
  }
  return { node, x, y, height, inset };
}

function linePath(days, key, x, y) {
  let path = '';
  let drawing = false;
  days.forEach((day, i) => {
    const value = day[key];
    if (Number.isFinite(value)) {
      path += `${drawing ? 'L' : 'M'}${x(i).toFixed(1)} ${y(value).toFixed(1)}`;
      drawing = true;
    } else {
      drawing = false;
    }
  });
  return path;
}

function addHover(frame, plot, items, chart, width, fillTip, drawMarkers) {
  const tip = html('div', 'hd-tip', undefined, frame);
  tip.hidden = true;
  const guide = svg('line', {
    y1: MARGIN.top,
    y2: MARGIN.top + PLOT_HEIGHT,
    stroke: 'var(--hd-axis)',
    'stroke-width': 1,
    visibility: 'hidden',
  }, plot.node);
  const markers = svg('g', {}, plot.node);
  let active = null;

  const show = (index) => {
    active = index;
    guide.setAttribute('x1', plot.x(index));
    guide.setAttribute('x2', plot.x(index));
    guide.setAttribute('visibility', 'visible');
    markers.replaceChildren();
    if (drawMarkers) drawMarkers(markers, index);
    tip.replaceChildren();
    fillTip(tip, items[index]);
    tip.hidden = false;
    const scale = plot.node.getBoundingClientRect().width / width;
    const px = plot.x(index) * scale;
    const left = px + 12 + tip.offsetWidth > frame.clientWidth ? px - tip.offsetWidth - 12 : px + 12;
    tip.style.transform = `translate(${Math.max(0, left)}px, ${MARGIN.top}px)`;
  };

  const hide = () => {
    active = null;
    tip.hidden = true;
    guide.setAttribute('visibility', 'hidden');
    markers.replaceChildren();
  };

  const indexAt = (event) => {
    const rect = plot.node.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = (px - MARGIN.left - plot.inset) / (width - MARGIN.left - MARGIN.right - 2 * plot.inset);
    return Math.max(0, Math.min(items.length - 1, Math.round(ratio * (items.length - 1))));
  };

  plot.node.addEventListener('pointermove', (event) => show(indexAt(event)));
  plot.node.addEventListener('pointerdown', (event) => show(indexAt(event)));
  plot.node.addEventListener('pointerleave', hide);
  plot.node.addEventListener('blur', hide);
  plot.node.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1 };
    if (event.key === 'Escape') hide();
    if (!(event.key in moves)) return;
    event.preventDefault();
    const start = active ?? items.length - 1;
    show(Math.max(0, Math.min(items.length - 1, start + (active === null ? 0 : moves[event.key]))));
  });
}

function tipRow(tip, color, label, value) {
  const row = html('div', 'hd-tip__row', undefined, tip);
  const name = html('span', 'hd-tip__name', undefined, row);
  html('span', 'hd-key hd-key--block', undefined, name).style.background = color;
  name.append(label);
  html('span', '', value, row);
}

function fillDayTip(chart) {
  return (tip, day) => {
    html('div', 'hd-tip__date', chart.weekly ? `Week of ${shortDate(day.date)}` : longDate(day.date), tip);
    let rows = 0;
    chart.series.forEach((series) => {
      const value = day[series.key];
      if (!Number.isFinite(value)) return;
      rows += 1;
      tipRow(tip, series.color, series.label, chart.format(value));
    });
    if (rows === 0) html('div', 'hd-tip__name', 'No data', tip);
  };
}

function guideLabel(plot, y, text) {
  const label = svg('text', { class: 'hd-guide', x: MARGIN.left + 6, y: y - 5 }, plot.node);
  label.textContent = text;
}

function drawRange(plot, chart, ticks, width) {
  if (chart.range) {
    const top = plot.y(Math.min(chart.range.high ?? Infinity, ticks[ticks.length - 1]));
    svg('rect', {
      x: MARGIN.left,
      y: top,
      width: width - MARGIN.left - MARGIN.right,
      height: plot.y(chart.range.low) - top,
      fill: 'var(--hd-band)',
    }, plot.node);
  }
  (chart.guides ?? []).forEach((guide) => {
    svg('line', {
      x1: MARGIN.left,
      x2: width - MARGIN.right,
      y1: plot.y(guide.value),
      y2: plot.y(guide.value),
      stroke: 'var(--hd-axis)',
      'stroke-width': 1,
    }, plot.node);
  });
}

// Drawn after the lines, so the labels stay readable.
function labelRange(plot, chart, ticks) {
  if (chart.range) {
    guideLabel(plot, plot.y(Math.min(chart.range.high ?? Infinity, ticks[ticks.length - 1])) + 16, chart.range.label);
  }
  (chart.guides ?? []).forEach((guide) => guideLabel(plot, plot.y(guide.value), guide.label));
}

function renderLine(frame, chart, days, width) {
  const values = days.flatMap((day) => chart.series.map((s) => day[s.key])).filter(Number.isFinite);
  // The reference range stays in view, so distance from it is visible.
  const bounds = [chart.range?.low, chart.range?.high, ...(chart.guides ?? []).map((g) => g.value)].filter(Number.isFinite);
  const min = Math.min(...values, ...bounds);
  const max = Math.max(...values, ...bounds);
  const pad = (max - min) * 0.08 || 1;
  const ticks = chart.time
    ? timeTicks(min, max)
    : niceTicks(chart.zeroBase ? 0 : Math.max(0, min - pad), max + pad);
  const plot = createPlot(chart, days, width, ticks, (day) => shortDate(day.date));
  drawRange(plot, chart, ticks, width);

  chart.series.forEach((series) => {
    svg('path', {
      d: linePath(days, series.key, plot.x, plot.y),
      fill: 'none',
      stroke: series.color,
      'stroke-width': series.thin ? 1 : 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }, plot.node);
  });

  labelRange(plot, chart, ticks);

  // Labels the line ends, unless they would collide, then the legend and tooltip carry them.
  const ends = chart.series
    .filter((s) => !s.thin)
    .map((series) => {
      let index = days.length - 1;
      while (index > 0 && !Number.isFinite(days[index][series.key])) index -= 1;
      return { series, index, value: days[index][series.key] };
    })
    .filter((end) => Number.isFinite(end.value));
  const apart = ends.every((a, i) => ends.every((b, j) => i >= j || Math.abs(plot.y(a.value) - plot.y(b.value)) > 14));
  ends.forEach(({ series, index, value }) => {
    svg('circle', {
      cx: plot.x(index), cy: plot.y(value), r: 4, fill: series.color,
      stroke: 'var(--hd-surface)', 'stroke-width': 2,
    }, plot.node);
    if (apart) {
      const label = svg('text', { class: 'hd-end', x: plot.x(index) + 8, y: plot.y(value) + 4 }, plot.node);
      label.textContent = chart.formatAxis(value >= 100 ? Math.round(value) : Math.round(value * 10) / 10);
    }
  });

  frame.appendChild(plot.node);
  addHover(frame, plot, days, chart, width, fillDayTip(chart), (group, index) => {
    chart.series.forEach((series) => {
      const value = days[index][series.key];
      if (!Number.isFinite(value) || series.thin) return;
      svg('circle', {
        cx: plot.x(index), cy: plot.y(value), r: 4, fill: series.color,
        stroke: 'var(--hd-surface)', 'stroke-width': 2,
      }, group);
    });
  });
}

function column(plot, node, centre, thickness, top, bottom, color, rounded) {
  const left = centre - thickness / 2;
  const right = left + thickness;
  const r = rounded && thickness >= 8 ? Math.min(4, bottom - top) : 0;
  svg('path', {
    d: `M${left} ${bottom}V${top + r}Q${left} ${top} ${left + r} ${top}H${right - r}Q${right} ${top} ${right} ${top + r}V${bottom}Z`,
    fill: color,
  }, node);
}

// Insets the first and last columns so they cannot cover the axis labels.
function columnFit(count, width) {
  const slot = (width - MARGIN.left - MARGIN.right) / Math.max(1, count);
  const thickness = Math.max(2, Math.min(COLUMN_MAX, slot - 2));
  return { thickness, inset: thickness / 2 + 2 };
}

function renderStack(frame, chart, days, width) {
  const totals = days.map((day) => chart.series.reduce((sum, s) => sum + (day[s.key] ?? 0), 0));
  const { thickness, inset } = columnFit(days.length, width);
  const top = Math.max(...totals, ...(chart.guides ?? []).map((g) => g.value));
  // Counts such as sessions need whole-number ticks.
  const ticks = niceTicks(0, top).filter((tick) => !chart.wholeTicks || Number.isInteger(tick));
  const plot = createPlot(chart, days, width, ticks, (day) => shortDate(day.date), inset);
  const gap = thickness >= 6 ? 2 : 0;

  days.forEach((day, i) => {
    let bottom = plot.y(0);
    const parts = chart.series.filter((s) => (day[s.key] ?? 0) > 0);
    parts.forEach((series, partIndex) => {
      const size = plot.y(0) - plot.y(day[series.key]);
      const segmentTop = bottom - Math.max(0.5, size - gap);
      column(plot, plot.node, plot.x(i), thickness, segmentTop, bottom, series.color, partIndex === parts.length - 1);
      bottom = segmentTop - gap;
    });
  });
  // Drawn after the columns, so a goal line stays visible across them.
  drawRange(plot, chart, ticks, width);
  labelRange(plot, chart, ticks);

  frame.appendChild(plot.node);
  addHover(frame, plot, days, chart, width, fillDayTip(chart));
}

function histogramData(days, key, width) {
  const counts = new Map();
  days.forEach((day) => {
    Object.entries(day[key] ?? {}).forEach(([bucket, n]) => {
      counts.set(Number(bucket), (counts.get(Number(bucket)) ?? 0) + n);
    });
  });
  if (counts.size === 0) return null;
  const buckets = [...counts.keys()];
  const lo = Math.min(...buckets);
  const hi = Math.max(...buckets);
  const items = [];
  for (let bucket = lo; bucket <= hi; bucket += width) {
    items.push({ bucket, count: counts.get(bucket) ?? 0 });
  }
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const mean = items.reduce((sum, item) => sum + (item.bucket + width / 2) * item.count, 0) / total;
  let running = 0;
  const medianItem = items.find((item) => {
    running += item.count;
    return running >= total / 2;
  });
  const modeItem = items.reduce((best, item) => (item.count > best.count ? item : best));
  return { items, total, mean, median: medianItem.bucket + width / 2, mode: modeItem.bucket + width / 2 };
}

function renderHistogram(frame, chart, data, width) {
  const { thickness, inset } = columnFit(data.items.length, width);
  const plot = createPlot(
    chart,
    data.items,
    width,
    niceTicks(0, Math.max(...data.items.map((item) => item.count))),
    (item) => `${item.bucket}`,
    inset,
  );
  data.items.forEach((item, i) => {
    if (item.count === 0) return;
    const zone = chart.zones?.find((z) => item.bucket < z.below);
    column(plot, plot.node, plot.x(i), thickness, plot.y(item.count), plot.y(0), zone?.color ?? chart.color, true);
  });
  frame.appendChild(plot.node);
  addHover(frame, plot, data.items, chart, width, (tip, item) => {
    html('div', 'hd-tip__date', `${item.bucket}-${item.bucket + chart.bucket} ${chart.unit}`, tip);
    tipRow(tip, chart.color, 'Readings', item.count.toLocaleString());
  });
}

function legend(parent, chart) {
  if (chart.zones) {
    const zones = html('ul', 'hd-legend', undefined, parent);
    chart.zones.forEach((zone) => {
      const item = html('li', '', undefined, zones);
      html('span', 'hd-key hd-key--block', undefined, item).style.background = zone.color;
      item.append(zone.label);
    });
    return;
  }
  if (!chart.series || (chart.series.length < 2 && !chart.range)) return;
  const list = html('ul', 'hd-legend', undefined, parent);
  chart.series.forEach((series) => {
    const item = html('li', '', undefined, list);
    const key = html('span', `hd-key${chart.kind === 'stack' ? ' hd-key--block' : ''}`, undefined, item);
    key.style.background = series.color;
    item.append(series.label);
  });
  if (chart.range) {
    const item = html('li', '', undefined, list);
    html('span', 'hd-key hd-key--block hd-key--band', undefined, item);
    item.append(chart.range.label);
  }
}

const raw = 'var(--hd-raw)';
const s1 = 'var(--hd-s1)';
const s2 = 'var(--hd-s2)';
const s3 = 'var(--hd-s3)';
const s4 = 'var(--hd-s4)';

const daily = (key, title, sub, format, extra = {}) => ({
  kind: 'line',
  title,
  sub,
  format,
  formatAxis: (v) => v.toLocaleString(),
  series: [
    { key, label: 'Daily', color: raw, thin: true },
    { key: `${key}_ma`, label: '7-day average', color: s1 },
  ],
  ...extra,
});

const trends = (title, sub, format, series, extra = {}) => ({
  kind: 'line',
  title,
  sub,
  format,
  formatAxis: (v) => v.toLocaleString(),
  series,
  ...extra,
});

const good = 'var(--hd-good)';
const warning = 'var(--hd-warning)';
const critical = 'var(--hd-critical)';

const distribution = (title, key, bucket, unit, color, zones) => ({
  kind: 'histogram', title, key, bucket, unit, color, zones, formatAxis: compact,
});

const SLEEP_HR_ZONES = [
  { below: 50, label: 'Athletic (<50)', color: good },
  { below: 60, label: 'Good (50-60)', color: s1 },
  { below: 70, label: 'Average (60-70)', color: warning },
  { below: Infinity, label: 'Elevated (>70)', color: critical },
];

const HRV_ZONES = [
  { below: 20, label: 'Very low (<20)', color: critical },
  { below: 50, label: 'Below average (20-50)', color: warning },
  { below: 100, label: 'Good (50-100)', color: s1 },
  { below: Infinity, label: 'Excellent (>100)', color: good },
];

const ACTIVITY_NAMES = {
  strength: 'Strength', functionalStrength: 'Functional strength', core: 'Core', hiit: 'HIIT', running: 'Running',
  walking: 'Walking', hiking: 'Hiking', cycling: 'Cycling', swimming: 'Swimming', rowing: 'Rowing',
  elliptical: 'Elliptical', stairs: 'Stairs', crossTraining: 'Cross training', yoga: 'Yoga', pilates: 'Pilates',
  cardio: 'Cardio', cricket: 'Cricket', badminton: 'Badminton', tennis: 'Tennis', football: 'Football',
  basketball: 'Basketball', other: 'Other',
};
const activityLabel = (name) => ACTIVITY_NAMES[name] ?? 'Other';

const stageTrend = (name, key, sub, range) => ({
  name,
  ...daily(key, name, sub, hours, { zeroBase: true, range, formatAxis: (v) => `${v}h` }),
});

const SECTIONS = [
  {
    title: '1. Sleep',
    sub: 'Duration, timing, stages and overnight vitals',
    charts: [
      trends('Sleep duration', 'Hours, 7-day average', hours, [
        { key: 'in_bed_ma', label: 'Main sleep span', color: s2 },
        { key: 'asleep_ma', label: 'Time asleep', color: s1 },
      ], { formatAxis: (v) => `${v}h`, zeroBase: true, range: { low: 7, high: 9, label: 'Ideal: 7-9 h asleep' } }),
      trends('Bedtime and wake time', 'Local time, 7-day average. No fixed target; consistency matters most.', clock, [
        { key: 'wake_axis_ma', label: 'Wake time', color: s2 },
        { key: 'bed_axis_ma', label: 'Bedtime', color: s1 },
      ], { formatAxis: clock, time: true }),
      {
        kind: 'stack',
        wide: true,
        title: 'Sleep stages',
        sub: 'Hours per night. Ideal: deep 1-2 h, REM 1.5-2 h, awake under 30 min.',
        format: hours,
        formatAxis: (v) => `${v}h`,
        series: [
          { key: 'deep', label: 'Deep', color: s1 },
          { key: 'core', label: 'Core', color: s2 },
          { key: 'rem', label: 'REM', color: s3 },
          { key: 'awake', label: 'Awake', color: s4 },
        ],
      },
      {
        kind: 'profile',
        wide: true,
        title: 'Sleep stages vs ideal',
        sub: 'Average hours per night',
        rows: [
          { key: 'deep', label: 'Deep', low: 1, high: 2, ideal: '1-2 h' },
          { key: 'rem', label: 'REM', low: 1.5, high: 2, ideal: '1.5-2 h' },
          { key: 'core', label: 'Core', ideal: null },
          { key: 'awake', label: 'Awake', low: 0, high: 0.5, ideal: 'Under 30 min' },
        ],
      },
      {
        kind: 'switch',
        wide: true,
        title: 'Stage trend',
        options: [
          stageTrend('Deep', 'deep', 'Hours per night', { low: 1, high: 2, label: 'Ideal: 1-2 h' }),
          stageTrend('REM', 'rem', 'Hours per night', { low: 1.5, high: 2, label: 'Ideal: 1.5-2 h' }),
          stageTrend('Core', 'core', 'Hours per night. Usually about half of total sleep.'),
          stageTrend('Awake', 'awake', 'Hours per night', { low: 0, high: 0.5, label: 'Ideal: under 30 min' }),
        ],
      },
      trends('Sleep regularity', 'Score from your last 7 nights of main sleep. 100 means the same sleep times every day.', (v) => `${Math.round(v)}`, [
        { key: 'regularity', label: 'Regularity', color: s1 },
      ]),
      trends('Heart rate during sleep', 'Beats per minute, 7-day average', bpm, [
        { key: 'sleep_hr_ma', label: 'Average', color: s2 },
        { key: 'sleep_hr_low_ma', label: 'Lowest', color: s1 },
      ], {
        guides: [
          { value: 50, label: 'Athletic (<50)' },
          { value: 60, label: 'Good (<60)' },
          { value: 70, label: 'Elevated (>70)' },
        ],
      }),
      daily('sleep_hrv', 'HRV during sleep', 'SDNN in milliseconds. A rough guide, as HRV varies with age.', ms, {
        guides: [
          { value: 20, label: 'Very low (20)' },
          { value: 50, label: 'Below average (<50)' },
          { value: 100, label: 'Excellent (100)' },
        ],
      }),
      distribution('Sleep heart rate distribution', 'h_sleep', 2, 'bpm', s1, SLEEP_HR_ZONES),
      distribution('Sleep HRV distribution', 'h_hrv', 5, 'ms', s1, HRV_ZONES),
      daily('breath', 'Breathing rate during sleep', 'Breaths per minute', (v) => `${fixed1(v)} br/min`, {
        range: { low: 12, high: 20, label: 'Normal: 12-20' },
      }),
    ],
  },
  {
    title: '2. Heart',
    sub: 'Daily heart rate by state, resting heart rate and fitness',
    charts: [
      trends('Heart rate over time', 'Daily averages, 7-day average', bpm, [
        { key: 'hr_workout_ma', label: 'Workout', color: s2 },
        { key: 'hr_awake_ma', label: 'Awake', color: s1 },
        { key: 'hr_rest_ma', label: 'Rest', color: s3 },
      ], { wide: true }),
      distribution('Awake heart rate distribution', 'h_awake', 2, 'bpm', s1),
      distribution('Workout heart rate distribution', 'h_workout', 2, 'bpm', s2),
      daily('hr_recovery', 'Heart rate recovery', 'Drop in beats per minute one minute after exercise, recorded after some workouts.', bpm),
      daily('resting_hr', 'Resting heart rate', 'Beats per minute. Below 60 is not always a concern, especially if you train.', bpm, {
        range: { low: 60, high: 100, label: 'Normal: 60-100 bpm' },
      }),
      daily('vo2', 'VO2 max', 'ml/kg/min, estimated by Apple Watch', fixed1),
    ],
  },
  {
    title: '3. Activity',
    sub: 'Steps, calories and exercise',
    charts: [
      daily('steps', 'Daily steps', 'Steps', round, {
        wide: true, zeroBase: true, formatAxis: compact, range: { low: 7000, label: 'Goal: 7,000+ steps' },
      }),
      {
        kind: 'stack',
        weekly: true,
        wide: true,
        showsPeak: true,
        title: 'Weekly time in heart rate zones',
        sub: 'Minutes of active heart rate per week.',
        format: (v) => `${Math.round(v)} min`,
        formatAxis: compact,
        series: [
          { key: 'z1', label: 'Zone 1 (50-60%)', color: 'var(--hd-z1)' },
          { key: 'z2', label: 'Zone 2 (60-70%)', color: 'var(--hd-z2)' },
          { key: 'z3', label: 'Zone 3 (70-80%)', color: 'var(--hd-z3)' },
          { key: 'z4', label: 'Zone 4 (80-90%)', color: 'var(--hd-z4)' },
          { key: 'z5', label: 'Zone 5 (90%+)', color: 'var(--hd-z5)' },
        ],
      },
      {
        kind: 'stack',
        weekly: true,
        title: 'Strength sessions per week',
        sub: 'Sessions logged as strength or core workouts.',
        format: (v) => `${Math.round(v)}`,
        formatAxis: compact,
        wholeTicks: true,
        guides: [{ value: 2, label: 'Goal: 2 sessions' }],
        series: [{ key: 'strength', label: 'Strength', color: s1 }],
      },
      {
        kind: 'ranked',
        wide: true,
        title: 'Workouts by type',
        sub: 'Total minutes of logged workouts.',
      },
      trends('Calories', 'kcal, 7-day average', (v) => `${round(v)} kcal`, [
        { key: 'total_kcal_ma', label: 'Total', color: s2 },
        { key: 'active_kcal_ma', label: 'Active', color: s1 },
      ], { zeroBase: true, formatAxis: compact }),
      daily('exercise_min', 'Exercise time', 'Minutes per day', (v) => `${round(v)} min`, {
        zeroBase: true, range: { low: 21, label: 'Goal: 21+ min (150 per week)' },
      }),
    ],
  },
  {
    title: '4. Oxygen and temperature',
    sub: 'Blood oxygen, breathing and wrist temperature',
    charts: [
      daily('spo2', 'Blood oxygen', 'Average percent per day', (v) => `${fixed1(v)}%`, {
        range: { low: 95, high: 100, label: 'Normal: 95-100%' },
        guides: [
          { value: 90, label: 'Low (<90%)' },
          { value: 95, label: 'Below normal (90-95%)' },
        ],
      }),
      daily('breathing_dist', 'Breathing disturbances', 'Per night. Apple does not publish a numeric target.', fixed1, { zeroBase: true }),
      daily('wrist_temp', 'Wrist temperature during sleep', 'Degrees Celsius. Compare with your own baseline.', (v) => `${v.toFixed(2)} C`),
    ],
  },
];

const TILES = [
  { key: 'asleep', label: 'Time asleep', format: hours, reference: 'Ideal 7-9 h' },
  { key: 'sleep_hr', label: 'Sleep heart rate', format: bpm, reference: 'Good 50-60 bpm' },
  { key: 'sleep_hrv', label: 'Sleep HRV', format: ms, reference: 'Good 50-100 ms' },
  { key: 'resting_hr', label: 'Resting heart rate', format: bpm, reference: 'Normal 60-100 bpm' },
  { key: 'steps', label: 'Daily steps', format: round, reference: 'Goal 7,000+' },
  { key: 'spo2', label: 'Blood oxygen', format: (v) => `${fixed1(v)}%`, reference: 'Normal 95-100%' },
];

const hasData = (days, chart) => chart.series.some((s) => {
  const count = days.filter((d) => Number.isFinite(d[s.key])).length;
  // Weekly totals are zero when nothing was recorded, so a stack needs a value above zero.
  return chart.kind === 'stack' ? days.some((d) => d[s.key] > 0) : !s.thin && count >= 2;
});

function renderTiles(parent, days) {
  const grid = html('div', 'hd-tiles', undefined, parent);
  TILES.forEach((tile) => {
    const values = days.map((d) => d[tile.key]).filter(Number.isFinite);
    if (values.length === 0) return;
    const card = html('div', 'hd-tile', undefined, grid);
    infoButton(html('span', 'hd-tile__label', tile.label, card), tile.label);
    html('span', 'hd-tile__value', tile.format(values.reduce((a, b) => a + b, 0) / values.length), card);
    if (tile.reference) html('span', 'hd-tile__reference', tile.reference, card);
  });
}

// Starts each chart at its own first reading, so a metric with a long history cannot squeeze the rest.
function fromFirstReading(days, chart) {
  const first = days.findIndex((day) => chart.series.some((s) => Number.isFinite(day[s.key])));
  return first > 0 ? days.slice(first) : days;
}

function profileRows(chart, days) {
  return chart.rows.map((row) => {
    const values = days.map((day) => day[row.key]).filter(Number.isFinite);
    const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const hits = row.ideal ? values.filter((v) => v >= row.low && v <= row.high).length : null;
    return { ...row, average, hits, count: values.length };
  }).filter((row) => row.average !== null);
}

function renderProfile(frame, chart, rows, width) {
  const narrow = width < 520;
  const left = narrow ? 76 : 96;
  const right = narrow ? 44 : 104;
  const rowHeight = 40;
  const axisHeight = 24;
  const height = rows.length * rowHeight + axisHeight;
  const inner = width - left - right;
  const ticks = niceTicks(0, Math.max(...rows.map((row) => Math.max(row.average, row.high ?? 0))), [1, 2, 5, 10], 5);
  const max = ticks[ticks.length - 1];
  const x = (v) => left + (v / max) * inner;
  const node = svg('svg', {
    class: 'hd-plot',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    tabindex: '0',
    'aria-label': rows.map((row) => `${row.label}: average ${hours(row.average)}${row.ideal ? `, ideal ${row.ideal}, in range ${row.hits} of ${row.count} nights` : ''}`).join('. '),
  });

  ticks.forEach((tick) => {
    svg('line', {
      x1: x(tick), x2: x(tick), y1: 0, y2: rows.length * rowHeight, stroke: 'var(--hd-grid)', 'stroke-width': 1,
    }, node);
    const label = svg('text', { x: x(tick), y: height - 6, 'text-anchor': 'middle' }, node);
    label.textContent = `${tick}h`;
  });

  rows.forEach((row, index) => {
    const middle = index * rowHeight + rowHeight / 2;
    const name = svg('text', { class: 'hd-end', x: 0, y: middle - 1 }, node);
    name.textContent = row.label;
    const value = svg('text', { x: 0, y: middle + 13 }, node);
    value.textContent = hours(row.average);
    svg('line', {
      x1: x(0), x2: x(max), y1: middle, y2: middle, stroke: 'var(--hd-axis)', 'stroke-width': 1,
    }, node);
    if (row.ideal) {
      svg('rect', {
        x: x(row.low), y: middle - 9, width: x(row.high) - x(row.low), height: 18, rx: 3, fill: 'var(--hd-ideal)',
      }, node);
    }
    svg('circle', {
      cx: x(row.average), cy: middle, r: 6, fill: 'var(--hd-s1)', stroke: 'var(--hd-surface)', 'stroke-width': 2,
    }, node);
    const tally = svg('text', { x: width, y: middle + 4, 'text-anchor': 'end' }, node);
    if (row.ideal) tally.textContent = narrow ? `${row.hits}/${row.count}` : `${row.hits}/${row.count} nights`;
  });
  frame.appendChild(node);

  const tip = html('div', 'hd-tip', undefined, frame);
  tip.hidden = true;
  const show = (event) => {
    const rect = node.getBoundingClientRect();
    const row = rows[Math.floor(((event.clientY - rect.top) / rect.height) * height / rowHeight)];
    if (!row) { tip.hidden = true; return; }
    tip.replaceChildren();
    html('div', 'hd-tip__date', row.label, tip);
    html('div', '', `Average ${hours(row.average)}`, tip);
    html('div', 'hd-tip__name', row.ideal ? `Ideal ${row.ideal}, in range on ${row.hits} of ${row.count} nights` : 'No fixed ideal. Usually about half of sleep.', tip);
    tip.hidden = false;
    const px = event.clientX - rect.left;
    const position = px + 12 + tip.offsetWidth > frame.clientWidth ? px - tip.offsetWidth - 12 : px + 12;
    tip.style.transform = `translate(${Math.max(0, position)}px, ${event.clientY - rect.top + 10}px)`;
  };
  node.addEventListener('pointermove', show);
  node.addEventListener('pointerdown', show);
  node.addEventListener('pointerleave', () => { tip.hidden = true; });
}

const selectedOption = new Map();

function addSwitchChart(grid, chart, allDays) {
  const options = chart.options
    .map((option) => ({ option, days: fromFirstReading(allDays, option) }))
    .filter(({ option, days }) => hasData(days, option));
  if (options.length === 0) return null;

  const figure = html('figure', 'hd-chart hd-chart--wide', undefined, grid);
  const caption = html('figcaption', '', undefined, figure);
  const switchTitle = html('span', 'hd-chart__title', chart.title, caption);
  infoButton(switchTitle, () => selectedOption.get(chart.title) ?? options[0].option.name);
  const sub = html('span', 'hd-chart__sub', undefined, caption);
  const tabs = html('div', 'hd-tabs', undefined, figure);
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', `${chart.title} stage`);
  const legendSlot = html('div', '', undefined, figure);
  const frame = html('div', 'hd-frame', undefined, figure);

  const draw = () => {
    const name = selectedOption.get(chart.title);
    const { option, days } = options.find(({ option: o }) => o.name === name) ?? options[0];
    sub.textContent = option.sub;
    [...tabs.children].forEach((button) => {
      button.setAttribute('aria-pressed', String(button.textContent === option.name));
    });
    legendSlot.replaceChildren();
    legend(legendSlot, option);
    frame.replaceChildren();
    renderLine(frame, option, days, Math.max(260, Math.round(frame.clientWidth)));
  };

  options.forEach(({ option }) => {
    const button = html('button', '', option.name, tabs);
    button.type = 'button';
    button.addEventListener('click', () => {
      closeInfo();
      selectedOption.set(chart.title, option.name);
      draw();
    });
  });
  return draw;
}

function renderRanked(frame, chart, rows, width) {
  const left = width < 520 ? 104 : 150;
  const right = 64;
  const rowHeight = 26;
  const height = rows.length * rowHeight;
  const max = Math.max(...rows.map((row) => row.minutes));
  const node = svg('svg', {
    class: 'hd-plot',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': rows.map((row) => `${activityLabel(row.name)}: ${Math.round(row.minutes)} minutes`).join('. '),
  });
  rows.forEach((row, index) => {
    const middle = index * rowHeight + rowHeight / 2;
    const label = svg('text', { x: 0, y: middle + 4 }, node);
    label.textContent = activityLabel(row.name);
    svg('rect', {
      x: left, y: middle - 8, width: Math.max(2, (row.minutes / max) * (width - left - right)), height: 16, rx: 3, fill: 'var(--hd-s1)',
    }, node);
    const value = svg('text', { class: 'hd-end', x: width, y: middle + 4, 'text-anchor': 'end' }, node);
    value.textContent = `${Math.round(row.minutes).toLocaleString()} min`;
  });
  frame.appendChild(node);
}

function addChart(grid, chart, allDays) {
  if (chart.kind === 'switch') return addSwitchChart(grid, chart, allDays);
  const activities = chart.kind === 'ranked' ? activityTotals(allDays) : null;
  if (activities) {
    if (activities.length === 0) return null;
    const figure = html('figure', `hd-chart${chart.wide ? ' hd-chart--wide' : ''}`, undefined, grid);
    const caption = html('figcaption', '', undefined, figure);
    infoButton(html('span', 'hd-chart__title', chart.title, caption), chart.title);
    html('span', 'hd-chart__sub', chart.sub, caption);
    const frame = html('div', 'hd-frame', undefined, figure);
    return () => renderRanked(frame, chart, activities, Math.max(260, Math.round(frame.clientWidth)));
  }
  const source = chart.weekly
    ? weeklySummaries(completeDays(allDays, new Date().toLocaleDateString('en-CA')))
    : allDays;
  const days = chart.series ? fromFirstReading(source, chart) : source;
  const data = chart.kind === 'histogram' ? histogramData(days, chart.key, chart.bucket) : null;
  const profile = chart.kind === 'profile' ? profileRows(chart, days) : null;
  if (profile ? profile.length === 0 : chart.kind === 'histogram' ? !data : !hasData(days, chart)) return null;

  const figure = html('figure', `hd-chart${chart.wide ? ' hd-chart--wide' : ''}`, undefined, grid);
  const caption = html('figcaption', '', undefined, figure);
  infoButton(html('span', 'hd-chart__title', chart.title, caption), chart.title);
  const sub = data
    ? `Mean ${data.mean.toFixed(1)} · Median ${data.median} · Mode ${data.mode} ${chart.unit}`
    : chart.sub;
  const peak = chart.showsPeak ? peakHeartRate(allDays) : null;
  html('span', 'hd-chart__sub', peak ? `${sub} Zones use your highest recorded heart rates, about ${peak} bpm, as your maximum.` : sub, caption);
  if (profile) {
    const list = html('ul', 'hd-legend', undefined, figure);
    const average = html('li', '', undefined, list);
    html('span', 'hd-swatch hd-swatch--dot', undefined, average);
    average.append('Average');
    const ideal = html('li', '', undefined, list);
    html('span', 'hd-swatch hd-swatch--ideal', undefined, ideal);
    ideal.append('Ideal range');
  } else {
    legend(figure, chart);
  }
  const frame = html('div', 'hd-frame', undefined, figure);
  return () => {
    const width = Math.max(260, Math.round(frame.clientWidth));
    if (profile) renderProfile(frame, chart, profile, width);
    else if (data) renderHistogram(frame, chart, data, width);
    else if (chart.kind === 'stack') renderStack(frame, chart, days, width);
    else renderLine(frame, chart, days, width);
  };
}

const TREND = {
  better: { icon: '↗', text: 'Better' },
  worse: { icon: '↘', text: 'Worse' },
  same: { icon: '→', text: 'About the same' },
  'on-target': { icon: '✓', text: 'On target' },
  new: { icon: '·', text: 'New this week' },
};

function renderWeeks(parent, weeks) {
  html('h4', 'hd-block-title', 'Last 7 days vs the 7 before', parent);
  const grid = html('div', 'hd-weeks', undefined, parent);
  weeks.forEach(({ goal, last, previous, trend }) => {
    const card = html('div', 'hd-week', undefined, grid);
    infoButton(html('span', 'hd-tile__label', goal.label, card), goal.label);
    html('span', 'hd-week__value', goal.format(last.average), card);
    const line = html('span', `hd-week__trend hd-week__trend--${trend}`, undefined, card);
    html('span', '', TREND[trend].icon, line).setAttribute('aria-hidden', 'true');
    line.append(` ${TREND[trend].text}`);
    const detail = previous.average === null ? `Target ${goal.target}` : `Was ${goal.format(previous.average)} · Target ${goal.target}`;
    html('span', 'hd-tile__reference', detail, card);
  });
}

function renderLevers(parent, levers, nights) {
  html('h4', 'hd-block-title', 'Habits linked to your results', parent);
  if (levers.length === 0) {
    html('p', 'hd-block-sub', 'No clear patterns yet. These appear when a habit and a result differ clearly across at least 10 days each way.', parent);
    return;
  }
  html('p', 'hd-block-sub', `Patterns from ${nights} days of data. They show what tends to go together, not what causes what.`, parent);
  const grid = html('div', 'hd-levers', undefined, parent);
  levers.forEach((lever) => {
    const card = html('div', 'hd-lever', undefined, grid);
    html('span', 'hd-lever__habit', lever.habit, card);
    html('strong', 'hd-lever__result', `${lever.outcome.label}: ${lever.outcome.format(lever.withHabit)} vs ${lever.outcome.format(lever.without)}`, card);
    const verdict = lever.helps ? 'Goes with better results' : 'Trade-off to watch';
    html('span', `hd-lever__verdict hd-lever__verdict--${lever.helps ? 'helps' : 'costs'}`, `${lever.helps ? '↗' : '↘'} ${verdict}`, card);
    html('span', 'hd-tile__reference', `${lever.countWith} days with, ${lever.countWithout} days ${lever.other}`, card);
  });
}

function renderGrid(parent, rows, width) {
  html('h4', 'hd-block-title', 'Days on target', parent);
  const figure = html('figure', 'hd-chart', undefined, parent);
  const legendList = html('ul', 'hd-legend', undefined, figure);
  [['hd-swatch hd-swatch--hit', 'On target'], ['hd-swatch hd-swatch--miss', 'Off target'], ['hd-swatch', 'No data']].forEach(([className, label]) => {
    const item = html('li', '', undefined, legendList);
    html('span', className, undefined, item);
    item.append(label);
  });
  const frame = html('div', 'hd-frame', undefined, figure);
  const available = Math.max(260, Math.round(frame.clientWidth || width));
  const narrow = available < 520;
  const labelWidth = narrow ? 104 : 150;
  const countWidth = 46;
  const count = rows[0].cells.length;
  const gap = 1;
  const cell = Math.max(3, Math.min(16, (available - labelWidth - countWidth) / count - gap));
  const rowHeight = Math.max(cell, 13) + 5;
  const height = rows.length * rowHeight + 20;
  const node = svg('svg', {
    class: 'hd-plot',
    viewBox: `0 0 ${available} ${height}`,
    role: 'img',
    tabindex: '0',
    'aria-label': rows.map((row) => `${row.goal.label}: on target ${row.hits} of ${row.count} days`).join('. '),
  });
  rows.forEach((row, r) => {
    const y = r * rowHeight;
    const label = svg('text', { x: 0, y: y + rowHeight / 2 + 3 }, node);
    label.textContent = row.goal.label;
    const tally = svg('text', { x: available, y: y + rowHeight / 2 + 3, 'text-anchor': 'end' }, node);
    tally.textContent = `${row.hits}/${row.count}`;
    row.cells.forEach((item, c) => {
      const attrs = { x: labelWidth + c * (cell + gap), y: y + (rowHeight - cell) / 2, width: cell, height: cell, rx: 1.5 };
      if (item.hit === null) svg('rect', { ...attrs, fill: 'var(--hd-grid)' }, node);
      else if (item.hit) svg('rect', { ...attrs, fill: 'var(--hd-good)' }, node);
      else svg('rect', { ...attrs, fill: 'none', stroke: 'var(--hd-raw)', 'stroke-width': 1 }, node);
    });
  });
  const dates = rows[0].cells;
  [0, dates.length - 1].forEach((index) => {
    const label = svg('text', {
      x: labelWidth + index * (cell + gap) + (index ? cell : 0),
      y: height - 4,
      'text-anchor': index ? 'end' : 'start',
    }, node);
    label.textContent = shortDate(dates[index].date);
  });
  frame.appendChild(node);

  const tip = html('div', 'hd-tip', undefined, frame);
  tip.hidden = true;
  node.addEventListener('pointerleave', () => { tip.hidden = true; });
  const show = (event) => {
    const rect = node.getBoundingClientRect();
    const scale = available / rect.width;
    const c = Math.floor(((event.clientX - rect.left) * scale - labelWidth) / (cell + gap));
    const r = Math.floor(((event.clientY - rect.top) * scale) / rowHeight);
    const row = rows[r];
    const item = row?.cells[c];
    if (!item) { tip.hidden = true; return; }
    tip.replaceChildren();
    html('div', 'hd-tip__date', longDate(item.date), tip);
    html('div', 'hd-tip__name', row.goal.label, tip);
    html('div', '', item.value === null ? 'No data' : `${row.goal.format(item.value)} · ${item.hit ? 'On target' : 'Off target'} (${row.goal.target})`, tip);
    tip.hidden = false;
    const px = (event.clientX - rect.left);
    const left = px + 12 + tip.offsetWidth > frame.clientWidth ? px - tip.offsetWidth - 12 : px + 12;
    tip.style.transform = `translate(${Math.max(0, left)}px, ${event.clientY - rect.top + 12}px)`;
  };
  node.addEventListener('pointermove', show);
  node.addEventListener('pointerdown', show);
}

function renderOverview(content, allDays) {
  const today = new Date().toLocaleDateString('en-CA');
  const days = completeDays(allDays, today);
  if (days.length === 0) return;
  const section = html('div', 'hd-overview', undefined, content);
  const weeks = compareWeeks(days);
  renderWeeks(section, weeks);
  renderLevers(section, findLevers(days), days.length);
  const rows = targetGrid(days);
  if (rows.length) renderGrid(section, rows, content.clientWidth);
}

function render(content, days) {
  closeInfo();
  content.replaceChildren();

  SECTIONS.forEach((section) => {
    const heading = html('div', 'hd-section', undefined, content);
    html('h3', 'hd-section__title', section.title, heading);
    html('p', 'hd-section__sub', section.sub, heading);
    const grid = html('div', 'hd-grid', undefined, content);
    // Drawn after every card exists, because the grid sets each card's final width.
    const draws = section.charts.map((chart) => addChart(grid, chart, days)).filter(Boolean);
    draws.forEach((draw) => draw());
    if (draws.length === 0) heading.remove();
  });

  renderOverview(content, days);
  renderTiles(content, days);
}

async function main() {
  let file;
  try {
    const response = await fetch(root.dataset.src, { cache: 'no-cache' });
    if (!response.ok) throw new Error(String(response.status));
    file = await response.json();
  } catch {
    status.textContent = 'Health data is not available right now.';
    return;
  }
  if (!file.days?.length) {
    status.textContent = 'No data yet.';
    return;
  }

  // Starts at the first watch reading, because earlier iPhone-only counts are unreliable.
  const days = watchPeriod(fillDays(file.days));
  prepare(days);

  status.remove();

  const content = html('div', '', undefined, root);
  render(content, days);

  let lastWidth = content.clientWidth;
  let timer;
  new ResizeObserver(() => {
    if (content.clientWidth === lastWidth) return;
    lastWidth = content.clientWidth;
    clearTimeout(timer);
    timer = setTimeout(() => render(content, days), 150);
  }).observe(content);
}

main();
