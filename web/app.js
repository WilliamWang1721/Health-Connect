/* global BodyBatteryModel */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    segments: [],
    lastResult: null,
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

  const UPGRADE_ID = "2025-12-28";
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
      { value: "awake_rest", label: "清醒静息（Rest）" },
      { value: "meditation", label: "正念/冥想（Mindful）" },
      { value: "workout", label: "训练（Workout）" },
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
      case "awake_rest":
        return { durationMin: 45, hrBpm: 60, hrvSdnnMs: null, stepsPerMin: 0, activeEnergyPerMin: 0.2 };
      case "meditation":
        return { durationMin: 15, hrBpm: 58, hrvSdnnMs: 60, stepsPerMin: 0, activeEnergyPerMin: 0.1 };
      case "workout":
        return { durationMin: 45, hrBpm: 150, stepsPerMin: 20, activeEnergyPerMin: 9, powerW: 210 };
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
          : seg.type === "awake_rest"
            ? { kind: "AWAKE_REST" }
            : seg.type === "light"
              ? { kind: "LIGHT_ACTIVITY" }
              : seg.type === "active"
                ? { kind: "ACTIVE" }
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
    setIf("baseRestChargePerHour", "baseRestChargePerHour");
    setIf("baseMindChargePerHour", "baseMindChargePerHour");
    setIf("loadDrainWorkoutMaxPerHour", "loadDrainWorkoutMaxPerHour");
    setIf("loadDrainActiveMaxPerHour", "loadDrainActiveMaxPerHour");
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

  function computeAndRender(cfg) {
    const result = BodyBatteryModel.computeSeries(cfg);
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

  function drawChart(series) {
    const canvas = $("chart");
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const pad = 28;
    const plotW = w - pad * 2;
    const plotH = h - pad * 2;

    const xs = series.map((r, idx) => (r.tsMs !== null && r.tsMs !== undefined ? r.tsMs : idx));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const xScale = maxX === minX ? 1 : plotW / (maxX - minX);

    const xOf = (x) => pad + (x - minX) * xScale;
    const yOf = (bb) => pad + (100 - clamp(bb, 0, 100)) * (plotH / 100);

    // Background grid
    ctx.save();
    ctx.strokeStyle = "rgba(36, 50, 82, 0.55)";
    ctx.lineWidth = 1;
    for (let y = 0; y <= 100; y += 20) {
      ctx.beginPath();
      ctx.moveTo(pad, yOf(y));
      ctx.lineTo(pad + plotW, yOf(y));
      ctx.stroke();
    }
    ctx.restore();

    // Sleep shading
    ctx.save();
    ctx.fillStyle = "rgba(122, 162, 255, 0.10)";
    let inSleep = false;
    let sleepStartX = null;
    for (let i = 0; i < series.length; i++) {
      const r = series[i];
      const isSleep = r.context?.kind === "SLEEP";
      if (isSleep && !inSleep) {
        inSleep = true;
        sleepStartX = xOf(xs[i]);
      }
      if (!isSleep && inSleep) {
        inSleep = false;
        const endX = xOf(xs[i]);
        ctx.fillRect(sleepStartX, pad, endX - sleepStartX, plotH);
      }
    }
    if (inSleep && sleepStartX !== null) {
      ctx.fillRect(sleepStartX, pad, pad + plotW - sleepStartX, plotH);
    }
    ctx.restore();

    // BB Line
    ctx.save();
    ctx.strokeStyle = "rgba(61, 220, 151, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < series.length; i++) {
      const r = series[i];
      const x = xOf(xs[i]);
      const y = yOf(r.bbNext);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // Axes labels
    ctx.save();
    ctx.fillStyle = "rgba(157, 176, 218, 0.95)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    ctx.fillText("100", 6, yOf(100) + 4);
    ctx.fillText("0", 12, yOf(0) + 4);
    ctx.restore();
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
      { type: "active", durationMin: 90, hrBpm: 112, stepsPerMin: 85, activeEnergyPerMin: 4 },
      { type: "awake_rest", durationMin: 60, hrBpm: 64, stepsPerMin: 0, activeEnergyPerMin: 0.25 },
      { type: "light", durationMin: 180, hrBpm: 88, stepsPerMin: 45, activeEnergyPerMin: 1.6 },
      { type: "awake", durationMin: 180, hrBpm: 74, stepsPerMin: 5, activeEnergyPerMin: 0.8 },
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
    const s = String(value);
    if (s === "HKCategoryValueSleepAnalysisInBed" || s === "0") return "inBed";
    if (s === "HKCategoryValueSleepAnalysisAsleep" || s === "1") return "core";
    if (s.includes("AsleepDeep")) return "deep";
    if (s.includes("AsleepCore")) return "core";
    if (s.includes("AsleepREM")) return "rem";
    if (s.includes("Awake")) return "awake";
    if (s.includes("Asleep")) return "core";
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

    const WANT_TYPES = new Set([
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
      if (!type || !WANT_TYPES.has(type)) return;

      const start = parseAppleHealthDateMs(extractXmlAttr(tag, "startDate"));
      const end = parseAppleHealthDateMs(extractXmlAttr(tag, "endDate"));
      if (start === null || end === null) return;
      const s = Math.min(start, end);
      const e = Math.max(start, end);
      if (e <= grid.startMs || s >= grid.endMs) return;

      if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
        const stage = sleepStageFromAppleHealth(extractXmlAttr(tag, "value"));
        if (stage) {
          addSleepStage(grid, stage, s, e);
          recordUsed++;
        }
        return;
      }

      if (type === "HKCategoryTypeIdentifierMindfulSession") {
        if (!includeMindful) return;
        setBooleanFlag(grid.mindful, grid, s, e);
        recordUsed++;
        return;
      }

      const valueRaw = extractXmlAttr(tag, "value");
      const unit = extractXmlAttr(tag, "unit");

      if (type === "HKQuantityTypeIdentifierHeartRate") {
        const v = Number(valueRaw);
        if (Number.isFinite(v)) {
          addWeightedAvg(grid.hrSum, grid.hrW, grid, v, s, e);
          recordUsed++;
        }
        return;
      }

      if (type === "HKQuantityTypeIdentifierHeartRateVariabilitySDNN") {
        const v = Number(valueRaw);
        if (Number.isFinite(v)) {
          addWeightedAvg(grid.hrvSum, grid.hrvW, grid, v, s, e);
          recordUsed++;
        }
        return;
      }

      if (type === "HKQuantityTypeIdentifierOxygenSaturation") {
        const v = normalizeOxygenSaturationPct(valueRaw, unit);
        if (v !== null) {
          addWeightedAvg(grid.spo2Sum, grid.spo2W, grid, v, s, e);
          recordUsed++;
        }
        return;
      }

      if (type === "HKQuantityTypeIdentifierRespiratoryRate") {
        const v = Number(valueRaw);
        if (Number.isFinite(v)) {
          addWeightedAvg(grid.rrSum, grid.rrW, grid, v, s, e);
          recordUsed++;
        }
        return;
      }

      if (type === "HKQuantityTypeIdentifierAppleSleepingWristTemperature" || type === "HKQuantityTypeIdentifierWristTemperature" || type === "HKQuantityTypeIdentifierBodyTemperature") {
        const v = Number(valueRaw);
        if (Number.isFinite(v)) {
          addWeightedAvg(grid.tempSum, grid.tempW, grid, v, s, e);
          recordUsed++;
        }
        return;
      }

      if (type === "HKQuantityTypeIdentifierCyclingPower" || type === "HKQuantityTypeIdentifierRunningPower") {
        const v = Number(valueRaw);
        if (Number.isFinite(v)) {
          addWeightedAvg(grid.powerSum, grid.powerW, grid, v, s, e);
          recordUsed++;
        }
        return;
      }

      if (type === "HKQuantityTypeIdentifierStepCount") {
        const v = Number(valueRaw);
        if (Number.isFinite(v)) {
          addAdditiveSum(grid.stepsSum, grid, v, s, e);
          recordUsed++;
        }
        return;
      }

      if (type === "HKQuantityTypeIdentifierActiveEnergyBurned") {
        const kcal = normalizeEnergyKcal(valueRaw, unit);
        if (kcal !== null) {
          addAdditiveSum(grid.activeEnergySum, grid, kcal, s, e);
          recordUsed++;
        }
      }
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

  async function importAppleHealthToJson(runAfterImport) {
    const file = $("appleHealthFile")?.files?.[0] ?? null;
    if (!file) {
      showError($("appleError"), "请选择 Apple Health 导出的 export.xml（或先解压 export.zip 再选 export.xml）。");
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

      const onProgress = ({ bytesRead, totalBytes, recordSeen, recordUsed, workoutSeen }) => {
        const pctNum = totalBytes ? (bytesRead / totalBytes) * 100 : null;
        const pct = pctNum !== null ? `${Math.round(pctNum)}%` : "-";
        if (pctNum !== null) setAppleProgress(pctNum);
        $("appleStatus").textContent = `解析中… ${pct} (${formatBytes(bytesRead)} / ${totalBytes ? formatBytes(totalBytes) : "?"}) · Record ${recordUsed}/${recordSeen} · Workout ${workoutSeen}`;
      };

      const { epochs, stats } = await parseAppleHealthExport(file, {
        startMs,
        endMs,
        epochMinutes,
        includeWorkouts,
        includeMindful,
        onProgress,
      });

      const initialBB = clamp(numOrNull($("initialBB").value) ?? 70, 0, 100);
      const baselines = readBaselinesFromUI();
      const params = readParamsFromUI();
      const cfg = { epochMinutes, initialBB, epochs };
      if (baselines) cfg.baselines = baselines;
      if (params) cfg.params = params;

      $("jsonInput").value = JSON.stringify(cfg, null, 2);
      showError($("jsonError"), null);
      setAppleProgress(100);
      $("appleStatus").textContent = `完成：epochs=${stats.epochCount} · RecordUsed=${stats.recordUsed}/${stats.recordSeen} · Workout=${stats.workoutSeen} · 读取=${formatBytes(stats.bytesRead)}`;

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
        const cfg = { epochMinutes, initialBB, epochs };
        if (baselines) cfg.baselines = baselines;
        if (params) cfg.params = params;
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

        $("epochMinutes").value = String(epochMinutes);
        $("initialBB").value = String(initialBB);

        const cfg = { epochMinutes, initialBB, epochs: obj.epochs };
        if (baselines) cfg.baselines = baselines;
        if (params) cfg.params = params;
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
