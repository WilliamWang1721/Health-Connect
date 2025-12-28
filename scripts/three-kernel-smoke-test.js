#!/usr/bin/env node
"use strict";

const assert = require("assert");
const BodyBatteryModel = require("../src/bodyBatteryModel.js");

function mkCfg() {
  const epochMinutes = 5;
  const startMs = Date.UTC(2025, 0, 1, 0, 0, 0);
  const msPerEpoch = epochMinutes * 60000;
  const mk = (i, patch) => ({ timestampMs: startMs + i * msPerEpoch, ...patch });

  const epochs = [];
  const total = Math.round((24 * 60) / epochMinutes);

  for (let i = 0; i < total; i++) {
    const minutes = i * epochMinutes;
    const asleep = minutes < 8 * 60;
    if (asleep) {
      epochs.push(
        mk(i, {
          sleepStage: "core",
          hrBpm: 54,
          hrvSdnnMs: i % 6 === 0 ? 65 : null,
          respRateBrpm: i % 8 === 0 ? 13.5 : null,
          spo2Pct: i % 10 === 0 ? 97.2 : null,
          wristTempC: i % 12 === 0 ? 36.55 : null,
          steps: 0,
          activeEnergyKcal: 0,
        }),
      );
    } else {
      const workout = minutes >= 18 * 60 && minutes < 19 * 60;
      epochs.push(
        mk(i, {
          workout,
          hrBpm: workout ? 150 : 82,
          steps: workout ? 150 : 40,
          activeEnergyKcal: workout ? 45 : 8,
          powerW: workout ? 210 : null,
        }),
      );
    }
  }

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
    epochs,
  };
}

assert.strictEqual(typeof BodyBatteryModel.computeSeriesThreeKernel, "function");

const cfg = mkCfg();
const core = BodyBatteryModel.computeSeries(cfg);
assert(core && Array.isArray(core.series) && core.series.length > 0);

const hybrid = BodyBatteryModel.computeSeriesThreeKernel({
  ...cfg,
  threeKernel: { enabled: true, weightCore: 0.9, weightTrend: 0.1, forecastHours: 0, minTrainSamples: 50 },
});
assert(hybrid.threeKernel && hybrid.threeKernel.enabled);
assert(hybrid.summaryCore && hybrid.summary);
assert.strictEqual(hybrid.series.length, core.series.length);

const sampleRow = hybrid.series[Math.min(10, hybrid.series.length - 1)];
assert(Number.isFinite(sampleRow.bbCoreNext));
assert(Number.isFinite(sampleRow.bbTrendNext));
assert(Number.isFinite(sampleRow.bbNext));

const onlyCore = BodyBatteryModel.computeSeriesThreeKernel({
  ...cfg,
  threeKernel: { enabled: true, weightCore: 1, weightTrend: 0, forecastHours: 0, minTrainSamples: 50 },
});
for (const r of onlyCore.series) {
  assert(Math.abs(r.bbNext - r.bbCoreNext) < 1e-9);
}

const onlyTrend = BodyBatteryModel.computeSeriesThreeKernel({
  ...cfg,
  threeKernel: { enabled: true, weightCore: 0, weightTrend: 1, forecastHours: 0, minTrainSamples: 50 },
});
for (const r of onlyTrend.series) {
  assert(Math.abs(r.bbNext - r.bbTrendNext) < 1e-9);
}

const forecast = BodyBatteryModel.computeSeriesThreeKernel({
  ...cfg,
  threeKernel: { enabled: true, weightCore: 0.9, weightTrend: 0.1, forecastHours: 1, minTrainSamples: 50 },
});
assert.strictEqual(forecast.series.length, core.series.length + 12);
assert.strictEqual(forecast.series[forecast.series.length - 1].context.kind, "FORECAST");

console.log("three-kernel-smoke-test: OK");

