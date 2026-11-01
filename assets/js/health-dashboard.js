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
    'asleep', 'in_bed', 'bed_axis', 'wake_axis', 'sleep_hr', 'sleep_hr_low', 'sleep_hrv', 'breath',
    'hr_rest', 'hr_awake', 'hr_workout', 'resting_hr', 'vo2', 'steps', 'active_kcal', 'total_kcal',
    'exercise_min', 'spo2', 'breathing_dist', 'wrist_temp',
  ].forEach((key) => addMovingAverage(days, key));
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

function createPlot(chart, items, width, yTicks, xLabel) {
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
  const x = (i) => MARGIN.left + (items.length === 1 ? inner / 2 : (i / (items.length - 1)) * inner);
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
  return { node, x, y, height };
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
    const ratio = (px - MARGIN.left) / (width - MARGIN.left - MARGIN.right);
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
    html('div', 'hd-tip__date', longDate(day.date), tip);
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

function renderLine(frame, chart, days, width) {
  const values = days.flatMap((day) => chart.series.map((s) => day[s.key])).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || 1;
  const ticks = chart.time
    ? timeTicks(min, max)
    : niceTicks(chart.zeroBase ? 0 : Math.max(0, min - pad), max + pad);
  const plot = createPlot(chart, days, width, ticks, (day) => shortDate(day.date));

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
      label.textContent = chart.formatAxis(Math.round(value * 10) / 10);
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

function renderStack(frame, chart, days, width) {
  const totals = days.map((day) => chart.series.reduce((sum, s) => sum + (day[s.key] ?? 0), 0));
  const plot = createPlot(chart, days, width, niceTicks(0, Math.max(...totals)), (day) => shortDate(day.date));
  const slot = (width - MARGIN.left - MARGIN.right) / Math.max(1, days.length - 1);
  const thickness = Math.max(2, Math.min(COLUMN_MAX, slot - 2));
  const gap = thickness >= 6 ? 2 : 0;

  days.forEach((day, i) => {
    let bottom = plot.y(0);
    const parts = chart.series.filter((s) => (day[s.key] ?? 0) > 0);
    parts.forEach((series, partIndex) => {
      const size = plot.y(0) - plot.y(day[series.key]);
      const top = bottom - Math.max(0.5, size - gap);
      column(plot, plot.node, plot.x(i), thickness, top, bottom, series.color, partIndex === parts.length - 1);
      bottom = top - gap;
    });
  });

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
  const plot = createPlot(
    chart,
    data.items,
    width,
    niceTicks(0, Math.max(...data.items.map((item) => item.count))),
    (item) => `${item.bucket}`,
  );
  const slot = (width - MARGIN.left - MARGIN.right) / Math.max(1, data.items.length - 1);
  const thickness = Math.max(2, Math.min(COLUMN_MAX, slot - 2));
  data.items.forEach((item, i) => {
    if (item.count === 0) return;
    column(plot, plot.node, plot.x(i), thickness, plot.y(item.count), plot.y(0), chart.color, true);
  });
  frame.appendChild(plot.node);
  addHover(frame, plot, data.items, chart, width, (tip, item) => {
    html('div', 'hd-tip__date', `${item.bucket}-${item.bucket + chart.bucket} ${chart.unit}`, tip);
    tipRow(tip, chart.color, 'Readings', item.count.toLocaleString());
  });
}

function legend(parent, chart) {
  if (!chart.series || chart.series.length < 2) return;
  const list = html('ul', 'hd-legend', undefined, parent);
  chart.series.forEach((series) => {
    const item = html('li', '', undefined, list);
    const key = html('span', `hd-key${chart.kind === 'stack' ? ' hd-key--block' : ''}`, undefined, item);
    key.style.background = series.color;
    item.append(series.label);
  });
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

const distribution = (title, key, bucket, unit, color) => ({ kind: 'histogram', title, key, bucket, unit, color, formatAxis: compact });

const SECTIONS = [
  {
    title: '1. Sleep',
    sub: 'Duration, timing, stages and overnight vitals',
    charts: [
      trends('Sleep duration', 'Hours, 7-day average', hours, [
        { key: 'in_bed_ma', label: 'Main sleep span', color: s2 },
        { key: 'asleep_ma', label: 'Time asleep', color: s1 },
      ], { formatAxis: (v) => `${v}h`, zeroBase: true }),
      trends('Bedtime and wake time', 'Local time, 7-day average', clock, [
        { key: 'wake_axis_ma', label: 'Wake time', color: s2 },
        { key: 'bed_axis_ma', label: 'Bedtime', color: s1 },
      ], { formatAxis: clock, time: true }),
      {
        kind: 'stack',
        wide: true,
        title: 'Sleep stages',
        sub: 'Hours per night. Apple Watch stages are estimates.',
        format: hours,
        formatAxis: (v) => `${v}h`,
        series: [
          { key: 'deep', label: 'Deep', color: s1 },
          { key: 'core', label: 'Core', color: s2 },
          { key: 'rem', label: 'REM', color: s3 },
          { key: 'awake', label: 'Awake', color: s4 },
        ],
      },
      trends('Heart rate during sleep', 'Beats per minute, 7-day average', bpm, [
        { key: 'sleep_hr_ma', label: 'Average', color: s2 },
        { key: 'sleep_hr_low_ma', label: 'Lowest', color: s1 },
      ]),
      daily('sleep_hrv', 'HRV during sleep', 'SDNN in milliseconds', ms),
      distribution('Sleep heart rate distribution', 'h_sleep', 2, 'bpm', s1),
      distribution('Sleep HRV distribution', 'h_hrv', 5, 'ms', s1),
      daily('breath', 'Breathing rate during sleep', 'Breaths per minute', (v) => `${fixed1(v)} br/min`),
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
      daily('resting_hr', 'Resting heart rate', 'Beats per minute', bpm),
      daily('vo2', 'VO2 max', 'ml/kg/min, estimated by Apple Watch', fixed1),
    ],
  },
  {
    title: '3. Activity',
    sub: 'Steps, calories and exercise',
    charts: [
      daily('steps', 'Daily steps', 'Steps', round, { wide: true, zeroBase: true, formatAxis: compact }),
      trends('Calories', 'kcal, 7-day average', (v) => `${round(v)} kcal`, [
        { key: 'total_kcal_ma', label: 'Total', color: s2 },
        { key: 'active_kcal_ma', label: 'Active', color: s1 },
      ], { zeroBase: true, formatAxis: compact }),
      daily('exercise_min', 'Exercise time', 'Minutes per day', (v) => `${round(v)} min`, { zeroBase: true }),
    ],
  },
  {
    title: '4. Oxygen and temperature',
    sub: 'Blood oxygen, breathing and wrist temperature',
    charts: [
      daily('spo2', 'Blood oxygen', 'Average percent per day', (v) => `${fixed1(v)}%`),
      daily('breathing_dist', 'Breathing disturbances', 'Per night, from Apple Watch', fixed1, { zeroBase: true }),
      daily('wrist_temp', 'Wrist temperature during sleep', 'Degrees Celsius', (v) => `${v.toFixed(2)} C`),
    ],
  },
];

const TILES = [
  { key: 'asleep', label: 'Time asleep', format: hours },
  { key: 'sleep_hr', label: 'Sleep heart rate', format: bpm },
  { key: 'sleep_hrv', label: 'Sleep HRV', format: ms },
  { key: 'resting_hr', label: 'Resting heart rate', format: bpm },
  { key: 'steps', label: 'Daily steps', format: round },
  { key: 'spo2', label: 'Blood oxygen', format: (v) => `${fixed1(v)}%` },
];

const hasData = (days, chart) => chart.series.some((s) => {
  const count = days.filter((d) => Number.isFinite(d[s.key])).length;
  return chart.kind === 'stack' ? count > 0 : !s.thin && count >= 2;
});

function renderTiles(parent, days) {
  html('p', 'hd-tiles-title', 'Averages across all data', parent);
  const grid = html('div', 'hd-tiles', undefined, parent);
  TILES.forEach((tile) => {
    const values = days.map((d) => d[tile.key]).filter(Number.isFinite);
    if (values.length === 0) return;
    const card = html('div', 'hd-tile', undefined, grid);
    html('span', 'hd-tile__label', tile.label, card);
    html('span', 'hd-tile__value', tile.format(values.reduce((a, b) => a + b, 0) / values.length), card);
  });
}

function addChart(grid, chart, days) {
  const data = chart.kind === 'histogram' ? histogramData(days, chart.key, chart.bucket) : null;
  if (chart.kind === 'histogram' ? !data : !hasData(days, chart)) return null;

  const figure = html('figure', `hd-chart${chart.wide ? ' hd-chart--wide' : ''}`, undefined, grid);
  const caption = html('figcaption', '', undefined, figure);
  html('span', 'hd-chart__title', chart.title, caption);
  const sub = data
    ? `Mean ${data.mean.toFixed(1)} · Median ${data.median} · Mode ${data.mode} ${chart.unit}`
    : chart.sub;
  html('span', 'hd-chart__sub', sub, caption);
  legend(figure, chart);
  const frame = html('div', 'hd-frame', undefined, figure);
  return () => {
    const width = Math.max(260, Math.round(frame.clientWidth));
    if (data) renderHistogram(frame, chart, data, width);
    else if (chart.kind === 'stack') renderStack(frame, chart, days, width);
    else renderLine(frame, chart, days, width);
  };
}

function render(content, days) {
  content.replaceChildren();
  renderTiles(content, days);

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

  const days = fillDays(file.days);
  prepare(days);

  const updated = file.last_ingest_at ?? file.generated_at;
  status.textContent = `Last updated ${new Date(updated * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;

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
