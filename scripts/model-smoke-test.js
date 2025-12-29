#!/usr/bin/env node
"use strict";

const assert = require("assert");
const BodyBatteryModel = require("../src/bodyBatteryModel.js");

function mkWorkoutCfg() {
  const epochMinutes = 5;
  const startMs = Date.UTC(2025, 0, 1, 0, 0, 0);
  const msPerEpoch = epochMinutes * 60000;

  const mk = (i, patch) => ({ timestampMs: startMs + i * msPerEpoch, ...patch });

  return {
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
    epochs: [
      mk(0, {
        workout: true,
        hrBpm: 150,
        steps: 150, // 30 steps/min @ 5min
        activeEnergyKcal: 45,
        powerW: 210,
      }),
      mk(1, {
        hrBpm: 70,
        steps: 0,
        activeEnergyKcal: 0,
      }),
    ],
  };
}

const workout = BodyBatteryModel.computeSeries(mkWorkoutCfg()).series;
assert(workout.length === 2);
assert.strictEqual(workout[0].context.kind, "WORKOUT");
assert(workout[0].drainPoints > 0);
assert(workout[0].drainComponents.loadPerHour > 0);
assert.notStrictEqual(workout[1].context.kind, "WORKOUT");
assert(workout[1].drainComponents.loadPerHour <= workout[0].drainComponents.loadPerHour);

// Large timestamp gaps should not be treated as a single long epoch duration.
// Otherwise one workout epoch can drain BB to 0 in one step.
(() => {
  const epochMinutes = 5;
  const startMs = Date.UTC(2025, 0, 1, 0, 0, 0);
  const mk = (tMs, patch) => ({ timestampMs: tMs, ...patch });

  const cfg = {
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
    epochs: [
      mk(startMs, { workout: true, hrBpm: 150, steps: 150, activeEnergyKcal: 45, powerW: 210 }),
      mk(startMs + 5 * 3600 * 1000, { workout: true, hrBpm: 150, steps: 150, activeEnergyKcal: 45, powerW: 210 }),
    ],
  };

  const series = BodyBatteryModel.computeSeries(cfg).series;
  assert.strictEqual(series.length, 2);
  assert.strictEqual(series[1].dtMinutes, epochMinutes);
  assert(series[1].bbNext > 0, `Expected BB not to clamp to 0 due to a timestamp gap. got bbNext=${series[1].bbNext}`);
})();

(() => {
  const epochMinutes = 5;
  const startMs = Date.UTC(2025, 0, 1, 3, 0, 0);
  const msPerEpoch = epochMinutes * 60000;
  const mk = (i, patch) => ({ timestampMs: startMs + i * msPerEpoch, ...patch });

  const baseCfg = {
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
    epochs: [
      mk(0, {
        workout: true,
        hrBpm: 138,
        steps: 525,
        activeEnergyKcal: 70,
        powerW: 250,
      }),
    ],
  };

  const lowW = BodyBatteryModel.computeSeries({ ...baseCfg, params: { workoutHrWeight: 1.0 } }).series[0];
  const highW = BodyBatteryModel.computeSeries({ ...baseCfg, params: { workoutHrWeight: 1.5 } }).series[0];

  assert(highW.drainComponents.loadPerHour > lowW.drainComponents.loadPerHour * 1.15);
})();

// SleepCharge should include multiple sleep segments within the same main sleep session.
(() => {
  const epochMinutes = 5;
  const startMs = Date.UTC(2025, 0, 2, 0, 0, 0);
  const msPerEpoch = epochMinutes * 60000;
  const mk = (i, patch) => ({ timestampMs: startMs + i * msPerEpoch, ...patch });

  const cfg = {
    epochMinutes,
    initialBB: 50,
    baselines: {
      rhrBpm: 60,
      hrvSdnnMs: 55,
      spo2Pct: 97,
      respRateBrpm: 14,
      wristTempC: 36.55,
    },
    epochs: [
      mk(0, { sleepStage: "core", hrBpm: 55, steps: 0, activeEnergyKcal: 0 }),
      mk(1, { sleepStage: "core", hrBpm: 55, steps: 0, activeEnergyKcal: 0 }),
      mk(2, { sleepStage: "awake", hrBpm: 58, steps: 0, activeEnergyKcal: 0 }),
      mk(3, { sleepStage: "core", hrBpm: 55, steps: 0, activeEnergyKcal: 0 }),
      mk(4, { sleepStage: "core", hrBpm: 55, steps: 0, activeEnergyKcal: 0 }),
    ],
  };

  const result = BodyBatteryModel.computeSeries(cfg);
  const series = result.series;
  const summary = result.summary;

  let expectedSleepCharge = 0;
  let lastSleepIdx = null;
  for (let i = 0; i < series.length; i++) {
    const r = series[i];
    if (r.context?.kind !== "SLEEP") continue;
    lastSleepIdx = i;
    expectedSleepCharge += r.bbNext - r.bb;
  }

  assert(lastSleepIdx !== null, "Expected at least one sleep epoch in test config.");

  assert.strictEqual(summary.sleepCharge, Number(expectedSleepCharge.toFixed(2)), "Expected sleepCharge to include all sleep segments.");
  assert.strictEqual(summary.morningBB, Number(series[lastSleepIdx].bbNext.toFixed(2)), "Expected morningBB to be end of the last sleep segment.");
})();

