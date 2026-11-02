const WEEK = 7;
const MIN_GROUP = 10;
const MIN_EFFECT = 0.5;
const MAX_LEVERS = 6;
const SAME_DAYS = 0.8;
const DAY_MS = 86400000;

const hours = (v) => `${v.toFixed(1)} h`;
const bpm = (v) => `${Math.round(v)} bpm`;

export const GOALS = [
  { key: 'asleep', label: 'Time asleep', low: 7, high: 9, format: hours, target: '7-9 h' },
  { key: 'deep', label: 'Deep sleep', low: 1, high: 2, format: hours, target: '1-2 h' },
  { key: 'rem', label: 'REM sleep', low: 1.5, high: 2, format: hours, target: '1.5-2 h' },
  { key: 'awake', label: 'Awake at night', low: 0, high: 0.5, format: hours, target: 'Under 30 min' },
  { key: 'sleep_hr', label: 'Sleep heart rate', low: 40, high: 60, format: bpm, target: 'Under 60 bpm' },
  { key: 'sleep_hrv', label: 'Sleep HRV', low: 50, high: 100, format: (v) => `${Math.round(v)} ms`, target: '50-100 ms' },
  { key: 'resting_hr', label: 'Resting heart rate', low: 60, high: 100, format: bpm, target: '60-100 bpm' },
  { key: 'breath', label: 'Breathing rate', low: 12, high: 20, format: (v) => `${v.toFixed(1)} /min`, target: '12-20 /min' },
  { key: 'spo2', label: 'Blood oxygen', low: 95, high: 100, format: (v) => `${v.toFixed(1)}%`, target: '95-100%' },
  { key: 'steps', label: 'Steps', low: 7000, high: Infinity, format: (v) => Math.round(v).toLocaleString(), target: '7,000+' },
  { key: 'exercise_min', label: 'Exercise', low: 21, high: Infinity, format: (v) => `${Math.round(v)} min`, target: '21+ min' },
];

const finite = Number.isFinite;
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const variance = (values) => {
  const m = mean(values);
  return values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
};

export const onTarget = (goal, value) => value >= goal.low && value <= goal.high;
const distance = (goal, value) => (value < goal.low ? goal.low - value : value > goal.high ? value - goal.high : 0);

// Today is still in progress, so its totals would read as a bad day.
export function completeDays(days, today) {
  return days.length && days[days.length - 1].date === today ? days.slice(0, -1) : days;
}

function summarize(goal, days) {
  const values = days.map((day) => day[goal.key]).filter(finite);
  return {
    count: values.length,
    hits: values.filter((v) => onTarget(goal, v)).length,
    average: values.length ? mean(values) : null,
  };
}

function trend(goal, last, previous) {
  if (last.average === null || previous.average === null) return 'new';
  const before = distance(goal, previous.average);
  const now = distance(goal, last.average);
  if (before === 0 && now === 0) return 'on-target';
  const tolerance = (Number.isFinite(goal.high) ? goal.high - goal.low : goal.low) * 0.05;
  if (Math.abs(now - before) <= tolerance) return 'same';
  return now < before ? 'better' : 'worse';
}

export function compareWeeks(days) {
  const lastDays = days.slice(-WEEK);
  const previousDays = days.slice(-2 * WEEK, -WEEK);
  return GOALS.map((goal) => {
    const last = summarize(goal, lastDays);
    const previous = summarize(goal, previousDays);
    return { goal, last, previous, trend: trend(goal, last, previous) };
  }).filter((row) => row.last.count > 0);
}

export const noonMinutes = (clockMinutes) => (clockMinutes + 720) % 1440;

