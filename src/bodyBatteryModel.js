/* eslint-disable no-var */
/* eslint-disable prefer-const */
(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    root.BodyBatteryModel = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = "0.2.0";

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function relu(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, value);
  }

  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function asPercentMaybe(value) {
    const n = toNumberOrNull(value);
    if (n === null) return null;
    if (n <= 1.5) return n * 100;
    return n;
  }

  function median(values) {
    const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
    if (xs.length === 0) return null;
    const mid = Math.floor(xs.length / 2);
    if (xs.length % 2 === 1) return xs[mid];
    return (xs[mid - 1] + xs[mid]) / 2;
  }

  function mad(values, med) {
    if (!Number.isFinite(med)) return null;
    const deviations = values
      .filter((v) => Number.isFinite(v))
      .map((v) => Math.abs(v - med));
    const m = median(deviations);
    if (!Number.isFinite(m)) return null;
    return m;
  }

  function quantile(values, q) {
    const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
    if (xs.length === 0) return null;
    const qq = clamp(Number(q), 0, 1);
    const pos = (xs.length - 1) * qq;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = xs[base + 1];
    if (!Number.isFinite(next)) return xs[base];
    return xs[base] + rest * (next - xs[base]);
  }

  function robustStats(values, opts) {
    const xs = values.filter((v) => Number.isFinite(v));
    const n = xs.length;
    if (n === 0) {
      return { n: 0, median: null, mad: null, sigma: null, p10: null, p90: null, min: null, max: null };
    }

    const med = median(xs);
    const m = mad(xs, med);
    const p10 = quantile(xs, 0.1);
    const p90 = quantile(xs, 0.9);

    let sigma = m !== null ? m * 1.4826 : null;
    if (!Number.isFinite(sigma) || sigma <= 1e-6) {
      if (Number.isFinite(p10) && Number.isFinite(p90) && p90 > p10) sigma = (p90 - p10) / 2.563;
      else sigma = 0;
    }

    const sigmaMin = Number.isFinite(opts?.sigmaMin) ? Number(opts.sigmaMin) : 0;
    const sigmaMax = Number.isFinite(opts?.sigmaMax) ? Number(opts.sigmaMax) : Infinity;
    sigma = clamp(sigma, sigmaMin, sigmaMax);

    const minV = xs.reduce((a, b) => Math.min(a, b), xs[0]);
    const maxV = xs.reduce((a, b) => Math.max(a, b), xs[0]);

    return { n, median: med, mad: m, sigma, p10, p90, min: minV, max: maxV };
  }

  function lerp(a, b, t) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a;
    const tt = clamp(Number(t), 0, 1);
    return a + (b - a) * tt;
  }

  function tanh(x) {
    const v = Number(x);
    if (!Number.isFinite(v)) return 0;
    if (Math.tanh) return Math.tanh(v);
    const e2x = Math.exp(2 * v);
    if (!Number.isFinite(e2x) || e2x === 0) return v > 0 ? 1 : -1;
    return (e2x - 1) / (e2x + 1);
  }

  function makeLcgRng(seed) {
    let s = (Number(seed) || 0) >>> 0;
    return function rand01() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function parseTimestampMs(epoch) {
    const direct =
      epoch.timestampMs ??
      epoch.tsMs ??
      epoch.tMs ??
      epoch.t ??
      epoch.timestamp ??
      epoch.ts ??
      null;
    if (direct === null || direct === undefined) return null;
    if (typeof direct === "number" && Number.isFinite(direct)) return direct;
    const parsed = Date.parse(String(direct));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function defaultBaselines() {
    return {
      rhrBpm: 60,
      rhrScaleBpm: 6,
      hrvSdnnMs: 50,
      hrvScaleMs: 20,
      spo2Pct: 97,
      spo2ScalePct: 1.5,
      respRateBrpm: 14,
      respRateScaleBrpm: 2,
      wristTempC: 36.5,
      wristTempScaleC: 0.3,
      ftpW: 220,
      hrMaxBpm: 190,
    };
  }

  function inferBaselinesFromEpochs(epochs, epochMinutes) {
    const defaults = defaultBaselines();
    const dtMin = Number.isFinite(epochMinutes) && epochMinutes > 0 ? epochMinutes : 5;

    const hrAll = [];
    const hrRestLike = [];
    const hrvAll = [];
    const spo2All = [];
    const rrAll = [];
    const tempAll = [];

    for (const e of epochs || []) {
      const hr = toNumberOrNull(e.hrBpm ?? e.hr);
      const hrv = toNumberOrNull(e.hrvSdnnMs ?? e.hrvMs ?? e.hrv);
      const spo2 = asPercentMaybe(e.spo2Pct ?? e.spo2);
      const rr = toNumberOrNull(e.respRateBrpm ?? e.respiratoryRate ?? e.rr);
      const temp = toNumberOrNull(e.wristTempC ?? e.tempC ?? e.temp);
      const steps = toNumberOrNull(e.steps);
      const sleepStage = (e.sleepStage ?? e.sleep ?? null) ? String(e.sleepStage ?? e.sleep) : null;
      const mindful = Boolean(e.mindful ?? e.mindfulness ?? e.isMindful);
      const workout = Boolean(e.workout ?? e.isWorkout);

      if (hr !== null) hrAll.push(hr);
      if (hrv !== null) hrvAll.push(hrv);
      if (spo2 !== null) spo2All.push(spo2);
      if (rr !== null) rrAll.push(rr);
      if (temp !== null) tempAll.push(temp);

      const stepsPerMin = steps === null ? 0 : steps / dtMin;
      const isSleep = sleepStage !== null && sleepStage !== "awake" && sleepStage !== "inBed";
      const isRestLike = !workout && !mindful && !isSleep && stepsPerMin <= 2 && hr !== null;
      if (isRestLike) hrRestLike.push(hr);
    }

    const rhrMed = median(hrRestLike) ?? median(hrAll) ?? defaults.rhrBpm;
    const rhrMad = mad(hrRestLike.length > 0 ? hrRestLike : hrAll, rhrMed);
    const rhrScale = (rhrMad !== null ? rhrMad * 1.4826 : null) ?? defaults.rhrScaleBpm;

    const hrvMed = median(hrvAll) ?? defaults.hrvSdnnMs;
    const hrvMad = mad(hrvAll, hrvMed);
    const hrvScale = (hrvMad !== null ? hrvMad * 1.4826 : null) ?? defaults.hrvScaleMs;

    const spo2Med = median(spo2All) ?? defaults.spo2Pct;
    const spo2Mad = mad(spo2All, spo2Med);
    const spo2Scale = (spo2Mad !== null ? spo2Mad * 1.4826 : null) ?? defaults.spo2ScalePct;

    const rrMed = median(rrAll) ?? defaults.respRateBrpm;
    const rrMad = mad(rrAll, rrMed);
    const rrScale = (rrMad !== null ? rrMad * 1.4826 : null) ?? defaults.respRateScaleBrpm;

    const tempMed = median(tempAll) ?? defaults.wristTempC;
    const tempMad = mad(tempAll, tempMed);
    const tempScale = (tempMad !== null ? tempMad * 1.4826 : null) ?? defaults.wristTempScaleC;

    return {
      ...defaults,
      rhrBpm: rhrMed,
      rhrScaleBpm: clamp(rhrScale, 2, 15),
      hrvSdnnMs: hrvMed,
      hrvScaleMs: clamp(hrvScale, 8, 60),
      spo2Pct: spo2Med,
      spo2ScalePct: clamp(spo2Scale, 0.8, 4),
      respRateBrpm: rrMed,
      respRateScaleBrpm: clamp(rrScale, 1, 6),
      wristTempC: tempMed,
      wristTempScaleC: clamp(tempScale, 0.15, 1),
    };
  }

  function defaultParams() {
    return {
      epochMinutes: 5,
      initialBB: 70,
      saturationExponent: 0.5,
      maxDeltaPerHour: 25,
      minChargeScale: 0.25,
      minDrainScale: 0.25,
      confidenceFloor: 0.15,
      // Missing-data handling: short-gap carry-forward imputation with decayed quality.
      // Purpose: avoid treating "missing vitals" as "perfect recovery" (esp. during sleep).
      imputeHrMaxGapMinutes: 15,
      imputeHrvMaxGapMinutes: 60,
      imputeSpo2MaxGapMinutes: 30,
      imputeRrMaxGapMinutes: 30,
      imputeTempMaxGapMinutes: 60,
      imputeHrQualityAtFresh: 0.6,
      imputeHrvQualityAtFresh: 0.35,
      imputeSpo2QualityAtFresh: 0.4,
      imputeRrQualityAtFresh: 0.4,
      imputeTempQualityAtFresh: 0.4,
      // Sleep charging:
      // - SleepRecovery is now primarily driven by sleep architecture (deep vs core/light/awake ratio) + HRV.
      // - HR and respiratory rate are auxiliary; duration + baseline + other signals are reference.
      sleepChargeDurationWeight: 0.8,
      sleepRecoveryExponent: 1.2,
      baseSleepChargePerHour: 10.5,
      baseRestChargePerHour: 2,
      baseMindChargePerHour: 4,
      loadDrainWorkoutMaxPerHour: 35.7,
      workoutHrWeight: 1.2,
      loadDrainHighMaxPerHour: 26.52,
      loadDrainActiveMaxPerHour: 18.36,
      loadDrainLightMaxPerHour: 12.24,
      loadDrainInactiveMaxPerHour: 6.12,
      // Auto state engine thresholds (0-1)
      stateLightMin01: 0.15,
      stateActiveMin01: 0.4,
      stateHighMin01: 0.7,
      // Rest vs inactive (sub-state under INACTIVE)
      restStateMinScore01: 0.55,
      restStateMaxMove01: 0.12,
      restStateMaxStepsPerMin: 2,
      restStateMaxEnergyPerMin: 0.8,
      // Low-activity recovery gate (rest/inactive)
      restChargeMinPotential01: 0.2,
      restChargeStressIndexMax: 1.8,
      restChargeAnomIndexMax: 1.2,
      restChargeGainExponent: 1.25,
      stressDrainPerIndexPerHour: 4,
      stressDrainMaxPerHour: 14,
      anomDrainPerIndexPerHour: 2.5,
      anomDrainMaxPerHour: 10,
      // Wrist Skin Temperature (WST) — dual-mechanism handling:
      // - Sleep-onset mild elevation can be beneficial (heat loss / sleep initiation)
      // - Sustained elevation + co-signals suggests heat stress / inflammation-like state
      tempOnsetWindowMinutes: 60,
      tempOnsetBeneficialMinC: 0.05,
      tempOnsetBeneficialMaxC: 0.45,
      tempOnsetBenefitMaxBoost: 0.12,
      tempOverheatStartC: 0.35,
      tempOverheatScaleC: 0.35,
      tempFeverStartC: 0.9,
      tempFeverScaleC: 0.5,
      tempSustainedHeatMinutes: 180,
      tempSustainedHeatMultiplierMax: 1.6,
      tempAnomWeight: 0.9,
      // Derived state dimensions
      comfortPenaltyPerIndex: 12,
      fatigueDrainPerHourFor100: 40,
      // Calm recovery after activity (short rebound window)
      postActivityRecoveryWindowMinutes: 90,
      postActivityRecoveryMaxMinutes: 45,
      postActivityRecoveryChargeMaxPerHour: 4,
      postActivityRecoveryMinActivityIntensity01: 0.25,
      postActivityRecoveryMaxMovementIntensity01: 0.15,
      postActivityRecoveryHrDropBpmPerMinForMax: 3,
      postActivityRecoveryHrvRiseZForMax: 0.8,
      postActivityRecoveryEnergyDropKcalPerMinForMax: 6,
      postActivityRecoveryStepsDropPerMinForMax: 60,
      postActivityRecoveryMinIndex: 0.12,
      postActivityRecoveryStressSuppressionPower: 2,
      postActivityRecoveryStressSuppressionMinFactor: 0.08,
    };
  }

  function mergeConfig(userConfig) {
    const p = defaultParams();
    const params = { ...p, ...(userConfig?.params || {}) };
    const epochMinutes = toNumberOrNull(userConfig?.epochMinutes ?? params.epochMinutes) ?? p.epochMinutes;
    params.epochMinutes = epochMinutes;
    params.initialBB = toNumberOrNull(userConfig?.initialBB ?? params.initialBB) ?? p.initialBB;
    return { params };
  }

  function readBehaviorBaselineConfig(userConfig) {
    const raw = userConfig?.behaviorBaseline;
    if (!raw || typeof raw !== "object") return { enabled: false };

    const enabled = Boolean(raw.enabled ?? raw.enable ?? raw.on);
    const days = clamp(toNumberOrNull(raw.days ?? raw.windowDays) ?? 10, 1, 60);
    const minSleepBoutMinutes = clamp(toNumberOrNull(raw.minSleepBoutMinutes) ?? 180, 60, 720);
    const minWorkoutBoutMinutes = clamp(toNumberOrNull(raw.minWorkoutBoutMinutes) ?? 10, 5, 240);
    const minSamplesSleep = clamp(toNumberOrNull(raw.minSleepSamples) ?? 5, 1, 30);
    const minSamplesWorkout = clamp(toNumberOrNull(raw.minWorkoutSamples) ?? 4, 1, 30);

    const sleepAbsMinHours0 = clamp(toNumberOrNull(raw.sleepAbsMinHours) ?? 3.5, 2.5, 6);
    const sleepHealthyMinHours0 = clamp(toNumberOrNull(raw.sleepHealthyMinHours) ?? 7.5, 4, 9.5);
    const sleepTargetHours0 = clamp(toNumberOrNull(raw.sleepTargetHours) ?? 8, 5.5, 10.5);

    const sleepAbsMinHours = sleepAbsMinHours0;
    const sleepHealthyMinHours = clamp(Math.max(sleepHealthyMinHours0, sleepAbsMinHours + 0.5), 4, 10);
    const sleepTargetHours = clamp(Math.max(sleepTargetHours0, sleepHealthyMinHours + 0.25), 5.5, 12);

    return {
      enabled,
      days,
      minSleepBoutMinutes,
      minWorkoutBoutMinutes,
      minSamplesSleep,
      minSamplesWorkout,
      sleepAbsMinHours,
      sleepHealthyMinHours,
      sleepTargetHours,
    };
  }

  function robustZ(value, stats) {
    if (!Number.isFinite(value)) return null;
    const medianV = Number(stats?.median);
    const sigma = Number(stats?.sigma);
    if (!Number.isFinite(medianV) || !Number.isFinite(sigma) || sigma <= 0) return null;
    return (value - medianV) / sigma;
  }

  function movementIntensity01FromEpoch(epoch, dtMinutes, baselines) {
    const dtMin = Number.isFinite(dtMinutes) && dtMinutes > 0 ? dtMinutes : 5;
    const steps = toNumberOrNull(epoch.steps) ?? 0;
    const activeEnergy = toNumberOrNull(epoch.activeEnergyKcal ?? epoch.activeEnergy ?? epoch.energyKcal);
    const power = toNumberOrNull(epoch.powerW ?? epoch.power);
    const ftp = Number(baselines?.ftpW ?? 220);

    const stepsPerMin = steps / dtMin;
    const energyPerMin = activeEnergy === null ? 0 : activeEnergy / dtMin;

    const stepsIdx = clamp(stepsPerMin / 150, 0, 1);
    const energyIdx = clamp(energyPerMin / 20, 0, 1);
    const powerIdx =
      power === null || !Number.isFinite(ftp) || ftp <= 0 ? 0 : clamp(power / ftp, 0, 1.6) / 1.6;
    return clamp(Math.max(stepsIdx, energyIdx, powerIdx), 0, 1);
  }

  function buildContextTimeline(epochs, params, baselines) {
    const epochMinutes = Number.isFinite(Number(params?.epochMinutes)) ? Number(params.epochMinutes) : 5;
    const dtHoursDefault = epochMinutes / 60;

    let prevTs = null;
    const timeline = [];
    for (let i = 0; i < (epochs || []).length; i++) {
      const e = epochs[i];
      const ts = parseTimestampMs(e);

      let dtHours = dtHoursDefault;
      let dtObservedMinutes = null;
      if (prevTs !== null && ts !== null) {
        const diffH = (ts - prevTs) / 3600000;
        if (Number.isFinite(diffH) && diffH > 0.1 / 60) {
          dtObservedMinutes = diffH * 60;

          // Epochs are expected to represent a fixed interval (epochMinutes).
          // If timestamps have large gaps (missing epochs), don't treat that whole gap as one epoch duration;
          // it can cause physiologically implausible BB jumps (e.g. workout draining BB to 0 in one step).
          const tolMin = 0.5;
          const tolMax = 1.5;
          const minH = dtHoursDefault * tolMin;
          const maxH = dtHoursDefault * tolMax;
          if (Number.isFinite(minH) && Number.isFinite(maxH) && diffH >= minH && diffH <= maxH) dtHours = diffH;
        }
      }
      prevTs = ts ?? prevTs;

      const dtMinutes = dtHours * 60;
      const context0 = e.context ? { ...(e.context || {}) } : classifyContext(e, baselines, epochMinutes, params);
      timeline.push({ tsMs: ts, dtMinutes, dtHours, dtObservedMinutes, context0 });
    }
    return timeline;
  }

  function buildContextSegments(epochs, timeline, baselines) {
    const segmentOf = new Array((epochs || []).length);
    const segments = [];
    let current = null;

    for (let i = 0; i < (epochs || []).length; i++) {
      const kind = timeline[i]?.context0?.kind ?? "AWAKE";
      if (!current || current.kind !== kind) {
        current = {
          id: segments.length,
          kind,
          startIdx: i,
          endIdx: i,
          startTsMs: timeline[i]?.tsMs ?? null,
          endTsMs: timeline[i]?.tsMs ?? null,
          durationMinutes: 0,
          intensity01Sum: 0,
          intensityMinutes: 0,
          meanMovementIntensity01: 0,
          scales: null,
        };
        segments.push(current);
      }

      current.endIdx = i;
      current.durationMinutes += Number(timeline[i]?.dtMinutes ?? 0) || 0;
      const ts = timeline[i]?.tsMs ?? null;
      if (ts !== null && ts !== undefined && Number.isFinite(ts)) current.endTsMs = ts;

      if (kind === "WORKOUT" || kind === "HIGH_ACTIVITY" || kind === "ACTIVE" || kind === "LIGHT_ACTIVITY") {
        const dtMinutes = Number(timeline[i]?.dtMinutes ?? 0) || 0;
        const intensity = movementIntensity01FromEpoch(epochs[i], dtMinutes, baselines);
        current.intensity01Sum += intensity * dtMinutes;
        current.intensityMinutes += dtMinutes;
      }

      segmentOf[i] = current.id;
    }

    for (const seg of segments) {
      seg.meanMovementIntensity01 =
        seg.intensityMinutes > 0 ? clamp(seg.intensity01Sum / seg.intensityMinutes, 0, 1) : 0;
      delete seg.intensity01Sum;
      delete seg.intensityMinutes;
    }

    return { segments, segmentOf };
  }

  function sleepDurationHealthScale(durationHours, cfg) {
    const d = Number(durationHours);
    if (!Number.isFinite(d) || d <= 0) return 1;

    const absMinH = Number(cfg?.sleepAbsMinHours ?? 3.5);
    const healthyMinH = Number(cfg?.sleepHealthyMinHours ?? 7.5);
    const targetH = Number(cfg?.sleepTargetHours ?? 8);

    const absMinFactor = 0.3;
    const belowHealthyMinFactor = 0.9;

    if (d <= absMinH) return absMinFactor;
    if (d < healthyMinH) {
      const t = (d - absMinH) / Math.max(1e-6, healthyMinH - absMinH);
      return lerp(absMinFactor, belowHealthyMinFactor, t);
    }
    if (d < targetH) {
      const t = (d - healthyMinH) / Math.max(1e-6, targetH - healthyMinH);
      return lerp(belowHealthyMinFactor, 1, t);
    }
    return 1;
  }

  function computeSleepChargeScale(durationHours, baselineStats, cfg) {
    const healthScale = sleepDurationHealthScale(durationHours, cfg);
    const out = {
      durationHours: Number.isFinite(durationHours) ? Number(durationHours) : null,
      healthScale,
      baselineZ: null,
      typicality01: null,
      baselinePenalty: 1,
      scale: healthScale,
    };

    if (!baselineStats || Number(baselineStats.n) < Number(cfg?.minSamplesSleep ?? 5)) return out;

    const z = robustZ(Number(durationHours), baselineStats);
    if (z === null) return out;

    const zMax = 3;
    const typicality01 = clamp(1 - Math.abs(z) / zMax, 0, 1);

    let scale = lerp(healthScale, 1, typicality01);

    const shortPenaltyStrength = 0.35;
    const longPenaltyStrength = 0.12;
    let baselinePenalty = 1;
    if (z < -1) {
      const anomaly01 = clamp((-z - 1) / (zMax - 1), 0, 1);
      baselinePenalty = clamp(1 - shortPenaltyStrength * anomaly01, 0.2, 1);
    } else if (z > 1) {
      const anomaly01 = clamp((z - 1) / (zMax - 1), 0, 1);
      baselinePenalty = clamp(1 - longPenaltyStrength * anomaly01, 0.2, 1);
    }
    scale = clamp(scale * baselinePenalty, 0.2, 1.2);

    out.baselineZ = z;
    out.typicality01 = typicality01;
    out.baselinePenalty = baselinePenalty;
    out.scale = scale;
    return out;
  }

  function computeWorkoutLoadDrainScale(meanIntensity01, baselineStats, cfg) {
    const intensity = clamp(Number(meanIntensity01 ?? 0), 0, 1);
    const out = { meanIntensity01: intensity, baselineZ: null, anomaly01: null, scale: 1 };
    if (!baselineStats || Number(baselineStats.n) < Number(cfg?.minSamplesWorkout ?? 4)) return out;

    const z = robustZ(intensity, baselineStats);
    if (z === null) return out;
    out.baselineZ = z;

    const z0 = 1;
    const zMax = 3;
    const absZ = Math.abs(z);
    if (absZ <= z0) return out;

    const anomaly01 = clamp((absZ - z0) / (zMax - z0), 0, 1);
    const dir = clamp(z / zMax, -1, 1);
    const strength = 0.35;
    const scale = clamp(1 + strength * dir * anomaly01, 0.7, 1.4);

    out.anomaly01 = anomaly01;
    out.scale = scale;
    return out;
  }

  function buildBehaviorBaselineFromSegments(segments, timeline, cfg) {
    let firstTsMs = null;
    let lastTsMs = null;
    for (const r of timeline || []) {
      const t = r?.tsMs ?? null;
      if (t === null || t === undefined || !Number.isFinite(t)) continue;
      if (firstTsMs === null || t < firstTsMs) firstTsMs = t;
      if (lastTsMs === null || t > lastTsMs) lastTsMs = t;
    }
    const windowDays = clamp(Number(cfg?.days ?? 10), 1, 60);
    const windowStartTsMs = firstTsMs;
    const windowEndTsMs = firstTsMs === null ? null : firstTsMs + windowDays * 24 * 60 * 60000;

    const hasFullWindow =
      windowStartTsMs !== null &&
      windowEndTsMs !== null &&
      lastTsMs !== null &&
      Number.isFinite(windowEndTsMs) &&
      Number.isFinite(lastTsMs) &&
      lastTsMs >= windowEndTsMs;

    const baselineSegments =
      windowEndTsMs === null
        ? []
        : (segments || []).filter((s) => Number.isFinite(Number(s?.startTsMs)) && Number(s.startTsMs) < windowEndTsMs);

    const sleepDurHours = [];
    const workoutIntensity01 = [];
    const workoutDurMinutes = [];
    const minSleepMinutes = Number(cfg?.minSleepBoutMinutes ?? 180);
    const minWorkoutMinutes = Number(cfg?.minWorkoutBoutMinutes ?? 10);

    for (const seg of baselineSegments) {
      const durMin = Number(seg?.durationMinutes ?? 0);
      if (!Number.isFinite(durMin) || durMin <= 0) continue;

      if (seg.kind === "SLEEP" && durMin >= minSleepMinutes) sleepDurHours.push(durMin / 60);
      if (seg.kind === "WORKOUT" && durMin >= minWorkoutMinutes) {
        workoutIntensity01.push(clamp(Number(seg?.meanMovementIntensity01 ?? 0), 0, 1));
        workoutDurMinutes.push(durMin);
      }
    }

    const sleepStats = robustStats(sleepDurHours, { sigmaMin: 0.25, sigmaMax: 4 });
    const workoutIntensityStats = robustStats(workoutIntensity01, { sigmaMin: 0.05, sigmaMax: 1 });
    const workoutDurationStats = robustStats(workoutDurMinutes, { sigmaMin: 5, sigmaMax: 360 });

    const ready =
      Boolean(cfg?.enabled) &&
      hasFullWindow &&
      sleepStats.n >= Number(cfg?.minSamplesSleep ?? 5) &&
      Number.isFinite(sleepStats.median);

    return {
      enabled: Boolean(cfg?.enabled),
      ready,
      windowDays,
      windowStartTsMs,
      windowEndTsMs,
      firstTsMs,
      lastTsMs,
      sleep: { durationHours: sleepStats },
      workout: { intensity01: workoutIntensityStats, durationMinutes: workoutDurationStats },
    };
  }

  function attachBehaviorScalesToSegments(segments, behaviorBaseline, cfg) {
    if (!behaviorBaseline?.enabled) return;
    const sleepStats = behaviorBaseline?.sleep?.durationHours ?? null;
    const workoutIntensityStats = behaviorBaseline?.workout?.intensity01 ?? null;

    for (const seg of segments || []) {
      if (!seg || typeof seg !== "object") continue;
      const durationHours = Number(seg.durationMinutes) / 60;

      if (seg.kind === "SLEEP") {
        seg.scales = {
          ...(seg.scales || {}),
          sleep: computeSleepChargeScale(durationHours, sleepStats, cfg),
        };
      }

      if (seg.kind === "WORKOUT") {
        seg.scales = {
          ...(seg.scales || {}),
          workout: computeWorkoutLoadDrainScale(seg.meanMovementIntensity01, workoutIntensityStats, cfg),
        };
      }
    }
  }

  function saturationFactor(bb, exponent) {
    const x = clamp(1 - bb / 100, 0, 1);
    const exp = Number.isFinite(exponent) ? exponent : 0.5;
    return Math.pow(x, clamp(exp, 0.1, 2));
  }

  function normalizeZ(value, base, scale) {
    if (!Number.isFinite(value) || !Number.isFinite(base) || !Number.isFinite(scale) || scale <= 0) return null;
    return (value - base) / scale;
  }

  function computeActivityFeaturesForStateEngine(epoch, baselines, dtMinutes) {
    const dtMin = Number.isFinite(dtMinutes) && dtMinutes > 0 ? dtMinutes : 5;

    const steps = toNumberOrNull(epoch.steps) ?? 0;
    const hr = toNumberOrNull(epoch.hrBpm ?? epoch.hr);
    const hrv = toNumberOrNull(epoch.hrvSdnnMs ?? epoch.hrvMs ?? epoch.hrv);
    const activeEnergy = toNumberOrNull(epoch.activeEnergyKcal ?? epoch.activeEnergy ?? epoch.energyKcal);
    const power = toNumberOrNull(epoch.powerW ?? epoch.power);

    const stepsPerMin = steps / dtMin;
    const energyPerMin = activeEnergy === null ? 0 : activeEnergy / dtMin;

    const ftp = Number(baselines?.ftpW ?? 220);
    const rhr = Number(baselines?.rhrBpm ?? 60);
    const hrMax = Number(baselines?.hrMaxBpm ?? 190);

    const stepsIdx = clamp(stepsPerMin / 150, 0, 1);
    const energyIdx = clamp(energyPerMin / 20, 0, 1);
    const powerIdx =
      power === null || !Number.isFinite(ftp) || ftp <= 0 ? 0 : clamp(power / ftp, 0, 1.6) / 1.6;

    const movementIntensity01 = clamp(Math.max(stepsIdx, energyIdx, powerIdx), 0, 1);
    const hasActivitySignal = stepsPerMin >= 8 || energyPerMin >= 1.2 || (power !== null && power >= 60);

    const hrIdx =
      hr === null || !Number.isFinite(rhr) || !Number.isFinite(hrMax) || hrMax <= rhr
        ? 0
        : clamp((hr - rhr) / (hrMax - rhr), 0, 1);

    const zHrv = hrv === null ? null : normalizeZ(hrv, baselines?.hrvSdnnMs, baselines?.hrvScaleMs);

    return {
      stepsPerMin,
      energyPerMin,
      power,
      movementIntensity01,
      hasActivitySignal,
      hr,
      hrIdx,
      hrv,
      zHrv,
      rhr,
    };
  }

  function inferActivityState(engineFeatures, params) {
    const move01 = clamp(Number(engineFeatures?.movementIntensity01 ?? 0), 0, 1);
    const hrIdx = clamp(Number(engineFeatures?.hrIdx ?? 0), 0, 1);
    const hasActivitySignal = Boolean(engineFeatures?.hasActivitySignal);

    // Avoid mistaking stress for activity: only let HR up-weight intensity when we see movement/energy/power evidence.
    const effort01 = hasActivitySignal ? Math.max(move01, 0.65 * hrIdx) : move01;

    const light0 = clamp(Number(params?.stateLightMin01 ?? 0.15), 0, 1);
    const active0 = clamp(Number(params?.stateActiveMin01 ?? 0.4), 0, 1);
    const high0 = clamp(Number(params?.stateHighMin01 ?? 0.7), 0, 1);

    const lightMin = Math.min(light0, active0, high0);
    const highMin = Math.max(light0, active0, high0);
    const activeMin = clamp(light0 + active0 + high0 - lightMin - highMin, lightMin, highMin);

    if (effort01 >= highMin) return { state: "HIGH_ACTIVITY", effort01 };
    if (effort01 >= activeMin) return { state: "ACTIVE", effort01 };
    if (effort01 >= lightMin) return { state: "LIGHT_ACTIVITY", effort01 };
    return { state: "INACTIVE", effort01 };
  }

  function inferRestSubState(engineFeatures, params) {
    const hr = toNumberOrNull(engineFeatures?.hr);
    const rhr = Number(engineFeatures?.rhr ?? 60);
    const zHrv = engineFeatures?.zHrv ?? null;

    const move01 = clamp(Number(engineFeatures?.movementIntensity01 ?? 0), 0, 1);
    const stepsPerMin = Math.max(0, Number(engineFeatures?.stepsPerMin ?? 0) || 0);
    const energyPerMin = Math.max(0, Number(engineFeatures?.energyPerMin ?? 0) || 0);

    const maxMove01 = clamp(Number(params?.restStateMaxMove01 ?? 0.12), 0, 1);
    const maxStepsPerMin = clamp(Number(params?.restStateMaxStepsPerMin ?? 2), 0, 50);
    const maxEnergyPerMin = clamp(Number(params?.restStateMaxEnergyPerMin ?? 0.8), 0, 10);
    const minScore01 = clamp(Number(params?.restStateMinScore01 ?? 0.55), 0, 1);

    if (hr === null) return { restKind: "INACTIVE", score01: 0 };
    if (move01 > maxMove01 || stepsPerMin > maxStepsPerMin || energyPerMin > maxEnergyPerMin) {
      return { restKind: "INACTIVE", score01: 0 };
    }

    const hrRelax01 = !Number.isFinite(rhr) ? 0 : clamp((rhr + 12 - hr) / 12, 0, 1);
    const still01 = clamp((maxMove01 - move01) / Math.max(1e-6, maxMove01), 0, 1);
    const hrvBonus01 = zHrv === null ? 0 : clamp(zHrv / 1.5, 0, 1);

    const score01 = clamp(0.55 * hrRelax01 + 0.25 * still01 + 0.2 * hrvBonus01, 0, 1);
    return { restKind: score01 >= minScore01 ? "REST" : "INACTIVE", score01 };
  }

  function classifyContext(epoch, baselines, epochMinutes, params) {
    const dtMin = Number.isFinite(epochMinutes) && epochMinutes > 0 ? epochMinutes : 5;

    const sleepStageRaw = epoch.sleepStage ?? epoch.sleep ?? null;
    const sleepStage = sleepStageRaw === null || sleepStageRaw === undefined || sleepStageRaw === "" ? null : String(sleepStageRaw);
    if (sleepStage) {
      return { kind: "SLEEP", sleepStage };
    }

    const mindful = Boolean(epoch.mindful ?? epoch.mindfulness ?? epoch.isMindful);
    if (mindful) return { kind: "MEDITATION" };

    const workout = Boolean(epoch.workout ?? epoch.isWorkout);
    if (workout) return { kind: "WORKOUT", workoutType: epoch.workoutType ?? null };

    const features = computeActivityFeaturesForStateEngine(epoch, baselines, dtMin);
    const inferred = inferActivityState(features, params);

    if (inferred.state === "HIGH_ACTIVITY") return { kind: "HIGH_ACTIVITY", engine: { ...features, ...inferred } };
    if (inferred.state === "ACTIVE") return { kind: "ACTIVE", engine: { ...features, ...inferred } };
    if (inferred.state === "LIGHT_ACTIVITY") return { kind: "LIGHT_ACTIVITY", engine: { ...features, ...inferred } };

    const rest = inferRestSubState(features, params);
    if (rest.restKind === "REST") return { kind: "AWAKE_REST", engine: { ...features, ...inferred, ...rest } };
    return { kind: "AWAKE", engine: { ...features, ...inferred, ...rest } };
  }

  function scoreQuality01(value, minOk, maxOk) {
    if (value === null || value === undefined) return 0;
    if (!Number.isFinite(value)) return 0;
    if (value < minOk || value > maxOk) return 0.15;
    return 1;
  }

  function computeQuality(epoch, baselines) {
    const qUser = epoch.quality ?? null;
    if (qUser && typeof qUser === "object") {
      const q = {};
      for (const [k, v] of Object.entries(qUser)) q[k] = clamp(Number(v), 0, 1);
      return q;
    }

    const hr = toNumberOrNull(epoch.hrBpm ?? epoch.hr);
    const hrv = toNumberOrNull(epoch.hrvSdnnMs ?? epoch.hrvMs ?? epoch.hrv);
    const spo2 = asPercentMaybe(epoch.spo2Pct ?? epoch.spo2);
    const rr = toNumberOrNull(epoch.respRateBrpm ?? epoch.respiratoryRate ?? epoch.rr);
    const temp = toNumberOrNull(epoch.wristTempC ?? epoch.tempC ?? epoch.temp);
    const steps = toNumberOrNull(epoch.steps);
    const energy = toNumberOrNull(epoch.activeEnergyKcal ?? epoch.activeEnergy ?? epoch.energyKcal);
    const power = toNumberOrNull(epoch.powerW ?? epoch.power);

    const q = {
      hr: scoreQuality01(hr, 30, 220),
      hrv: scoreQuality01(hrv, 5, 250),
      spo2: scoreQuality01(spo2, 75, 100),
      rr: scoreQuality01(rr, 6, 35),
      temp: scoreQuality01(temp, 30, 42),
      steps: steps === null ? 0 : steps >= 0 ? 1 : 0.2,
      energy: energy === null ? 0 : energy >= 0 ? 1 : 0.2,
      power: power === null ? 0 : power >= 0 && power <= 2000 ? 1 : 0.2,
    };

    if (baselines?.wristTempBaselineDays !== null && baselines?.wristTempBaselineDays !== undefined) {
      const days = Number(baselines.wristTempBaselineDays);
      if (Number.isFinite(days) && days < 5 && q.temp > 0) q.temp = Math.min(q.temp, 0.35);
    }

    return q;
  }

  function ruleWeights(context) {
    switch (context.kind) {
      case "SLEEP":
        return {
          charge: { sleep: 1, rest: 0, mind: 0 },
          drain: { load: 0.08, stress: 0.32, anom: 0.6 },
        };
      case "WORKOUT":
        return {
          charge: { sleep: 0, rest: 0, mind: 0 },
          drain: { load: 0.78, stress: 0.22, anom: 0 },
        };
      case "MEDITATION":
        return {
          charge: { sleep: 0, rest: 0.25, mind: 0.75 },
          drain: { load: 0.05, stress: 0.95, anom: 0 },
        };
      case "AWAKE_REST":
        return {
          charge: { sleep: 0, rest: 1, mind: 0 },
          drain: { load: 0.15, stress: 0.85, anom: 0 },
        };
      case "POST_ACTIVITY_RECOVERY":
        return {
          charge: { sleep: 0, rest: 0.9, mind: 0.1 },
          drain: { load: 0.1, stress: 0.9, anom: 0 },
        };
      case "HIGH_ACTIVITY":
        return {
          charge: { sleep: 0, rest: 0.02, mind: 0 },
          drain: { load: 0.78, stress: 0.22, anom: 0 },
        };
      case "ACTIVE":
        return {
          charge: { sleep: 0, rest: 0.05, mind: 0 },
          drain: { load: 0.72, stress: 0.28, anom: 0 },
        };
      case "LIGHT_ACTIVITY":
        return {
          charge: { sleep: 0, rest: 0.12, mind: 0 },
          drain: { load: 0.62, stress: 0.38, anom: 0 },
        };
      case "AWAKE":
      default:
        return {
          charge: { sleep: 0, rest: 0.18, mind: 0 },
          drain: { load: 0.45, stress: 0.55, anom: 0 },
        };
    }
  }

  function weightedAvg01(weights, qualities) {
    let sumW = 0;
    let sum = 0;
    for (const [k, w] of Object.entries(weights)) {
      const ww = Number.isFinite(w) ? w : 0;
      if (ww <= 0) continue;
      sumW += ww;
      sum += ww * clamp(Number(qualities?.[k] ?? 0), 0, 1);
    }
    if (sumW <= 0) return 0;
    return clamp(sum / sumW, 0, 1);
  }

  function gateWeights(priorWeights, componentQuality, minScale) {
    const gated = {};
    let sum = 0;
    for (const [k, w] of Object.entries(priorWeights)) {
      const q = clamp(Number(componentQuality?.[k] ?? 0), 0, 1);
      const ww = clamp(Number(w), 0, 1) * q;
      gated[k] = ww;
      sum += ww;
    }

    if (sum > 0) {
      for (const k of Object.keys(gated)) gated[k] = gated[k] / sum;
    } else {
      for (const [k, w] of Object.entries(priorWeights)) gated[k] = clamp(Number(w), 0, 1);
    }

    const groupQuality = weightedAvg01(priorWeights, componentQuality);
    const minS = clamp(Number(minScale), 0, 1);
    const groupScale = clamp(minS + (1 - minS) * groupQuality, minS, 1);

    return { weights: gated, groupQuality, groupScale };
  }

  function sleepStageFactor(sleepStage) {
    if (!sleepStage) return 1;
    const s = String(sleepStage).toLowerCase();
    // Fine-grained per-epoch modifier (small range); main driver is session-level architecture + HRV.
    if (s.includes("deep")) return 1.05;
    if (s.includes("core") || s.includes("light")) return 1;
    if (s.includes("rem")) return 0.95;
    if (s.includes("awake")) return 0.05;
    if (s.includes("inbed") || s.includes("in_bed")) return 0.15;
    return 1;
  }

  function sleepStageKind(sleepStage) {
    if (!sleepStage) return null;
    const s = String(sleepStage).toLowerCase();
    if (s.includes("deep")) return "deep";
    if (s.includes("core") || s.includes("light")) return "core";
    if (s.includes("rem")) return "rem";
    if (s.includes("awake")) return "awake";
    if (s.includes("inbed") || s.includes("in_bed")) return "inbed";
    return "core";
  }

  function computeSleepArchitectureFactor(stageMinutes, totalMinutes) {
    const total = Math.max(0, Number(totalMinutes) || 0);
    if (!Number.isFinite(total) || total <= 0) return 1;

    const deep = Math.max(0, Number(stageMinutes?.deep ?? 0) || 0);
    const awakeLike =
      Math.max(0, Number(stageMinutes?.awake ?? 0) || 0) + Math.max(0, Number(stageMinutes?.inbed ?? 0) || 0);

    const asleep = Math.max(0, total - awakeLike);
    const asleepFrac = clamp(asleep / total, 0, 1);
    const deepFracAsleep = asleep <= 1e-6 ? 0 : clamp(deep / asleep, 0, 1);

    // References (order-of-magnitude guidance; varies by age/sex):
    // - StatPearls/NCBI Bookshelf "Physiology, Sleep Stages": N3 ~ 25% of sleep; REM ~ 25%.
    // - PSG meta-analyses: normative sleep efficiency decreases with age (use as a soft, non-diagnostic prior).
    const efficiencyScore01 = clamp((asleepFrac - 0.85) / 0.1, 0, 1);
    const deepScore01 = clamp((deepFracAsleep - 0.1) / 0.15, 0, 1);

    // Architecture factor (main driver): deep ratio + low fragmentation.
    // Core/light/restful sleep without deep is still beneficial, but deep increases efficiency.
    const factor = 0.65 + 0.3 * efficiencyScore01 + 0.3 * deepScore01;
    return clamp(factor, 0.55, 1.25);
  }

  function buildSleepArchitectureFactorByEpoch(timeline, maxWakeGapMinutes) {
    const n = Array.isArray(timeline) ? timeline.length : 0;
    const out = { factorOfEpoch: new Array(n).fill(null), sessions: [] };
    if (n === 0) return out;

    const MAX_WAKE_GAP_MIN = clamp(Number(maxWakeGapMinutes ?? 90), 0, 720);

    const sleepSegments = [];
    for (let i = 0; i < n; i++) {
      if (timeline[i]?.context0?.kind !== "SLEEP") continue;
      const startIdx = i;
      let endIdx = i;
      while (endIdx + 1 < n && timeline[endIdx + 1]?.context0?.kind === "SLEEP") endIdx++;
      sleepSegments.push({ startIdx, endIdx });
      i = endIdx;
    }

    const sleepSessions = [];
    if (sleepSegments.length > 0) {
      let curr = null;
      for (const seg of sleepSegments) {
        if (!curr) {
          curr = { startIdx: seg.startIdx, endIdx: seg.endIdx };
          continue;
        }

        let gapMin = 0;
        if (curr.endIdx + 1 < seg.startIdx) {
          const gapStartMs = timeline[curr.endIdx + 1]?.tsMs ?? null;
          const gapEndMs = timeline[seg.startIdx]?.tsMs ?? null;
          if (Number.isFinite(gapStartMs) && Number.isFinite(gapEndMs) && gapEndMs >= gapStartMs) {
            gapMin = (gapEndMs - gapStartMs) / 60000;
          } else {
            for (let i = curr.endIdx + 1; i < seg.startIdx; i++) gapMin += Number(timeline[i]?.dtMinutes ?? 0) || 0;
          }
        }

        if (gapMin <= MAX_WAKE_GAP_MIN) {
          curr.endIdx = seg.endIdx;
        } else {
          sleepSessions.push(curr);
          curr = { startIdx: seg.startIdx, endIdx: seg.endIdx };
        }
      }
      if (curr) sleepSessions.push(curr);
    }

    for (const s of sleepSessions) {
      const stageMinutes = { deep: 0, core: 0, rem: 0, awake: 0, inbed: 0 };
      let totalMin = 0;

      for (let i = s.startIdx; i <= s.endIdx; i++) {
        const ctx = timeline[i]?.context0;
        if (ctx?.kind !== "SLEEP") continue;
        const dt = Number(timeline[i]?.dtMinutes ?? 0) || 0;
        if (!Number.isFinite(dt) || dt <= 0) continue;

        const k = sleepStageKind(ctx.sleepStage);
        if (k === "deep") stageMinutes.deep += dt;
        else if (k === "rem") stageMinutes.rem += dt;
        else if (k === "awake") stageMinutes.awake += dt;
        else if (k === "inbed") stageMinutes.inbed += dt;
        else stageMinutes.core += dt;

        totalMin += dt;
      }

      const factor = computeSleepArchitectureFactor(stageMinutes, totalMin);
      out.sessions.push({
        startIdx: s.startIdx,
        endIdx: s.endIdx,
        durationMinutes: totalMin,
        stageMinutes,
        factor,
      });

      for (let i = s.startIdx; i <= s.endIdx; i++) {
        if (timeline[i]?.context0?.kind !== "SLEEP") continue;
        out.factorOfEpoch[i] = factor;
      }
    }

    return out;
  }

  function computeIndices(epoch, context, baselines, params, q, dtMinutes, meta) {
    const dtMin = Number.isFinite(dtMinutes) && dtMinutes > 0 ? dtMinutes : Number(params.epochMinutes) || 5;
    const hr = toNumberOrNull(epoch.hrBpm ?? epoch.hr);
    const hrv = toNumberOrNull(epoch.hrvSdnnMs ?? epoch.hrvMs ?? epoch.hrv);
    const spo2 = asPercentMaybe(epoch.spo2Pct ?? epoch.spo2);
    const rr = toNumberOrNull(epoch.respRateBrpm ?? epoch.respiratoryRate ?? epoch.rr);
    const temp = toNumberOrNull(epoch.wristTempC ?? epoch.tempC ?? epoch.temp);
    const steps = toNumberOrNull(epoch.steps);
    const activeEnergy = toNumberOrNull(epoch.activeEnergyKcal ?? epoch.activeEnergy ?? epoch.energyKcal);
    const power = toNumberOrNull(epoch.powerW ?? epoch.power);

    const rhr = Number(baselines.rhrBpm);
    const hrMax = Number(baselines.hrMaxBpm);
    const ftp = Number(baselines.ftpW);

    const stepsPerMin = steps === null ? 0 : steps / dtMin;
    const energyPerMin = activeEnergy === null ? 0 : activeEnergy / dtMin;

    const stepsIdx = clamp(stepsPerMin / 150, 0, 1);
    const energyIdx = clamp(energyPerMin / 20, 0, 1);
    const powerIdx =
      power === null || !Number.isFinite(ftp) || ftp <= 0 ? 0 : clamp(power / ftp, 0, 1.6) / 1.6;
    const hrIdx =
      hr === null || !Number.isFinite(rhr) || !Number.isFinite(hrMax) || hrMax <= rhr
        ? 0
        : clamp((hr - rhr) / (hrMax - rhr), 0, 1);

    const activityIdx = clamp((stepsIdx + energyIdx + powerIdx) / 3, 0, 1);
    const movementIntensity = clamp(Math.max(stepsIdx, energyIdx, powerIdx), 0, 1);

    const hasActivitySignal =
      stepsPerMin >= 8 ||
      energyPerMin >= 1.2 ||
      (power !== null && power !== undefined && Number.isFinite(power) && power >= 60);

    // Avoid double-counting: elevated HR without steps/energy/power is treated as "stress", not "mechanical load".
    let intensityForLoad = 0;
    if (context.kind === "WORKOUT") {
      const hrW = clamp(Number(params.workoutHrWeight ?? 1.2), 0.5, 2);
      intensityForLoad = clamp(Math.max(movementIntensity, hrW * hrIdx), 0, 1);
    }
    else if (hasActivitySignal) intensityForLoad = clamp(Math.max(movementIntensity, 0.5 * hrIdx), 0, 1);
    else intensityForLoad = movementIntensity;

    const zHrv = hrv === null ? null : normalizeZ(hrv, baselines.hrvSdnnMs, baselines.hrvScaleMs);

    const spo2Penalty = spo2 === null ? 0 : relu((baselines.spo2Pct - spo2) / 2);
    const rrPenalty = rr === null ? 0 : relu((rr - baselines.respRateBrpm) / 2);

    // Wrist temperature (WST) is peripheral skin temperature; handle dual-mechanism:
    // - sleep-onset mild elevation can be beneficial (heat loss / sleep initiation)
    // - sustained elevation (esp. with RR/SpO2/HR/HRV co-signals) is likely heat stress / inflammation-like
    const sleepMinutesFromStart = Number.isFinite(meta?.sleepMinutesFromStart) ? Number(meta.sleepMinutesFromStart) : null;
    const sleepHeatStreakMinutes = Number.isFinite(meta?.sleepHeatStreakMinutes) ? Number(meta.sleepHeatStreakMinutes) : 0;
    const qTemp = clamp(Number(q.temp ?? 0), 0, 1);

    const tempDeltaC = temp === null ? null : temp - Number(baselines.wristTempC);

    const rrScale = Number(baselines.respRateScaleBrpm);
    const hrHigh01 =
      hr === null || !Number.isFinite(rhr) ? 0 : clamp((hr - (rhr + 12)) / 18, 0, 1);
    const rrHigh01 =
      rr === null || !Number.isFinite(rrScale) || rrScale <= 0
        ? 0
        : clamp((rr - Number(baselines.respRateBrpm)) / (2 * rrScale), 0, 1);
    const spo2Low01 = spo2 === null ? 0 : clamp((Number(baselines.spo2Pct) - spo2) / 4, 0, 1);
    const hrvLow01 = zHrv === null ? 0 : clamp((-zHrv) / 2, 0, 1);
    const physioHeatStress01 = clamp(0.35 * hrHigh01 + 0.25 * rrHigh01 + 0.25 * spo2Low01 + 0.15 * hrvLow01, 0, 1);

    const onsetWindowMin = clamp(Number(params.tempOnsetWindowMinutes ?? 60), 15, 180);
    const isSleep = context.kind === "SLEEP";
    const isOnsetWindow = isSleep && sleepMinutesFromStart !== null && sleepMinutesFromStart <= onsetWindowMin;

    const onsetMinC = Number(params.tempOnsetBeneficialMinC ?? 0.05);
    const onsetMaxC = Number(params.tempOnsetBeneficialMaxC ?? 0.45);
    const onsetBoost = clamp(Number(params.tempOnsetBenefitMaxBoost ?? 0.12), 0, 0.5);

    const overheatStartC = Number(params.tempOverheatStartC ?? 0.35);
    const overheatScaleC = Math.max(0.05, Number(params.tempOverheatScaleC ?? 0.35));

    const feverStartC = Number(params.tempFeverStartC ?? 0.9);
    const feverScaleC = Math.max(0.05, Number(params.tempFeverScaleC ?? 0.5));

    const sustainedMinutes = clamp(Number(params.tempSustainedHeatMinutes ?? 180), 30, 600);
    const sustainedMaxMult = clamp(Number(params.tempSustainedHeatMultiplierMax ?? 1.6), 1, 3);

    let tempMode = "missing";
    let tempOnsetBenefitIndex = 0;
    let tempOverheatIndex = 0;
    let tempFeverIndex = 0;
    let tempHarmIndex = 0;
    let tempHeatLikely = false;

    if (tempDeltaC !== null && qTemp > 0) {
      tempMode = "neutral";
      const d = tempDeltaC;

      const isBenignOnsetElev =
        isOnsetWindow && d >= onsetMinC && d <= onsetMaxC && physioHeatStress01 <= 0.6;
      if (isBenignOnsetElev) {
        const denom = Math.max(1e-6, onsetMaxC - onsetMinC);
        const shape = clamp((d - onsetMinC) / denom, 0, 1);
        tempOnsetBenefitIndex = shape * (1 - physioHeatStress01) * qTemp;
        if (tempOnsetBenefitIndex > 0) tempMode = "onset_heat_loss";
      }

      const overheatBase = relu((d - overheatStartC) / overheatScaleC);
      const feverBase = relu((d - feverStartC) / feverScaleC);

      const isExtremeHeat = d >= feverStartC;
      // Sustained overheat: beyond onset window, OR with strong co-signals, OR extreme elevation (likely heat load).
      if (overheatBase > 0 && (!isOnsetWindow || physioHeatStress01 > 0.3 || isExtremeHeat)) {
        const heatStreakCandidate = Math.max(0, sleepHeatStreakMinutes) + dtMin;
        const sustainedFrac = clamp(heatStreakCandidate / sustainedMinutes, 0, 1);
        const sustainedFactor = 1 + (sustainedMaxMult - 1) * sustainedFrac;
        tempOverheatIndex = overheatBase * (0.7 + 0.6 * physioHeatStress01) * sustainedFactor * qTemp;
        if (tempOverheatIndex > 0) {
          tempHeatLikely = true;
          tempMode = "heat_stress";
        }
      }

      // Fever / inflammation-like: large elevation (co-signals amplify).
      if (feverBase > 0) {
        tempFeverIndex = feverBase * (0.6 + 0.8 * physioHeatStress01) * qTemp;
        if (tempFeverIndex > 0) {
          tempHeatLikely = true;
          tempMode = "fever_like";
        }
      }

      tempHarmIndex = tempOverheatIndex + tempFeverIndex;
    }

    const spo2PenaltyEff = spo2Penalty * clamp(Number(q.spo2 ?? 0), 0, 1);
    const rrPenaltyEff = rrPenalty * clamp(Number(q.rr ?? 0), 0, 1);
    const tempAnomWeight = clamp(Number(params.tempAnomWeight ?? 0.9), 0, 3);
    const anomIndex = 1.0 * spo2PenaltyEff + 0.7 * rrPenaltyEff + tempAnomWeight * tempHarmIndex;

    const stageFactor = isSleep ? sleepStageFactor(context.sleepStage) : 0;
    const sleepArchFactor = !isSleep ? 1 : clamp(Number(meta?.sleepArchitectureFactor ?? 1), 0.55, 1.25);

    // HRV is a primary driver (scaled by personal baseline z-score); HR/RR are auxiliary signals.
    const qHrv = clamp(Number(q.hrv ?? 0), 0, 1);
    const zHrv0 = zHrv === null ? 0 : clamp(zHrv, -3, 3);
    const hrvDelta = tanh(zHrv0 / 1.7);
    const hrvFactorRaw = 1 + 0.38 * hrvDelta;
    const hrvFactor = clamp(lerp(0.9, hrvFactorRaw, qHrv), 0.7, 1.35);

    let hrFactor = 1;
    const qHr = clamp(Number(q.hr ?? 0), 0, 1);
    if (hr !== null && Number.isFinite(rhr) && qHr > 0) {
      const hrDelta = Number(rhr) - hr;
      hrFactor = 1 + 0.05 * tanh(hrDelta / 10) * qHr;
      hrFactor = clamp(hrFactor, 0.93, 1.07);
    }

    let rrFactor = 1;
    const qRr = clamp(Number(q.rr ?? 0), 0, 1);
    if (rr !== null && Number.isFinite(rrScale) && rrScale > 0 && qRr > 0) {
      const rrHigh = relu((rr - Number(baselines.respRateBrpm)) / (2 * rrScale));
      rrFactor = 1 - 0.04 * clamp(rrHigh, 0, 3) * qRr;
      rrFactor = clamp(rrFactor, 0.88, 1);
    }

    // Reference penalties: temperature/SpO2 dominate; RR is down-weighted (auxiliary).
    const sleepPenaltyIndex = 1.0 * spo2PenaltyEff + 0.25 * rrPenaltyEff + tempAnomWeight * tempHarmIndex;
    const sleepAnomPenalty = Math.exp(-0.10 * sleepPenaltyIndex);

    let sleepRecovery = stageFactor * sleepArchFactor * hrvFactor * hrFactor * rrFactor * sleepAnomPenalty;
    if (isSleep && tempOnsetBenefitIndex > 0) sleepRecovery *= 1 + onsetBoost * tempOnsetBenefitIndex;

    const sleepQualityExp = clamp(toNumberOrNull(params.sleepRecoveryExponent) ?? 1, 0.5, 3);
    sleepRecovery = clamp(sleepRecovery, 0, 2.0);
    if (isSleep && sleepRecovery > 0) sleepRecovery = clamp(Math.pow(sleepRecovery, sleepQualityExp), 0, 2.0);

    let restRecoveryRaw = 0;
    if (context.kind === "AWAKE_REST" || context.kind === "AWAKE" || context.kind === "POST_ACTIVITY_RECOVERY") {
      const hrRelax =
        hr === null || !Number.isFinite(rhr) ? 0.6 : clamp((rhr + 15 - hr) / 15, 0, 1);
      const stepRelax = clamp((10 - stepsPerMin) / 10, 0, 1);
      const hrvBonus = zHrv === null ? 0 : clamp(zHrv / 2, 0, 0.9);
      restRecoveryRaw = clamp(0.5 * hrRelax + 0.25 * stepRelax + 0.35 * hrvBonus, 0, 1.5);
    }
    let restRecovery = restRecoveryRaw;

    let mindRecovery = 0;
    const mindful = Boolean(epoch.mindful ?? epoch.mindfulness ?? epoch.isMindful);
    if (mindful || context.kind === "MEDITATION") {
      const hrRelax =
        hr === null || !Number.isFinite(rhr) ? 0.6 : clamp((rhr + 18 - hr) / 18, 0, 1);
      const hrvBonus = zHrv === null ? 0 : clamp(zHrv / 2, 0, 1.0);
      mindRecovery = clamp(0.65 + 0.35 * hrRelax + 0.35 * hrvBonus, 0, 1.8);
    }

    const isWorkout = context.kind === "WORKOUT";
    const isHigh = context.kind === "HIGH_ACTIVITY";
    const isActive = context.kind === "ACTIVE";
    const isLight = context.kind === "LIGHT_ACTIVITY";

    const loadExponent = clamp(isWorkout ? 1.55 : isHigh ? 1.45 : isActive ? 1.25 : isLight ? 1.15 : 1.05, 1, 2);
    const loadMaxRaw = isWorkout
      ? params.loadDrainWorkoutMaxPerHour
      : isHigh
        ? params.loadDrainHighMaxPerHour
        : isActive
          ? params.loadDrainActiveMaxPerHour
          : isLight
            ? params.loadDrainLightMaxPerHour
            : params.loadDrainInactiveMaxPerHour;
    const loadMaxN = Number(loadMaxRaw);
    const loadMax = Number.isFinite(loadMaxN) ? Math.max(0, loadMaxN) : 0;
    const loadRate = loadMax * Math.pow(intensityForLoad, loadExponent);

    const hrExcessExpected =
      hr === null || !Number.isFinite(rhr)
        ? 0
        : relu(hr - (rhr + 10 + 70 * activityIdx));
    const stressFromHr = hrExcessExpected / 10;
    const stressFromHrv = zHrv === null ? 0 : relu(-zHrv);
    const restElev =
      (context.kind === "AWAKE_REST" || context.kind === "AWAKE" || context.kind === "POST_ACTIVITY_RECOVERY") &&
      hr !== null &&
      Number.isFinite(rhr)
        ? relu((hr - (rhr + 5)) / 5)
        : 0;
    const stressIndex = clamp(1.1 * stressFromHrv + 0.35 * stressFromHr + 0.2 * restElev, 0, 5);
    const stressRate = clamp(
      params.stressDrainPerIndexPerHour * stressIndex,
      0,
      params.stressDrainMaxPerHour,
    );

    const anomRate = clamp(
      params.anomDrainPerIndexPerHour * anomIndex,
      0,
      params.anomDrainMaxPerHour,
    );

    // Rest vs inactive: decide whether BB should "charge" during low activity, and how much.
    // Goal: allow small recovery during true relaxation, but prevent BB rising while physiologically stressed.
    let restDecision = null;
    if (context.kind === "AWAKE_REST" || context.kind === "AWAKE") {
      const potential01 = clamp(restRecoveryRaw / 1.2, 0, 1);
      const minPotential01 = clamp(Number(params.restChargeMinPotential01 ?? 0.2), 0, 1);
      const stressMax = clamp(Number(params.restChargeStressIndexMax ?? 1.8), 0, 5);
      const anomMax = Math.max(0, Number(params.restChargeAnomIndexMax ?? 1.2));
      const gainExp = clamp(Number(params.restChargeGainExponent ?? 1.25), 0.5, 3);

      const allowCharge = potential01 >= minPotential01 && stressIndex <= stressMax && anomIndex <= anomMax;
      const gainScale = allowCharge ? clamp(Math.pow(potential01, gainExp), 0, 1) : 0;

      restRecovery = allowCharge ? restRecoveryRaw * gainScale : 0;
      restDecision = { allowCharge, potential01, gainScale, stressIndex, anomIndex };
    }

    const qLoad = clamp(Math.max(q.steps ?? 0, q.energy ?? 0, q.power ?? 0, q.hr ?? 0), 0, 1);
    const qStress = clamp(Math.max(q.hrv ?? 0, q.hr ?? 0), 0, 1);
    const qAnom = clamp(Math.max(q.spo2 ?? 0, q.rr ?? 0, q.temp ?? 0), 0, 1);
    const qSleep = clamp(0.55 * (q.hrv ?? 0) + 0.35 * (q.hr ?? 0) + 0.1 * qAnom, 0, 1);
    const qRest = clamp(0.35 + 0.45 * (q.hr ?? 0) + 0.2 * (q.steps ?? 0), 0, 1);
    const qMind = clamp(0.35 + 0.4 * (q.hr ?? 0) + 0.25 * (q.hrv ?? 0), 0, 1);

    const respDiscomfortIndex = 0.9 * spo2PenaltyEff + 0.6 * rrPenaltyEff;
    const thermalDiscomfortIndex = tempOverheatIndex + 0.6 * tempFeverIndex;
    const discomfortIndex = thermalDiscomfortIndex + 0.5 * respDiscomfortIndex;
    const comfortPenaltyPerIndex = clamp(Number(params.comfortPenaltyPerIndex ?? 12), 0, 50);
    const comfortScore = clamp(100 - comfortPenaltyPerIndex * discomfortIndex, 0, 100);

    return {
      values: { hr, hrv, spo2, rr, temp, steps, activeEnergy, power },
      z: { zHrv },
      activity: {
        stepsPerMin,
        energyPerMin,
        stepsIdx,
        energyIdx,
        powerIdx,
        hrIdx,
        activityIdx,
        movementIntensity,
        intensity: intensityForLoad,
        hasActivitySignal,
      },
      recovery: {
        sleepRecovery,
        restRecovery,
        mindRecovery,
        anomIndex,
        restDecision,
        anomBreakdown: {
          spo2: spo2PenaltyEff,
          rr: rrPenaltyEff,
          temp: tempHarmIndex,
        },
      },
      temperature: {
        deltaC: tempDeltaC,
        mode: tempMode,
        onsetBenefitIndex: tempOnsetBenefitIndex,
        overheatIndex: tempOverheatIndex,
        feverIndex: tempFeverIndex,
        harmIndex: tempHarmIndex,
        heatLikely: tempHeatLikely,
        physioHeatStress01,
        sleepMinutesFromStart,
      },
      comfortScore,
      drainRates: { loadRate, stressRate, anomRate },
      componentQuality: {
        charge: { sleep: qSleep, rest: qRest, mind: qMind },
        drain: { load: qLoad, stress: qStress, anom: qAnom },
      },
    };
  }

  function computeEpoch(dtHours, bb, context, indices, params, baseWeights, extraChargePerHour) {
    const sat = saturationFactor(bb, params.saturationExponent);

    const chargeGate = gateWeights(baseWeights.charge, indices.componentQuality.charge, params.minChargeScale);
    const drainGate = gateWeights(baseWeights.drain, indices.componentQuality.drain, params.minDrainScale);

    const sleepDurationWeight = clamp(toNumberOrNull(params.sleepChargeDurationWeight) ?? 1, 0, 1.5);
    const rawChargePerHour =
      sleepDurationWeight * chargeGate.weights.sleep * params.baseSleepChargePerHour * indices.recovery.sleepRecovery +
      chargeGate.weights.rest * params.baseRestChargePerHour * indices.recovery.restRecovery +
      chargeGate.weights.mind * params.baseMindChargePerHour * indices.recovery.mindRecovery;

    const extraCharge = Number.isFinite(extraChargePerHour) ? Math.max(0, extraChargePerHour) : 0;
    const chargePerHourCore = sat * chargeGate.groupScale * rawChargePerHour;
    const chargePerHourExtra = sat * extraCharge;
    const chargePerHour = chargePerHourCore + chargePerHourExtra;

    const rawDrainPerHour =
      drainGate.weights.load * indices.drainRates.loadRate +
      drainGate.weights.stress * indices.drainRates.stressRate +
      drainGate.weights.anom * indices.drainRates.anomRate;

    const drainPerHour = drainGate.groupScale * rawDrainPerHour;

    const chargePointsCore = dtHours * chargePerHourCore;
    const chargePointsExtra = dtHours * chargePerHourExtra;
    const chargePoints = chargePointsCore + chargePointsExtra;
    const drainPoints = dtHours * drainPerHour;

    const rawDelta = chargePoints - drainPoints;
    const maxDelta = (params.maxDeltaPerHour * dtHours) || 0;
    const deltaCore = clamp(rawDelta, -maxDelta, maxDelta);

    const nextBB = clamp(bb + deltaCore, 0, 100);

    const contextFloor =
      context.kind === "SLEEP" ? 0.35 : context.kind === "WORKOUT" ? 0.25 : params.confidenceFloor;
    const confidenceBase = 0.5 * chargeGate.groupQuality + 0.5 * drainGate.groupQuality;
    const confidence = clamp(contextFloor + (1 - contextFloor) * confidenceBase, 0, 1);

    return {
      sat,
      chargeGate,
      drainGate,
      rawChargePerHour,
      rawDrainPerHour,
      chargePerHour,
      chargePerHourCore,
      chargePerHourExtra,
      drainPerHour,
      chargePoints,
      chargePointsCore,
      chargePointsExtra,
      drainPoints,
      deltaCore,
      nextBB,
      confidence,
    };
  }

  function computeCalmRecovery(input) {
    const p = input?.params || {};

    const prev = input?.prev || null;
    const curr = input?.curr || null;
    const dtMinutes = Number(input?.dtMinutes);

    const minutesSinceActiveEnd = input?.minutesSinceActiveEnd;
    const recoveryMinutes = Number(input?.recoveryMinutes ?? 0);
    const lastActiveIntensity01 = clamp(Number(input?.lastActiveIntensity01 ?? 0), 0, 1);

    const windowMinutes = clamp(Number(p.postActivityRecoveryWindowMinutes ?? 90), 15, 240);
    const maxMinutes = clamp(Number(p.postActivityRecoveryMaxMinutes ?? 45), 5, 180);
    const maxChargePerHour = Math.max(0, Number(p.postActivityRecoveryChargeMaxPerHour ?? 4));
    const maxMove01 = clamp(Number(p.postActivityRecoveryMaxMovementIntensity01 ?? 0.15), 0, 1);
    const minIndex = clamp(Number(p.postActivityRecoveryMinIndex ?? 0.12), 0, 1);

    const out = {
      index: 0,
      chargePerHour: 0,
      signal01: 0,
      windowFactor: 0,
      durationFactor: 0,
      intensityFactor: 0,
      minutesSinceActiveEnd: minutesSinceActiveEnd ?? null,
      recoveryMinutes: Number.isFinite(recoveryMinutes) ? recoveryMinutes : 0,
      lastActiveIntensity01,
      debug: {},
    };

    if (!prev || !curr) return out;
    if (!Number.isFinite(dtMinutes) || dtMinutes <= 0) return out;
    if (minutesSinceActiveEnd === null || minutesSinceActiveEnd === undefined) return out;
    if (!Number.isFinite(Number(minutesSinceActiveEnd))) return out;
    if (Number(minutesSinceActiveEnd) > windowMinutes) return out;
    if (recoveryMinutes >= maxMinutes) return out;
    if (curr.contextKind === "SLEEP") return out;
    if (curr.temperature?.heatLikely) return out;
    if (clamp(Number(curr.movementIntensity01 ?? 0), 0, 1) > maxMove01) return out;
    if (lastActiveIntensity01 <= 0) return out;

    const qPrev = prev.q || {};
    const qCurr = curr.q || {};

    const debug = {};
    function qMin(a, b) {
      return clamp(Math.min(clamp(Number(a ?? 0), 0, 1), clamp(Number(b ?? 0), 0, 1)), 0, 1);
    }

    let hrDrop01 = null;
    if (Number.isFinite(prev.hr) && Number.isFinite(curr.hr)) {
      const dropPerMin = (Number(prev.hr) - Number(curr.hr)) / dtMinutes;
      const denom = Math.max(0.5, Number(p.postActivityRecoveryHrDropBpmPerMinForMax ?? 3));
      const q = qMin(qPrev.hr, qCurr.hr);
      hrDrop01 = clamp(dropPerMin / denom, 0, 1) * q;
      debug.hrDropPerMin = dropPerMin;
      debug.hrDrop01 = hrDrop01;
    }

    let hrvRise01 = null;
    if (Number.isFinite(prev.zHrv) && Number.isFinite(curr.zHrv)) {
      const rise = Number(curr.zHrv) - Number(prev.zHrv);
      const denom = Math.max(0.2, Number(p.postActivityRecoveryHrvRiseZForMax ?? 0.8));
      const q = qMin(qPrev.hrv, qCurr.hrv);
      hrvRise01 = clamp(rise / denom, 0, 1) * q;
      debug.hrvRiseZ = rise;
      debug.hrvRise01 = hrvRise01;
    }

    let metabolicDrop01 = null;
    let metabolicBest = 0;
    let metabolicFound = false;

    if (Number.isFinite(prev.energyPerMin) && Number.isFinite(curr.energyPerMin)) {
      const q = qMin(qPrev.energy, qCurr.energy);
      if (q > 0) {
        const drop = Number(prev.energyPerMin) - Number(curr.energyPerMin);
        const denom = Math.max(0.5, Number(p.postActivityRecoveryEnergyDropKcalPerMinForMax ?? 6));
        const v = clamp(drop / denom, 0, 1) * q;
        metabolicBest = Math.max(metabolicBest, v);
        metabolicFound = true;
        debug.energyDropKcalPerMin = drop;
      }
    }

    if (Number.isFinite(prev.stepsPerMin) && Number.isFinite(curr.stepsPerMin)) {
      const q = qMin(qPrev.steps, qCurr.steps);
      if (q > 0) {
        const drop = Number(prev.stepsPerMin) - Number(curr.stepsPerMin);
        const denom = Math.max(5, Number(p.postActivityRecoveryStepsDropPerMinForMax ?? 60));
        const v = clamp(drop / denom, 0, 1) * q;
        metabolicBest = Math.max(metabolicBest, v);
        metabolicFound = true;
        debug.stepsDropPerMin = drop;
      }
    }

    if (metabolicFound) {
      metabolicDrop01 = metabolicBest;
      debug.metabolicDrop01 = metabolicDrop01;
    }

    let sumW = 0;
    let sum = 0;
    function addSignal(name, value01, weight) {
      if (value01 === null || value01 === undefined) return;
      const v = clamp(Number(value01), 0, 1);
      if (!Number.isFinite(v) || v <= 0) return;
      sumW += weight;
      sum += weight * v;
      debug[name] = v;
    }

    addSignal("hrDrop01", hrDrop01, 0.55);
    addSignal("hrvRise01", hrvRise01, 0.25);
    addSignal("metabolicDrop01", metabolicDrop01, 0.2);

    if (sumW <= 0) {
      out.debug = debug;
      return out;
    }

    const signal01 = clamp(sum / sumW, 0, 1);
    const windowFactor = clamp(1 - Number(minutesSinceActiveEnd) / windowMinutes, 0, 1);
    const durationFactor = clamp(1 - recoveryMinutes / maxMinutes, 0, 1);
    const intensityFactor = clamp(lastActiveIntensity01 / 0.6, 0, 1);
    const index = signal01 * windowFactor * durationFactor * intensityFactor;

    out.signal01 = signal01;
    out.windowFactor = windowFactor;
    out.durationFactor = durationFactor;
    out.intensityFactor = intensityFactor;
    out.debug = debug;

    if (index < minIndex) return out;

    out.index = clamp(index, 0, 1);
    out.chargePerHour = maxChargePerHour * out.index;
    return out;
  }

  function computeSeries(userConfig) {
    const { params } = mergeConfig(userConfig);
    const epochs = Array.isArray(userConfig?.epochs) ? userConfig.epochs.slice() : [];

    const baselines =
      userConfig?.baselines && typeof userConfig.baselines === "object"
        ? { ...defaultBaselines(), ...userConfig.baselines }
        : inferBaselinesFromEpochs(epochs, params.epochMinutes);

    epochs.sort((a, b) => (parseTimestampMs(a) ?? 0) - (parseTimestampMs(b) ?? 0));

    const behaviorBaselineCfg = readBehaviorBaselineConfig(userConfig);
    const timeline = buildContextTimeline(epochs, params, baselines);
    const { segments: contextSegments, segmentOf: segmentOfEpoch } = buildContextSegments(epochs, timeline, baselines);
    const sleepArchitecture = buildSleepArchitectureFactorByEpoch(timeline, 90);
    const sleepArchitectureFactorOfEpoch = sleepArchitecture.factorOfEpoch;
    const behaviorBaseline = behaviorBaselineCfg.enabled
      ? buildBehaviorBaselineFromSegments(contextSegments, timeline, behaviorBaselineCfg)
      : null;
    if (behaviorBaselineCfg.enabled) attachBehaviorScalesToSegments(contextSegments, behaviorBaseline, behaviorBaselineCfg);
    const behaviorApplyFromTsMs = behaviorBaseline?.ready ? behaviorBaseline.windowEndTsMs : null;

    let bb = clamp(params.initialBB, 0, 100);
    let prevContextKind = null;
    let sleepMinutesFromStart = null;
    let sleepHeatStreakMinutes = 0;
    let activeLikePrev = false;
    let minutesSinceActiveEnd = null;
    let recoveryMinutes = 0;
    let lastActiveIntensity01 = 0;
    let prevSignals = null;

    const carry = {
      hr: { value: null, ageMin: null, lastKind: null },
      hrv: { value: null, ageMin: null, lastKind: null },
      spo2: { value: null, ageMin: null, lastKind: null },
      rr: { value: null, ageMin: null, lastKind: null },
      temp: { value: null, ageMin: null, lastKind: null },
    };

    function tickCarry(slot, rawValue, dtMinutes, contextKind) {
      if (rawValue === null || rawValue === undefined) {
        if (slot.value === null || slot.value === undefined) return;
        const age = Number.isFinite(slot.ageMin) ? Number(slot.ageMin) : 0;
        slot.ageMin = age + Math.max(0, Number(dtMinutes) || 0);
        return;
      }
      slot.value = rawValue;
      slot.ageMin = 0;
      slot.lastKind = contextKind ?? null;
    }

    function maybeImpute(rawValue, slot, options) {
      if (rawValue !== null && rawValue !== undefined) return { value: rawValue, q: null, imputed: false };
      const allow = Boolean(options?.allow ?? true);
      if (!allow) return { value: null, q: 0, imputed: false };

      const maxGapMin = Number(options?.maxGapMin ?? 0);
      const qFresh = clamp(Number(options?.qFresh ?? 0), 0, 1);
      const requireLastKind = options?.requireLastKind ?? null;
      if (!Number.isFinite(maxGapMin) || maxGapMin <= 0) return { value: null, q: 0, imputed: false };
      if (qFresh <= 0) return { value: null, q: 0, imputed: false };
      if (slot?.value === null || slot?.value === undefined) return { value: null, q: 0, imputed: false };
      if (requireLastKind && slot?.lastKind !== requireLastKind) return { value: null, q: 0, imputed: false };

      const ageMin = Number(slot?.ageMin ?? 0);
      if (!Number.isFinite(ageMin) || ageMin < 0 || ageMin > maxGapMin) return { value: null, q: 0, imputed: false };

      const freshness = clamp(1 - ageMin / maxGapMin, 0, 1);
      return { value: slot.value, q: clamp(qFresh * freshness, 0, 1), imputed: true };
    }

    const out = [];
    for (let i = 0; i < epochs.length; i++) {
      const e = epochs[i];
      const t = timeline[i] || {};
      const ts = t.tsMs ?? null;
      const dtHours = Number.isFinite(Number(t.dtHours)) ? Number(t.dtHours) : params.epochMinutes / 60;
      const dtMinutes = Number.isFinite(Number(t.dtMinutes)) ? Number(t.dtMinutes) : dtHours * 60;
      const dtCarryMinutes = Number.isFinite(Number(t.dtObservedMinutes)) ? Number(t.dtObservedMinutes) : dtMinutes;

      const context0 =
        t.context0 && typeof t.context0 === "object" ? t.context0 : classifyContext(e, baselines, params.epochMinutes, params);

      const qRaw = computeQuality(e, baselines);

      const rawHr = toNumberOrNull(e.hrBpm ?? e.hr);
      const rawHrv = toNumberOrNull(e.hrvSdnnMs ?? e.hrvMs ?? e.hrv);
      const rawSpo2 = asPercentMaybe(e.spo2Pct ?? e.spo2);
      const rawRr = toNumberOrNull(e.respRateBrpm ?? e.respiratoryRate ?? e.rr);
      const rawTemp = toNumberOrNull(e.wristTempC ?? e.tempC ?? e.temp);

      tickCarry(carry.hr, rawHr, dtCarryMinutes, context0.kind);
      tickCarry(carry.hrv, rawHrv, dtCarryMinutes, context0.kind);
      tickCarry(carry.spo2, rawSpo2, dtCarryMinutes, context0.kind);
      tickCarry(carry.rr, rawRr, dtCarryMinutes, context0.kind);
      tickCarry(carry.temp, rawTemp, dtCarryMinutes, context0.kind);

      const allowSleepVitals = context0.kind === "SLEEP";
      const hrImp = maybeImpute(rawHr, carry.hr, {
        allow: true,
        maxGapMin: params.imputeHrMaxGapMinutes,
        qFresh: params.imputeHrQualityAtFresh,
      });
      const hrvImp = maybeImpute(rawHrv, carry.hrv, {
        allow: true,
        maxGapMin: params.imputeHrvMaxGapMinutes,
        qFresh: params.imputeHrvQualityAtFresh,
      });
      const spo2Imp = maybeImpute(rawSpo2, carry.spo2, {
        allow: allowSleepVitals,
        requireLastKind: "SLEEP",
        maxGapMin: params.imputeSpo2MaxGapMinutes,
        qFresh: params.imputeSpo2QualityAtFresh,
      });
      const rrImp = maybeImpute(rawRr, carry.rr, {
        allow: allowSleepVitals,
        requireLastKind: "SLEEP",
        maxGapMin: params.imputeRrMaxGapMinutes,
        qFresh: params.imputeRrQualityAtFresh,
      });
      const tempImp = maybeImpute(rawTemp, carry.temp, {
        allow: allowSleepVitals,
        requireLastKind: "SLEEP",
        maxGapMin: params.imputeTempMaxGapMinutes,
        qFresh: params.imputeTempQualityAtFresh,
      });

      let eEff = e;
      let q = qRaw;
      const setEpoch = (k, v) => {
        if (eEff === e) eEff = { ...e };
        eEff[k] = v;
      };
      const setQ = (k, v) => {
        if (q === qRaw) q = { ...qRaw };
        q[k] = v;
      };

      if (hrImp.imputed) {
        setEpoch("hrBpm", hrImp.value);
        setQ("hr", hrImp.q);
      }
      if (hrvImp.imputed) {
        setEpoch("hrvSdnnMs", hrvImp.value);
        setQ("hrv", hrvImp.q);
      }
      if (spo2Imp.imputed) {
        setEpoch("spo2Pct", spo2Imp.value);
        setQ("spo2", spo2Imp.q);
      }
      if (rrImp.imputed) {
        setEpoch("respRateBrpm", rrImp.value);
        setQ("rr", rrImp.q);
      }
      if (tempImp.imputed) {
        setEpoch("wristTempC", tempImp.value);
        setQ("temp", tempImp.q);
      }

      if (context0.kind === "SLEEP") {
        if (prevContextKind !== "SLEEP") {
          sleepMinutesFromStart = 0;
          sleepHeatStreakMinutes = 0;
        } else {
          sleepMinutesFromStart = (sleepMinutesFromStart ?? 0) + dtMinutes;
        }
      } else {
        sleepMinutesFromStart = null;
        sleepHeatStreakMinutes = 0;
      }

      const indices = computeIndices(eEff, context0, baselines, params, q, dtMinutes, {
        sleepMinutesFromStart,
        sleepHeatStreakMinutes,
        sleepArchitectureFactor: sleepArchitectureFactorOfEpoch[i],
      });

      const activeThreshold = clamp(Number(params.postActivityRecoveryMinActivityIntensity01 ?? 0.25), 0, 1);
      const isActiveLikeNow =
        context0.kind === "WORKOUT" || clamp(Number(indices.activity.movementIntensity ?? 0), 0, 1) >= activeThreshold;
      if (isActiveLikeNow) {
        minutesSinceActiveEnd = null;
        recoveryMinutes = 0;
        lastActiveIntensity01 = clamp(
          Math.max(Number(indices.activity.movementIntensity ?? 0), Number(indices.activity.hrIdx ?? 0)),
          0,
          1,
        );
      } else {
        if (activeLikePrev) {
          minutesSinceActiveEnd = 0;
          recoveryMinutes = 0;
        } else if (minutesSinceActiveEnd !== null) {
          minutesSinceActiveEnd += dtMinutes;
        }
        const win = clamp(Number(params.postActivityRecoveryWindowMinutes ?? 90), 15, 240);
        if (minutesSinceActiveEnd !== null && minutesSinceActiveEnd > win) {
          minutesSinceActiveEnd = null;
          recoveryMinutes = 0;
          lastActiveIntensity01 = 0;
        }
      }

      const calm = computeCalmRecovery({
        prev: prevSignals,
        curr: {
          hr: indices.values.hr,
          zHrv: indices.z.zHrv,
          stepsPerMin: indices.activity.stepsPerMin,
          energyPerMin: indices.activity.energyPerMin,
          power: indices.values.power,
          movementIntensity01: indices.activity.movementIntensity,
          hasActivitySignal: indices.activity.hasActivitySignal,
          q,
          temperature: indices.temperature,
          contextKind: context0.kind,
        },
        minutesSinceActiveEnd,
        recoveryMinutes,
        lastActiveIntensity01,
        dtMinutes,
        params,
      });

      let indicesForStep = indices;
      let stressSuppressionFactor = 1;
      if (calm.index > 0) {
        const pow = clamp(Number(params.postActivityRecoveryStressSuppressionPower ?? 2), 1, 4);
        const minF = clamp(Number(params.postActivityRecoveryStressSuppressionMinFactor ?? 0.08), 0, 1);
        const base = 1 - clamp(Number(calm.signal01 ?? calm.index), 0, 1);
        stressSuppressionFactor = clamp(Math.pow(base, pow), minF, 1);
        indicesForStep = {
          ...indices,
          drainRates: {
            ...indices.drainRates,
            stressRate: indices.drainRates.stressRate * stressSuppressionFactor,
          },
        };
      }

      let context = context0;
      if (calm.index > 0) {
        context = { kind: "POST_ACTIVITY_RECOVERY", sourceKind: context0.kind };
      }
      const weights = ruleWeights(context);

      let indicesApplied = indicesForStep;
      let behavior = null;
      const segId = segmentOfEpoch[i];
      const seg = segId !== null && segId !== undefined ? contextSegments[segId] : null;
      const behaviorActive =
        behaviorApplyFromTsMs !== null &&
        behaviorApplyFromTsMs !== undefined &&
        ts !== null &&
        ts !== undefined &&
        Number.isFinite(ts) &&
        Number.isFinite(Number(behaviorApplyFromTsMs)) &&
        ts >= Number(behaviorApplyFromTsMs) &&
        Boolean(behaviorBaseline?.ready);

      if (behaviorActive && seg && seg.scales) {
        if (context.kind === "SLEEP") {
          const scale = Number(seg.scales?.sleep?.scale ?? 1);
          if (Number.isFinite(scale) && scale !== 1) {
            indicesApplied = {
              ...indicesApplied,
              recovery: {
                ...indicesApplied.recovery,
                sleepRecovery: indicesApplied.recovery.sleepRecovery * scale,
              },
            };
          }
        }

        if (context.kind === "WORKOUT") {
          const scale = Number(seg.scales?.workout?.scale ?? 1);
          if (Number.isFinite(scale) && scale !== 1) {
            indicesApplied = {
              ...indicesApplied,
              drainRates: {
                ...indicesApplied.drainRates,
                loadRate: indicesApplied.drainRates.loadRate * scale,
              },
            };
          }
        }

        behavior = {
          applied: true,
          applyFromTsMs: behaviorApplyFromTsMs,
          segmentId: seg.id,
          segmentKind: seg.kind,
          segmentDurationMinutes: seg.durationMinutes,
          scales: seg.scales,
        };
      } else if (behaviorBaselineCfg.enabled) {
        behavior = {
          applied: false,
          applyFromTsMs: behaviorApplyFromTsMs,
          segmentId: seg?.id ?? null,
          segmentKind: seg?.kind ?? null,
          segmentDurationMinutes: seg?.durationMinutes ?? null,
          scales: seg?.scales ?? null,
        };
      }

      const step = computeEpoch(dtHours, bb, context, indicesApplied, params, weights, calm.chargePerHour);
      const fatigueScale = Math.max(1e-6, Number(params.fatigueDrainPerHourFor100 ?? 40));
      const fatigueScore = clamp(100 * (step.drainPerHour / fatigueScale), 0, 100);
      if (context.kind === "SLEEP") {
        if (indices.temperature?.heatLikely) sleepHeatStreakMinutes += dtMinutes;
        else sleepHeatStreakMinutes = 0;
      }
      prevContextKind = context.kind;
      activeLikePrev = isActiveLikeNow;
      const maxRec = clamp(Number(params.postActivityRecoveryMaxMinutes ?? 45), 5, 180);
      if (calm.index > 0) recoveryMinutes = Math.min(recoveryMinutes + dtMinutes, maxRec);
      else if (minutesSinceActiveEnd !== null) recoveryMinutes = 0;
      prevSignals = {
        hr: indices.values.hr,
        zHrv: indices.z.zHrv,
        stepsPerMin: indices.activity.stepsPerMin,
        energyPerMin: indices.activity.energyPerMin,
        power: indices.values.power,
        q,
      };

      const row = {
        i,
        tsMs: ts,
        iso: ts === null ? null : new Date(ts).toISOString(),
        dtMinutes,
        bb,
        bbNext: step.nextBB,
        reserveScore: step.nextBB,
        comfortScore: indices.comfortScore,
        fatigueScore,
        deltaCore: step.deltaCore,
        chargePoints: step.chargePoints,
        drainPoints: step.drainPoints,
        chargePerHour: step.chargePerHour,
        drainPerHour: step.drainPerHour,
        chargeComponents: {
          sleep: indicesApplied.recovery.sleepRecovery,
          rest: indicesApplied.recovery.restRecovery,
          mind: indicesApplied.recovery.mindRecovery,
          calmRecoveryIndex: calm.index,
          calmRecoveryChargePerHour: calm.chargePerHour,
          calmRecoveryPoints: step.chargePointsExtra,
        },
        drainComponents: {
          loadPerHour: indicesApplied.drainRates.loadRate,
          stressPerHour: indicesApplied.drainRates.stressRate,
          anomPerHour: indicesApplied.drainRates.anomRate,
          anomIndex: indices.recovery.anomIndex,
          anomBreakdown: indices.recovery.anomBreakdown,
        },
        temperature: indices.temperature,
        calmRecovery: { ...calm, stressSuppressionFactor },
        weights: {
          charge: step.chargeGate.weights,
          drain: step.drainGate.weights,
        },
        sleepArchitectureFactor: sleepArchitectureFactorOfEpoch[i],
        quality: q,
        confidence: step.confidence,
        context,
        behavior,
        input: indices.values,
      };
      out.push(row);
      bb = step.nextBB;
    }

    const summary = summarize(out);

    return {
      version: VERSION,
      params,
      baselines,
      behaviorBaseline: behaviorBaselineCfg.enabled ? behaviorBaseline : null,
      series: out,
      summary,
    };
  }

  function readThreeKernelConfig(userConfig) {
    const raw = userConfig?.threeKernel;
    if (!raw || typeof raw !== "object") return { enabled: false };
    const enabled = Boolean(raw.enabled ?? raw.enable ?? raw.on);
    if (!enabled) return { enabled: false };

    const wCore0 = toNumberOrNull(raw.weightCore ?? raw.wCore ?? raw.w1 ?? 0.9) ?? 0.9;
    const wTrend0 = toNumberOrNull(raw.weightTrend ?? raw.wTrend ?? raw.w2 ?? 0.1) ?? 0.1;
    const sum = Math.max(1e-6, wCore0 + wTrend0);
    const weightCore = clamp(wCore0 / sum, 0, 1);
    const weightTrend = clamp(wTrend0 / sum, 0, 1);

    const forecastHours = clamp(toNumberOrNull(raw.forecastHours ?? raw.horizonHours) ?? 0, 0, 168);

    const binMinutes = clamp(toNumberOrNull(raw.binMinutes) ?? 60, 10, 240);
    const minTrainSamples = clamp(toNumberOrNull(raw.minTrainSamples) ?? 240, 50, 5000);
    const maxTrainSamples = clamp(toNumberOrNull(raw.maxTrainSamples) ?? 4000, 200, 20000);

    const hiddenSize = clamp(toNumberOrNull(raw.hiddenSize) ?? 8, 2, 32);
    const epochs = clamp(toNumberOrNull(raw.trainEpochs) ?? 40, 1, 400);
    const learningRate = clamp(toNumberOrNull(raw.learningRate) ?? 0.03, 0.001, 0.2);
    const l2 = clamp(toNumberOrNull(raw.l2) ?? 0.0008, 0, 0.05);

    return {
      enabled: true,
      weightCore,
      weightTrend,
      forecastHours,
      binMinutes,
      minTrainSamples,
      maxTrainSamples,
      hiddenSize,
      epochs,
      learningRate,
      l2,
    };
  }

  function dayBinIndex(tsMs, binMinutes) {
    if (!Number.isFinite(tsMs)) return 0;
    const d = new Date(tsMs);
    const minutes = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    const binMin = Math.max(1, Number(binMinutes) || 60);
    const bins = Math.max(1, Math.round((24 * 60) / binMin));
    const idx = Math.floor(minutes / binMin);
    return clamp(idx, 0, bins - 1);
  }

  function buildSleepProbByBin(series, binMinutes) {
    const binMin = Math.max(1, Number(binMinutes) || 60);
    const bins = Math.max(1, Math.round((24 * 60) / binMin));
    const total = new Array(bins).fill(0);
    const sleep = new Array(bins).fill(0);

    for (const r of series || []) {
      const ts = Number(r?.tsMs);
      if (!Number.isFinite(ts)) continue;
      const b = dayBinIndex(ts, binMin);
      total[b] += 1;
      if (r?.context?.kind === "SLEEP") sleep[b] += 1;
    }

    const alpha = 1;
    const out = new Array(bins).fill(0);
    for (let i = 0; i < bins; i++) {
      const t = total[i];
      const s = sleep[i];
      out[i] = (s + alpha) / (t + 2 * alpha);
    }
    return { binMinutes: binMin, pSleep: out };
  }

  function buildMeanDeltaNormByBin(series, params, binMinutes) {
    const binMin = Math.max(1, Number(binMinutes) || 60);
    const bins = Math.max(1, Math.round((24 * 60) / binMin));
    const sum = new Array(bins).fill(0);
    const wsum = new Array(bins).fill(0);

    const maxDeltaPerHour = Number(params?.maxDeltaPerHour ?? 0);
    if (!Number.isFinite(maxDeltaPerHour) || maxDeltaPerHour <= 0) {
      return { binMinutes: binMin, meanDeltaNorm: new Array(bins).fill(0) };
    }

    for (const r of series || []) {
      const ts = Number(r?.tsMs);
      if (!Number.isFinite(ts)) continue;
      const dtMin = Number(r?.dtMinutes ?? params?.epochMinutes ?? 5);
      if (!Number.isFinite(dtMin) || dtMin <= 0) continue;
      const dtHours = dtMin / 60;
      const maxDelta = maxDeltaPerHour * dtHours;
      if (!Number.isFinite(maxDelta) || maxDelta <= 1e-6) continue;

      const bb0 = Number(r?.bb);
      const bb1 = Number(r?.bbNext);
      if (!Number.isFinite(bb0) || !Number.isFinite(bb1)) continue;
      const y = clamp((bb1 - bb0) / maxDelta, -1, 1);

      const w = clamp(Number(r?.confidence ?? 0.6), 0, 1);
      const b = dayBinIndex(ts, binMin);
      sum[b] += y * w;
      wsum[b] += w;
    }

    const out = new Array(bins).fill(0);
    for (let i = 0; i < bins; i++) {
      out[i] = wsum[i] > 1e-6 ? sum[i] / wsum[i] : 0;
    }
    return { binMinutes: binMin, meanDeltaNorm: out };
  }

  function trendFeatureVector(bb, lastDeltaNorm, tsMs, sleepProbByBin) {
    const bb01 = clamp(Number(bb) / 100, 0, 1);
    const bbC = bb01 * 2 - 1;
    const d = Number.isFinite(tsMs) ? new Date(tsMs) : null;
    const minutes = d ? d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 : 0;
    const phase = (2 * Math.PI * minutes) / (24 * 60);
    const sinT = Math.sin(phase);
    const cosT = Math.cos(phase);
    const dow = d ? d.getDay() : 0;
    const phaseW = (2 * Math.PI * dow) / 7;
    const sinW = Math.sin(phaseW);
    const cosW = Math.cos(phaseW);

    const idx = sleepProbByBin ? dayBinIndex(tsMs, sleepProbByBin.binMinutes) : 0;
    const pSleep = sleepProbByBin && Array.isArray(sleepProbByBin.pSleep) ? Number(sleepProbByBin.pSleep[idx]) : 0.5;
    const pSleepC = clamp(pSleep, 0, 1) * 2 - 1;

    const dNorm = clamp(Number(lastDeltaNorm) || 0, -1, 1);
    return [1, bbC, dNorm, sinT, cosT, pSleepC, sinW, cosW];
  }

  function shuffleInPlace(arr, rand01) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand01() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  function trainTinyTrendNet(samples, cfg, seed) {
    if (!Array.isArray(samples) || samples.length === 0) return null;
    const inputDim = samples[0].x.length;
    const hidden = Math.max(2, Number(cfg?.hiddenSize) || 8);
    const rng = makeLcgRng(seed);

    const W1 = [];
    for (let h = 0; h < hidden; h++) {
      const row = [];
      for (let j = 0; j < inputDim; j++) row.push((rng() - 0.5) * 0.2);
      W1.push(row);
    }
    const b1 = new Array(hidden).fill(0);
    const W2 = new Array(hidden).fill(0).map(() => (rng() - 0.5) * 0.2);
    let b2 = 0;

    const epochs = Math.max(1, Number(cfg?.epochs) || 40);
    const lr0 = Math.max(1e-6, Number(cfg?.learningRate) || 0.03);
    const l2 = clamp(Number(cfg?.l2) || 0, 0, 0.2);

    const order = samples.map((_, i) => i);

    for (let ep = 0; ep < epochs; ep++) {
      shuffleInPlace(order, rng);
      const lr = lr0 / (1 + ep * 0.03);

      for (let t = 0; t < order.length; t++) {
        const s = samples[order[t]];
        const x = s.x;
        const target = Number(s.y);
        const weight = clamp(Number(s.w ?? 1), 0, 1);
        if (!Number.isFinite(target) || weight <= 0) continue;

        const a1 = new Array(hidden);
        for (let h = 0; h < hidden; h++) {
          let z = b1[h];
          const wRow = W1[h];
          for (let j = 0; j < inputDim; j++) z += wRow[j] * x[j];
          a1[h] = tanh(z);
        }

        let z2 = b2;
        for (let h = 0; h < hidden; h++) z2 += W2[h] * a1[h];
        const yPred = tanh(z2);

        const err = (yPred - target) * weight;
        const dz2 = 2 * err * (1 - yPred * yPred);

        const w2Old = W2.slice();
        for (let h = 0; h < hidden; h++) {
          const g = dz2 * a1[h] + l2 * W2[h];
          W2[h] -= lr * g;
        }
        b2 -= lr * dz2;

        for (let h = 0; h < hidden; h++) {
          const da = dz2 * w2Old[h];
          const dz1 = da * (1 - a1[h] * a1[h]);
          const wRow = W1[h];
          for (let j = 0; j < inputDim; j++) wRow[j] -= lr * (dz1 * x[j] + l2 * wRow[j]);
          b1[h] -= lr * dz1;
        }
      }
    }

    function predictDeltaNorm(x) {
      if (!Array.isArray(x) || x.length !== inputDim) return 0;
      const a1 = new Array(hidden);
      for (let h = 0; h < hidden; h++) {
        let z = b1[h];
        const wRow = W1[h];
        for (let j = 0; j < inputDim; j++) z += wRow[j] * x[j];
        a1[h] = tanh(z);
      }
      let z2 = b2;
      for (let h = 0; h < hidden; h++) z2 += W2[h] * a1[h];
      return clamp(tanh(z2), -1, 1);
    }

    return { inputDim, hidden, predictDeltaNorm };
  }

  function computeSeriesThreeKernel(userConfig) {
    const cfg = readThreeKernelConfig(userConfig);
    const base = computeSeries(userConfig);
    if (!cfg.enabled) return base;

    const series = Array.isArray(base?.series) ? base.series : [];
    const params = base?.params || {};

    const summaryCore = base.summary;

    const sleepProb = buildSleepProbByBin(series, cfg.binMinutes);
    const meanDeltaByBin = buildMeanDeltaNormByBin(series, params, cfg.binMinutes);

    const samples = [];
    const maxDeltaPerHour = Number(params?.maxDeltaPerHour ?? 0);
    for (let i = 0; i < series.length; i++) {
      const r = series[i];
      const dtMin = Number(r?.dtMinutes ?? params?.epochMinutes ?? 5);
      if (!Number.isFinite(dtMin) || dtMin <= 0) continue;
      const dtHours = dtMin / 60;
      const maxDelta = maxDeltaPerHour * dtHours;
      if (!Number.isFinite(maxDelta) || maxDelta <= 1e-6) continue;

      const bb0 = Number(r?.bb);
      const bb1 = Number(r?.bbNext);
      if (!Number.isFinite(bb0) || !Number.isFinite(bb1)) continue;

      const y = clamp((bb1 - bb0) / maxDelta, -1, 1);
      const lastDeltaNorm =
        i === 0
          ? 0
          : (() => {
              const prev = series[i - 1];
              const prevDt = Number(prev?.dtMinutes ?? params?.epochMinutes ?? 5);
              const prevMaxDelta = maxDeltaPerHour * (prevDt / 60);
              if (!Number.isFinite(prevMaxDelta) || prevMaxDelta <= 1e-6) return 0;
              const d = Number(prev?.bbNext) - Number(prev?.bb);
              return clamp(d / prevMaxDelta, -1, 1);
            })();
      const x = trendFeatureVector(bb0, lastDeltaNorm, r?.tsMs ?? null, sleepProb);
      const w = clamp(Number(r?.confidence ?? 0.6), 0, 1);
      samples.push({ x, y, w });
    }

    let trainSamples = samples;
    if (trainSamples.length > cfg.maxTrainSamples) {
      const stride = Math.max(1, Math.floor(trainSamples.length / cfg.maxTrainSamples));
      const down = [];
      for (let i = 0; i < trainSamples.length; i += stride) down.push(trainSamples[i]);
      trainSamples = down;
    }

    const seed =
      ((Number(series?.[0]?.tsMs ?? 0) || 0) ^
        (Number(series?.[series.length - 1]?.tsMs ?? 0) || 0) ^
        (series.length * 2654435761)) >>>
      0;

    const trained = trainSamples.length >= cfg.minTrainSamples;
    const model = trained ? trainTinyTrendNet(trainSamples, cfg, seed) : null;

    let bbTrend = clamp(Number(params?.initialBB ?? 70), 0, 100);
    let lastDeltaNorm = 0;

    for (let i = 0; i < series.length; i++) {
      const r = series[i];
      const dtMin = Number(r?.dtMinutes ?? params?.epochMinutes ?? 5);
      const dtHours = Number.isFinite(dtMin) && dtMin > 0 ? dtMin / 60 : (Number(params?.epochMinutes ?? 5) || 5) / 60;
      const maxDelta = maxDeltaPerHour * dtHours;

      const tsMs = r?.tsMs ?? null;
      const x = trendFeatureVector(bbTrend, lastDeltaNorm, tsMs, sleepProb);
      const bin = dayBinIndex(Number.isFinite(tsMs) ? Number(tsMs) : 0, meanDeltaByBin.binMinutes);
      const fallback = Number(meanDeltaByBin.meanDeltaNorm?.[bin] ?? 0) || 0;
      const yPred = model ? model.predictDeltaNorm(x) : clamp(fallback, -1, 1);
      const delta = Number.isFinite(maxDelta) ? yPred * maxDelta : 0;
      const bbTrendNext = clamp(bbTrend + delta, 0, 100);

      r.bbCore = r.bb;
      r.bbCoreNext = r.bbNext;
      r.deltaCoreCore = r.deltaCore;

      r.bbTrend = bbTrend;
      r.bbTrendNext = bbTrendNext;

      const bbHybrid = cfg.weightCore * Number(r.bbCore) + cfg.weightTrend * bbTrend;
      const bbHybridNext = cfg.weightCore * Number(r.bbCoreNext) + cfg.weightTrend * bbTrendNext;

      r.bb = clamp(bbHybrid, 0, 100);
      r.bbNext = clamp(bbHybridNext, 0, 100);
      r.reserveScore = r.bbNext;
      r.deltaCore = r.bbNext - r.bb;

      lastDeltaNorm = maxDelta > 1e-6 ? clamp((bbTrendNext - bbTrend) / maxDelta, -1, 1) : 0;
      bbTrend = bbTrendNext;
    }

    const epochMinutes = Number(params?.epochMinutes ?? 5) || 5;
    const forecastEpochs = Math.max(0, Math.round((cfg.forecastHours * 60) / epochMinutes));
    if (forecastEpochs > 0) {
      const dtMin = epochMinutes;
      const dtHours = dtMin / 60;
      const maxDelta = maxDeltaPerHour * dtHours;
      const dtMs = dtMin * 60000;
      const lastTs = Number(series?.[series.length - 1]?.tsMs);
      const startTs = Number.isFinite(lastTs) ? lastTs : null;

      for (let k = 0; k < forecastEpochs; k++) {
        const tsMs = startTs === null ? null : startTs + (k + 1) * dtMs;
        const x = trendFeatureVector(bbTrend, lastDeltaNorm, tsMs, sleepProb);
        const bin = dayBinIndex(Number.isFinite(tsMs) ? Number(tsMs) : 0, meanDeltaByBin.binMinutes);
        const fallback = Number(meanDeltaByBin.meanDeltaNorm?.[bin] ?? 0) || 0;
        const yPred = model ? model.predictDeltaNorm(x) : clamp(fallback, -1, 1);
        const delta = Number.isFinite(maxDelta) ? yPred * maxDelta : 0;
        const bbTrendNext = clamp(bbTrend + delta, 0, 100);

        const bbHybrid = bbTrend;
        const bbHybridNext = bbTrendNext;

        series.push({
          i: series.length,
          tsMs,
          iso: tsMs === null ? null : new Date(tsMs).toISOString(),
          dtMinutes: dtMin,
          bbCore: null,
          bbCoreNext: null,
          bbTrend: bbTrend,
          bbTrendNext: bbTrendNext,
          bb: bbHybrid,
          bbNext: bbHybridNext,
          reserveScore: bbHybridNext,
          comfortScore: null,
          fatigueScore: null,
          deltaCore: bbHybridNext - bbHybrid,
          deltaCoreCore: null,
          chargePoints: 0,
          drainPoints: 0,
          chargePerHour: 0,
          drainPerHour: 0,
          confidence: 0,
          context: { kind: "FORECAST" },
        });

        lastDeltaNorm = maxDelta > 1e-6 ? clamp((bbTrendNext - bbTrend) / maxDelta, -1, 1) : 0;
        bbTrend = bbTrendNext;
      }
    }

    base.summaryCore = summaryCore;
    base.summary = summarize(series);
    base.threeKernel = {
      enabled: true,
      weights: { core: cfg.weightCore, trend: cfg.weightTrend },
      forecastHours: cfg.forecastHours,
      trend: {
        trained,
        samples: trainSamples.length,
        binMinutes: cfg.binMinutes,
        model: trained ? { kind: "tiny-mlp", inputDim: model?.inputDim ?? null, hidden: model?.hidden ?? null } : null,
      },
    };

    return base;
  }

  function summarize(series) {
    if (!Array.isArray(series) || series.length === 0) {
      return {
        startBB: null,
        endBB: null,
        minBB: null,
        maxBB: null,
        totalCharge: 0,
        totalDrain: 0,
        avgConfidence: 0,
        avgComfort: null,
        avgFatigue: null,
        sleepCharge: null,
        morningBB: null,
        sleepAvgComfort: null,
        morningComfort: null,
        readiness: null,
      };
    }

    const startBB = series[0].bb;
    const endBB = series[series.length - 1].bbNext;
    let minBB = startBB;
    let maxBB = startBB;
    let totalCharge = 0;
    let totalDrain = 0;
    let confidenceSum = 0;
    let comfortSum = 0;
    let comfortCount = 0;
    let fatigueSum = 0;
    let fatigueCount = 0;

    for (const r of series) {
      minBB = Math.min(minBB, r.bb, r.bbNext);
      maxBB = Math.max(maxBB, r.bb, r.bbNext);
      totalCharge += r.chargePoints;
      totalDrain += r.drainPoints;
      confidenceSum += r.confidence;
      if (Number.isFinite(r.comfortScore)) {
        comfortSum += r.comfortScore;
        comfortCount += 1;
      }
      if (Number.isFinite(r.fatigueScore)) {
        fatigueSum += r.fatigueScore;
        fatigueCount += 1;
      }
    }

    const avgConfidence = confidenceSum / series.length;
    const avgComfort = comfortCount > 0 ? comfortSum / comfortCount : null;
    const avgFatigue = fatigueCount > 0 ? fatigueSum / fatigueCount : null;

    // 主睡眠段：允许夜里短暂清醒（awake gap），合并多段 SLEEP；再取总睡眠时长最长的一段
    const MAX_WAKE_GAP_MIN = 90;

    const sleepSegments = [];
    for (let i = 0; i < series.length; i++) {
      if (series[i].context?.kind !== "SLEEP") continue;
      const startIdx = i;
      let endIdx = i;
      while (endIdx + 1 < series.length && series[endIdx + 1].context?.kind === "SLEEP") endIdx++;
      sleepSegments.push({ startIdx, endIdx });
      i = endIdx;
    }

    const sleepSessions = [];
    if (sleepSegments.length > 0) {
      let curr = null;
      for (const seg of sleepSegments) {
        const segSleepEpochs = seg.endIdx - seg.startIdx + 1;
        if (!curr) {
          curr = { startIdx: seg.startIdx, endIdx: seg.endIdx, sleepEpochs: segSleepEpochs };
          continue;
        }

        let gapMin = 0;
        if (curr.endIdx + 1 < seg.startIdx) {
          const gapStartMs = series[curr.endIdx + 1]?.tsMs ?? null;
          const gapEndMs = series[seg.startIdx]?.tsMs ?? null;
          if (Number.isFinite(gapStartMs) && Number.isFinite(gapEndMs) && gapEndMs >= gapStartMs) {
            gapMin = (gapEndMs - gapStartMs) / 60000;
          } else {
            for (let i = curr.endIdx + 1; i < seg.startIdx; i++) gapMin += Number(series[i]?.dtMinutes ?? 0);
          }
        }

        if (gapMin <= MAX_WAKE_GAP_MIN) {
          curr.endIdx = seg.endIdx;
          curr.sleepEpochs += segSleepEpochs;
        } else {
          sleepSessions.push(curr);
          curr = { startIdx: seg.startIdx, endIdx: seg.endIdx, sleepEpochs: segSleepEpochs };
        }
      }
      if (curr) sleepSessions.push(curr);
    }

    let mainSleep = null;
    for (const s of sleepSessions) {
      if (!mainSleep) {
        mainSleep = s;
        continue;
      }
      if (s.sleepEpochs > mainSleep.sleepEpochs || (s.sleepEpochs === mainSleep.sleepEpochs && s.endIdx > mainSleep.endIdx)) {
        mainSleep = s;
      }
    }

    let sleepCharge = null;
    let morningBB = null;
    let sleepAvgComfort = null;
    let morningComfort = null;
    let morningFatigue = null;
    if (mainSleep) {
      let lastSleepIdx = null;
      let chargeSum = 0;
      let comfortSumSleep = 0;
      let comfortCntSleep = 0;

      for (let i = mainSleep.startIdx; i <= mainSleep.endIdx; i++) {
        const r = series[i];
        if (r.context?.kind !== "SLEEP") continue;
        lastSleepIdx = i;
        if (Number.isFinite(r.bb) && Number.isFinite(r.bbNext)) chargeSum += r.bbNext - r.bb;
        const v = r.comfortScore;
        if (Number.isFinite(v)) {
          comfortSumSleep += v;
          comfortCntSleep += 1;
        }
      }

      if (lastSleepIdx !== null) {
        sleepCharge = chargeSum;
        morningBB = series[lastSleepIdx].bbNext;
        sleepAvgComfort = comfortCntSleep > 0 ? comfortSumSleep / comfortCntSleep : null;
        morningComfort = Number.isFinite(series[lastSleepIdx].comfortScore) ? series[lastSleepIdx].comfortScore : null;
        morningFatigue = Number.isFinite(series[lastSleepIdx].fatigueScore) ? series[lastSleepIdx].fatigueScore : null;
      }
    }

    const readiness =
      morningBB === null
        ? null
        : clamp(
            0.6 * morningBB +
              0.25 * (sleepAvgComfort ?? avgComfort ?? 50) +
              0.15 * Math.max(0, sleepCharge ?? 0) -
              0.1 * (morningFatigue ?? 0),
            0,
            100,
          );

    return {
      startBB,
      endBB,
      minBB,
      maxBB,
      totalCharge: Number(totalCharge.toFixed(2)),
      totalDrain: Number(totalDrain.toFixed(2)),
      avgConfidence: Number(avgConfidence.toFixed(3)),
      avgComfort: avgComfort === null ? null : Number(avgComfort.toFixed(2)),
      avgFatigue: avgFatigue === null ? null : Number(avgFatigue.toFixed(2)),
      sleepCharge: sleepCharge === null ? null : Number(sleepCharge.toFixed(2)),
      morningBB: morningBB === null ? null : Number(morningBB.toFixed(2)),
      sleepAvgComfort: sleepAvgComfort === null ? null : Number(sleepAvgComfort.toFixed(2)),
      morningComfort: morningComfort === null ? null : Number(morningComfort.toFixed(2)),
      readiness: readiness === null ? null : Number(readiness.toFixed(2)),
    };
  }

  return {
    VERSION,
    defaultParams,
    defaultBaselines,
    inferBaselinesFromEpochs,
    computeSeries,
    computeSeriesThreeKernel,
  };
});
