import assert from "node:assert/strict";
import { test } from "node:test";
import { GOALS, addRegularity, regularityBetween, weeklySummaries, compareWeeks, completeDays, findLevers, onTarget, targetGrid, watchPeriod, clock, noonMinutes } from "../assets/js/health-insights.js";
const date = (i) => new Date(Date.UTC(2026, 8, 1) + i * 864e5).toISOString().slice(0, 10);
const goal = (k) => GOALS.find((g) => g.key === k);
const series = (n, f) => Array.from({ length: n }, (_, i) => ({ date: date(i), ...f(i) }));

test("range checks include their edges and open-ended goals", () => {
  assert.equal(onTarget(goal("asleep"), 7), true);
  assert.equal(onTarget(goal("asleep"), 6.99), false);
  assert.equal(onTarget(goal("asleep"), 9.1), false);
  assert.equal(onTarget(goal("steps"), 50000), true);
  assert.equal(onTarget(goal("awake"), 0.5), true);
});
test("today is excluded because it is incomplete", () => {
  const d = series(3, () => ({ steps: 100 }));
  assert.equal(completeDays(d, date(2)).length, 2);
  assert.equal(completeDays(d, date(9)).length, 3);
});
test("weeks compare the last 7 days with the 7 before", () => {
  const d = series(14, (i) => ({ steps: i < 7 ? 3000 : 8000 }));
  const row = compareWeeks(d).find((r) => r.goal.key === "steps");
  assert.equal(row.last.average, 8000); assert.equal(row.previous.average, 3000);
  assert.equal(row.last.hits, 7); assert.equal(row.previous.hits, 0);
});
test("trend reads toward the target, including lower-is-better", () => {
  const up = compareWeeks(series(14, (i) => ({ steps: i < 7 ? 3000 : 5000 }))).find((r) => r.goal.key === "steps");
  assert.equal(up.trend, "better");
  const awake = compareWeeks(series(14, (i) => ({ awake: i < 7 ? 0.6 : 2 }))).find((r) => r.goal.key === "awake");
  assert.equal(awake.trend, "worse");
  const both = compareWeeks(series(14, (i) => ({ steps: i < 7 ? 9000 : 12000 }))).find((r) => r.goal.key === "steps");
  assert.equal(both.trend, "on-target");
  const flat = compareWeeks(series(14, () => ({ steps: 5000 }))).find((r) => r.goal.key === "steps");
  assert.equal(flat.trend, "same");
  const fresh = compareWeeks(series(5, () => ({ steps: 5000 }))).find((r) => r.goal.key === "steps");
  assert.equal(fresh.trend, "new");
});
test("levers find a real difference and report the right direction", () => {
  const d = series(40, (i) => ({ bedtime: i % 2 ? 23 * 60 : 120, asleep: (i % 2 ? 8 : 6) + (i % 5) * 0.05 }));
  const l = findLevers(d).find((x) => x.outcome.key === "asleep");
  assert.ok(l); assert.match(l.habit, /Asleep before/); assert.equal(l.helps, true);
  assert.ok(l.withHabit > l.without); assert.equal(l.countWith + l.countWithout, 40);
});
test("lower-is-better outcomes count as helping when they fall", () => {
  const d = series(40, (i) => ({ bedtime: i % 2 ? 23 * 60 : 120, sleep_hr: (i % 2 ? 55 : 65) + (i % 3) }));
  const l = findLevers(d).find((x) => x.outcome.key === "sleep_hr");
  assert.equal(l.helps, true); assert.ok(l.withHabit < l.without);
});
test("previous-day habits look at the day before", () => {
  const d = series(40, (i) => ({ steps: i % 2 ? 9000 : 2000, deep: (i % 2 ? 0.5 : 1.5) + (i % 4) * 0.02 }));
  const l = findLevers(d).find((x) => x.outcome.key === "deep");
  assert.match(l.habit, /7,000\+ steps the day before/);
  assert.ok(l.withHabit > l.without, "deep after active days is the even-index value");
});
test("sleep habits are not compared with sleep results", () => {
  const d = series(40, (i) => ({ asleep: i % 2 ? 8 : 5, rem: i % 2 ? 2 : 1 }));
  assert.equal(findLevers(d).filter((x) => x.habit.startsWith("7+ hours") && x.outcome.key === "rem").length, 0);
});
test("levers stay hidden with small groups or weak differences", () => {
  assert.equal(findLevers(series(15, (i) => ({ bedtime: i % 2 ? 23 * 60 : 120, asleep: i % 2 ? 8 : 6 }))).length, 0);
  assert.equal(findLevers(series(40, (i) => ({ bedtime: i % 2 ? 23 * 60 : 120, asleep: 7 + (i % 7) * 0.5 + (i % 2) * 0.01 }))).length, 0);
  assert.equal(findLevers(series(40, () => ({ asleep: 7, bedtime: 120 }))).length, 0);
});
test("at most 6 levers, strongest first", () => {
  const d = series(60, (i) => { const g = i % 2; return { bedtime: g ? 23 * 60 : 120, asleep: g ? 8 + (i % 3) * 0.1 : 6, deep: g ? 1.2 + (i % 3) * 0.01 : 0.7, rem: g ? 2 : 1 + (i % 3) * 0.1, awake: g ? 0.2 : 1 + (i % 3) * 0.1, sleep_hr: g ? 55 + i % 3 : 65, sleep_hrv: g ? 80 : 50 + i % 3, steps: g ? 9000 : 2000, exercise_min: g ? 30 : 0 }; });
  const l = findLevers(d);
  assert.ok(l.length <= 6);
  for (let i = 1; i < l.length; i += 1) assert.ok(l[i - 1].effect >= l[i].effect);
});
test("watch period drops iPhone-only months", () => {
  const d = series(10, (i) => ({ steps: 100, asleep: i >= 7 ? 7 : undefined }));
  assert.equal(watchPeriod(d).length, 3);
});
test("grid separates hit, miss and missing, and hides empty goals", () => {
  const rows = targetGrid(series(3, (i) => ({ steps: [8000, 100, undefined][i] })));
  assert.equal(rows.length, 1); assert.deepEqual(rows[0].cells.map((c) => c.hit), [true, false, null]);
  assert.equal(rows[0].hits, 1); assert.equal(rows[0].count, 2);
});
test("clock helpers round-trip across midnight", () => {
  assert.equal(clock(noonMinutes(60)), "01:00"); assert.equal(clock(noonMinutes(23 * 60)), "23:00");
  assert.ok(noonMinutes(60) > noonMinutes(23 * 60));
});
test("weeks are Monday based and only full weeks count", () => {
  const start = Date.UTC(2026, 8, 7);
  const d = Array.from({ length: 10 }, (_, i) => ({ date: new Date(start + i * 864e5).toISOString().slice(0, 10), strength_count: i === 0 ? 1 : 0, workout_count: 1 }));
  const w = weeklySummaries(d);
  assert.equal(w.length, 1); assert.equal(w[0].date, "2026-09-07");
  assert.equal(w[0].strength, 1); assert.equal(w[0].workouts, 7);
});
test("regularity is 100 for identical days and falls as times move apart", () => {
  const night = { bed: 660, wake: 1140 };
  assert.equal(regularityBetween(night, night), 100);
  assert.ok(Math.abs(regularityBetween(night, { bed: 720, wake: 1200 }) - (100 - 200 * (120 / 1440))) < 1e-9);
  const never = regularityBetween({ bed: 0, wake: 480 }, { bed: 480, wake: 960 });
  assert.ok(never < 0 + 200 * (480 / 1440) && never > -100);
  assert.equal(regularityBetween({ bed: 700, wake: 600 }, night), null);
});
test("rolling regularity needs enough nights and handles midnight", () => {
  const d = series(12, () => ({ bedtime: 23 * 60, wake_time: 7 * 60 }));
  addRegularity(d);
  assert.equal(d[3].regularity, undefined);
  assert.equal(d[4].regularity, 100);
  const gap = series(3, (i) => (i === 1 ? {} : { bedtime: 60, wake_time: 480 }));
  addRegularity(gap);
  assert.equal(gap[2].regularity, undefined);
});