// Missing vitals should reduce sleep charging (quality gating).
(() => {
  const epochMinutes = 5;
  const startMs = Date.UTC(2025, 0, 2, 1, 0, 0);
  const msPerEpoch = epochMinutes * 60000;
  const mk = (i, patch) => ({ timestampMs: startMs + i * msPerEpoch, ...patch });

  const mkCfg = (withHr) => ({
    epochMinutes,
    initialBB: 70,
    baselines: {
      rhrBpm: 60,
      hrvSdnnMs: 55,
      spo2Pct: 97,
      respRateBrpm: 14,
      wristTempC: 36.55,
    },
    epochs: Array.from({ length: 12 }, (_, i) => mk(i, { sleepStage: "core", ...(withHr ? { hrBpm: 55 } : {}) })),
  });

  const miss = BodyBatteryModel.computeSeries(mkCfg(false)).summary.sleepCharge;
  const hasHr = BodyBatteryModel.computeSeries(mkCfg(true)).summary.sleepCharge;

  assert(miss !== null && hasHr !== null);
  assert(miss < hasHr * 0.8, `Expected missing-vitals sleepCharge < 0.8x. got miss=${miss}, hasHr=${hasHr}`);
})();

(() => {
  const epochMinutes = 5;
  const startMs = Date.UTC(2025, 0, 3, 0, 0, 0);
  const msPerEpoch = epochMinutes * 60000;
  const mk = (i, patch) => ({ timestampMs: startMs + i * msPerEpoch, ...patch });

  const mkSleepCfg = ({ sleepStage, hrBpm, hrvSdnnMs, spo2Pct, respRateBrpm }) => ({
    epochMinutes,
    initialBB: 60,
    baselines: {
      rhrBpm: 60,
      hrvSdnnMs: 55,
      spo2Pct: 97,
      respRateBrpm: 14,
      wristTempC: 36.55,
    },
    epochs: Array.from({ length: 96 }, (_, i) =>
      mk(i, {
        sleepStage,
        hrBpm,
        hrvSdnnMs,
        spo2Pct,
        respRateBrpm,
        steps: 0,
        activeEnergyKcal: 0,
      }),
    ),
  });

  const good = BodyBatteryModel.computeSeries(
    mkSleepCfg({ sleepStage: "deep", hrBpm: 52, hrvSdnnMs: 80, spo2Pct: 98, respRateBrpm: 13 }),
  ).summary.morningBB;

  const bad = BodyBatteryModel.computeSeries(
    mkSleepCfg({ sleepStage: "inBed", hrBpm: 68, hrvSdnnMs: 30, spo2Pct: 93, respRateBrpm: 18 }),
  ).summary.morningBB;

  assert(good !== null && bad !== null);
  assert(good - bad >= 20, `Expected sleep quality to materially impact morningBB. good=${good}, bad=${bad}`);
})();

(() => {
  const epochMinutes = 5;
  const startMs = Date.UTC(2025, 0, 4, 0, 0, 0);
  const msPerEpoch = epochMinutes * 60000;
  const mk = (i, patch) => ({ timestampMs: startMs + i * msPerEpoch, ...patch });

  const mkCfg = (hrvSdnnMs) => ({
    epochMinutes,
    initialBB: 60,
    baselines: {
      rhrBpm: 60,
      hrvSdnnMs: 55,
      spo2Pct: 97,
      respRateBrpm: 14,
      wristTempC: 36.55,
    },
    epochs: Array.from({ length: 72 }, (_, i) =>
      mk(i, { sleepStage: "core", hrBpm: 55, hrvSdnnMs, spo2Pct: 97, respRateBrpm: 14, steps: 0, activeEnergyKcal: 0 }),
    ),
  });

  const high = BodyBatteryModel.computeSeries(mkCfg(80)).summary.morningBB;
  const low = BodyBatteryModel.computeSeries(mkCfg(30)).summary.morningBB;

  assert(high !== null && low !== null);
  assert(high - low >= 12, `Expected higher HRV to produce higher morningBB. high=${high}, low=${low}`);
})();

console.log("model-smoke-test: OK");
