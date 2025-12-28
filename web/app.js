/* global BodyBatteryModel */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    segments: [],
    lastResult: null,
    chart: {
      options: {
        showReserve: true,
        showComfort: true,
        showFatigue: false,
        showSleep: true,
        showEvents: true,
        bottomMetric: "chargeDrain",
      },
      view: { minX: null, maxX: null },
      hover: { idx: null, px: null },
      drag: { active: false, startPx: null, endPx: null },
      cache: null,
      raf: 0,
    },
  };

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function numOrNull(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "string" && v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function percentToMaybeFraction(pct) {
    const n = numOrNull(pct);
    if (n === null) return null;
    if (n <= 1.5) return n; // already fraction
    return n / 100;
  }

  function localDateTimeValue(date) {
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const mi = pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "-";
    const units = ["B", "KB", "MB", "GB"];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    const digits = i === 0 ? 0 : i === 1 ? 1 : 2;
    return `${v.toFixed(digits)} ${units[i]}`;
  }

  function showError(el, message) {
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = String(message);
  }

  function setAppleProgress(pct) {
    const wrap = $("appleProgress");
    const bar = $("appleProgressBar");
    if (!wrap || !bar) return;
    const p = clamp(Number(pct), 0, 100);
    bar.style.width = `${p}%`;
    wrap.setAttribute("aria-valuenow", String(Math.round(p)));
  }

  const UPGRADE_ID = "v0.2.0";
  const UPGRADE_STORAGE_KEY = "bb_upgrade_seen";

  function maybeShowUpgradeModal() {
    const modal = $("upgradeModal");
    const closeBtn = $("upgradeModalClose");
    const backdrop = $("upgradeBackdrop");
    const version = $("upgradeVersion");
    if (!modal || !closeBtn) return;

    const v = window.BodyBatteryModel && window.BodyBatteryModel.VERSION ? String(window.BodyBatteryModel.VERSION) : null;
    if (version) version.textContent = v ? `版本 ${v} · ${UPGRADE_ID}` : `版本 - · ${UPGRADE_ID}`;

    let seen = null;
    try {
      seen = window.localStorage ? window.localStorage.getItem(UPGRADE_STORAGE_KEY) : null;
    } catch (err) {
      seen = null;
    }
    if (seen === UPGRADE_ID) return;

    const onKeyDown = (e) => {
      if (e && e.key === "Escape") close();
    };

    const close = () => {
      modal.hidden = true;
      document.removeEventListener("keydown", onKeyDown);
      try {
        if (window.localStorage) window.localStorage.setItem(UPGRADE_STORAGE_KEY, UPGRADE_ID);
      } catch (err) {
        // ignore
      }
    };

    modal.hidden = false;
    closeBtn.addEventListener("click", close, { once: true });
    if (backdrop) backdrop.addEventListener("click", close, { once: true });
    document.addEventListener("keydown", onKeyDown);
  }

  function setActiveTab(name) {
    $("tabBtnSegments").classList.toggle("active", name === "segments");
    $("tabBtnJson").classList.toggle("active", name === "json");
    $("tabBtnApple").classList.toggle("active", name === "apple");
    $("tabSegments").hidden = name !== "segments";
    $("tabJson").hidden = name !== "json";
    $("tabApple").hidden = name !== "apple";
  }

  function segmentTypeOptions() {
    return [
      { value: "sleep_deep", label: "睡眠：Deep" },
      { value: "sleep_core", label: "睡眠：Core/Light" },
      { value: "sleep_rem", label: "睡眠：REM" },
      { value: "sleep_inbed", label: "在床（inBed）" },
      { value: "auto", label: "自动（由引擎判断状态）" },
      { value: "awake_rest", label: "清醒静息（Rest）" },
      { value: "meditation", label: "正念/冥想（Mindful）" },
      { value: "workout", label: "训练（Workout）" },
      { value: "high", label: "高强度活动（High）" },
      { value: "light", label: "轻活动（Light）" },
      { value: "active", label: "活动（Active）" },
      { value: "awake", label: "清醒（无明显活动）" },
    ];
  }

  function defaultsForType(type) {
    switch (type) {
      case "sleep_deep":
        return { durationMin: 90, hrBpm: 50, hrvSdnnMs: 70, spo2Pct: 97, respRateBrpm: 13, wristTempC: 36.55 };
      case "sleep_core":
        return { durationMin: 240, hrBpm: 54, hrvSdnnMs: 62, spo2Pct: 97, respRateBrpm: 13.5, wristTempC: 36.58 };
      case "sleep_rem":
        return { durationMin: 90, hrBpm: 58, hrvSdnnMs: 55, spo2Pct: 97, respRateBrpm: 14.5, wristTempC: 36.6 };
      case "sleep_inbed":
        return { durationMin: 30, hrBpm: 60, hrvSdnnMs: 50, spo2Pct: 97, respRateBrpm: 14, wristTempC: 36.6 };
      case "auto":
        return { durationMin: 60, hrBpm: 74, hrvSdnnMs: null, stepsPerMin: 8, activeEnergyPerMin: 0.7 };
      case "awake_rest":
        return { durationMin: 45, hrBpm: 60, hrvSdnnMs: null, stepsPerMin: 0, activeEnergyPerMin: 0.2 };
      case "meditation":
        return { durationMin: 15, hrBpm: 58, hrvSdnnMs: 60, stepsPerMin: 0, activeEnergyPerMin: 0.1 };
      case "workout":
        return { durationMin: 45, hrBpm: 150, stepsPerMin: 20, activeEnergyPerMin: 9, powerW: 210 };
      case "high":
        return { durationMin: 35, hrBpm: 135, stepsPerMin: 110, activeEnergyPerMin: 6.5 };
      case "light":
        return { durationMin: 120, hrBpm: 95, stepsPerMin: 60, activeEnergyPerMin: 2.2 };
      case "active":
        return { durationMin: 60, hrBpm: 115, stepsPerMin: 95, activeEnergyPerMin: 4.2 };
      case "awake":
      default:
        return { durationMin: 60, hrBpm: 72, stepsPerMin: 5, activeEnergyPerMin: 0.7 };
    }
  }

  function newSegment(type) {
    return { type, ...defaultsForType(type) };
  }

  function renderSegments() {
    const tbody = document.querySelector("#segmentsTable tbody");
    tbody.textContent = "";

    const opts = segmentTypeOptions();
    for (let idx = 0; idx < state.segments.length; idx++) {
      const seg = state.segments[idx];
      const tr = document.createElement("tr");

      const typeTd = document.createElement("td");
      const sel = document.createElement("select");
      for (const o of opts) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === seg.type) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => {
        const nextType = sel.value;
        state.segments[idx] = { ...newSegment(nextType), ...state.segments[idx], type: nextType };
        renderSegments();
      });
      typeTd.appendChild(sel);
      tr.appendChild(typeTd);

      const mkInputTd = (key, placeholder, step = "1") => {
        const td = document.createElement("td");
        const input = document.createElement("input");
        input.type = "number";
        input.step = step;
        input.placeholder = placeholder;
        if (seg[key] !== null && seg[key] !== undefined && seg[key] !== "") input.value = String(seg[key]);
        input.addEventListener("input", () => {
          state.segments[idx][key] = numOrNull(input.value);
        });
        td.appendChild(input);
        return td;
      };

      tr.appendChild(mkInputTd("durationMin", "min", "1"));
      tr.appendChild(mkInputTd("hrBpm", "bpm", "0.1"));
      tr.appendChild(mkInputTd("hrvSdnnMs", "ms", "0.1"));
      tr.appendChild(mkInputTd("stepsPerMin", "步/分", "0.1"));
      tr.appendChild(mkInputTd("activeEnergyPerMin", "kcal/分", "0.1"));
      tr.appendChild(mkInputTd("powerW", "W", "1"));
      tr.appendChild(mkInputTd("spo2Pct", "%", "0.1"));
      tr.appendChild(mkInputTd("respRateBrpm", "次/分", "0.1"));
      tr.appendChild(mkInputTd("wristTempC", "°C", "0.01"));

      const delTd = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.textContent = "删除";
      delBtn.className = "danger";
      delBtn.addEventListener("click", () => {
        state.segments.splice(idx, 1);
        renderSegments();
      });
      delTd.appendChild(delBtn);
      tr.appendChild(delTd);

      tbody.appendChild(tr);
    }
  }

  function sleepStageFromType(type) {
    switch (type) {
      case "sleep_deep":
        return "deep";
      case "sleep_core":
        return "core";
      case "sleep_rem":
        return "rem";
      case "sleep_inbed":
        return "inBed";
      default:
        return null;
    }
  }

  function buildEpochsFromSegments(epochMinutes) {
    const dtMin = epochMinutes;
    const startStr = $("startTime").value;
    const startMs = startStr ? new Date(startStr).getTime() : Date.now();
    const msPerEpoch = dtMin * 60000;

    let cursor = startMs;
    const epochs = [];

    for (const seg of state.segments) {
      const durationMin = numOrNull(seg.durationMin);
      if (durationMin === null || durationMin <= 0) continue;

      const count = Math.max(1, Math.round(durationMin / dtMin));
      const stepsPerMin = numOrNull(seg.stepsPerMin);
      const energyPerMin = numOrNull(seg.activeEnergyPerMin);

      const sleepStage = sleepStageFromType(seg.type);
      const isMindful = seg.type === "meditation";
      const isWorkout = seg.type === "workout";

      const explicitContext =
        sleepStage !== null
          ? { kind: "SLEEP", sleepStage }
          : seg.type === "auto"
            ? null
          : seg.type === "awake_rest"
            ? { kind: "AWAKE_REST" }
            : seg.type === "light"
              ? { kind: "LIGHT_ACTIVITY" }
              : seg.type === "active"
                ? { kind: "ACTIVE" }
                : seg.type === "high"
                  ? { kind: "HIGH_ACTIVITY" }
                : seg.type === "awake"
                  ? { kind: "AWAKE" }
                  : seg.type === "meditation"
                    ? { kind: "MEDITATION" }
                    : seg.type === "workout"
                      ? { kind: "WORKOUT" }
                      : null;

      for (let i = 0; i < count; i++) {
        const e = {
          timestampMs: cursor,
          hrBpm: numOrNull(seg.hrBpm),
          hrvSdnnMs: numOrNull(seg.hrvSdnnMs),
          steps: stepsPerMin === null ? null : Math.round(stepsPerMin * dtMin),
          activeEnergyKcal: energyPerMin === null ? null : energyPerMin * dtMin,
          powerW: numOrNull(seg.powerW),
          spo2Pct: numOrNull(seg.spo2Pct),
          respRateBrpm: numOrNull(seg.respRateBrpm),
          wristTempC: numOrNull(seg.wristTempC),
        };
        if (sleepStage !== null) e.sleepStage = sleepStage;
        if (isMindful) e.mindful = true;
        if (isWorkout) e.workout = true;
        if (explicitContext) e.context = explicitContext;

        epochs.push(e);
        cursor += msPerEpoch;
      }
    }

    return epochs;
  }

  function readBaselinesFromUI() {
    const baselines = {};
    const setIf = (key, elId) => {
      const v = numOrNull($(elId).value);
      if (v !== null) baselines[key] = v;
    };
    setIf("rhrBpm", "rhrBpm");
    setIf("hrvSdnnMs", "hrvSdnnMs");
    setIf("spo2Pct", "spo2Pct");
    setIf("respRateBrpm", "respRateBrpm");
    setIf("wristTempC", "wristTempC");
    setIf("ftpW", "ftpW");
    setIf("hrMaxBpm", "hrMaxBpm");
    return Object.keys(baselines).length ? baselines : null;
  }

  function readParamsFromUI() {
    const params = {};
    const setIf = (key, elId) => {
      const v = numOrNull($(elId).value);
      if (v !== null) params[key] = v;
    };

    setIf("baseSleepChargePerHour", "baseSleepChargePerHour");
    setIf("sleepChargeDurationWeight", "sleepChargeDurationWeight");
    setIf("sleepRecoveryExponent", "sleepRecoveryExponent");
    setIf("baseRestChargePerHour", "baseRestChargePerHour");
    setIf("baseMindChargePerHour", "baseMindChargePerHour");
    setIf("loadDrainWorkoutMaxPerHour", "loadDrainWorkoutMaxPerHour");
    setIf("workoutHrWeight", "workoutHrWeight");
    setIf("loadDrainHighMaxPerHour", "loadDrainHighMaxPerHour");
    setIf("loadDrainActiveMaxPerHour", "loadDrainActiveMaxPerHour");
    setIf("loadDrainLightMaxPerHour", "loadDrainLightMaxPerHour");
    setIf("loadDrainInactiveMaxPerHour", "loadDrainInactiveMaxPerHour");
    setIf("stateLightMin01", "stateLightMin01");
    setIf("stateActiveMin01", "stateActiveMin01");
    setIf("stateHighMin01", "stateHighMin01");
    setIf("restChargeMinPotential01", "restChargeMinPotential01");
    setIf("restChargeStressIndexMax", "restChargeStressIndexMax");
    setIf("restChargeAnomIndexMax", "restChargeAnomIndexMax");
    setIf("restChargeGainExponent", "restChargeGainExponent");
    setIf("tempOnsetWindowMinutes", "tempOnsetWindowMinutes");
    setIf("tempOnsetBeneficialMaxC", "tempOnsetBeneficialMaxC");
    setIf("tempOverheatStartC", "tempOverheatStartC");
    setIf("tempFeverStartC", "tempFeverStartC");
    setIf("tempAnomWeight", "tempAnomWeight");
    setIf("comfortPenaltyPerIndex", "comfortPenaltyPerIndex");
    setIf("fatigueDrainPerHourFor100", "fatigueDrainPerHourFor100");
    setIf("postActivityRecoveryWindowMinutes", "postActivityRecoveryWindowMinutes");
    setIf("postActivityRecoveryMaxMinutes", "postActivityRecoveryMaxMinutes");
    setIf("postActivityRecoveryChargeMaxPerHour", "postActivityRecoveryChargeMaxPerHour");
    setIf("postActivityRecoveryStressSuppressionPower", "postActivityRecoveryStressSuppressionPower");
    setIf("postActivityRecoveryStressSuppressionMinFactor", "postActivityRecoveryStressSuppressionMinFactor");
    setIf("postActivityRecoveryMaxMovementIntensity01", "postActivityRecoveryMaxMovementIntensity01");

    return Object.keys(params).length ? params : null;
  }

  function readBehaviorBaselineFromUI() {
    const enabled = Boolean($("behaviorBaselineEnabled")?.checked);
    if (!enabled) return null;
    const days = clamp(numOrNull($("behaviorBaselineDays")?.value) ?? 10, 1, 60);
    return { enabled: true, days };
  }

  function readThreeKernelFromUI() {
    const enabled = Boolean($("threeKernelEnabled")?.checked);
    if (!enabled) return null;

    const wCore0 = clamp(numOrNull($("threeKernelWeightCore")?.value) ?? 0.9, 0, 1);
    const wTrend0 = clamp(numOrNull($("threeKernelWeightTrend")?.value) ?? 0.1, 0, 1);
    const sum = Math.max(1e-6, wCore0 + wTrend0);

    const forecastHours = clamp(numOrNull($("threeKernelForecastHours")?.value) ?? 0, 0, 168);

    return {
      enabled: true,
      weightCore: wCore0 / sum,
      weightTrend: wTrend0 / sum,
      forecastHours,
    };
  }

  function computeAndRender(cfg) {
    const uiThreeKernel = readThreeKernelFromUI();
    if (!cfg.threeKernel && uiThreeKernel) cfg.threeKernel = uiThreeKernel;

    const useThreeKernel = Boolean(cfg?.threeKernel?.enabled) && typeof BodyBatteryModel.computeSeriesThreeKernel === "function";
    const result = useThreeKernel ? BodyBatteryModel.computeSeriesThreeKernel(cfg) : BodyBatteryModel.computeSeries(cfg);
    state.lastResult = result;
    renderResult(result);
  }

  function renderSummaryPills(summary) {
    const bar = $("summaryBar");
    bar.textContent = "";

    const pill = (label, value, suffix = "") => {
      const div = document.createElement("div");
      div.className = "pill";
      div.innerHTML = `${label} <strong>${value === null || value === undefined ? "-" : value}${suffix}</strong>`;
      bar.appendChild(div);
    };

    pill("Start", summary.startBB, "");
    pill("End", summary.endBB, "");
    pill("Min", summary.minBB, "");
    pill("Max", summary.maxBB, "");
    pill("SleepCharge", summary.sleepCharge, "");
    pill("SleepComfort", summary.sleepAvgComfort, "");
    pill("Morning", summary.morningBB, "");
    pill("MorningComfort", summary.morningComfort, "");
    pill("Readiness", summary.readiness, "");
    pill("AvgComfort", summary.avgComfort, "");
    pill("AvgFatigue", summary.avgFatigue, "");
    pill("AvgConf", summary.avgConfidence, "");
  }

  function formatBaselineValue(key, value) {
    if (value === null || value === undefined) return "-";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "-";
      const k = String(key || "");
      let digits = 2;
      if (k.endsWith("Bpm") || k.endsWith("Brpm") || k.endsWith("W")) digits = 0;
      else if (k.includes("Pct")) digits = 1;
      else if (k.endsWith("C") || k.toLowerCase().includes("temp")) digits = 2;
      else if (k.toLowerCase().includes("scale")) digits = 2;
      else if (Math.abs(value - Math.round(value)) < 1e-6) digits = 0;
      return digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
    }
    return String(value);
  }

  function renderBaselinesTable(baselines) {
    const tbody = document.querySelector("#baselinesTable tbody");
    if (!tbody) return;
    tbody.textContent = "";

    if (!baselines || typeof baselines !== "object") {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
      td.textContent = "-";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const order = [
      "rhrBpm",
      "rhrScaleBpm",
      "hrvSdnnMs",
      "hrvScaleMs",
      "spo2Pct",
      "spo2ScalePct",
      "respRateBrpm",
      "respRateScaleBrpm",
      "wristTempC",
      "wristTempScaleC",
      "ftpW",
      "hrMaxBpm",
    ];

    const keys = Object.keys(baselines);
    const seen = new Set(order);
    const rest = keys.filter((k) => !seen.has(k)).sort((a, b) => a.localeCompare(b));
    const list = order.filter((k) => keys.includes(k)).concat(rest);

    for (const k of list) {
      const tr = document.createElement("tr");
      const tdK = document.createElement("td");
      tdK.className = "k";
      tdK.textContent = k;
      const tdV = document.createElement("td");
      tdV.className = "v";
      tdV.textContent = formatBaselineValue(k, baselines[k]);
      tr.appendChild(tdK);
      tr.appendChild(tdV);
      tbody.appendChild(tr);
    }
  }

  function renderBehaviorBaseline(behaviorBaseline) {
    const hint = $("behaviorBaselineHint");
    const out = $("behaviorBaselineJson");
    if (hint) hint.textContent = "";
    if (out) out.value = "";
    if (!behaviorBaseline) {
      if (hint) hint.textContent = "未启用或数据不足。";
      return;
    }

    const ready = Boolean(behaviorBaseline.ready);
    const applyFromMs = behaviorBaseline.windowEndTsMs ?? null;
    const applyFrom =
      Number.isFinite(applyFromMs) ? new Date(applyFromMs).toLocaleString() : "-";
    if (hint) hint.textContent = `ready=${ready} · applyFrom=${applyFrom}`;
    if (out) out.value = JSON.stringify(behaviorBaseline, null, 2);
  }

  async function copyTextToClipboard(text) {
    const s = String(text ?? "");
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(s);
        return true;
      }
    } catch (err) {
      // ignore -> fallback
    }

    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  function lowerBound(arr, x) {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function upperBound(arr, x) {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function scheduleChartRedraw() {
    if (state.chart.raf) return;
    state.chart.raf = window.requestAnimationFrame(() => {
      state.chart.raf = 0;
      if (!state.lastResult) return;
      drawChart(state.lastResult.series);
    });
  }

  function readChartOptionsFromUI() {
    const opts = state.chart.options;
    const reserve = $("chartShowReserve");
    const comfort = $("chartShowComfort");
    const fatigue = $("chartShowFatigue");
    const sleep = $("chartShowSleep");
    const events = $("chartShowEvents");
    const bottom = $("chartBottomMetric");

    if (reserve) opts.showReserve = Boolean(reserve.checked);
    if (comfort) opts.showComfort = Boolean(comfort.checked);
    if (fatigue) opts.showFatigue = Boolean(fatigue.checked);
    if (sleep) opts.showSleep = Boolean(sleep.checked);
    if (events) opts.showEvents = Boolean(events.checked);
    if (bottom && bottom.value) opts.bottomMetric = String(bottom.value);

    if (!opts.showReserve && !opts.showComfort && !opts.showFatigue) {
      opts.showReserve = true;
      if (reserve) reserve.checked = true;
    }
  }

  function resetChartZoom() {
    state.chart.view.minX = null;
    state.chart.view.maxX = null;
    state.chart.drag.active = false;
    state.chart.drag.startPx = null;
    state.chart.drag.endPx = null;
  }

  function isLikelyEpochMs(x) {
    return Number.isFinite(x) && x > 1e11;
  }

  function formatTimeTick(ms, rangeMs) {
    const d = new Date(ms);
    const pad2 = (n) => String(n).padStart(2, "0");
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    if (rangeMs <= 24 * 3600 * 1000) return `${hh}:${mi}`;
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    return `${mm}-${dd} ${hh}:${mi}`;
  }

  function computeTimeTicks(minMs, maxMs, target = 6) {
    const rangeMs = Math.max(0, maxMs - minMs);
    if (!Number.isFinite(rangeMs) || rangeMs <= 0) return [];
    const steps = [
      5 * 60000,
      10 * 60000,
      15 * 60000,
      30 * 60000,
      60 * 60000,
      2 * 60 * 60000,
      3 * 60 * 60000,
      6 * 60 * 60000,
      12 * 60 * 60000,
      24 * 60 * 60000,
    ];
    let step = steps[steps.length - 1];
    for (const s of steps) {
      if (rangeMs / s <= target) {
        step = s;
        break;
      }
    }
    const out = [];
    const start = Math.ceil(minMs / step) * step;
    for (let t = start; t <= maxMs + 1; t += step) out.push(t);
    return out;
  }

  function clampToCanvasTooltip(wrapEl, tipEl, x, y) {
    const pad = 8;
    const maxLeft = Math.max(pad, wrapEl.clientWidth - tipEl.offsetWidth - pad);
    const maxTop = Math.max(pad, wrapEl.clientHeight - tipEl.offsetHeight - pad);
    return {
      left: clamp(x, pad, maxLeft),
      top: clamp(y, pad, maxTop),
    };
  }

  function buildChartTooltipHtml(row) {
    if (!row) return "";

    const timeLabel = row.tsMs ? new Date(row.tsMs).toLocaleString() : `#${row.i}`;
    const kind = row.context?.kind ?? "-";
    const stage = kind === "SLEEP" ? row.context?.sleepStage ?? "" : "";
    const meta = kind === "SLEEP" && stage ? `${kind} · ${stage}` : kind;

    const fmt = (v, digits = 1) => (Number.isFinite(v) ? Number(v).toFixed(digits) : "-");
    const fmtInt = (v) => (Number.isFinite(v) ? String(Math.round(Number(v))) : "-");

    const hr = row.input?.hr;
    const hrv = row.input?.hrv;
    const power = row.input?.power;
    const dtMin = Number(row.dtMinutes ?? 0) || 0;
    const stepsPerMin = dtMin > 0 ? Number(row.input?.steps ?? 0) / dtMin : null;
    const kcalPerMin = dtMin > 0 ? Number(row.input?.activeEnergy ?? 0) / dtMin : null;

    const netPerHour = Number(row.chargePerHour ?? 0) - Number(row.drainPerHour ?? 0);

    const lines = [["Reserve", fmt(row.bbNext, 1)]];
    if (Number.isFinite(row.bbCoreNext)) lines.push(["Core", fmt(row.bbCoreNext, 1)]);
    if (Number.isFinite(row.bbTrendNext)) lines.push(["Trend", fmt(row.bbTrendNext, 1)]);
    lines.push(
      ["Comfort", fmtInt(row.comfortScore)],
      ["Fatigue", fmtInt(row.fatigueScore)],
      ["Conf", fmt(row.confidence, 2)],
      ["Net/h", fmt(netPerHour, 1)],
      ["Charge/h", fmt(row.chargePerHour, 1)],
      ["Drain/h", fmt(row.drainPerHour, 1)],
      ["HR", fmtInt(hr)],
      ["HRV", fmtInt(hrv)],
      ["Steps/min", fmt(stepsPerMin, 1)],
      ["kcal/min", fmt(kcalPerMin, 2)],
      ["Power", fmtInt(power)],
    );

    let gridHtml = "";
    for (const [k, v] of lines) {
      if (v === "-" || v === "NaN") continue;
      gridHtml += `<div class="tt-k">${k}</div><div class="tt-v">${v}</div>`;
    }

    return `
      <div class="tt-title">${timeLabel}</div>
      <div class="tt-meta">${meta}</div>
      <div class="tt-grid">${gridHtml}</div>
    `;
  }

  function drawLine(ctx, xs, series, i0, i1, xOf, yOf, getY) {
    let started = false;
    for (let i = i0; i <= i1; i++) {
      const r = series[i];
      const v = getY(r);
      if (!Number.isFinite(v)) {
        started = false;
        continue;
      }
      const x = xOf(xs[i]);
      const y = yOf(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
  }

  function drawChart(series) {
    const canvas = $("chart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const pxW = Math.max(1, Math.round(w * dpr));
    const pxH = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, w, h);

    const tip = $("chartTooltip");
    const wrap = $("chartWrap");
    if (tip) tip.hidden = true;

    if (!Array.isArray(series) || series.length === 0) {
      state.chart.cache = null;
      ctx.save();
      ctx.fillStyle = "rgba(157, 176, 218, 0.95)";
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillText("No data", 12, 20);
      ctx.restore();
      return;
    }

    const opts = state.chart.options;
    const xs = series.map((r, idx) => (Number.isFinite(r.tsMs) ? r.tsMs : idx));
    const minXAll = xs[0];
    const maxXAll = xs[xs.length - 1];
    const isTime = isLikelyEpochMs(minXAll) && isLikelyEpochMs(maxXAll);

    const minX = Math.min(minXAll, ...xs);
    const maxX = Math.max(maxXAll, ...xs);

    let viewMinX = state.chart.view.minX === null ? minX : Number(state.chart.view.minX);
    let viewMaxX = state.chart.view.maxX === null ? maxX : Number(state.chart.view.maxX);
    if (!Number.isFinite(viewMinX) || !Number.isFinite(viewMaxX) || viewMaxX <= viewMinX) {
      viewMinX = minX;
      viewMaxX = maxX;
    }
    viewMinX = clamp(viewMinX, minX, maxX);
    viewMaxX = clamp(viewMaxX, minX, maxX);

    const padL = 44;
    const padR = 18;
    const padT = 14;
    const padB = 26;
    const plotW = Math.max(1, w - padL - padR);
    const plotH = Math.max(1, h - padT - padB);

    const gap = 12;
    const bottomMetric = String(opts.bottomMetric || "chargeDrain");
    let bottomH = Math.max(84, Math.round(plotH * 0.32));
    let topH = Math.max(120, plotH - bottomH - gap);
    if (topH + bottomH + gap > plotH) bottomH = Math.max(60, plotH - topH - gap);
    if (plotH < 210) {
      bottomH = Math.max(64, Math.round(plotH * 0.36));
      topH = Math.max(110, plotH - bottomH - gap);
    }

    const topPanel = { x: padL, y: padT, w: plotW, h: topH };
    const bottomPanel = { x: padL, y: padT + topH + gap, w: plotW, h: bottomH };
    const plotY0 = padT;
    const plotY1 = padT + plotH;

    const xScale = viewMaxX === viewMinX ? 1 : plotW / (viewMaxX - viewMinX);
    const xOf = (x) => padL + (x - viewMinX) * xScale;
    const xToValue = (px) => viewMinX + (px - padL) / Math.max(1e-9, xScale);

    const i0 = clamp(lowerBound(xs, viewMinX), 0, xs.length - 1);
    const i1 = clamp(upperBound(xs, viewMaxX) - 1, 0, xs.length - 1);

    state.chart.cache = {
      xs,
      minX,
      maxX,
      viewMinX,
      viewMaxX,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      plotY0,
      plotY1,
      topPanel,
      bottomPanel,
      xScale,
      i0,
      i1,
      isTime,
    };

    const yScore = (v) => topPanel.y + (100 - clamp(v, 0, 100)) * (topPanel.h / 100);

    // Top grid
    ctx.save();
    ctx.strokeStyle = "rgba(36, 50, 82, 0.55)";
    ctx.lineWidth = 1;
    for (let y = 0; y <= 100; y += 20) {
      const yy = yScore(y);
      ctx.beginPath();
      ctx.moveTo(topPanel.x, yy);
      ctx.lineTo(topPanel.x + topPanel.w, yy);
      ctx.stroke();
    }
    ctx.restore();

    // Sleep shading (per stage)
    if (opts.showSleep) {
      const stageFill = (stage) => {
        switch (stage) {
          case "deep":
            return "rgba(122, 162, 255, 0.16)";
          case "rem":
            return "rgba(166, 122, 255, 0.14)";
          case "inBed":
            return "rgba(122, 162, 255, 0.08)";
          case "awake":
            return "rgba(255, 223, 122, 0.06)";
          case "core":
          default:
            return "rgba(122, 162, 255, 0.11)";
        }
      };

      ctx.save();
      let segStart = null;
      let segStage = null;
      const flush = (endIdxOrNull) => {
        if (segStart === null) return;
        const x0 = xOf(xs[segStart]);
        const x1 = endIdxOrNull === null ? topPanel.x + topPanel.w : xOf(xs[endIdxOrNull]);
        const wRect = Math.max(0, x1 - x0);
        if (wRect > 0.5) {
          ctx.fillStyle = stageFill(segStage);
          ctx.fillRect(x0, topPanel.y, wRect, topPanel.h);
        }
        segStart = null;
        segStage = null;
      };

      for (let i = i0; i <= i1; i++) {
        const r = series[i];
        const isSleep = r.context?.kind === "SLEEP";
        const stage = isSleep ? String(r.context?.sleepStage ?? "core") : null;
        if (isSleep) {
          if (segStart === null) {
            segStart = i;
            segStage = stage;
          } else if (stage !== segStage) {
            flush(i);
            segStart = i;
            segStage = stage;
          }
        } else {
          flush(i);
        }
      }
      flush(null);
      ctx.restore();
    }

    // Activity shading (workout/mindful)
    if (opts.showEvents) {
      const kindFill = (kind) => {
        switch (kind) {
          case "WORKOUT":
            return "rgba(255, 107, 107, 0.10)";
          case "HIGH_ACTIVITY":
            return "rgba(255, 183, 77, 0.07)";
          case "ACTIVE":
            return "rgba(61, 220, 151, 0.05)";
          case "LIGHT_ACTIVITY":
            return "rgba(61, 220, 151, 0.03)";
          case "MEDITATION":
            return "rgba(122, 162, 255, 0.07)";
          default:
            return null;
        }
      };

      ctx.save();
      let segStart = null;
      let segKind = null;
      const flush = (endIdxOrNull) => {
        if (segStart === null || !segKind) return;
        const fill = kindFill(segKind);
        if (!fill) {
          segStart = null;
          segKind = null;
          return;
        }
        const x0 = xOf(xs[segStart]);
        const x1 = endIdxOrNull === null ? topPanel.x + topPanel.w : xOf(xs[endIdxOrNull]);
        const wRect = Math.max(0, x1 - x0);
        if (wRect > 0.5) {
          ctx.fillStyle = fill;
          ctx.fillRect(x0, topPanel.y, wRect, topPanel.h);
        }
        segStart = null;
        segKind = null;
      };

      for (let i = i0; i <= i1; i++) {
        const kind = series[i].context?.kind ?? null;
        const fill = kindFill(kind);
        if (fill) {
          if (segStart === null) {
            segStart = i;
            segKind = kind;
          } else if (kind !== segKind) {
            flush(i);
            segStart = i;
            segKind = kind;
          }
        } else {
          flush(i);
        }
      }
      flush(null);
      ctx.restore();
    }

    // Reserve fill
    if (opts.showReserve) {
      ctx.save();
      ctx.beginPath();
      drawLine(ctx, xs, series, i0, i1, xOf, yScore, (r) => r.bbNext);
      const firstX = xOf(xs[i0]);
      const lastX = xOf(xs[i1]);
      ctx.lineTo(lastX, topPanel.y + topPanel.h);
      ctx.lineTo(firstX, topPanel.y + topPanel.h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, topPanel.y, 0, topPanel.y + topPanel.h);
      grad.addColorStop(0, "rgba(61, 220, 151, 0.22)");
      grad.addColorStop(1, "rgba(61, 220, 151, 0.02)");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }

    // Top lines
    const drawTopSeries = (enabled, color, width, getY, dash = null) => {
      if (!enabled) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      drawLine(ctx, xs, series, i0, i1, xOf, yScore, getY);
      ctx.stroke();
      ctx.restore();
    };

    drawTopSeries(opts.showReserve, "rgba(61, 220, 151, 0.95)", 2.2, (r) => r.bbNext);
    drawTopSeries(opts.showComfort, "rgba(122, 162, 255, 0.95)", 1.8, (r) => r.comfortScore);
    drawTopSeries(opts.showFatigue, "rgba(255, 183, 77, 0.95)", 1.6, (r) => r.fatigueScore, [6, 4]);

    // Top axis labels
    ctx.save();
    ctx.fillStyle = "rgba(157, 176, 218, 0.95)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillText("100", 8, yScore(100) + 4);
    ctx.fillText("50", 14, yScore(50) + 4);
    ctx.fillText("0", 18, yScore(0) + 4);
    ctx.restore();

    // Bottom panel
    const bottomMinMax = () => {
      let minV = Infinity;
      let maxV = -Infinity;
      const upd = (v) => {
        if (!Number.isFinite(v)) return;
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      };
      for (let i = i0; i <= i1; i++) upd(getBottomValue(series[i], bottomMetric));
      if (minV === Infinity || maxV === -Infinity) return null;
      return { minV, maxV };
    };

    function getBottomValue(r, metric) {
      switch (metric) {
        case "confidence":
          return r.confidence;
        case "hr":
          return r.input?.hr ?? null;
        case "steps": {
          const dtMin = Number(r.dtMinutes ?? 0) || 0;
          return dtMin > 0 ? Number(r.input?.steps ?? 0) / dtMin : null;
        }
        case "power":
          return r.input?.power ?? null;
        case "chargeDrain":
        default:
          return null;
      }
    }

    const drawBottomGridLine = (yy) => {
      ctx.beginPath();
      ctx.moveTo(bottomPanel.x, yy);
      ctx.lineTo(bottomPanel.x + bottomPanel.w, yy);
      ctx.stroke();
    };

    if (bottomMetric === "chargeDrain") {
      let maxAbs = 0;
      for (let i = i0; i <= i1; i++) {
        maxAbs = Math.max(maxAbs, Number(series[i].chargePerHour ?? 0) || 0, Number(series[i].drainPerHour ?? 0) || 0);
      }
      maxAbs = Math.max(1, maxAbs);
      const yRate = (v) =>
        bottomPanel.y + (maxAbs - clamp(v, -maxAbs, maxAbs)) * (bottomPanel.h / (2 * maxAbs));
      const yZero = yRate(0);

      ctx.save();
      ctx.strokeStyle = "rgba(36, 50, 82, 0.55)";
      ctx.lineWidth = 1;
      drawBottomGridLine(yRate(maxAbs));
      drawBottomGridLine(yZero);
      drawBottomGridLine(yRate(-maxAbs));
      ctx.restore();

      ctx.save();
      ctx.fillStyle = "rgba(122, 162, 255, 0.70)";
      for (let i = i0; i <= i1; i++) {
        const cph = Number(series[i].chargePerHour ?? 0) || 0;
        if (cph <= 0) continue;
        const x0 = xOf(xs[i]);
        const x1 = i < i1 ? xOf(xs[i + 1]) : bottomPanel.x + bottomPanel.w;
        const bw = Math.max(1, (x1 - x0) * 0.9);
        const y = yRate(cph);
        ctx.fillRect(x0, y, bw, yZero - y);
      }
      ctx.fillStyle = "rgba(255, 107, 107, 0.75)";
      for (let i = i0; i <= i1; i++) {
        const dph = Number(series[i].drainPerHour ?? 0) || 0;
        if (dph <= 0) continue;
        const x0 = xOf(xs[i]);
        const x1 = i < i1 ? xOf(xs[i + 1]) : bottomPanel.x + bottomPanel.w;
        const bw = Math.max(1, (x1 - x0) * 0.9);
        const y = yRate(-dph);
        ctx.fillRect(x0, yZero, bw, y - yZero);
      }
      ctx.restore();

      ctx.save();
      ctx.fillStyle = "rgba(157, 176, 218, 0.95)";
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillText(`+${Math.round(maxAbs)}`, 6, yRate(maxAbs) + 4);
      ctx.fillText("0", 14, yZero + 4);
      ctx.fillText(`-${Math.round(maxAbs)}`, 6, yRate(-maxAbs) + 4);
      ctx.fillText("Charge/Drain per hour", bottomPanel.x + 6, bottomPanel.y + 14);
      ctx.restore();
    } else {
      const mm = bottomMinMax();
      const minV = mm ? mm.minV : 0;
      const maxV = mm ? mm.maxV : 1;
      const span = Math.max(1e-9, maxV - minV);
      const pad = span * 0.08;
      const v0 = bottomMetric === "confidence" ? 0 : minV - pad;
      const v1 = bottomMetric === "confidence" ? 1 : maxV + pad;
      const yOf = (v) => bottomPanel.y + (v1 - clamp(v, v0, v1)) * (bottomPanel.h / Math.max(1e-9, v1 - v0));

      ctx.save();
      ctx.strokeStyle = "rgba(36, 50, 82, 0.55)";
      ctx.lineWidth = 1;
      drawBottomGridLine(yOf(v0));
      drawBottomGridLine(yOf((v0 + v1) / 2));
      drawBottomGridLine(yOf(v1));
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = "rgba(207, 224, 255, 0.85)";
      ctx.lineWidth = 1.6;
      if (bottomMetric === "confidence") ctx.setLineDash([5, 4]);
      ctx.beginPath();
      drawLine(ctx, xs, series, i0, i1, xOf, yOf, (r) => getBottomValue(r, bottomMetric));
      ctx.stroke();
      ctx.restore();

      const label =
        bottomMetric === "confidence"
          ? "Confidence"
          : bottomMetric === "hr"
            ? "Heart rate (bpm)"
            : bottomMetric === "steps"
              ? "Steps/min"
              : bottomMetric === "power"
                ? "Power (W)"
                : "Metric";

      ctx.save();
      ctx.fillStyle = "rgba(157, 176, 218, 0.95)";
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillText(label, bottomPanel.x + 6, bottomPanel.y + 14);
      ctx.fillText(Number(v1).toFixed(bottomMetric === "confidence" ? 1 : 0), 6, yOf(v1) + 4);
      ctx.fillText(Number((v0 + v1) / 2).toFixed(bottomMetric === "confidence" ? 1 : 0), 6, yOf((v0 + v1) / 2) + 4);
      ctx.fillText(Number(v0).toFixed(bottomMetric === "confidence" ? 1 : 0), 6, yOf(v0) + 4);
      ctx.restore();
    }

    // X axis ticks
    if (isTime) {
      const ticks = computeTimeTicks(viewMinX, viewMaxX, 7);
      const rangeMs = viewMaxX - viewMinX;
      ctx.save();
      ctx.strokeStyle = "rgba(36, 50, 82, 0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, plotY1);
      ctx.lineTo(padL + plotW, plotY1);
      ctx.stroke();
      ctx.fillStyle = "rgba(157, 176, 218, 0.95)";
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      for (const t of ticks) {
        const x = xOf(t);
        if (x < padL - 2 || x > padL + plotW + 2) continue;
        ctx.beginPath();
        ctx.moveTo(x, plotY1);
        ctx.lineTo(x, plotY1 + 6);
        ctx.stroke();
        const label = formatTimeTick(t, rangeMs);
        const tw = ctx.measureText(label).width;
        ctx.fillText(label, x - tw / 2, plotY1 + 18);
      }
      ctx.restore();
    }

    // Hover crosshair + tooltip
    const hoverIdx = state.chart.hover.idx;
    const hoverPx = state.chart.hover.px;
    if (hoverIdx !== null && hoverIdx !== undefined && hoverIdx >= i0 && hoverIdx <= i1) {
      const x = xOf(xs[hoverIdx]);
      ctx.save();
      ctx.strokeStyle = "rgba(207, 224, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plotY0);
      ctx.lineTo(x, plotY1);
      ctx.stroke();
      ctx.restore();

      const dot = (y, color) => {
        if (!Number.isFinite(y)) return;
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      if (opts.showReserve) dot(yScore(series[hoverIdx].bbNext), "rgba(61, 220, 151, 0.95)");
      if (opts.showComfort) dot(yScore(series[hoverIdx].comfortScore), "rgba(122, 162, 255, 0.95)");
      if (opts.showFatigue) dot(yScore(series[hoverIdx].fatigueScore), "rgba(255, 183, 77, 0.95)");

      if (tip && wrap && hoverPx) {
        tip.innerHTML = buildChartTooltipHtml(series[hoverIdx]);
        tip.hidden = false;
        const pos = clampToCanvasTooltip(wrap, tip, hoverPx.x + 12, hoverPx.y + 12);
        tip.style.left = `${pos.left}px`;
        tip.style.top = `${pos.top}px`;
      }
    }

    // Drag selection overlay (zoom)
    if (state.chart.drag.active && Number.isFinite(state.chart.drag.startPx) && Number.isFinite(state.chart.drag.endPx)) {
      const x0 = clamp(Math.min(state.chart.drag.startPx, state.chart.drag.endPx), padL, padL + plotW);
      const x1 = clamp(Math.max(state.chart.drag.startPx, state.chart.drag.endPx), padL, padL + plotW);
      ctx.save();
      ctx.fillStyle = "rgba(122, 162, 255, 0.12)";
      ctx.strokeStyle = "rgba(122, 162, 255, 0.45)";
      ctx.lineWidth = 1;
      ctx.fillRect(x0, plotY0, Math.max(0, x1 - x0), plotH);
      ctx.strokeRect(x0 + 0.5, plotY0 + 0.5, Math.max(0, x1 - x0) - 1, plotH - 1);
      ctx.restore();
    }

    // Keep tooltip hidden when not hovering
    if ((hoverIdx === null || hoverIdx === undefined) && tip) tip.hidden = true;

    // Hide tooltip when hovering but no px (shouldn't happen)
    if (hoverIdx !== null && hoverIdx !== undefined && !hoverPx && tip) tip.hidden = true;

    // Persist hover mapping helpers for event handlers (only numbers)
    state.chart.cache.xToValue = xToValue;
  }

  function renderResultTable(series) {
    const tbody = document.querySelector("#resultTable tbody");
    tbody.textContent = "";

    const rows = series.slice(0, 250);
    for (const r of rows) {
      const tr = document.createElement("tr");
      const td = (text) => {
        const cell = document.createElement("td");
        cell.textContent = text;
        return cell;
      };

      const time = r.tsMs ? new Date(r.tsMs).toLocaleString() : "-";
      const ctx =
        r.context?.kind === "SLEEP"
          ? `SLEEP:${r.context?.sleepStage ?? ""}`
          : r.context?.kind ?? "-";
      tr.appendChild(td(String(r.i)));
      tr.appendChild(td(time));
      tr.appendChild(td(ctx));
      tr.appendChild(td(r.bbNext.toFixed(1)));
      tr.appendChild(td(Number.isFinite(r.comfortScore) ? r.comfortScore.toFixed(0) : "-"));
      tr.appendChild(td(Number.isFinite(r.fatigueScore) ? r.fatigueScore.toFixed(0) : "-"));
      const dC = r.temperature?.deltaC;
      tr.appendChild(td(Number.isFinite(dC) ? dC.toFixed(2) : "-"));
      tr.appendChild(td(r.temperature?.mode ?? "-"));
      tr.appendChild(td(r.deltaCore.toFixed(2)));
      tr.appendChild(td(r.chargePoints.toFixed(2)));
      const calmIdx = Number(r.chargeComponents?.calmRecoveryIndex ?? 0);
      const calmPts = Number(r.chargeComponents?.calmRecoveryPoints ?? 0);
      tr.appendChild(td(calmIdx > 0 ? calmPts.toFixed(2) : "-"));
      tr.appendChild(td(r.drainPoints.toFixed(2)));
      tr.appendChild(td(r.confidence.toFixed(2)));
      tbody.appendChild(tr);
    }
  }

  function renderResult(result) {
    renderSummaryPills(result.summary);
    renderBaselinesTable(result.baselines);
    renderBehaviorBaseline(result.behaviorBaseline);
    drawChart(result.series);
    renderResultTable(result.series);
    $("jsonOutput").value = JSON.stringify(result, null, 2);
  }

  function sampleSegments() {
    const now = new Date();
    now.setHours(23, 0, 0, 0);

    $("startTime").value = localDateTimeValue(now);
    $("epochMinutes").value = "5";
    $("initialBB").value = "55";

    state.segments = [
      { type: "sleep_inbed", durationMin: 20, hrBpm: 62, hrvSdnnMs: 45, spo2Pct: 97, respRateBrpm: 14, wristTempC: 36.55 },
      { type: "sleep_core", durationMin: 210, hrBpm: 54, hrvSdnnMs: 60, spo2Pct: 97, respRateBrpm: 13.4, wristTempC: 36.58 },
      { type: "sleep_deep", durationMin: 70, hrBpm: 50, hrvSdnnMs: 75, spo2Pct: 97.5, respRateBrpm: 12.8, wristTempC: 36.55 },
      { type: "sleep_core", durationMin: 120, hrBpm: 55, hrvSdnnMs: 62, spo2Pct: 97.2, respRateBrpm: 13.6, wristTempC: 36.6 },
      { type: "sleep_rem", durationMin: 60, hrBpm: 59, hrvSdnnMs: 52, spo2Pct: 97, respRateBrpm: 14.7, wristTempC: 36.62 },
      { type: "awake_rest", durationMin: 45, hrBpm: 60, stepsPerMin: 0, activeEnergyPerMin: 0.2 },
      { type: "light", durationMin: 120, hrBpm: 92, stepsPerMin: 55, activeEnergyPerMin: 2 },
      { type: "workout", durationMin: 45, hrBpm: 152, stepsPerMin: 30, activeEnergyPerMin: 9.5, powerW: 215 },
      { type: "high", durationMin: 25, hrBpm: 138, stepsPerMin: 105, activeEnergyPerMin: 6.2 },
      { type: "active", durationMin: 90, hrBpm: 112, stepsPerMin: 85, activeEnergyPerMin: 4 },
      { type: "awake_rest", durationMin: 60, hrBpm: 64, stepsPerMin: 0, activeEnergyPerMin: 0.25 },
      { type: "light", durationMin: 180, hrBpm: 88, stepsPerMin: 45, activeEnergyPerMin: 1.6 },
      { type: "auto", durationMin: 180, hrBpm: 74, stepsPerMin: 5, activeEnergyPerMin: 0.8 },
    ];

    renderSegments();
  }

  function sampleJson() {
    const epochMinutes = 5;
    const start = new Date();
    start.setHours(23, 0, 0, 0);
    const startMs = start.getTime();

    const mk = (offsetMin, patch) => ({
      timestampMs: startMs + offsetMin * 60000,
      ...patch,
    });

    const epochs = [];
    for (let m = 0; m < 360; m += epochMinutes) {
      epochs.push(
        mk(m, { sleepStage: "core", hrBpm: 54, hrvSdnnMs: m % 30 === 0 ? 60 : null, spo2Pct: m % 20 === 0 ? 97 : null, respRateBrpm: m % 25 === 0 ? 13.5 : null, wristTempC: m % 25 === 0 ? 36.58 : null }),
      );
    }
    for (let m = 360; m < 420; m += epochMinutes) {
      epochs.push(mk(m, { sleepStage: "deep", hrBpm: 50, hrvSdnnMs: m % 20 === 0 ? 75 : null, spo2Pct: 97.5 }));
    }
    for (let m = 420; m < 480; m += epochMinutes) {
      epochs.push(mk(m, { sleepStage: "rem", hrBpm: 58, hrvSdnnMs: null, respRateBrpm: m % 20 === 0 ? 14.6 : null }));
    }
    for (let m = 480; m < 540; m += epochMinutes) {
      epochs.push(mk(m, { hrBpm: 62, steps: 0, activeEnergyKcal: 1 }));
    }
    for (let m = 540; m < 585; m += epochMinutes) {
      epochs.push(mk(m, { workout: true, hrBpm: 150, powerW: 210, activeEnergyKcal: 45, steps: 120 }));
    }
    for (let m = 585; m < 720; m += epochMinutes) {
      epochs.push(mk(m, { hrBpm: 98, steps: 280, activeEnergyKcal: 12 }));
    }

    return {
      epochMinutes,
      initialBB: 55,
      baselines: { rhrBpm: 60, hrvSdnnMs: 55, spo2Pct: 97, respRateBrpm: 14, wristTempC: 36.55, ftpW: 220, hrMaxBpm: 190 },
      epochs,
    };
  }

  function extractXmlAttr(tag, attrName) {
    const key = `${attrName}="`;
    const start = tag.indexOf(key);
    if (start === -1) return null;
    const valueStart = start + key.length;
    const end = tag.indexOf('"', valueStart);
    if (end === -1) return null;
    return tag.slice(valueStart, end);
  }

  function parseAppleHealthDateMs(value) {
    if (!value) return null;
    const s = String(value).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?: ([+-]\d{4}))?$/);
    if (m) {
      const [, yyyy, mm, dd, hh, mi, ss, tz] = m;
      let iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
      if (tz) iso += `${tz.slice(0, 3)}:${tz.slice(3)}`;
      const t = Date.parse(iso);
      return Number.isFinite(t) ? t : null;
    }
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }

  function sleepStageFromAppleHealth(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    const lower = s.toLowerCase();

    if (s === "HKCategoryValueSleepAnalysisInBed" || s === "0") return "inBed";
    if (s === "HKCategoryValueSleepAnalysisAsleep" || s === "1") return "core";

    if (lower === "in bed" || lower === "inbed") return "inBed";
    if (lower === "awake") return "awake";
    if (lower === "rem") return "rem";
    if (lower === "core") return "core";
    if (lower === "deep") return "deep";
    if (lower === "asleep") return "core";

    if (lower.includes("asleep") && lower.includes("deep")) return "deep";
    if (lower.includes("asleep") && lower.includes("rem")) return "rem";
    if (lower.includes("asleep") && lower.includes("core")) return "core";
    if (lower.includes("in bed")) return "inBed";
    if (lower.includes("awake")) return "awake";
    if (lower.includes("asleep")) return "core";
    return null;
  }

  function normalizeOxygenSaturationPct(value, unit) {
    const v = Number(value);
    if (!Number.isFinite(v)) return null;
    if (unit === "%") return v <= 1.5 ? v * 100 : v;
    return v <= 1.5 ? v * 100 : v;
  }

  function normalizeEnergyKcal(value, unit) {
    const v = Number(value);
    if (!Number.isFinite(v)) return null;
    if (unit === "kJ") return v / 4.184;
    return v;
  }

  async function isZipFile(file) {
    if (!file) return false;
    const buf = await file.slice(0, 4).arrayBuffer();
    const b = new Uint8Array(buf);
    return b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b; // PK..
  }

  function guessCsvDelimiter(line) {
    const s = String(line || "");
    const comma = (s.match(/,/g) || []).length;
    const semi = (s.match(/;/g) || []).length;
    const tab = (s.match(/\t/g) || []).length;
    if (semi > comma && semi > tab) return ";";
    if (tab > comma && tab > semi) return "\t";
    return ",";
  }

  function parseCsvLine(line, delimiter) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    const d = delimiter || ",";

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        continue;
      }

      if (ch === d) {
        out.push(cur);
        cur = "";
        continue;
      }

      cur += ch;
    }
    out.push(cur);
    return out;
  }

  function normalizeCsvHeaderName(name) {
    return String(name || "")
      .replace(/^\ufeff/, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
  }

  function buildCsvHeaderIndex(headerFields) {
    const idx = new Map();
    for (let i = 0; i < headerFields.length; i++) {
      const key = normalizeCsvHeaderName(headerFields[i]);
      if (!key) continue;
      if (!idx.has(key)) idx.set(key, i);
    }
    return idx;
  }

  function findCsvColumn(headerIndex, aliases) {
    for (const a of aliases) {
      const i = headerIndex.get(a);
      if (i !== undefined) return i;
    }
    return -1;
  }

  function inferAppleHealthRecordTypeFromHint(hint) {
    if (!hint) return null;
    const s = String(hint).trim().toLowerCase();

    if (s.includes("hkquantitytypeidentifierheartratevariabilitysdnn") || (s.includes("variability") && s.includes("sdnn")) || s.includes("hrv")) {
      return "HKQuantityTypeIdentifierHeartRateVariabilitySDNN";
    }
    if (s.includes("hkquantitytypeidentifierheartrate") || s.includes("heart rate") || s.includes("heartrate")) return "HKQuantityTypeIdentifierHeartRate";
    if (s.includes("hkquantitytypeidentifierstepcount") || s.includes("step count") || s.includes("steps")) return "HKQuantityTypeIdentifierStepCount";
    if (s.includes("hkquantitytypeidentifieractiveenergyburned") || s.includes("active energy") || s.includes("energy burned") || s.includes("activeenergy")) {
      return "HKQuantityTypeIdentifierActiveEnergyBurned";
    }
    if (s.includes("hkquantitytypeidentifieroxygensaturation") || s.includes("oxygen saturation") || s.includes("spo2") || s.includes("o2 saturation")) {
      return "HKQuantityTypeIdentifierOxygenSaturation";
    }
    if (s.includes("hkquantitytypeidentifierrespiratoryrate") || s.includes("respiratory rate") || s.includes("respiration") || s.includes("breath")) {
      return "HKQuantityTypeIdentifierRespiratoryRate";
    }
    if (s.includes("hkcategorytypeidentifiersleepanalysis") || s.includes("sleep analysis") || s.includes("sleep")) return "HKCategoryTypeIdentifierSleepAnalysis";
    if (s.includes("hkcategorytypeidentifiermindfulsession") || s.includes("mindful")) return "HKCategoryTypeIdentifierMindfulSession";
    if (
      s.includes("hkquantitytypeidentifierapplesleepingwristtemperature") ||
      s.includes("sleeping wrist temperature") ||
      s.includes("wrist temperature") ||
      (s.includes("temperature") && s.includes("wrist"))
    ) {
      return "HKQuantityTypeIdentifierAppleSleepingWristTemperature";
    }
    if (s.includes("hkquantitytypeidentifierwristtemperature")) return "HKQuantityTypeIdentifierWristTemperature";
    if (s.includes("hkquantitytypeidentifierbodytemperature") || (s.includes("temperature") && s.includes("body"))) return "HKQuantityTypeIdentifierBodyTemperature";
    if (s.includes("hkquantitytypeidentifiercyclingpower") || (s.includes("cycling") && s.includes("power"))) return "HKQuantityTypeIdentifierCyclingPower";
    if (s.includes("hkquantitytypeidentifierrunningpower") || (s.includes("running") && s.includes("power"))) return "HKQuantityTypeIdentifierRunningPower";
    return null;
  }

  function resolveAppleHealthRecordType(typeRaw, fileInferredType, fileName) {
    const raw = typeRaw === null || typeRaw === undefined ? "" : String(typeRaw).trim();
    if (raw) {
      if (raw.startsWith("HKQuantityTypeIdentifier") || raw.startsWith("HKCategoryTypeIdentifier")) return raw;
      const inferredFromRaw = inferAppleHealthRecordTypeFromHint(raw);
      if (inferredFromRaw) return inferredFromRaw;
    }
    if (fileInferredType) return fileInferredType;
    const inferredFromName = inferAppleHealthRecordTypeFromHint(fileName);
    if (inferredFromName) return inferredFromName;
    return null;
  }

  function buildAppleHealthEpochGrid(startMs, endMs, epochMinutes) {
    const msPerEpoch = epochMinutes * 60000;
    const count = Math.ceil((endMs - startMs) / msPerEpoch);
    if (!Number.isFinite(count) || count <= 0) throw new Error("时间范围无效：end <= start。");
    if (count > 20000) {
      throw new Error(`时间范围过大：将生成 ${count} 个 epoch（上限 20000）。请缩小时间范围或增大 epochMinutes。`);
    }

    const zeros = () => Array.from({ length: count }, () => 0);
    return {
      startMs,
      endMs,
      epochMinutes,
      msPerEpoch,
      count,
      stepsSum: zeros(),
      activeEnergySum: zeros(),
      hrSum: zeros(),
      hrW: zeros(),
      hrvSum: zeros(),
      hrvW: zeros(),
      spo2Sum: zeros(),
      spo2W: zeros(),
      rrSum: zeros(),
      rrW: zeros(),
      tempSum: zeros(),
      tempW: zeros(),
      powerSum: zeros(),
      powerW: zeros(),
      sleepMs: Array.from({ length: count }, () => ({ deep: 0, core: 0, rem: 0, inBed: 0, awake: 0 })),
      workout: Array.from({ length: count }, () => false),
      workoutType: Array.from({ length: count }, () => null),
      mindful: Array.from({ length: count }, () => false),
    };
  }

  const APPLE_HEALTH_WANT_TYPES = new Set([
    "HKQuantityTypeIdentifierHeartRate",
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
    "HKQuantityTypeIdentifierStepCount",
    "HKQuantityTypeIdentifierActiveEnergyBurned",
    "HKQuantityTypeIdentifierOxygenSaturation",
    "HKQuantityTypeIdentifierRespiratoryRate",
    "HKCategoryTypeIdentifierSleepAnalysis",
    "HKCategoryTypeIdentifierMindfulSession",
    "HKQuantityTypeIdentifierAppleSleepingWristTemperature",
    "HKQuantityTypeIdentifierWristTemperature",
    "HKQuantityTypeIdentifierBodyTemperature",
    "HKQuantityTypeIdentifierCyclingPower",
    "HKQuantityTypeIdentifierRunningPower",
  ]);

  function applyAppleHealthRecordToGrid(grid, record, options) {
    const type = record && record.type ? String(record.type) : null;
    if (!type || !APPLE_HEALTH_WANT_TYPES.has(type)) return false;

    const s0 = Number(record.startMs);
    const e0 = Number(record.endMs);
    if (!Number.isFinite(s0) || !Number.isFinite(e0)) return false;
    const s = Math.min(s0, e0);
    const e = Math.max(s0, e0);
    if (e <= grid.startMs || s >= grid.endMs) return false;

    const includeMindful = options && options.includeMindful !== undefined ? Boolean(options.includeMindful) : true;
    const valueRaw = record.value;
    const unit = record.unit;

    if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
      const stage = sleepStageFromAppleHealth(valueRaw);
      if (!stage) return false;
      addSleepStage(grid, stage, s, e);
      return true;
    }

    if (type === "HKCategoryTypeIdentifierMindfulSession") {
      if (!includeMindful) return false;
      setBooleanFlag(grid.mindful, grid, s, e);
      return true;
    }

    if (type === "HKQuantityTypeIdentifierHeartRate") {
      const v = Number(valueRaw);
      if (!Number.isFinite(v)) return false;
      addWeightedAvg(grid.hrSum, grid.hrW, grid, v, s, e);
      return true;
    }

    if (type === "HKQuantityTypeIdentifierHeartRateVariabilitySDNN") {
      const v = Number(valueRaw);
      if (!Number.isFinite(v)) return false;
      addWeightedAvg(grid.hrvSum, grid.hrvW, grid, v, s, e);
      return true;
    }

    if (type === "HKQuantityTypeIdentifierOxygenSaturation") {
      const v = normalizeOxygenSaturationPct(valueRaw, unit);
      if (v === null) return false;
      addWeightedAvg(grid.spo2Sum, grid.spo2W, grid, v, s, e);
      return true;
    }

    if (type === "HKQuantityTypeIdentifierRespiratoryRate") {
      const v = Number(valueRaw);
      if (!Number.isFinite(v)) return false;
      addWeightedAvg(grid.rrSum, grid.rrW, grid, v, s, e);
      return true;
    }

    if (
      type === "HKQuantityTypeIdentifierAppleSleepingWristTemperature" ||
      type === "HKQuantityTypeIdentifierWristTemperature" ||
      type === "HKQuantityTypeIdentifierBodyTemperature"
    ) {
      const v = Number(valueRaw);
      if (!Number.isFinite(v)) return false;
      addWeightedAvg(grid.tempSum, grid.tempW, grid, v, s, e);
      return true;
    }

    if (type === "HKQuantityTypeIdentifierCyclingPower" || type === "HKQuantityTypeIdentifierRunningPower") {
      const v = Number(valueRaw);
      if (!Number.isFinite(v)) return false;
      addWeightedAvg(grid.powerSum, grid.powerW, grid, v, s, e);
      return true;
    }

    if (type === "HKQuantityTypeIdentifierStepCount") {
      const v = Number(valueRaw);
      if (!Number.isFinite(v)) return false;
      addAdditiveSum(grid.stepsSum, grid, v, s, e);
      return true;
    }

    if (type === "HKQuantityTypeIdentifierActiveEnergyBurned") {
      const kcal = normalizeEnergyKcal(valueRaw, unit);
      if (kcal === null) return false;
      addAdditiveSum(grid.activeEnergySum, grid, kcal, s, e);
      return true;
    }

    return false;
  }

  function forEachOverlappingEpoch(grid, intervalStartMs, intervalEndMs, fn) {
    let s = intervalStartMs;
    let e = intervalEndMs;
    if (!Number.isFinite(s) || !Number.isFinite(e)) return;
    if (e <= s) e = s + 1;

    const startMs = grid.startMs;
    const endMs = grid.endMs;
    if (e <= startMs || s >= endMs) return;
    s = Math.max(s, startMs);
    e = Math.min(e, endMs);
    if (e <= s) return;

    const msPerEpoch = grid.msPerEpoch;
    const startIdx = Math.max(0, Math.floor((s - startMs) / msPerEpoch));
    const endIdx = Math.min(grid.count - 1, Math.floor((e - 1 - startMs) / msPerEpoch));
    const totalMs = Math.max(1, intervalEndMs - intervalStartMs);

    for (let i = startIdx; i <= endIdx; i++) {
      const epStart = startMs + i * msPerEpoch;
      const epEnd = epStart + msPerEpoch;
      const ovStart = Math.max(s, epStart);
      const ovEnd = Math.min(e, epEnd);
      const overlapMs = Math.max(0, ovEnd - ovStart);
      if (overlapMs <= 0) continue;
      fn(i, overlapMs, totalMs);
    }
  }

  function addAdditiveSum(sumArr, grid, value, startMs, endMs) {
    if (!Number.isFinite(value)) return;
    forEachOverlappingEpoch(grid, startMs, endMs, (i, overlapMs, totalMs) => {
      sumArr[i] += value * (overlapMs / totalMs);
    });
  }

  function addWeightedAvg(sumArr, wArr, grid, value, startMs, endMs) {
    if (!Number.isFinite(value)) return;
    forEachOverlappingEpoch(grid, startMs, endMs, (i, overlapMs) => {
      sumArr[i] += value * overlapMs;
      wArr[i] += overlapMs;
    });
  }

  function addSleepStage(grid, stage, startMs, endMs) {
    if (!stage) return;
    forEachOverlappingEpoch(grid, startMs, endMs, (i, overlapMs) => {
      grid.sleepMs[i][stage] += overlapMs;
    });
  }

  function setBooleanFlag(flagArr, grid, startMs, endMs, onStart) {
    forEachOverlappingEpoch(grid, startMs, endMs, (i) => {
      if (!flagArr[i] && typeof onStart === "function") onStart(i);
      flagArr[i] = true;
    });
  }

  function finalizeAppleHealthEpochs(grid) {
    const stagePriority = { deep: 50, rem: 40, core: 30, inBed: 20, awake: 10 };

    const epochs = [];
    for (let i = 0; i < grid.count; i++) {
      const e = { timestampMs: grid.startMs + i * grid.msPerEpoch };

      if (grid.hrW[i] > 0) e.hrBpm = grid.hrSum[i] / grid.hrW[i];
      if (grid.hrvW[i] > 0) e.hrvSdnnMs = grid.hrvSum[i] / grid.hrvW[i];
      if (grid.spo2W[i] > 0) e.spo2Pct = grid.spo2Sum[i] / grid.spo2W[i];
      if (grid.rrW[i] > 0) e.respRateBrpm = grid.rrSum[i] / grid.rrW[i];
      if (grid.tempW[i] > 0) e.wristTempC = grid.tempSum[i] / grid.tempW[i];
      if (grid.powerW[i] > 0) e.powerW = grid.powerSum[i] / grid.powerW[i];

      if (grid.stepsSum[i] > 0.0001) e.steps = Math.round(grid.stepsSum[i]);
      if (grid.activeEnergySum[i] > 0.0001) e.activeEnergyKcal = grid.activeEnergySum[i];

      const sleep = grid.sleepMs[i];
      let bestStage = null;
      let bestMs = 0;
      let bestPriority = -1;
      for (const stage of Object.keys(sleep)) {
        const ms = sleep[stage] || 0;
        const pri = stagePriority[stage] ?? 0;
        if (ms > bestMs || (ms === bestMs && pri > bestPriority)) {
          bestStage = stage;
          bestMs = ms;
          bestPriority = pri;
        }
      }
      if (bestStage && bestMs > 0) e.sleepStage = bestStage;

      if (grid.workout[i]) {
        e.workout = true;
        if (grid.workoutType[i]) e.workoutType = grid.workoutType[i];
      }
      if (grid.mindful[i]) e.mindful = true;

      epochs.push(e);
    }
    return epochs;
  }

  async function parseAppleHealthExport(file, options) {
    const { startMs, endMs, epochMinutes, includeWorkouts, includeMindful, onProgress } = options || {};
    if (!file) throw new Error("缺少文件。");
    if (await isZipFile(file)) throw new Error("检测到 ZIP：请先解压后选择其中的 export.xml。");
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error("请选择有效的时间范围。");

    const grid = buildAppleHealthEpochGrid(startMs, endMs, epochMinutes);

    let bytesRead = 0;
    let recordSeen = 0;
    let recordUsed = 0;
    let workoutSeen = 0;

    const totalBytes = Number.isFinite(file.size) ? file.size : null;
    const progressTick = () => {
      if (typeof onProgress !== "function") return;
      onProgress({ bytesRead, totalBytes, recordSeen, recordUsed, workoutSeen });
    };

    const handleRecord = (tag) => {
      recordSeen++;
      const type = extractXmlAttr(tag, "type");
      if (!type || !APPLE_HEALTH_WANT_TYPES.has(type)) return;

      const start = parseAppleHealthDateMs(extractXmlAttr(tag, "startDate"));
      const end = parseAppleHealthDateMs(extractXmlAttr(tag, "endDate"));
      if (start === null || end === null) return;
      const s = Math.min(start, end);
      const e = Math.max(start, end);
      if (e <= grid.startMs || s >= grid.endMs) return;

      const used = applyAppleHealthRecordToGrid(
        grid,
        {
          type,
          startMs: s,
          endMs: e,
          value: extractXmlAttr(tag, "value"),
          unit: extractXmlAttr(tag, "unit"),
        },
        { includeMindful },
      );
      if (used) recordUsed++;
    };

    const handleWorkout = (tag) => {
      workoutSeen++;
      if (!includeWorkouts) return;

      const start = parseAppleHealthDateMs(extractXmlAttr(tag, "startDate"));
      const end = parseAppleHealthDateMs(extractXmlAttr(tag, "endDate"));
      if (start === null || end === null) return;
      const s = Math.min(start, end);
      const e = Math.max(start, end);
      if (e <= grid.startMs || s >= grid.endMs) return;

      const workoutType = extractXmlAttr(tag, "workoutActivityType");
      setBooleanFlag(grid.workout, grid, s, e, (idx) => {
        if (workoutType && !grid.workoutType[idx]) grid.workoutType[idx] = workoutType;
      });
    };

    const processBuffer = (buffer) => {
      let buf = buffer;
      while (true) {
        const idxRecord = buf.indexOf("<Record ");
        const idxWorkout = buf.indexOf("<Workout ");
        let idx = -1;
        let kind = null;
        if (idxRecord !== -1 && (idxWorkout === -1 || idxRecord < idxWorkout)) {
          idx = idxRecord;
          kind = "record";
        } else if (idxWorkout !== -1) {
          idx = idxWorkout;
          kind = "workout";
        } else {
          break;
        }

        if (idx > 0) buf = buf.slice(idx);

        if (kind === "record") {
          const closeSelf = buf.indexOf("/>");
          const closeAngle = buf.indexOf(">");
          const endIdx = closeSelf !== -1 ? closeSelf + 2 : closeAngle !== -1 ? closeAngle + 1 : -1;
          if (endIdx === -1) break;
          handleRecord(buf.slice(0, endIdx));
          buf = buf.slice(endIdx);
          continue;
        }

        if (kind === "workout") {
          const endIdx = buf.indexOf(">");
          if (endIdx === -1) break;
          handleWorkout(buf.slice(0, endIdx + 1));
          buf = buf.slice(endIdx + 1);
        }
      }

      const keepTail = 4096;
      if (buf.length > keepTail) return buf.slice(buf.length - keepTail);
      return buf;
    };

    const decoder = new TextDecoder("utf-8");
    let carry = "";
    let lastProgressAt = 0;

    // Chunked slicing: avoid loading big export.xml into memory at once.
    const chunkBytes = 2 * 1024 * 1024;
    const size = Number.isFinite(file.size) ? file.size : 0;
    for (let offset = 0; offset < size; offset += chunkBytes) {
      const buf = await file.slice(offset, offset + chunkBytes).arrayBuffer();
      bytesRead += buf.byteLength;
      carry += decoder.decode(buf, { stream: true });
      carry = processBuffer(carry);
      if (bytesRead - lastProgressAt >= 2 * 1024 * 1024) {
        lastProgressAt = bytesRead;
        progressTick();
      }
    }
    carry += decoder.decode();
    carry = processBuffer(carry);
    progressTick();

    const epochs = finalizeAppleHealthEpochs(grid);
    return { epochs, stats: { bytesRead, recordSeen, recordUsed, workoutSeen, epochCount: grid.count } };
  }

  async function parseAppleHealthCsvFiles(files, options) {
    const { startMs, endMs, epochMinutes, includeWorkouts, includeMindful, onProgress } = options || {};
    const fileList = Array.from(files || []);
    if (fileList.length === 0) throw new Error("缺少 CSV 文件。");
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error("请选择有效的时间范围。");

    const grid = buildAppleHealthEpochGrid(startMs, endMs, epochMinutes);

    let bytesRead = 0;
    let recordSeen = 0;
    let recordUsed = 0;
    let workoutSeen = 0;

    const totalBytes = fileList.reduce((sum, f) => sum + (Number.isFinite(f.size) ? f.size : 0), 0) || null;

    const progressTick = (extra) => {
      if (typeof onProgress !== "function") return;
      onProgress({ bytesRead, totalBytes, recordSeen, recordUsed, workoutSeen, ...extra });
    };

    const START_COLS = ["startdate", "starttime", "startdatetime", "start", "begindate", "begintime", "begin"];
    const END_COLS = ["enddate", "endtime", "enddatetime", "end", "finishdate", "finishtime", "finish", "stopdate", "stoptime", "stop"];
    const DATE_COLS = ["date", "datetime", "time", "timestamp"];
    const VALUE_COLS = ["value", "val", "quantity"];
    const UNIT_COLS = ["unit", "units"];
    const TYPE_COLS = ["type", "identifier", "datatype", "recordtype"];
    const WORKOUT_TYPE_COLS = ["workoutactivitytype", "activitytype", "workouttype"];

    const chunkBytes = 1024 * 1024;
    let lastProgressAt = 0;

    for (let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {
      const file = fileList[fileIndex];
      const fileName = file && file.name ? String(file.name) : `file${fileIndex + 1}.csv`;

      if (await isZipFile(file)) throw new Error(`检测到 ZIP：请先解压后选择 CSV 文件（${fileName}）。`);

      const fileInferredType = inferAppleHealthRecordTypeFromHint(fileName);
      progressTick({ fileIndex: fileIndex + 1, fileCount: fileList.length, fileName });

      const decoder = new TextDecoder("utf-8");
      let carry = "";
      let delimiter = null;
      let headerFields = null;
      let headerIndex = null;
      let col = null;
      let isWorkoutFile = /workout/i.test(fileName);

      const handleHeaderLine = (line) => {
        const trimmed = String(line || "").trim();
        if (!trimmed) return true;

        const sep = trimmed.match(/^sep\s*=\s*(.)\s*$/i);
        if (sep) {
          delimiter = sep[1];
          return true;
        }

        delimiter = delimiter || guessCsvDelimiter(trimmed);
        headerFields = parseCsvLine(trimmed.replace(/^\ufeff/, ""), delimiter);
        headerIndex = buildCsvHeaderIndex(headerFields);

        col = {
          typeIdx: findCsvColumn(headerIndex, TYPE_COLS),
          startIdx: findCsvColumn(headerIndex, START_COLS),
          endIdx: findCsvColumn(headerIndex, END_COLS),
          dateIdx: findCsvColumn(headerIndex, DATE_COLS),
          valueIdx: findCsvColumn(headerIndex, VALUE_COLS),
          unitIdx: findCsvColumn(headerIndex, UNIT_COLS),
          workoutTypeIdx: findCsvColumn(headerIndex, WORKOUT_TYPE_COLS),
        };
        if (col.workoutTypeIdx !== -1) isWorkoutFile = true;
        return false;
      };

      const handleDataLine = (line) => {
        const s = String(line || "");
        if (!s.trim()) return;
        if (!headerFields || !headerIndex || !col) return;

        const fields = parseCsvLine(s, delimiter);
        if (fields.length === 0) return;

        // Skip accidental repeated headers inside the file.
        if (fields.length === headerFields.length && normalizeCsvHeaderName(fields[0]) === normalizeCsvHeaderName(headerFields[0])) return;

        const startStr = col.startIdx !== -1 ? fields[col.startIdx] : col.dateIdx !== -1 ? fields[col.dateIdx] : null;
        const endStr = col.endIdx !== -1 ? fields[col.endIdx] : null;
        const start = parseAppleHealthDateMs(startStr);
        if (start === null) return;
        const end = endStr ? parseAppleHealthDateMs(endStr) : start;
        if (end === null) return;

        const sMs = Math.min(start, end);
        const eMs = Math.max(start, end);
        if (eMs <= grid.startMs || sMs >= grid.endMs) return;

        if (isWorkoutFile) {
          workoutSeen++;
          if (!includeWorkouts) return;
          const workoutType = col.workoutTypeIdx !== -1 ? fields[col.workoutTypeIdx] : null;
          setBooleanFlag(grid.workout, grid, sMs, eMs, (idx) => {
            if (workoutType && !grid.workoutType[idx]) grid.workoutType[idx] = workoutType;
          });
          return;
        }

        recordSeen++;
        const typeRaw = col.typeIdx !== -1 ? fields[col.typeIdx] : null;
        const type = resolveAppleHealthRecordType(typeRaw, fileInferredType, fileName);
        if (!type || !APPLE_HEALTH_WANT_TYPES.has(type)) return;

        const value = col.valueIdx !== -1 ? fields[col.valueIdx] : null;
        const unit = col.unitIdx !== -1 ? fields[col.unitIdx] : null;

        const used = applyAppleHealthRecordToGrid(grid, { type, startMs: sMs, endMs: eMs, value, unit }, { includeMindful });
        if (used) recordUsed++;
      };

      const size = Number.isFinite(file.size) ? file.size : 0;
      for (let offset = 0; offset < size; offset += chunkBytes) {
        const buf = await file.slice(offset, offset + chunkBytes).arrayBuffer();
        bytesRead += buf.byteLength;
        carry += decoder.decode(buf, { stream: true });

        while (true) {
          const nl = carry.indexOf("\n");
          if (nl === -1) break;
          let line = carry.slice(0, nl);
          carry = carry.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);

          if (!headerFields) {
            handleHeaderLine(line);
            continue;
          }
          handleDataLine(line);
        }

        if (bytesRead - lastProgressAt >= 2 * 1024 * 1024) {
          lastProgressAt = bytesRead;
          progressTick({ fileIndex: fileIndex + 1, fileCount: fileList.length, fileName });
        }
      }

      carry += decoder.decode();
      if (carry) {
        const tail = carry.replace(/\r$/, "");
        if (!headerFields) handleHeaderLine(tail);
        else handleDataLine(tail);
      }

      progressTick({ fileIndex: fileIndex + 1, fileCount: fileList.length, fileName });
    }

    const epochs = finalizeAppleHealthEpochs(grid);
    return { epochs, stats: { bytesRead, recordSeen, recordUsed, workoutSeen, epochCount: grid.count, fileCount: fileList.length } };
  }

  async function importAppleHealthToJson(runAfterImport) {
    const files = Array.from($("appleHealthFile")?.files ?? []);
    if (files.length === 0) {
      showError($("appleError"), "请选择 Apple Health 的 export.xml 或 HealthExportCSV 导出的 CSV 文件（可多选）。");
      return;
    }

    try {
      showError($("appleError"), null);
      $("appleStatus").textContent = "";
      setAppleProgress(0);

      const epochMinutes = clamp(numOrNull($("epochMinutes").value) ?? 5, 1, 60);
      const startStr = $("appleStartTime").value;
      const endStr = $("appleEndTime").value;
      const startMs = startStr ? new Date(startStr).getTime() : null;
      const endMs = endStr ? new Date(endStr).getTime() : null;

      const includeWorkouts = Boolean($("appleIncludeWorkouts").checked);
      const includeMindful = Boolean($("appleIncludeMindful").checked);

      $("appleImportToJson").disabled = true;
      $("appleImportAndRun").disabled = true;

      const onProgress = ({ bytesRead, totalBytes, recordSeen, recordUsed, workoutSeen, fileIndex, fileCount, fileName }) => {
        const pctNum = totalBytes ? (bytesRead / totalBytes) * 100 : null;
        const pct = pctNum !== null ? `${Math.round(pctNum)}%` : "-";
        if (pctNum !== null) setAppleProgress(pctNum);
        const filePart =
          Number.isFinite(fileIndex) && Number.isFinite(fileCount) && fileCount > 0
            ? ` · File ${fileIndex}/${fileCount}${fileName ? ` (${fileName})` : ""}`
            : "";
        $("appleStatus").textContent = `解析中… ${pct} (${formatBytes(bytesRead)} / ${totalBytes ? formatBytes(totalBytes) : "?"}) · Record ${recordUsed}/${recordSeen} · Workout ${workoutSeen}${filePart}`;
      };

      const isXml = (f) => {
        const name = String(f?.name || "").toLowerCase();
        const type = String(f?.type || "").toLowerCase();
        return name.endsWith(".xml") || type.includes("xml");
      };
      const isCsv = (f) => {
        const name = String(f?.name || "").toLowerCase();
        const type = String(f?.type || "").toLowerCase();
        return name.endsWith(".csv") || type.includes("csv");
      };
      const isZip = (f) => {
        const name = String(f?.name || "").toLowerCase();
        const type = String(f?.type || "").toLowerCase();
        return name.endsWith(".zip") || type.includes("zip");
      };

      const xmlFiles = files.filter(isXml);
      const csvFiles = files.filter(isCsv);
      const zipFiles = files.filter(isZip);

      if (zipFiles.length > 0) throw new Error("检测到 ZIP：请先解压后再选择其中的 export.xml / CSV 文件。");
      if (xmlFiles.length > 0 && csvFiles.length > 0) throw new Error("请只选择 export.xml 或一组 CSV 文件，不要混选。");
      if (xmlFiles.length > 1) throw new Error("export.xml 只能选择 1 个文件。");

      const parsed =
        xmlFiles.length === 1
          ? await parseAppleHealthExport(xmlFiles[0], { startMs, endMs, epochMinutes, includeWorkouts, includeMindful, onProgress })
          : csvFiles.length > 0
            ? await parseAppleHealthCsvFiles(csvFiles, { startMs, endMs, epochMinutes, includeWorkouts, includeMindful, onProgress })
            : null;

      if (!parsed) throw new Error("未识别的文件类型：请选择 export.xml 或 .csv 文件。");
      const { epochs, stats } = parsed;

      const initialBB = clamp(numOrNull($("initialBB").value) ?? 70, 0, 100);
      const baselines = readBaselinesFromUI();
      const params = readParamsFromUI();
      const behaviorBaseline = readBehaviorBaselineFromUI();
      const cfg = { epochMinutes, initialBB, epochs };
      if (baselines) cfg.baselines = baselines;
      if (params) cfg.params = params;
      if (behaviorBaseline) cfg.behaviorBaseline = behaviorBaseline;

      $("jsonInput").value = JSON.stringify(cfg, null, 2);
      showError($("jsonError"), null);
      setAppleProgress(100);
      const fileInfo = stats.fileCount ? ` · Files=${stats.fileCount}` : "";
      $("appleStatus").textContent = `完成：epochs=${stats.epochCount}${fileInfo} · RecordUsed=${stats.recordUsed}/${stats.recordSeen} · Workout=${stats.workoutSeen} · 读取=${formatBytes(stats.bytesRead)}`;

      setActiveTab("json");
      if (runAfterImport) computeAndRender(cfg);
    } catch (err) {
      showError($("appleError"), err && err.stack ? err.stack : String(err));
      $("appleStatus").textContent = "";
      setAppleProgress(0);
    } finally {
      $("appleImportToJson").disabled = false;
      $("appleImportAndRun").disabled = false;
    }
  }

  function wire() {
    setActiveTab("segments");

    $("tabBtnSegments").addEventListener("click", () => setActiveTab("segments"));
    $("tabBtnJson").addEventListener("click", () => setActiveTab("json"));
    $("tabBtnApple").addEventListener("click", () => setActiveTab("apple"));

    $("addSegment").addEventListener("click", () => {
      state.segments.push(newSegment("awake"));
      renderSegments();
    });

    $("clearSegments").addEventListener("click", () => {
      state.segments = [];
      renderSegments();
      showError($("segmentsError"), null);
    });

    $("loadSample").addEventListener("click", () => {
      sampleSegments();
      showError($("segmentsError"), null);
    });

    $("runSegments").addEventListener("click", () => {
      try {
        showError($("segmentsError"), null);
        const epochMinutes = clamp(numOrNull($("epochMinutes").value) ?? 5, 1, 60);
        const epochs = buildEpochsFromSegments(epochMinutes);
        if (epochs.length === 0) {
          showError($("segmentsError"), "没有可计算的数据：请添加分段并填写时长。");
          return;
        }
        const initialBB = clamp(numOrNull($("initialBB").value) ?? 70, 0, 100);
        const baselines = readBaselinesFromUI();
        const params = readParamsFromUI();
        const behaviorBaseline = readBehaviorBaselineFromUI();
        const cfg = { epochMinutes, initialBB, epochs };
        if (baselines) cfg.baselines = baselines;
        if (params) cfg.params = params;
        if (behaviorBaseline) cfg.behaviorBaseline = behaviorBaseline;
        computeAndRender(cfg);
      } catch (err) {
        showError($("segmentsError"), err && err.stack ? err.stack : String(err));
      }
    });

    $("loadSampleJson").addEventListener("click", () => {
      const s = sampleJson();
      $("jsonInput").value = JSON.stringify(s, null, 2);
      showError($("jsonError"), null);
    });

    $("runJson").addEventListener("click", () => {
      try {
        showError($("jsonError"), null);
        const raw = $("jsonInput").value;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") throw new Error("JSON 必须是对象。");
        if (!Array.isArray(obj.epochs)) throw new Error("JSON 必须包含 epochs 数组。");
        const epochMinutes = clamp(numOrNull(obj.epochMinutes) ?? numOrNull($("epochMinutes").value) ?? 5, 1, 60);
        const initialBB = clamp(numOrNull(obj.initialBB) ?? numOrNull($("initialBB").value) ?? 70, 0, 100);
        const baselines = obj.baselines && typeof obj.baselines === "object" ? obj.baselines : readBaselinesFromUI();
        const params = obj.params && typeof obj.params === "object" ? obj.params : readParamsFromUI();
        const behaviorBaseline =
          obj.behaviorBaseline && typeof obj.behaviorBaseline === "object"
            ? obj.behaviorBaseline
            : readBehaviorBaselineFromUI();

        $("epochMinutes").value = String(epochMinutes);
        $("initialBB").value = String(initialBB);

        const cfg = { epochMinutes, initialBB, epochs: obj.epochs };
        if (baselines) cfg.baselines = baselines;
        if (params) cfg.params = params;
        if (behaviorBaseline) cfg.behaviorBaseline = behaviorBaseline;
        computeAndRender(cfg);
      } catch (err) {
        showError($("jsonError"), err && err.stack ? err.stack : String(err));
      }
    });

    $("appleImportToJson").addEventListener("click", () => {
      importAppleHealthToJson(false);
    });

    $("appleImportAndRun").addEventListener("click", () => {
      importAppleHealthToJson(true);
    });

    $("copyBaselinesJson")?.addEventListener("click", async () => {
      const btn = $("copyBaselinesJson");
      const baselines = state.lastResult?.baselines ?? null;
      const text = baselines ? JSON.stringify(baselines, null, 2) : "";
      const ok = await copyTextToClipboard(text);
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = ok ? "已复制" : "复制失败";
        window.setTimeout(() => {
          btn.textContent = prev;
        }, 900);
      }
    });

    // Chart controls + interactions (Garmin-like hover/zoom)
    readChartOptionsFromUI();

    const onChartOptChange = () => {
      readChartOptionsFromUI();
      if (!state.lastResult) return;
      drawChart(state.lastResult.series);
    };

    $("chartShowReserve")?.addEventListener("change", onChartOptChange);
    $("chartShowComfort")?.addEventListener("change", onChartOptChange);
    $("chartShowFatigue")?.addEventListener("change", onChartOptChange);
    $("chartShowSleep")?.addEventListener("change", onChartOptChange);
    $("chartShowEvents")?.addEventListener("change", onChartOptChange);
    $("chartBottomMetric")?.addEventListener("change", onChartOptChange);

    $("chartResetZoom")?.addEventListener("click", () => {
      resetChartZoom();
      if (!state.lastResult) return;
      drawChart(state.lastResult.series);
    });

    const canvas = $("chart");
    if (canvas) {
      canvas.style.touchAction = "none";

      const clearHover = () => {
        state.chart.hover.idx = null;
        state.chart.hover.px = null;
        const tip = $("chartTooltip");
        if (tip) tip.hidden = true;
      };

      const updateHoverFromEvent = (e) => {
        const c = state.chart.cache;
        if (!c || !Array.isArray(c.xs) || c.xs.length === 0) return;
        const pxX = clamp(e.offsetX, c.padL, c.padL + c.plotW);
        const pxY = clamp(e.offsetY, 0, c.plotY1);
        const xVal = c.viewMinX + (pxX - c.padL) / Math.max(1e-9, c.xScale);
        let idx = lowerBound(c.xs, xVal);
        idx = clamp(idx, c.i0, c.i1);
        if (idx > c.i0) {
          const left = c.xs[idx - 1];
          const right = c.xs[idx];
          if (Math.abs(left - xVal) <= Math.abs(right - xVal)) idx = idx - 1;
        }
        state.chart.hover.idx = idx;
        state.chart.hover.px = { x: e.offsetX, y: pxY };
      };

      canvas.addEventListener("pointerleave", () => {
        if (state.chart.drag.active) return;
        clearHover();
        scheduleChartRedraw();
      });

      canvas.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const c = state.chart.cache;
        if (!c) return;
        canvas.setPointerCapture?.(e.pointerId);
        state.chart.drag.active = true;
        state.chart.drag.startPx = clamp(e.offsetX, c.padL, c.padL + c.plotW);
        state.chart.drag.endPx = state.chart.drag.startPx;
        clearHover();
        scheduleChartRedraw();
      });

      canvas.addEventListener("pointermove", (e) => {
        if (!state.lastResult) return;
        const c = state.chart.cache;
        if (!c) return;
        if (state.chart.drag.active) {
          state.chart.drag.endPx = clamp(e.offsetX, c.padL, c.padL + c.plotW);
          scheduleChartRedraw();
          return;
        }
        updateHoverFromEvent(e);
        scheduleChartRedraw();
      });

      const endDrag = (e) => {
        if (!state.chart.drag.active) return;
        const c = state.chart.cache;
        const startPx = state.chart.drag.startPx;
        const endPx = state.chart.drag.endPx;
        state.chart.drag.active = false;
        state.chart.drag.startPx = null;
        state.chart.drag.endPx = null;

        if (!c || !Number.isFinite(startPx) || !Number.isFinite(endPx)) {
          scheduleChartRedraw();
          return;
        }

        if (Math.abs(endPx - startPx) < 8) {
          updateHoverFromEvent(e);
          scheduleChartRedraw();
          return;
        }

        const px0 = clamp(Math.min(startPx, endPx), c.padL, c.padL + c.plotW);
        const px1 = clamp(Math.max(startPx, endPx), c.padL, c.padL + c.plotW);
        const x0 = c.viewMinX + (px0 - c.padL) / Math.max(1e-9, c.xScale);
        const x1 = c.viewMinX + (px1 - c.padL) / Math.max(1e-9, c.xScale);
        const dt = c.xs && c.xs.length >= 2 ? c.xs[1] - c.xs[0] : 0;
        const minSpan = Number.isFinite(dt) && dt > 0 ? dt * 2 : 1;
        if (x1 - x0 >= minSpan) {
          state.chart.view.minX = clamp(x0, c.minX, c.maxX);
          state.chart.view.maxX = clamp(x1, c.minX, c.maxX);
        }

        clearHover();
        scheduleChartRedraw();
      };

      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);

      canvas.addEventListener("dblclick", () => {
        resetChartZoom();
        clearHover();
        scheduleChartRedraw();
      });
    }

    window.addEventListener("resize", () => {
      if (!state.lastResult) return;
      drawChart(state.lastResult.series);
    });

    // Init: default time + a couple segments
    const d = new Date();
    d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
    $("startTime").value = localDateTimeValue(d);

    const appleEnd = new Date(d.getTime());
    const appleStart = new Date(d.getTime() - 24 * 60 * 60000);
    $("appleStartTime").value = localDateTimeValue(appleStart);
    $("appleEndTime").value = localDateTimeValue(appleEnd);

    $("appleSetRange24h").addEventListener("click", () => {
      const end = new Date();
      end.setMinutes(Math.floor(end.getMinutes() / 5) * 5, 0, 0);
      const start = new Date(end.getTime() - 24 * 60 * 60000);
      $("appleStartTime").value = localDateTimeValue(start);
      $("appleEndTime").value = localDateTimeValue(end);
    });

    $("appleSetRange7d").addEventListener("click", () => {
      const end = new Date();
      end.setMinutes(Math.floor(end.getMinutes() / 5) * 5, 0, 0);
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60000);
      $("appleStartTime").value = localDateTimeValue(start);
      $("appleEndTime").value = localDateTimeValue(end);
    });

    state.segments = [newSegment("awake_rest"), newSegment("light"), newSegment("workout"), newSegment("awake")];
    renderSegments();

    // Preload sample JSON to reduce friction
    $("jsonInput").value = JSON.stringify(sampleJson(), null, 2);
  }

  function bootstrap() {
    if (!window.BodyBatteryModel) {
      showError($("segmentsError"), "BodyBatteryModel 未加载：请确保 ../src/bodyBatteryModel.js 可访问。");
      return;
    }
    wire();
    maybeShowUpgradeModal();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap);
  else bootstrap();
})();
