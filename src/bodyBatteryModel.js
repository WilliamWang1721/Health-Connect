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

  const VERSION = "0.1.0";

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

  function normalizeScore01(raw) {
    const n = toNumberOrNull(raw);
    if (n === null) return null;
    if (n >= 0 && n <= 1) return clamp(n, 0, 1); // already 0..1
    if (n >= -1 && n <= 1) return clamp((n + 1) / 2, 0, 1); // -1..1 valence-like
    if (n >= 1 && n <= 5) return clamp((n - 1) / 4, 0, 1); // 1..5 Likert
    if (n >= 0 && n <= 10) return clamp(n / 10, 0, 1); // 0..10
    if (n >= 0 && n <= 100) return clamp(n / 100, 0, 1); // 0..100
    return null;
  }

  function rampUp01(value01, start01, full01) {
    if (!Number.isFinite(value01)) return null;
    const s = clamp(Number(start01), 0, 1);
    const f = clamp(Number(full01), 0, 1);
    if (f <= s) return value01 >= s ? 1 : 0;
    return clamp((value01 - s) / (f - s), 0, 1);
  }

  function rampDown01(value01, start01, full01) {
    if (!Number.isFinite(value01)) return null;
    const s = clamp(Number(start01), 0, 1);
    const f = clamp(Number(full01), 0, 1);
    if (s <= f) return value01 <= s ? 1 : 0;
    return clamp((s - value01) / (s - f), 0, 1);
  }

  function parseStateOfMind(epoch) {
    const raw = epoch?.stateOfMind ?? epoch?.som ?? null;
    if (raw === null || raw === undefined || raw === "") return null;

    if (typeof raw === "object") {
      const valenceRaw =
        raw.valence ?? raw.pleasantness ?? raw.mood ?? raw.score ?? raw.value ?? raw.valence01 ?? null;
      const stressRaw = raw.stress ?? raw.pressure ?? raw.anxiety ?? raw.arousal ?? raw.stress01 ?? null;
      const parsed = {
        valence01: normalizeScore01(valenceRaw),
        stress01: normalizeScore01(stressRaw),
      };
      if (parsed.valence01 === null && parsed.stress01 === null) return null;
      return parsed;
    }

    const parsed = {
      valence01: normalizeScore01(raw),
      stress01: null,
    };
    if (parsed.valence01 === null) return null;
    return parsed;
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
      baseSleepChargePerHour: 9,
      baseRestChargePerHour: 2,
      baseMindChargePerHour: 4,
      loadDrainWorkoutMaxPerHour: 35,
      loadDrainActiveMaxPerHour: 18,
      stressDrainPerIndexPerHour: 4,
      stressDrainMaxPerHour: 14,
      anomDrainPerIndexPerHour: 2.5,
      anomDrainMaxPerHour: 10,
      // Stress/Mood (State of Mind / HRV) — used for comfort & mild drain
      somPriorityWeight: 0.75, // higher => SoM dominates over HRV when both exist
      somLowMoodStart01: 0.45,
      somLowMoodFull01: 0.2,
      somHighStressStart01: 0.6,
      somHighStressFull01: 0.9,
      somStressIndexMax: 1.2, // maps SoM strain(0..1) -> stressFromSom (z-like scale)
      mindStrainFromHrvStartZ: 0.4, // on (-zHrv)
      mindStrainFromHrvFullZ: 1.6, // on (-zHrv)
      mindComfortPenaltyMaxPoints: 8, // max comfort reduction when mindStrain01=1
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

  function saturationFactor(bb, exponent) {
    const x = clamp(1 - bb / 100, 0, 1);
    const exp = Number.isFinite(exponent) ? exponent : 0.5;
    return Math.pow(x, clamp(exp, 0.1, 2));
  }

  function normalizeZ(value, base, scale) {
    if (!Number.isFinite(value) || !Number.isFinite(base) || !Number.isFinite(scale) || scale <= 0) return null;
    return (value - base) / scale;
  }

  function classifyContext(epoch, baselines, epochMinutes) {
    const dtMin = Number.isFinite(epochMinutes) && epochMinutes > 0 ? epochMinutes : 5;

    const sleepStageRaw = epoch.sleepStage ?? epoch.sleep ?? null;
    const sleepStage = sleepStageRaw === null || sleepStageRaw === undefined || sleepStageRaw === "" ? null : String(sleepStageRaw);
    if (sleepStage && sleepStage !== "awake") {
      return { kind: "SLEEP", sleepStage };
    }

    const mindful = Boolean(epoch.mindful ?? epoch.mindfulness ?? epoch.isMindful);
    if (mindful) return { kind: "MEDITATION" };

    const workout = Boolean(epoch.workout ?? epoch.isWorkout);
    if (workout) return { kind: "WORKOUT", workoutType: epoch.workoutType ?? null };

    const steps = toNumberOrNull(epoch.steps) ?? 0;
    const hr = toNumberOrNull(epoch.hrBpm ?? epoch.hr);
    const power = toNumberOrNull(epoch.powerW ?? epoch.power);
    const activeEnergy = toNumberOrNull(epoch.activeEnergyKcal ?? epoch.activeEnergy ?? epoch.energyKcal);

    const stepsPerMin = steps / dtMin;
    const hasActivitySignal = stepsPerMin >= 8 || (activeEnergy !== null && activeEnergy / dtMin >= 1.2) || (power !== null && power >= 60);

    const rhr = baselines?.rhrBpm ?? 60;
    const isRestLike = !hasActivitySignal && hr !== null && hr <= rhr + 12;
    if (isRestLike) return { kind: "AWAKE_REST" };

    if (!hasActivitySignal) return { kind: "AWAKE" };
    if (stepsPerMin < 40 && (power === null || power < 120)) return { kind: "LIGHT_ACTIVITY" };
    return { kind: "ACTIVE" };
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
    const somRaw = epoch.stateOfMind ?? epoch.som ?? null;
    const somPresent = somRaw !== null && somRaw !== undefined && somRaw !== "";

    const q = {
      hr: scoreQuality01(hr, 30, 220),
      hrv: scoreQuality01(hrv, 5, 250),
      spo2: scoreQuality01(spo2, 75, 100),
      rr: scoreQuality01(rr, 6, 35),
      temp: scoreQuality01(temp, 30, 42),
      steps: steps === null ? 0 : steps >= 0 ? 1 : 0.2,
      energy: energy === null ? 0 : energy >= 0 ? 1 : 0.2,
      power: power === null ? 0 : power >= 0 && power <= 2000 ? 1 : 0.2,
      som: somPresent ? 1 : 0,
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
    if (s.includes("deep")) return 1.2;
    if (s.includes("core") || s.includes("light")) return 1;
    if (s.includes("rem")) return 0.9;
    if (s.includes("awake")) return 0.25;
    if (s.includes("inbed") || s.includes("in_bed")) return 0.35;
    return 1;
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
    const som = parseStateOfMind(epoch);
    const qSom = clamp(Number(q?.som ?? (som ? 1 : 0)), 0, 1);

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
    if (context.kind === "WORKOUT") intensityForLoad = clamp(Math.max(movementIntensity, hrIdx), 0, 1);
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

    const stageFactor = context.kind === "SLEEP" ? sleepStageFactor(context.sleepStage) : 0;

    let autonomicFactor = 1;
    if (zHrv !== null) autonomicFactor += 0.15 * clamp(zHrv, -3, 3);
    if (hr !== null && Number.isFinite(rhr)) autonomicFactor -= 0.1 * clamp((hr - rhr) / 5, 0, 5);
    autonomicFactor = clamp(autonomicFactor, 0.4, 1.6);

    const anomPenalty = Math.exp(-0.12 * anomIndex);
    let sleepRecovery = stageFactor * autonomicFactor * anomPenalty;
    if (isSleep && tempOnsetBenefitIndex > 0) {
      sleepRecovery *= 1 + onsetBoost * tempOnsetBenefitIndex;
    }
    sleepRecovery = clamp(sleepRecovery, 0, 2.5);

    let restRecovery = 0;
    if (context.kind === "AWAKE_REST" || context.kind === "AWAKE" || context.kind === "POST_ACTIVITY_RECOVERY") {
      const hrRelax =
        hr === null || !Number.isFinite(rhr) ? 0.6 : clamp((rhr + 15 - hr) / 15, 0, 1);
      const stepRelax = clamp((10 - stepsPerMin) / 10, 0, 1);
      const hrvBonus = zHrv === null ? 0 : clamp(zHrv / 2, 0, 0.6);
      restRecovery = clamp(0.55 * hrRelax + 0.35 * stepRelax + 0.2 * hrvBonus, 0, 1.5);
    }

    let mindRecovery = 0;
    const mindful = Boolean(epoch.mindful ?? epoch.mindfulness ?? epoch.isMindful);
    if (mindful || context.kind === "MEDITATION") {
      const hrRelax =
        hr === null || !Number.isFinite(rhr) ? 0.6 : clamp((rhr + 18 - hr) / 18, 0, 1);
      const hrvBonus = zHrv === null ? 0 : clamp(zHrv / 2, 0, 0.8);
      mindRecovery = clamp(0.7 + 0.4 * hrRelax + 0.2 * hrvBonus, 0, 1.8);
    }

    const loadExponent = context.kind === "WORKOUT" ? 1.55 : 1.25;
    const loadMax = context.kind === "WORKOUT" ? params.loadDrainWorkoutMaxPerHour : params.loadDrainActiveMaxPerHour;
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

    const somLowMood01 =
      som?.valence01 === null || som?.valence01 === undefined
        ? null
        : rampDown01(som.valence01, params.somLowMoodStart01, params.somLowMoodFull01);
    const somHighStress01 =
      som?.stress01 === null || som?.stress01 === undefined
        ? null
        : rampUp01(som.stress01, params.somHighStressStart01, params.somHighStressFull01);
    const somStrain01Raw = Math.max(Number(somLowMood01 ?? 0), Number(somHighStress01 ?? 0));
    const somStrain01 = som ? clamp(somStrain01Raw * qSom, 0, 1) : null;

    const mindStartZ = clamp(Number(params.mindStrainFromHrvStartZ ?? 0.4), 0, 4);
    const mindFullZ = clamp(Number(params.mindStrainFromHrvFullZ ?? 1.6), mindStartZ + 1e-6, 6);
    const hrvStrain01 =
      zHrv === null
        ? null
        : clamp(((relu(-zHrv) - mindStartZ) / (mindFullZ - mindStartZ)) * clamp(Number(q.hrv ?? 0), 0, 1), 0, 1);

    const somW = clamp(Number(params.somPriorityWeight ?? 0.75), 0, 1);
    const mindStrain01 =
      somStrain01 !== null
        ? clamp(somW * somStrain01 + (1 - somW) * Number(hrvStrain01 ?? 0), 0, 1)
        : clamp(Number(hrvStrain01 ?? 0), 0, 1);

    const somStressIndexMax = clamp(Number(params.somStressIndexMax ?? 1.2), 0, 5);
    const stressFromSom = somStrain01 === null ? 0 : somStrain01 * somStressIndexMax;
    const stressFromMind = somStrain01 === null ? stressFromHrv : somW * stressFromSom + (1 - somW) * stressFromHrv;

    const stressIndex = clamp(0.8 * stressFromMind + 0.4 * stressFromHr + 0.2 * restElev, 0, 5);
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

    const qLoad = clamp(Math.max(q.steps ?? 0, q.energy ?? 0, q.power ?? 0, q.hr ?? 0), 0, 1);
    const qStress = clamp(Math.max(q.hrv ?? 0, q.hr ?? 0), 0, 1);
    const qAnom = clamp(Math.max(q.spo2 ?? 0, q.rr ?? 0, q.temp ?? 0), 0, 1);
    const qSleep = clamp(0.4 + 0.3 * (q.hrv ?? 0) + 0.2 * (q.hr ?? 0) + 0.1 * qAnom, 0, 1);
    const qRest = clamp(0.35 + 0.45 * (q.hr ?? 0) + 0.2 * (q.steps ?? 0), 0, 1);
    const qMind = clamp(0.35 + 0.4 * (q.hr ?? 0) + 0.25 * (q.hrv ?? 0), 0, 1);

    const respDiscomfortIndex = 0.9 * spo2PenaltyEff + 0.6 * rrPenaltyEff;
    const thermalDiscomfortIndex = tempOverheatIndex + 0.6 * tempFeverIndex;
    const discomfortIndex = thermalDiscomfortIndex + 0.5 * respDiscomfortIndex;
    const comfortPenaltyPerIndex = clamp(Number(params.comfortPenaltyPerIndex ?? 12), 0, 50);
    const mindComfortPenaltyMaxPoints = clamp(Number(params.mindComfortPenaltyMaxPoints ?? 8), 0, 30);
    const comfortScore = clamp(
      100 - comfortPenaltyPerIndex * discomfortIndex - mindComfortPenaltyMaxPoints * mindStrain01,
      0,
      100,
    );

    return {
      values: { hr, hrv, spo2, rr, temp, steps, activeEnergy, power, stateOfMind: epoch.stateOfMind ?? epoch.som ?? null },
      z: { zHrv },
      mind: {
        somValence01: som?.valence01 ?? null,
        somStress01: som?.stress01 ?? null,
        somLowMood01,
        somHighStress01,
        somStrain01,
        hrvStrain01,
        mindStrain01,
        stressFromHrv,
        stressFromSom,
        stressFromMind,
      },
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

    const rawChargePerHour =
      chargeGate.weights.sleep * params.baseSleepChargePerHour * indices.recovery.sleepRecovery +
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

    let bb = clamp(params.initialBB, 0, 100);
    let prevTs = null;
    let prevContextKind = null;
    let sleepMinutesFromStart = null;
    let sleepHeatStreakMinutes = 0;
    let activeLikePrev = false;
    let minutesSinceActiveEnd = null;
    let recoveryMinutes = 0;
    let lastActiveIntensity01 = 0;
    let prevSignals = null;

    const out = [];
    for (let i = 0; i < epochs.length; i++) {
      const e = epochs[i];
      const ts = parseTimestampMs(e);
      const dtHoursDefault = params.epochMinutes / 60;
      let dtHours = dtHoursDefault;
      if (prevTs !== null && ts !== null) {
        const diffH = (ts - prevTs) / 3600000;
        if (Number.isFinite(diffH) && diffH > 0.1 / 60 && diffH < 6) dtHours = diffH;
      }
      prevTs = ts ?? prevTs;
      const dtMinutes = dtHours * 60;

      const q = computeQuality(e, baselines);
      const context0 = e.context ? { ...(e.context || {}) } : classifyContext(e, baselines, params.epochMinutes);
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

      const indices = computeIndices(e, context0, baselines, params, q, dtMinutes, {
        sleepMinutesFromStart,
        sleepHeatStreakMinutes,
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

      const step = computeEpoch(dtHours, bb, context, indicesForStep, params, weights, calm.chargePerHour);
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
          sleep: indices.recovery.sleepRecovery,
          rest: indices.recovery.restRecovery,
          mind: indices.recovery.mindRecovery,
          calmRecoveryIndex: calm.index,
          calmRecoveryChargePerHour: calm.chargePerHour,
          calmRecoveryPoints: step.chargePointsExtra,
        },
        drainComponents: {
          loadPerHour: indices.drainRates.loadRate,
          stressPerHour: indicesForStep.drainRates.stressRate,
          anomPerHour: indices.drainRates.anomRate,
          anomIndex: indices.recovery.anomIndex,
          anomBreakdown: indices.recovery.anomBreakdown,
        },
        temperature: indices.temperature,
        calmRecovery: { ...calm, stressSuppressionFactor },
        weights: {
          charge: step.chargeGate.weights,
          drain: step.drainGate.weights,
        },
        quality: q,
        confidence: step.confidence,
        context,
        input: indices.values,
      };
      out.push(row);
      bb = step.nextBB;
    }

    const summary = summarize(out);

    return { version: VERSION, params, baselines, series: out, summary };
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

    // 主睡眠段：取第一段连续 SLEEP
    let sleepStartIdx = null;
    let sleepEndIdx = null;
    for (let i = 0; i < series.length; i++) {
      if (series[i].context?.kind === "SLEEP") {
        sleepStartIdx = i;
        break;
      }
    }
    if (sleepStartIdx !== null) {
      sleepEndIdx = sleepStartIdx;
      while (sleepEndIdx + 1 < series.length && series[sleepEndIdx + 1].context?.kind === "SLEEP") {
        sleepEndIdx++;
      }
    }

    let sleepCharge = null;
    let morningBB = null;
    let sleepAvgComfort = null;
    let morningComfort = null;
    let morningFatigue = null;
    if (sleepStartIdx !== null && sleepEndIdx !== null) {
      const bbStart = series[sleepStartIdx].bb;
      const bbEnd = series[sleepEndIdx].bbNext;
      sleepCharge = bbEnd - bbStart;
      morningBB = bbEnd;

      let sum = 0;
      let cnt = 0;
      for (let i = sleepStartIdx; i <= sleepEndIdx; i++) {
        const v = series[i].comfortScore;
        if (Number.isFinite(v)) {
          sum += v;
          cnt += 1;
        }
      }
      sleepAvgComfort = cnt > 0 ? sum / cnt : null;
      morningComfort = Number.isFinite(series[sleepEndIdx].comfortScore) ? series[sleepEndIdx].comfortScore : null;
      morningFatigue = Number.isFinite(series[sleepEndIdx].fatigueScore) ? series[sleepEndIdx].fatigueScore : null;
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
  };
});
