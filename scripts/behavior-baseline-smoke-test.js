#!/usr/bin/env node
"use strict";

const assert = require("assert");
const BodyBatteryModel = require("../src/bodyBatteryModel.js");

function mkEpochs() {
  const epochMinutes = 60;
  const startMs = Date.UTC(2025, 0, 1, 0, 0, 0);
  const hours = 12 * 24; // cover baseline(10d) + apply window + extra

  const epochs = [];
  for (let h = 0; h < hours; h++) {
    const ts = startMs + h * 3600000;
    const hourOfDay = h % 24;
    const dayIndex = Math.floor(h / 24);

    const e = { timestampMs: ts, hrBpm: 72, steps: 0, activeEnergyKcal: 0 };

    // Night sleep: each night starts at 23:00.
    // - Nights starting day 0..9: 23:00 -> 06:00 (7h)
    // - Night starting day 10: 23:00 -> 04:00 (5h)
    const sleepStartH = 23;
    const sleepEndForNightStartDay = (d) => (d === 10 ? 4 : 6);

    let inSleep = false;
    if (hourOfDay >= sleepStartH) {
      inSleep = true;
    } else if (hourOfDay < 12) {
      const prevDayIndex = dayIndex - 1;
      const endH = sleepEndForNightStartDay(prevDayIndex);
      inSleep = hourOfDay < endH;
    }

    if (inSleep) {
      e.sleepStage = "core";
      e.hrBpm = 55;
    }

    // Daily workout: 17:00 for days 0..9 moderate, day 10 very intense.
    if (hourOfDay === 17) {
      e.workout = true;
      e.hrBpm = dayIndex === 10 ? 175 : 145;
      e.steps = dayIndex === 10 ? 9000 : 4500; // 150 vs 75 steps/min (60min epoch)
      e.activeEnergyKcal = dayIndex === 10 ? 900 : 450;
      e.powerW = dayIndex === 10 ? 330 : 190;
    }

    epochs.push(e);
  }
  return { epochMinutes, startMs, epochs };
}

const { epochMinutes, startMs, epochs } = mkEpochs();

const res = BodyBatteryModel.computeSeries({
  epochMinutes,
  initialBB: 70,
  baselines: {
    rhrBpm: 60,
    hrvSdnnMs: 55,
    spo2Pct: 97,
    respRateBrpm: 14,
    wristTempC: 36.55,
    ftpW: 220,
    hrMaxBpm: 190,
  },
  behaviorBaseline: { enabled: true, days: 10 },
  epochs,
});

assert(res.behaviorBaseline && res.behaviorBaseline.ready, "Expected behavior baseline ready with 10+ days data.");

// 10 days after start => baseline applied from day 11 00:00. Pick 01:00 inside the crossing sleep bout.
const tsSleepAfterApply = startMs + (10 * 24 + 1) * 3600000;
const rowSleep = res.series.find((r) => r.tsMs === tsSleepAfterApply);
assert(rowSleep, "Expected to find sleep row after baseline apply timestamp.");
assert(rowSleep.context.kind === "SLEEP", "Expected sleep context at baseline-applied time.");
assert(rowSleep.behavior && rowSleep.behavior.applied === true, "Expected behavior scaling applied on/after applyFrom.");
assert(rowSleep.behavior.scales && rowSleep.behavior.scales.sleep, "Expected sleep scale details.");
assert(rowSleep.behavior.scales.sleep.healthScale < 1, "Expected generic sleep healthScale < 1 for 7h sleep.");
assert(
  rowSleep.behavior.scales.sleep.scale > rowSleep.behavior.scales.sleep.healthScale,
  "Expected baseline to lift sleep scale vs generic healthScale when within personal baseline.",
);

// Workout on day 10 (Jan 11) 17:00 should be scaled up vs baseline.
const tsWorkoutAfterApply = startMs + (10 * 24 + 17) * 3600000;
const rowWorkout = res.series.find((r) => r.tsMs === tsWorkoutAfterApply);
assert(rowWorkout, "Expected to find workout row after baseline apply timestamp.");
assert(rowWorkout.context.kind === "WORKOUT", "Expected workout context.");
assert(rowWorkout.behavior && rowWorkout.behavior.applied === true, "Expected behavior scaling applied on workout.");
assert(rowWorkout.behavior.scales && rowWorkout.behavior.scales.workout, "Expected workout scale details.");
assert(rowWorkout.behavior.scales.workout.scale > 1, "Expected workout load drain scale > 1 for unusually intense workout.");

console.log("behavior-baseline-smoke-test: OK");
