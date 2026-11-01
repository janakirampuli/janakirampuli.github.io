const WEEK = 7;
const MIN_GROUP = 10;
const MIN_EFFECT = 0.5;
const MAX_LEVERS = 6;
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
  return sorted[Math.floor(sorted.length / 2)];
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
      days.forEach((day) => {
        const did = habit.test(day);
        const value = day[outcome.key];
        if (did === null || !finite(value)) return;
        (did ? yes : no).push(value);
      });
      if (yes.length < MIN_GROUP || no.length < MIN_GROUP) return;
      const pooled = Math.sqrt((variance(yes) + variance(no)) / 2);
      if (pooled === 0) return;
      const difference = mean(yes) - mean(no);
      const effect = difference / pooled;
      if (Math.abs(effect) < MIN_EFFECT) return;
      found.push({
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
  return found.sort((a, b) => b.effect - a.effect).slice(0, MAX_LEVERS);
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

const ZONE_BOUNDS = [0.5, 0.6, 0.7, 0.8, 0.9];
const PEAK_PERCENTILE = 0.995;
const REGULARITY_WINDOW = 7;
const REGULARITY_MIN_PAIRS = 4;
const MINUTES_IN_DAY = 1440;

// Uses a high percentile, because a single bad reading can be far above the true peak.
export function peakHeartRate(days) {
  const counts = new Map();
  days.forEach((day) => {
    Object.entries(day.h_workout ?? {}).forEach(([bucket, count]) => {
      counts.set(Number(bucket), (counts.get(Number(bucket)) ?? 0) + count);
    });
  });
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let running = 0;
  for (const bucket of [...counts.keys()].sort((a, b) => a - b)) {
    running += counts.get(bucket);
    if (running >= total * PEAK_PERCENTILE) return bucket;
  }
  return null;
}

function zoneIndex(heartRate, peak) {
  const share = heartRate / peak;
  for (let index = ZONE_BOUNDS.length - 1; index >= 0; index -= 1) {
    if (share >= ZONE_BOUNDS[index]) return index;
  }
  return -1;
}

const mondayOf = (date) => {
  const time = Date.parse(`${date}T00:00:00Z`);
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - weekday * DAY_MS).toISOString().slice(0, 10);
};

// Only full weeks are kept, so a partial week never reads as falling short of a weekly goal.
export function weeklySummaries(days) {
  const peak = peakHeartRate(days);
  const weeks = new Map();
  days.forEach((day) => {
    const key = mondayOf(day.date);
    if (!weeks.has(key)) {
      weeks.set(key, { date: key, days: 0, strength: 0, workouts: 0, zones: [0, 0, 0, 0, 0] });
    }
    const week = weeks.get(key);
    week.days += 1;
    if (finite(day.strength_count)) week.strength += day.strength_count;
    if (finite(day.workout_count)) week.workouts += day.workout_count;
    if (peak) {
      Object.entries(day.h_zone ?? {}).forEach(([bucket, minutes]) => {
        const zone = zoneIndex(Number(bucket) + 2.5, peak);
        if (zone >= 0) week.zones[zone] += minutes;
      });
    }
  });
  return [...weeks.values()]
    .filter((week) => week.days === WEEK)
    .map((week) => ({
      date: week.date,
      strength: week.strength,
      workouts: week.workouts,
      z1: week.zones[0],
      z2: week.zones[1],
      z3: week.zones[2],
      z4: week.zones[3],
      z5: week.zones[4],
    }));
}

export function activityTotals(days) {
  const totals = new Map();
  days.forEach((day) => {
    Object.entries(day.h_activity ?? {}).forEach(([name, minutes]) => {
      totals.set(name, (totals.get(name) ?? 0) + minutes);
    });
  });
  return [...totals.entries()]
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
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