export function clock(noon) {
  const minutes = Math.round(noon + 720) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const SLEEP_OUTCOMES = [
  { key: 'asleep', label: 'Time asleep', better: 1, format: hours },
  { key: 'deep', label: 'Deep sleep', better: 1, format: hours },
  { key: 'rem', label: 'REM sleep', better: 1, format: hours },
  { key: 'awake', label: 'Awake at night', better: -1, format: hours },
  { key: 'sleep_hr', label: 'Sleep heart rate', better: -1, format: bpm },
  { key: 'sleep_hrv', label: 'Sleep HRV', better: 1, format: (v) => `${Math.round(v)} ms` },
];

const DAY_OUTCOMES = [
  { key: 'resting_hr', label: 'Resting heart rate', better: -1, format: bpm },
  { key: 'hr_awake', label: 'Awake heart rate', better: -1, format: bpm },
  { key: 'steps', label: 'Steps', better: 1, format: (v) => Math.round(v).toLocaleString() },
  { key: 'exercise_min', label: 'Exercise', better: 1, format: (v) => `${Math.round(v)} min` },
];

function habits(days) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const previous = (day) => byDate.get(new Date(Date.parse(`${day.date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10));
  const bedtimes = days.filter((d) => finite(d.bedtime)).map((d) => noonMinutes(d.bedtime));
  const list = [
    {
      label: '7,000+ steps the day before',
      other: 'fewer',
      outcomes: SLEEP_OUTCOMES,
      test: (day) => { const v = previous(day)?.steps; return finite(v) ? v >= 7000 : null; },
    },
    {
      label: '21+ min of exercise the day before',
      other: 'less',
      outcomes: SLEEP_OUTCOMES,
      test: (day) => { const v = previous(day)?.exercise_min; return finite(v) ? v >= 21 : null; },
    },
    {
      label: '7+ hours of sleep the night before',
      other: 'less',
      outcomes: DAY_OUTCOMES,
      test: (day) => (finite(day.asleep) ? day.asleep >= 7 : null),
    },
  ];
  if (bedtimes.length) {
    const cutoff = Math.round(median(bedtimes) / 30) * 30;
    list.unshift({
      label: `Asleep before ${clock(cutoff)}`,
      other: 'later',
      outcomes: SLEEP_OUTCOMES,
      test: (day) => (finite(day.bedtime) ? noonMinutes(day.bedtime) < cutoff : null),
    });
  }
  return list;
}

// Holds back small or weak differences, because many comparisons will produce some by chance.
export function findLevers(days) {
  const found = [];
  habits(days).forEach((habit) => {
    habit.outcomes.forEach((outcome) => {
      const yes = [];
      const no = [];
      const split = new Map();
      days.forEach((day) => {
        const did = habit.test(day);
        const value = day[outcome.key];
        if (did === null || !finite(value)) return;
        (did ? yes : no).push(value);
        split.set(day.date, did);
      });
      if (yes.length < MIN_GROUP || no.length < MIN_GROUP) return;
      const pooled = Math.sqrt((variance(yes) + variance(no)) / 2);
      if (pooled === 0) return;
      const difference = mean(yes) - mean(no);
      const effect = difference / pooled;
      if (Math.abs(effect) < MIN_EFFECT) return;
      found.push({
        split,
        habit: habit.label,
        other: habit.other,
        outcome,
        withHabit: mean(yes),
        without: mean(no),
        countWith: yes.length,
        countWithout: no.length,
        effect: Math.abs(effect),
        helps: Math.sign(difference) === outcome.better,
      });
    });
  });
  const kept = [];
  found.sort((a, b) => b.effect - a.effect).forEach((lever) => {
    if (kept.some((other) => other.outcome.key === lever.outcome.key && agreement(other.split, lever.split) >= SAME_DAYS)) return;
    kept.push(lever);
  });
  return kept.slice(0, MAX_LEVERS).map(({ split, ...lever }) => lever);
}

// Two habits that fall on mostly the same days, e.g. steps and exercise on gym days, would repeat one finding.
function agreement(a, b) {
  let shared = 0;
  let same = 0;
  a.forEach((did, date) => {
    if (!b.has(date)) return;
    shared += 1;
    if (b.get(date) === did) same += 1;
  });
  return shared ? same / shared : 0;
}

export function watchPeriod(days) {
  const first = days.findIndex((day) => finite(day.asleep) || finite(day.resting_hr));
  return first > 0 ? days.slice(first) : days;
}

export function targetGrid(days) {
  return GOALS.map((goal) => {
    const cells = days.map((day) => {
      const value = day[goal.key];
      return { date: day.date, value: finite(value) ? value : null, hit: finite(value) ? onTarget(goal, value) : null };
    });
    const measured = cells.filter((cell) => cell.value !== null);
    return { goal, cells, hits: measured.filter((cell) => cell.hit).length, count: measured.length };
  }).filter((row) => row.count > 0);
}

const REGULARITY_WINDOW = 7;
const REGULARITY_MIN_PAIRS = 4;
const MINUTES_IN_DAY = 1440;

const mondayOf = (date) => {
  const time = Date.parse(`${date}T00:00:00Z`);
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - weekday * DAY_MS).toISOString().slice(0, 10);
};

// Only full weeks are kept, so a partial week never reads as falling short of a weekly goal.
export function weeklySummaries(days) {
  const weeks = new Map();
  days.forEach((day) => {
    const key = mondayOf(day.date);
    if (!weeks.has(key)) {
      weeks.set(key, { date: key, days: 0, strength: 0, workouts: 0 });
    }
    const week = weeks.get(key);
    week.days += 1;
    if (finite(day.strength_count)) week.strength += day.strength_count;
    if (finite(day.workout_count)) week.workouts += day.workout_count;
  });
  return [...weeks.values()]
    .filter((week) => week.days === WEEK)
    .map((week) => ({
      date: week.date,
      strength: week.strength,
      workouts: week.workouts,
    }));
}

// The share of minutes spent in the same state, asleep or awake, 24 hours apart, scaled so 100 means identical.
export function regularityBetween(a, b) {
  const sleepA = a.wake - a.bed;
  const sleepB = b.wake - b.bed;
  if (sleepA <= 0 || sleepB <= 0) return null;
  const overlap = Math.max(0, Math.min(a.wake, b.wake) - Math.max(a.bed, b.bed));
  const different = sleepA + sleepB - 2 * overlap;
  return -100 + 200 * ((MINUTES_IN_DAY - different) / MINUTES_IN_DAY);
}

export function addRegularity(days) {
  const window = (day) => (finite(day.bedtime) && finite(day.wake_time)
    ? { bed: noonMinutes(day.bedtime), wake: noonMinutes(day.wake_time) }
    : null);
  const pairs = days.map((day, index) => {
    if (index === 0) return null;
    const today = window(day);
    const yesterday = window(days[index - 1]);
    return today && yesterday ? regularityBetween(yesterday, today) : null;
  });
  days.forEach((day, index) => {
    const recent = pairs.slice(Math.max(0, index - REGULARITY_WINDOW + 1), index + 1).filter(finite);
    if (recent.length >= REGULARITY_MIN_PAIRS) day.regularity = mean(recent);
  });
}

const BASELINE_NIGHTS = 28;
const BASELINE_MIN = 14;
const UNUSUAL = 2;
// Converts the median absolute deviation into the scale of a standard deviation.
const MAD_SCALE = 1.4826;

// Concern is the direction linked with strain or illness. Floor keeps a very steady metric from flagging tiny changes.
export const VITALS = [
  { key: 'sleep_hrv', label: 'Sleep HRV', concern: -1, floor: 3, format: (v) => `${Math.round(v)} ms` },
  { key: 'sleep_hr', label: 'Sleep heart rate', concern: 1, floor: 1, format: bpm },
  { key: 'breath', label: 'Breathing rate', concern: 1, floor: 0.3, format: (v) => `${v.toFixed(1)} /min` },
  { key: 'wrist_temp', label: 'Wrist temperature', concern: 1, floor: 0.1, format: (v) => `${v.toFixed(2)} C` },
  { key: 'spo2', label: 'Blood oxygen', concern: -1, floor: 0.5, format: (v) => `${v.toFixed(1)}%` },
];

// Uses the median and median absolute deviation, so one odd night does not widen the usual range.
export function vitalsCheck(days) {
  const nights = days.filter((day) => finite(day.asleep));
  const last = nights[nights.length - 1];
  if (!last) return null;
  const history = nights.slice(-BASELINE_NIGHTS - 1, -1);
  const rows = VITALS.map((vital) => {
    const value = last[vital.key];
    const past = history.map((day) => day[vital.key]).filter(finite);
    if (!finite(value) || past.length < BASELINE_MIN) return null;
    const middle = median(past);
    const spread = Math.max(vital.floor, MAD_SCALE * median(past.map((v) => Math.abs(v - middle))));
    const score = (value - middle) / spread;
    const direction = Math.abs(score) < UNUSUAL ? 0 : Math.sign(score);
    return {
      vital,
      value,
      low: middle - UNUSUAL * spread,
      high: middle + UNUSUAL * spread,
      direction,
      concern: direction === vital.concern,
      nights: past.length,
    };
  }).filter(Boolean);
  if (rows.length === 0) return null;
  return { date: last.date, rows, concerns: rows.filter((row) => row.concern).length };
}

const MIN_NIGHTS = 20;
const MIN_LINK = 0.3;

const ranks = (values) => {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const result = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    for (let k = i; k <= j; k += 1) result[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return result;
};

function correlation(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

// The median of all pairwise slopes (Theil-Sen) and a rank correlation, so one unusual night, like an all-nighter, cannot tilt the result.
export function fit(points) {
  const slopes = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = points[j][0] - points[i][0];
      if (dx !== 0) slopes.push((points[j][1] - points[i][1]) / dx);
    }
  }
  if (slopes.length === 0) return null;
  const slope = median(slopes);
  const r = correlation(ranks(points.map((p) => p[0])), ranks(points.map((p) => p[1])));
  return { slope, intercept: median(points.map(([x, y]) => y - slope * x)), r, count: points.length };
}

// Slopes are per hour of bedtime, so they read as "each hour later goes with ...".
export function bedtimeEffect(days) {
  const nights = days.filter((day) => finite(day.bedtime) && finite(day.wake_time) && finite(day.asleep));
  if (nights.length < MIN_NIGHTS) return null;
  const bed = (day) => noonMinutes(day.bedtime) / 60;
  const link = (value) => {
    const points = nights.filter((day) => finite(value(day))).map((day) => [bed(day), value(day)]);
    const line = points.length >= MIN_NIGHTS ? fit(points) : null;
    return line && Math.abs(line.r) >= MIN_LINK ? line : null;
  };
  return {
    nights: nights.map((day) => ({
      date: day.date, bed: noonMinutes(day.bedtime), wake: noonMinutes(day.wake_time), asleep: day.asleep,
    })),
    asleep: link((day) => day.asleep),
    wake: link((day) => noonMinutes(day.wake_time) / 60),
    deep: link((day) => day.deep),
    rem: link((day) => day.rem),
  };
}

const FREE_DAYS = new Set([0, 6]);
const MIN_FREE = 4;
const MIN_WORK = 8;

// A night belongs to the day it ends, so Friday and Saturday nights are the rows dated Saturday and Sunday.
export function weekendShift(days) {
  const groups = { work: [], free: [] };
  days.forEach((day) => {
    if (!finite(day.bedtime) || !finite(day.wake_time) || !finite(day.asleep)) return;
    const bed = noonMinutes(day.bedtime);
    const wake = noonMinutes(day.wake_time);
    if (wake <= bed) return;
    const weekday = new Date(Date.parse(`${day.date}T00:00:00Z`)).getUTCDay();
    groups[FREE_DAYS.has(weekday) ? 'free' : 'work'].push({ middle: (bed + wake) / 2, asleep: day.asleep });
  });
  if (groups.free.length < MIN_FREE || groups.work.length < MIN_WORK) return null;
  const summary = (list) => ({
    middle: mean(list.map((n) => n.middle)),
    asleep: mean(list.map((n) => n.asleep)),
    count: list.length,
  });
  const work = summary(groups.work);
  const free = summary(groups.free);
  return { work, free, shift: free.middle - work.middle };
}
