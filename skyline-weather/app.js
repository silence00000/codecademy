(() => {
  "use strict";

  const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
  const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
  const REVERSE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";
  const DEFAULT_PLACE = { name: "London", admin1: "England", country: "United Kingdom", latitude: 51.5085, longitude: -0.1257 };
  const REFRESH_MS = 10 * 60 * 1000;

  const $ = (id) => document.getElementById(id);

  /* ---------- Storage (safe) ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("skyline:" + key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("skyline:" + key, JSON.stringify(value)); } catch { /* ignore */ }
    },
  };

  const state = {
    unit: store.get("unit", guessUnit()),
    place: null,
    saved: store.get("saved", []),
    data: null,
    refreshTimer: null,
  };

  function guessUnit() {
    const lang = (navigator.language || "").toLowerCase();
    return /^en-(us|lr)|^my/.test(lang) ? "fahrenheit" : "celsius";
  }
  const imperial = () => state.unit === "fahrenheit";

  /* ---------- Weather codes (WMO) ---------- */
  const WMO = {
    0: ["Clear sky", "clear"], 1: ["Mainly clear", "partly"], 2: ["Partly cloudy", "partly"], 3: ["Overcast", "cloudy"],
    45: ["Fog", "fog"], 48: ["Freezing fog", "fog"],
    51: ["Light drizzle", "drizzle"], 53: ["Drizzle", "drizzle"], 55: ["Heavy drizzle", "drizzle"],
    56: ["Freezing drizzle", "drizzle"], 57: ["Heavy freezing drizzle", "drizzle"],
    61: ["Light rain", "rain"], 63: ["Rain", "rain"], 65: ["Heavy rain", "rain"],
    66: ["Freezing rain", "rain"], 67: ["Heavy freezing rain", "rain"],
    71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"], 77: ["Snow grains", "snow"],
    80: ["Light showers", "rain"], 81: ["Showers", "rain"], 82: ["Violent showers", "rain"],
    85: ["Snow showers", "snow"], 86: ["Heavy snow showers", "snow"],
    95: ["Thunderstorm", "storm"], 96: ["Thunderstorm, hail", "storm"], 99: ["Severe thunderstorm, hail", "storm"],
  };
  const describe = (code) => WMO[code] || ["Unknown", "cloudy"];

  function skyFor(kind, isDay) {
    const base = { clear: "clear", partly: "clear", cloudy: "cloudy", fog: "fog", drizzle: "rain", rain: "rain", snow: "snow", storm: "storm" }[kind] || "cloudy";
    return `${base}-${isDay ? "day" : "night"}`;
  }

  /* ---------- Icons ---------- */
  const sunSvg = (cx, cy, r) => {
    let rays = "";
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const x1 = cx + Math.cos(a) * (r + 5), y1 = cy + Math.sin(a) * (r + 5);
      const x2 = cx + Math.cos(a) * (r + 11), y2 = cy + Math.sin(a) * (r + 11);
      rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }
    return `<g stroke="#f5b52e" stroke-width="3.5" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#f5b52e"/>`;
  };
  const moonSvg = (cx, cy, r) =>
    `<path d="M${cx + r * 0.35} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.65} ${r * 1.55} a${r * 0.8} ${r * 0.8} 0 0 1 ${-r * 0.65} ${-r * 1.55}z" fill="#e9d98a"/>`;
  const cloudSvg = (dx = 0, dy = 0, fill = "#ffffff", stroke = "#b5c3d1") =>
    `<path transform="translate(${dx} ${dy})" d="M22 70h40a14 14 0 0 0 1-28 20 20 0 0 0-38.5 4A12 12 0 0 0 22 70z" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  const drops = (n, color = "#3d8bfd") => {
    let s = "";
    for (let i = 0; i < n; i++) s += `<line x1="${34 + i * 12}" y1="76" x2="${30 + i * 12}" y2="${86 + (i % 2) * 4}" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>`;
    return s;
  };
  const flakes = () => [34, 48, 62].map((x, i) => `<circle cx="${x}" cy="${80 + (i % 2) * 6}" r="3.2" fill="#9ec8f0"/>`).join("");

  function icon(code, isDay) {
    const kind = describe(code)[1];
    const sky = isDay ? sunSvg(40, 38, 14) : moonSvg(40, 38, 14);
    let body;
    switch (kind) {
      case "clear": body = isDay ? sunSvg(48, 48, 18) : moonSvg(48, 48, 20); break;
      case "partly": body = sky + cloudSvg(8, 6); break;
      case "cloudy": body = cloudSvg(-6, -8, "#dbe3ec") + cloudSvg(6, 4); break;
      case "fog": body = cloudSvg(0, -6) + [72, 80, 88].map((y, i) => `<line x1="${22 + i * 4}" y1="${y}" x2="${74 - i * 4}" y2="${y}" stroke="#9fb0c1" stroke-width="3.5" stroke-linecap="round"/>`).join(""); break;
      case "drizzle": body = cloudSvg(0, -6) + drops(2); break;
      case "rain": body = cloudSvg(0, -6, "#eef2f6", "#8ea2b6") + drops(3); break;
      case "snow": body = cloudSvg(0, -6) + flakes(); break;
      case "storm": body = cloudSvg(0, -8, "#c3ceda", "#6d8197") + `<path d="M50 62l-9 15h8l-5 14 14-19h-8l6-10z" fill="#f5b52e"/>`; break;
      default: body = cloudSvg();
    }
    return `<svg viewBox="0 0 96 96" role="img" aria-label="${describe(code)[0]}">${body}</svg>`;
  }

  /* ---------- Formatting ---------- */
  const r = (n) => (n == null || Number.isNaN(n) ? "--" : Math.round(n));
  const deg = (n) => `${r(n)}°`;
  const windUnit = () => (imperial() ? "mph" : "km/h");
  const compass = (d) => ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(d / 22.5) % 16];
  const uvLabel = (u) => (u == null ? "" : u < 3 ? "Low" : u < 6 ? "Moderate" : u < 8 ? "High" : u < 11 ? "Very high" : "Extreme");

  // API times are local wall-clock strings ("2026-11-11T14:00"); treat them as UTC so formatting never shifts them.
  const asWall = (s) => new Date(s + (s.length <= 10 ? "T00:00Z" : "Z"));
  const fmt = (opts) => new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...opts });
  const fmtTime = fmt({ hour: "numeric", minute: "2-digit" });
  const fmtHour = fmt({ hour: "numeric" });
  const fmtWeekday = fmt({ weekday: "short" });
  const fmtShortDate = fmt({ month: "short", day: "numeric" });
  const fmtFull = fmt({ weekday: "long", hour: "numeric", minute: "2-digit" });

  function placeLabel(p) {
    return [p.admin1, p.country].filter((x, i, a) => x && a.indexOf(x) === i && x !== p.name).join(", ");
  }
  const placeKey = (p) => `${p.latitude.toFixed(2)},${p.longitude.toFixed(2)}`;

  /* ---------- Network ---------- */
  async function getJSON(url, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j.reason) reason = j.reason; } catch { /* ignore */ }
      throw new Error(reason);
    }
    return res.json();
  }

  function forecastUrl(p) {
    const q = new URLSearchParams({
      latitude: p.latitude, longitude: p.longitude, timezone: "auto", forecast_days: "7",
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,dew_point_2m",
      hourly: "temperature_2m,precipitation_probability,weather_code,is_day,visibility,uv_index",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max",
      temperature_unit: state.unit,
      wind_speed_unit: imperial() ? "mph" : "kmh",
      precipitation_unit: imperial() ? "inch" : "mm",
    });
    return `${FORECAST_URL}?${q}`;
  }

  /* ---------- Load + render ---------- */
  let loadCtrl = null;
  async function loadPlace(place, { quiet = false } = {}) {
    state.place = place;
    if (loadCtrl) loadCtrl.abort();
    loadCtrl = new AbortController();
    if (!quiet) document.body.classList.add("loading");
    showStatus(null);
    syncUrl(place);
    renderSaved();
    $("place-name").textContent = place.name;
    $("place-sub").textContent = placeLabel(place);
    try {
      const data = await getJSON(forecastUrl(place), loadCtrl.signal);
      state.data = data;
      store.set("last", place);
      render(data);
      scheduleRefresh();
    } catch (err) {
      if (err.name === "AbortError") return;
      showStatus(`Couldn't load the forecast for ${place.name}: ${err.message}. Check your connection and try again.`, true);
    } finally {
      document.body.classList.remove("loading");
    }
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (document.visibilityState === "visible" && state.place) loadPlace(state.place, { quiet: true });
      else scheduleRefresh();
    }, REFRESH_MS);
  }

  function render(d) {
    state.lastLoad = Date.now();
    const c = d.current, h = d.hourly, day = d.daily;
    const [condText, kind] = describe(c.weather_code);
    document.body.dataset.sky = skyFor(kind, c.is_day);

    // Local time at the place
    const localNow = new Date(Date.now() + d.utc_offset_seconds * 1000);
    $("local-time").textContent = `${fmtFull.format(localNow)} local time`;

    // Find the current hour in the hourly arrays
    const hourKey = c.time.slice(0, 13);
    let hi = h.time.findIndex((t) => t.startsWith(hourKey));
    if (hi < 0) hi = 0;

    $("now-icon").innerHTML = icon(c.weather_code, c.is_day);
    $("now-temp").textContent = r(c.temperature_2m);
    $("now-cond").textContent = condText;
    $("now-hi").textContent = `H ${deg(day.temperature_2m_max[0])}`;
    $("now-lo").textContent = `L ${deg(day.temperature_2m_min[0])}`;
    $("now-feels").textContent = deg(c.apparent_temperature);

    $("m-wind").textContent = `${r(c.wind_speed_10m)} ${windUnit()}`;
    $("m-wind-dir").textContent = c.wind_direction_10m != null ? `${compass(c.wind_direction_10m)}` : "";
    $("m-gust").textContent = `${r(c.wind_gusts_10m)} ${windUnit()}`;
    $("m-hum").textContent = `${r(c.relative_humidity_2m)}%`;
    $("m-dew").textContent = deg(c.dew_point_2m);
    $("m-pres").textContent = imperial() ? `${(c.pressure_msl * 0.02953).toFixed(2)} inHg` : `${r(c.pressure_msl)} hPa`;
    const vis = h.visibility?.[hi];
    $("m-vis").textContent = vis == null ? "--" : imperial() ? `${(vis / 1609.34).toFixed(1)} mi` : `${(vis / 1000).toFixed(1)} km`;
    const uv = h.uv_index?.[hi];
    $("m-uv").textContent = uv == null ? "--" : uv.toFixed(1);
    $("m-uv-label").textContent = uvLabel(uv);
    const ps = day.precipitation_sum[0];
    $("m-precip").textContent = ps == null ? "--" : imperial() ? `${ps.toFixed(2)} in` : `${ps.toFixed(1)} mm`;
    $("m-rise").textContent = fmtTime.format(asWall(day.sunrise[0]));
    $("m-set").textContent = fmtTime.format(asWall(day.sunset[0]));

    renderHourly(h, hi);
    renderDaily(day);
    updateSaveBtn();
    $("updated").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    document.title = `${r(c.temperature_2m)}° ${state.place.name} · Skyline Weather`;
  }

  function renderHourly(h, start) {
    const n = Math.min(24, h.time.length - start);
    const COL = 64, CH = 110, TOP = 26, BOT = 18;
    const temps = h.temperature_2m.slice(start, start + n);
    const min = Math.min(...temps), max = Math.max(...temps);
    const span = Math.max(max - min, 1);
    const y = (t) => TOP + (1 - (t - min) / span) * (CH - TOP - BOT);
    const x = (i) => i * COL + COL / 2;

    let cols = "";
    for (let i = 0; i < n; i++) {
      const k = start + i;
      const pop = h.precipitation_probability?.[k];
      cols += `<div class="hour${i === 0 ? " now-hour" : ""}">
        <span class="h-time">${i === 0 ? "Now" : fmtHour.format(asWall(h.time[k]))}</span>
        <span class="h-icon">${icon(h.weather_code[k], h.is_day[k])}</span>
        <span></span>
        <span class="h-pop">${pop ? pop + "%" : ""}</span>
      </div>`;
    }

    const pts = temps.map((t, i) => [x(i), y(t)]);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const area = `${line} L${pts[pts.length - 1][0]} ${CH} L${pts[0][0]} ${CH} Z`;
    let bars = "", dots = "", labels = "";
    for (let i = 0; i < n; i++) {
      const pop = h.precipitation_probability?.[start + i] || 0;
      const bh = (pop / 100) * 34;
      if (bh > 0) bars += `<rect class="r-bar" x="${x(i) - 9}" y="${CH - bh}" width="18" height="${bh}" rx="3"/>`;
      dots += `<circle class="t-dot" cx="${pts[i][0]}" cy="${pts[i][1]}" r="3.5"/>`;
      labels += `<text class="t-label" x="${pts[i][0]}" y="${pts[i][1] - 10}" text-anchor="middle">${r(temps[i])}°</text>`;
    }
    const svg = `<svg class="chart" width="${n * COL}" height="${CH}" viewBox="0 0 ${n * COL} ${CH}" aria-hidden="true">
      ${bars}<path class="t-area" d="${area}"/><path class="t-line" d="${line}"/>${dots}${labels}</svg>`;

    $("hourly").innerHTML = cols + svg;
  }

  function renderDaily(day) {
    const days = day.time.length;
    const lo = Math.min(...day.temperature_2m_min), hi = Math.max(...day.temperature_2m_max);
    const span = Math.max(hi - lo, 1);
    const curTemp = state.data.current.temperature_2m;
    let out = "";
    for (let i = 0; i < days; i++) {
      const date = asWall(day.time[i]);
      const name = i === 0 ? "Today" : i === 1 ? "Tomorrow" : fmtWeekday.format(date);
      const mn = day.temperature_2m_min[i], mx = day.temperature_2m_max[i];
      const left = ((mn - lo) / span) * 100, width = ((mx - mn) / span) * 100;
      const pop = day.precipitation_probability_max[i];
      const nowDot = i === 0 && curTemp != null ? `<i style="left:${Math.min(100, Math.max(0, ((curTemp - lo) / span) * 100)).toFixed(1)}%" title="Now"></i>` : "";
      out += `<li class="day">
        <span class="d-name">${name}<small>${fmtShortDate.format(date)}</small></span>
        <span class="d-icon">${icon(day.weather_code[i], 1)}</span>
        <span class="d-cond">${describe(day.weather_code[i])[0]}${pop ? `<span class="d-pop">${pop}% rain</span>` : ""}</span>
        <span class="d-lo">${deg(mn)}</span>
        <span class="range" aria-label="Low ${r(mn)}°, high ${r(mx)}°"><span style="left:${left.toFixed(1)}%;width:${Math.max(width, 2).toFixed(1)}%"></span>${nowDot}</span>
        <span class="d-hi">${deg(mx)}</span>
      </li>`;
    }
    $("daily").innerHTML = out;
  }

  function showStatus(msg, isError = false) {
    const el = $("status");
    el.hidden = !msg;
    el.textContent = msg || "";
    el.classList.toggle("error", isError);
  }

  /* ---------- URL state ---------- */
  function syncUrl(p) {
    const q = new URLSearchParams({ q: p.name, lat: p.latitude.toFixed(4), lon: p.longitude.toFixed(4) });
    if (p.country) q.set("c", p.country);
    if (p.admin1) q.set("r", p.admin1);
    try { history.replaceState(null, "", `?${q}`); } catch { /* ignore */ }
  }
  function placeFromUrl() {
    const q = new URLSearchParams(location.search);
    const lat = parseFloat(q.get("lat")), lon = parseFloat(q.get("lon"));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { name: q.get("q") || "Selected place", latitude: lat, longitude: lon, country: q.get("c") || "", admin1: q.get("r") || "" };
    }
    return null;
  }

  /* ---------- Search ---------- */
  const input = $("search-input");
  const list = $("suggestions");
  let results = [], active = -1, searchCtrl = null, debounce = null;

  function closeSuggestions() {
    list.hidden = true; active = -1;
    input.setAttribute("aria-expanded", "false");
  }
  function renderSuggestions(items, emptyText) {
    results = items; active = items.length ? 0 : -1;
    if (!items.length) {
      list.innerHTML = `<li class="empty">${emptyText}</li>`;
    } else {
      list.innerHTML = items.map((p, i) =>
        `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === active}"><span>${escapeHtml(p.name)}</span><small>${escapeHtml(placeLabel(p))}</small></li>`).join("");
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  function highlight(i) {
    active = i;
    [...list.querySelectorAll("[role=option]")].forEach((li, k) => li.setAttribute("aria-selected", String(k === i)));
    if (i >= 0) input.setAttribute("aria-activedescendant", `opt-${i}`);
  }
  function choose(i) {
    const p = results[i];
    if (!p) return;
    closeSuggestions();
    input.value = "";
    input.blur();
    loadPlace({ name: p.name, admin1: p.admin1 || "", country: p.country || "", latitude: p.latitude, longitude: p.longitude });
  }
  async function search(term) {
    if (searchCtrl) searchCtrl.abort();
    searchCtrl = new AbortController();
    try {
      const q = new URLSearchParams({ name: term, count: "6", language: "en", format: "json" });
      const j = await getJSON(`${GEOCODE_URL}?${q}`, searchCtrl.signal);
      renderSuggestions(j.results || [], `No places match “${escapeHtml(term)}”.`);
    } catch (err) {
      if (err.name !== "AbortError") renderSuggestions([], "Search is unavailable right now.");
    }
  }

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    const term = input.value.trim();
    if (term.length < 2) { closeSuggestions(); return; }
    debounce = setTimeout(() => search(term), 250);
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(Math.min(results.length - 1, active + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(0, active - 1)); }
    else if (e.key === "Escape") closeSuggestions();
  });
  $("search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const term = input.value.trim();
    if (!term) return;
    if (!list.hidden && active >= 0) { choose(active); return; }
    clearTimeout(debounce);
    await search(term);
    if (results.length) choose(0);
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("[role=option]");
    if (li) { e.preventDefault(); choose(+li.dataset.i); }
  });
  input.addEventListener("blur", () => setTimeout(closeSuggestions, 120));

  /* ---------- Geolocation ---------- */
  $("locate-btn").addEventListener("click", () => {
    const btn = $("locate-btn");
    if (!("geolocation" in navigator)) { showStatus("Your browser doesn't support location. Search for a city instead.", true); return; }
    btn.classList.add("busy");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      let place = { name: "Your location", admin1: "", country: "", latitude, longitude };
      try {
        const q = new URLSearchParams({ latitude, longitude, localityLanguage: "en" });
        const j = await getJSON(`${REVERSE_URL}?${q}`);
        place = { ...place, name: j.city || j.locality || "Your location", admin1: j.principalSubdivision || "", country: j.countryName || "" };
      } catch { /* keep generic name */ }
      btn.classList.remove("busy");
      loadPlace(place);
    }, (err) => {
      btn.classList.remove("busy");
      const msg = err.code === 1 ? "Location access was denied. Allow it in your browser settings, or search for a city." : "Couldn't find your location. Try again or search for a city.";
      showStatus(msg, true);
    }, { timeout: 10000, maximumAge: 300000 });
  });

  /* ---------- Units ---------- */
  document.querySelectorAll(".unit-toggle button").forEach((b) => {
    b.addEventListener("click", () => {
      if (state.unit === b.dataset.unit) return;
      state.unit = b.dataset.unit;
      store.set("unit", state.unit);
      syncUnitButtons();
      if (state.place) loadPlace(state.place, { quiet: true });
    });
  });
  function syncUnitButtons() {
    document.querySelectorAll(".unit-toggle button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.unit === state.unit)));
  }

  /* ---------- Saved places ---------- */
  const isSaved = (p) => state.saved.some((s) => placeKey(s) === placeKey(p));
  function updateSaveBtn() {
    const saved = state.place && isSaved(state.place);
    const btn = $("save-btn");
    btn.setAttribute("aria-pressed", String(!!saved));
    btn.querySelector("span").textContent = saved ? "Saved" : "Save place";
  }
  $("save-btn").addEventListener("click", () => {
    if (!state.place) return;
    if (isSaved(state.place)) state.saved = state.saved.filter((s) => placeKey(s) !== placeKey(state.place));
    else state.saved = [...state.saved, state.place].slice(-8);
    store.set("saved", state.saved);
    updateSaveBtn();
    renderSaved();
  });
  function renderSaved() {
    const nav = $("saved");
    nav.innerHTML = state.saved.map((p, i) => `
      <span class="chip${state.place && placeKey(p) === placeKey(state.place) ? " active" : ""}">
        <button type="button" data-open="${i}">${escapeHtml(p.name)}</button>
        <button type="button" class="chip-x" data-remove="${i}" aria-label="Remove ${escapeHtml(p.name)}">×</button>
      </span>`).join("");
  }
  $("saved").addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]"), rm = e.target.closest("[data-remove]");
    if (open) loadPlace(state.saved[+open.dataset.open]);
    if (rm) {
      state.saved.splice(+rm.dataset.remove, 1);
      store.set("saved", state.saved);
      renderSaved(); updateSaveBtn();
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.place && state.data) {
      const age = Date.now() - (state.lastLoad || 0);
      if (age > REFRESH_MS) loadPlace(state.place, { quiet: true });
    }
  });

  /* ---------- Boot ---------- */
  syncUnitButtons();
  renderSaved();
  loadPlace(placeFromUrl() || store.get("last", null) || DEFAULT_PLACE);
})();
