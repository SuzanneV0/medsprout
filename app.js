'use strict';

/* =========================================================
   Doseline — medication tracker (PWA)
   All data stays on the device in localStorage.
   ========================================================= */

const STORE_KEY = 'doseline:v1';

/* ---------- tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((parseDay(dayKey(b)) - parseDay(dayKey(a))) / 86400000);
const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const minToHHMM = m => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.round(m) % 60)}`;
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60; };
const fmtMin = m => {
  m = Math.round(m);
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  return `${h % 12 || 12}:${pad(mm)} ${h < 12 ? 'AM' : 'PM'}${m >= 1440 ? ' +1d' : ''}`;
};
const fmtDate = (k, o = { weekday: 'short', month: 'short', day: 'numeric' }) => parseDay(k).toLocaleDateString(undefined, o);
const fmtNum = n => String(+(+n).toFixed(2));
const fmtPills = n => `${fmtNum(n)} ${+n === 1 ? 'pill' : 'pills'}`;
const fmtHours = m => { const h = m / 60; return h % 1 === 0 ? `${h} h` : `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`; };
const atMin = (iso, k) => { const d = new Date(iso); return daysBetween(parseDay(k), d) * 1440 + d.getHours() * 60 + d.getMinutes(); };

/* ---------- state ---------- */
const defaults = () => ({
  meds: [],
  doses: {},        // { 'YYYY-MM-DD': { medId: { slotIdx: { status, at, pills } } } }
  sideEffects: [],
  notified: {},     // { key: timestamp } — prevents duplicate alerts
  snoozes: {},      // { slotKey: timestamp }
  settings: { graceMin: 30, refillWindowDays: 3, notifications: false },
});

let state = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw), d = defaults();
      return { ...d, ...s, settings: { ...d.settings, ...s.settings } };
    }
  } catch (e) { /* fall through */ }
  return defaults();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save — storage is unavailable in this browser.', 'danger'); }
}
const getMed = id => state.meds.find(m => m.id === id);

/* =========================================================
   Scheduling
   ========================================================= */

/** Base dose times for a medication, in minutes after midnight. */
function baseTimes(med) {
  const n = Math.max(1, Math.round(num(med.dosesPerDay, 1)));
  if (med.scheduleMode === 'custom') {
    return (med.customTimes || []).filter(Boolean).map(toMin).sort((a, b) => a - b);
  }
  const first = toMin(med.firstDose || '08:00');
  if (med.scheduleMode === 'interval') {
    const h = num(med.intervalHours, 24) * 60;
    return Array.from({ length: n }, (_, i) => first + i * h);
  }
  // 'even': spread across waking hours, first → last
  let last = toMin(med.lastDose || '20:00');
  if (last <= first) last += 1440;
  if (n === 1) return [first];
  return Array.from({ length: n }, (_, i) => Math.round(first + i * (last - first) / (n - 1)));
}

/** Minimum spacing between two doses (minutes). */
function gapMin(med) {
  if (med.scheduleMode === 'interval') return num(med.intervalHours, 24) * 60;
  const t = baseTimes(med);
  if (t.length < 2) return 1440;
  let g = Infinity;
  for (let i = 1; i < t.length; i++) g = Math.min(g, t[i] - t[i - 1]);
  return g;
}

const taperActive = (med, k) => !!(med.taper && med.taper.enabled && med.taper.startDate && k >= med.taper.startDate);

/** Total pills scheduled on a given day. */
function dailyPills(med, k) {
  if (taperActive(med, k)) {
    const t = med.taper;
    const step = Math.floor(daysBetween(parseDay(t.startDate), parseDay(k)) / Math.max(1, num(t.everyDays, 7)));
    return Math.max(0, num(t.startDaily) - step * num(t.reduceBy));
  }
  return num(med.pillsPerDose, 1) * baseTimes(med).length;
}

/** Pills for each base slot on a given day (taper splits the daily total across slots). */
function slotPills(med, k) {
  const times = baseTimes(med);
  if (!taperActive(med, k)) return times.map(() => num(med.pillsPerDose, 1));
  const t = med.taper, n = times.length;
  const unit = Number.isInteger(num(t.reduceBy)) && Number.isInteger(num(t.startDaily)) ? 1 : 0.5;
  const units = Math.round(dailyPills(med, k) / unit);
  const base = Math.floor(units / n), rem = units % n;
  return times.map((_, i) => (base + (i < rem ? 1 : 0)) * unit);
}

/** Full taper plan: one row per step until the dose reaches 0. */
function taperSteps(med) {
  const t = med.taper;
  if (!t || !t.enabled || !t.startDate || num(t.reduceBy) <= 0) return [];
  const every = Math.max(1, num(t.everyDays, 7));
  const steps = [];
  let i = 0, dose = num(t.startDaily);
  while (dose > 0 && i < 300) {
    const s = addDays(parseDay(t.startDate), i * every);
    steps.push({ step: i + 1, start: dayKey(s), end: dayKey(addDays(s, every - 1)), daily: dose });
    i++;
    dose = Math.max(0, num(t.startDaily) - i * num(t.reduceBy));
  }
  steps.push({ step: 'Done', start: dayKey(addDays(parseDay(t.startDate), i * every)), end: null, daily: 0 });
  return steps;
}

/**
 * The schedule for one medication on one day, with late-dose adjustment:
 * if a dose is taken late, every following dose that day is pushed so it
 * stays at least one full dosing interval after the dose actually taken.
 */
function daySchedule(med, k) {
  if (!med.active) return [];
  if (med.startDate && k < med.startDate) return [];
  if (taperActive(med, k) && dailyPills(med, k) <= 0) return [];
  const times = baseTimes(med), pills = slotPills(med, k), gap = gapMin(med);
  const recs = (state.doses[k] && state.doses[k][med.id]) || {};
  const createdDay = med.createdAt ? dayKey(new Date(med.createdAt)) : null;
  const createdMin = med.createdAt ? atMin(med.createdAt, k) : -1;
  const out = [];
  // `anchor` is when the previous dose was (or will be) taken; each dose must
  // come at least `gap` after it, so one late dose re-spaces the rest of the day.
  let anchor = null;
  times.forEach((base, idx) => {
    if (pills[idx] <= 0) return;
    const rec = recs[idx];
    // Doses that were already past when the medication was added aren't tracked.
    if (!rec && k === createdDay && base + state.settings.graceMin < createdMin) return;
    let time = base, shifted = false;
    if (anchor != null && anchor + gap > base + 0.5) { time = anchor + gap; shifted = true; }
    out.push({ med, k, idx, base, time, shifted, pills: pills[idx], rec, key: `${k}|${med.id}|${idx}` });
    if (rec && rec.status === 'taken') anchor = atMin(rec.at, k);
    else if (rec && rec.status === 'skipped') anchor = null;
    else anchor = time;
  });
  return out;
}

function allSlots(k) {
  return state.meds.flatMap(m => daySchedule(m, k)).sort((a, b) => a.time - b.time);
}

function slotStatus(slot) {
  if (slot.rec) return slot.rec.status;
  const today = dayKey();
  if (slot.k < today) return 'missed';
  if (slot.k > today) return 'upcoming';
  const n = nowMin();
  if (n < slot.time) return 'upcoming';
  if (n < slot.time + num(state.settings.graceMin, 30)) return 'due';
  return 'missed';
}

/** Days of supply left, walking the schedule (and taper) forward day by day. */
function forecast(med) {
  let left = num(med.pillsRemaining);
  const start = new Date();
  for (let i = 0; i < 400; i++) {
    const k = dayKey(addDays(start, i));
    if (taperActive(med, k) && dailyPills(med, k) <= 0) return { days: Infinity, taperEnds: k };
    const need = daySchedule(med, k).filter(s => !s.rec).reduce((a, s) => a + s.pills, 0);
    if (left + 1e-9 < need) return { days: i, runOut: k };
    left -= need;
  }
  return { days: Infinity };
}

function refillStatus(med) {
  if (!med.active) return { level: 'ok' };
  const f = forecast(med);
  if (num(med.pillsRemaining) <= 0 || f.days === 0) return { level: 'out', ...f };
  if (f.days <= num(state.settings.refillWindowDays, 3)) return { level: 'soon', ...f };
  return { level: 'ok', ...f };
}

/* =========================================================
   Actions
   ========================================================= */

function setRec(k, medId, idx, rec) {
  state.doses[k] = state.doses[k] || {};
  state.doses[k][medId] = state.doses[k][medId] || {};
  if (rec) state.doses[k][medId][idx] = rec; else delete state.doses[k][medId][idx];
}

function findSlot(key) {
  const [k, medId, idx] = key.split('|');
  const med = getMed(medId);
  if (!med) return null;
  return daySchedule(med, k).find(s => s.idx === +idx) || null;
}

function takeDose(key) {
  const slot = findSlot(key);
  if (!slot || slot.rec) return;
  const med = slot.med;
  const late = nowMin() - slot.time;
  setRec(slot.k, med.id, slot.idx, { status: 'taken', at: new Date().toISOString(), pills: slot.pills });
  med.pillsRemaining = Math.max(0, num(med.pillsRemaining) - slot.pills);
  delete state.snoozes[key];
  save();
  const next = daySchedule(med, slot.k).find(s => s.idx > slot.idx);
  let msg = `${med.name} taken ✓`;
  if (late > num(state.settings.graceMin, 30) && next && next.shifted) msg += ` Next dose moved to ${fmtMin(next.time)}.`;
  toast(msg, 'success');
  render();
}

function skipDose(key) {
  const slot = findSlot(key);
  if (!slot || slot.rec) return;
  setRec(slot.k, slot.med.id, slot.idx, { status: 'skipped', at: new Date().toISOString(), pills: 0 });
  delete state.snoozes[key];
  save();
  toast(`${slot.med.name} dose skipped.`);
  render();
}

function undoDose(key) {
  const [k, medId, idx] = key.split('|');
  const rec = state.doses[k] && state.doses[k][medId] && state.doses[k][medId][idx];
  const med = getMed(medId);
  if (!rec || !med) return;
  if (rec.status === 'taken') med.pillsRemaining = num(med.pillsRemaining) + num(rec.pills);
  setRec(k, medId, idx, null);
  save();
  toast('Dose un-logged.');
  render();
}

function snoozeDose(key, minutes = 10) {
  state.snoozes[key] = Date.now() + minutes * 60000;
  save();
  toast(`Reminder snoozed for ${minutes} minutes.`);
  render();
}

/* =========================================================
   Notifications & the reminder loop
   ========================================================= */

const canNotify = () => 'Notification' in window && Notification.permission === 'granted' && state.settings.notifications;

async function sysNotify(title, body, tag, slotKey) {
  if (!canNotify()) return;
  const opts = { body, tag, icon: 'icon.svg', badge: 'icon.svg', renotify: true, data: { slot: slotKey } };
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) {
      if (slotKey) opts.actions = [{ action: 'take', title: 'Mark taken' }, { action: 'snooze', title: 'Snooze 10 min' }];
      await reg.showNotification(title, opts);
    } else {
      new Notification(title, opts);
    }
  } catch (e) { /* notifications are best-effort */ }
}

function notifyOnce(key, title, body, level, slotKey) {
  if (state.notified[key]) return;
  state.notified[key] = Date.now();
  save();
  toast(`${title} — ${body}`, level, 7000);
  sysNotify(title, body, key, slotKey);
}

function tick() {
  const k = dayKey(), n = nowMin(), now = Date.now();
  for (const slot of allSlots(k)) {
    const med = slot.med, st = slotStatus(slot);
    const rem = med.reminder || { enabled: true, leadMin: 0 };
    const pillsTxt = `Take ${fmtPills(slot.pills)}${med.strength ? ` (${med.strength})` : ''}.`;
    if (!slot.rec && rem.enabled) {
      const lead = num(rem.leadMin);
      if (lead > 0 && n >= slot.time - lead && n < slot.time)
        notifyOnce(`${slot.key}|pre`, `${med.name} in ${lead} min`, `${pillsTxt} Due at ${fmtMin(slot.time)}.`, '', slot.key);
      if (st === 'due')
        notifyOnce(`${slot.key}|due|${Math.round(slot.time)}`, `Time to take ${med.name}`, `${pillsTxt} ${med.instructions ? med.instructions : ''}`.trim(), '', slot.key);
    }
    if (st === 'missed' && !slot.rec)
      notifyOnce(`${slot.key}|missed|${Math.round(slot.time)}`, `Missed dose: ${med.name}`, `It was due at ${fmtMin(slot.time)}. Take it now or skip it and your next dose will be re-spaced.`, 'danger', slot.key);
    const sz = state.snoozes[slot.key];
    if (sz && now >= sz && !slot.rec) {
      delete state.snoozes[slot.key];
      notifyOnce(`${slot.key}|snooze|${sz}`, `Reminder: ${med.name}`, pillsTxt, st === 'missed' ? 'danger' : '', slot.key);
    }
  }
  for (const med of state.meds) {
    const r = refillStatus(med);
    if (r.level === 'out') notifyOnce(`refill-out|${med.id}|${k}`, `${med.name} needs a refill`, `You don't have enough pills for today's doses. Refill your prescription.`, 'danger');
    else if (r.level === 'soon') notifyOnce(`refill-soon|${med.id}|${k}`, `Refill ${med.name} soon`, `About ${r.days} day${r.days === 1 ? '' : 's'} left — runs out ${fmtDate(r.runOut)}.`, 'warn');
  }
  // prune old notification keys (> 3 days)
  const cutoff = now - 3 * 86400000;
  let pruned = false;
  for (const key in state.notified) if (state.notified[key] < cutoff) { delete state.notified[key]; pruned = true; }
  if (pruned) save();
  // keep Today fresh unless the user is typing or a dialog is open
  if (currentView === 'today' && !$('#modal').open && !document.activeElement.matches('input,textarea,select')) render();
}

/* =========================================================
   UI plumbing
   ========================================================= */

function toast(msg, level = '', ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast ${level}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

const modal = $('#modal');
function openModal(html, onSubmit) {
  modal.innerHTML = html;
  modal.showModal();
  const form = $('form', modal);
  $$('[data-close]', modal).forEach(b => b.addEventListener('click', () => modal.close()));
  if (form && onSubmit) form.addEventListener('submit', e => {
    e.preventDefault();
    if (onSubmit(new FormData(form), form) !== false) modal.close();
  });
}
modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });

function confirmBox(title, body, okLabel, danger, onOk) {
  openModal(`<form method="dialog"><h2>${esc(title)}</h2><p>${body}</p>
    <div class="row"><button class="btn ${danger ? 'danger' : ''}" value="ok">${esc(okLabel)}</button>
    <button type="button" class="btn ghost" data-close>Cancel</button></div></form>`, () => { onOk(); });
}

/* menu */
const menuBtn = $('#menuBtn'), menu = $('#menu');
function setMenu(open) { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); }
menuBtn.addEventListener('click', e => { e.stopPropagation(); setMenu(menu.hidden); });
document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) setMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
menu.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });

/* delegated dose actions */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, key, id } = b.dataset;
  if (act === 'take') takeDose(key);
  else if (act === 'skip') skipDose(key);
  else if (act === 'undo') undoDose(key);
  else if (act === 'snooze') snoozeDose(key);
  else if (act === 'refill') refillModal(id);
  else if (act === 'pause') { const m = getMed(id); m.active = !m.active; save(); toast(m.active ? `${m.name} resumed.` : `${m.name} paused.`); render(); }
  else if (act === 'delete-med') {
    const m = getMed(id);
    confirmBox('Delete medication?', `This removes <strong>${esc(m.name)}</strong> and its schedule. Side-effect notes stay in your log.`, 'Delete', true, () => {
      state.meds = state.meds.filter(x => x.id !== id); save(); toast(`${m.name} deleted.`); render();
    });
  }
  else if (act === 'delete-effect') { state.sideEffects = state.sideEffects.filter(x => x.id !== id); save(); render(); }
  else if (act === 'notify') enableNotifications();
});

/* =========================================================
   Views
   ========================================================= */

let currentView = 'today';
let flashMedId = null;

function render() {
  const [view, arg] = (location.hash.slice(1) || 'today').split('/');
  currentView = view;
  $$('.menu a').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
  const app = $('#app');
  const views = { today: viewToday, meds: viewMeds, med: () => viewMedForm(arg), tapers: viewTapers, effects: viewEffects, history: viewHistory, settings: viewSettings };
  app.innerHTML = (views[view] || viewToday)();
  if (view === 'med') bindMedForm(arg);
  if (view === 'effects') bindEffectForm();
  if (view === 'settings') bindSettings();
}

/* ---------- Today ---------- */
function viewToday() {
  const k = dayKey();
  if (!state.meds.length) {
    return `<div class="page-head"><div><h1>Today</h1><p>${fmtDate(k, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div></div>
      <div class="empty"><h2>No medications yet</h2><p class="muted">Add your first prescription using the instructions on its label.</p>
      <a class="btn" href="#med/new">Add medication</a></div>`;
  }
  const slots = allSlots(k);
  const statuses = slots.map(s => ({ s, st: slotStatus(s) }));
  const done = statuses.filter(x => x.st === 'taken').length;
  const counted = statuses.filter(x => x.st !== 'skipped').length;

  // alerts
  const alerts = [];
  statuses.filter(x => x.st === 'missed').forEach(({ s }) => {
    const next = daySchedule(s.med, k).find(o => o.idx > s.idx && !o.rec);
    const nearNext = next && next.base - nowMin() < gapMin(s.med) / 2;
    alerts.push(`<div class="alert missed" role="alert"><div class="alert-body">
      <strong>Missed: ${esc(s.med.name)}</strong>
      <p>${fmtPills(s.pills)} was due at ${fmtMin(s.time)}.${nearNext ? ` Your next dose is at ${fmtMin(next.base)} — many labels say to skip a missed dose if the next one is close. Check your label or ask your pharmacist.` : ' Take it now and your next dose will be re-spaced automatically.'}</p></div>
      <div class="row"><button class="btn take sm" data-act="take" data-key="${s.key}">Take now</button>
      <button class="btn ghost sm" data-act="skip" data-key="${s.key}">Skip</button></div></div>`);
  });
  state.meds.forEach(m => {
    const r = refillStatus(m);
    if (r.level === 'out') alerts.push(`<div class="alert out" role="alert"><div class="alert-body"><strong>Prescription not refilled: ${esc(m.name)}</strong>
      <p>${num(m.pillsRemaining) <= 0 ? 'You are out of pills.' : `Only ${fmtPills(num(m.pillsRemaining))} left — not enough for today.`} Refill now so you don't miss doses.</p></div>
      <button class="btn sm" data-act="refill" data-id="${m.id}">Log refill</button></div>`);
    else if (r.level === 'soon') alerts.push(`<div class="alert soon"><div class="alert-body"><strong>Refill soon: ${esc(m.name)}</strong>
      <p>About ${r.days} day${r.days === 1 ? '' : 's'} of pills left — runs out ${fmtDate(r.runOut)}. Order your refill now.</p></div>
      <button class="btn sm" data-act="refill" data-id="${m.id}">Log refill</button></div>`);
  });

  const cards = statuses.map(({ s, st }) => doseCard(s, st)).join('');
  const tomorrow = allSlots(dayKey(addDays(new Date(), 1)));

  return `<div class="page-head"><div><h1>Today</h1><p>${fmtDate(k, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div>
    ${notifBanner()}</div>
    ${alerts.length ? `<div class="alerts">${alerts.join('')}</div>` : ''}
    <div class="card summary">
      <div><div class="big-num">${done}/${counted}</div><small>doses taken</small></div>
      <div class="progress" aria-label="Doses taken"><span style="width:${counted ? (done / counted) * 100 : 0}%"></span></div>
    </div>
    <div class="section"><h2>Schedule</h2>
      ${slots.length ? `<div class="timeline">${cards}</div>` : '<p class="muted">No doses scheduled today.</p>'}
    </div>
    ${tomorrow.length ? `<div class="section"><h2>Tomorrow</h2><div class="row">${tomorrow.map(s => `<span class="time-chip">${fmtMin(s.time)} · ${esc(s.med.name)} × ${fmtNum(s.pills)}</span>`).join('')}</div></div>` : ''}
    <div class="section"><h2>This week</h2>${weekStrip()}</div>`;
}

function doseCard(s, st) {
  const m = s.med;
  const label = { taken: 'Taken', skipped: 'Skipped', missed: 'Missed', due: 'Due now', upcoming: 'Upcoming' }[st];
  const snoozed = state.snoozes[s.key] && state.snoozes[s.key] > Date.now();
  let actions = '';
  if (st === 'taken' || st === 'skipped') {
    const at = new Date(s.rec.at);
    actions = `<span class="muted">${st === 'taken' ? 'Taken' : 'Skipped'} at ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      <button class="linkish" data-act="undo" data-key="${s.key}">Undo</button>`;
  } else {
    actions = `<button class="btn take sm" data-act="take" data-key="${s.key}">${st === 'upcoming' ? 'Take early' : 'Mark taken'}</button>
      ${st !== 'upcoming' ? `<button class="btn ghost sm" data-act="snooze" data-key="${s.key}">${snoozed ? 'Snoozed' : 'Snooze 10 min'}</button>` : ''}
      <button class="btn ghost sm" data-act="skip" data-key="${s.key}">Skip</button>`;
  }
  return `<article class="dose ${st}">
    <div class="dose-time">${fmtMin(s.time)}${s.shifted ? `<s>${fmtMin(s.base)}</s><span class="moved">re-spaced</span>` : ''}</div>
    <div>
      <div class="row"><h3>${esc(m.name)}</h3><span class="chip ${st}">${label}</span>${taperActive(m, s.k) ? '<span class="chip taper">Taper</span>' : ''}</div>
      <p class="meta">${fmtPills(s.pills)}${m.strength ? ` · ${esc(m.strength)}` : ''}${m.instructions ? ` · ${esc(m.instructions)}` : ''}</p>
      <div class="actions">${actions}</div>
    </div></article>`;
}

function weekStrip() {
  const today = new Date();
  const cells = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i), k = dayKey(d);
    const slots = allSlots(k).map(s => slotStatus(s)).filter(st => st !== 'skipped' && (i > 0 || st !== 'upcoming'));
    const taken = slots.filter(st => st === 'taken').length;
    const cls = !slots.length ? '' : taken === slots.length ? 'full' : 'partial';
    cells.push(`<div class="d">${d.toLocaleDateString(undefined, { weekday: 'narrow' })}
      <div class="dot ${cls} ${i === 0 ? 'today' : ''}" title="${taken} of ${slots.length} taken">${slots.length ? `${taken}/${slots.length}` : '–'}</div></div>`);
  }
  return `<div class="week">${cells.join('')}</div>`;
}

function notifBanner() {
  if (!('Notification' in window)) return '';
  if (canNotify()) return '<span class="chip">🔔 Reminders on</span>';
  if (Notification.permission === 'denied') return '<span class="chip" title="Allow notifications for this site in your browser settings">🔕 Notifications blocked</span>';
  return '<button class="btn ghost sm" data-act="notify">🔔 Turn on reminders</button>';
}

async function enableNotifications() {
  if (!('Notification' in window)) { toast('This browser does not support notifications. On iPhone, add Doseline to your Home Screen first.', 'warn', 6000); return; }
  const p = await Notification.requestPermission();
  state.settings.notifications = p === 'granted';
  save();
  toast(p === 'granted' ? 'Reminders are on.' : 'Notifications were not allowed.', p === 'granted' ? 'success' : 'warn');
  render();
}

/* ---------- Medications list ---------- */
function viewMeds() {
  const head = `<div class="page-head"><div><h1>Medications</h1><p>${state.meds.length} on file</p></div><a class="btn" href="#med/new">+ Add medication</a></div>`;
  if (!state.meds.length) return head + `<div class="empty"><h2>Nothing here yet</h2><p class="muted">Add a prescription to start tracking.</p></div>`;
  const cards = state.meds.map(m => {
    const r = refillStatus(m);
    const times = baseTimes(m);
    const bottle = Math.max(num(m.pillsPerBottle), num(m.pillsRemaining), 1);
    const pct = Math.min(100, (num(m.pillsRemaining) / bottle) * 100);
    const chip = !m.active ? '<span class="chip skipped">Paused</span>'
      : r.level === 'out' ? '<span class="chip out">Refill needed</span>'
      : r.level === 'soon' ? '<span class="chip soon">Refill soon</span>' : '';
    const supply = !m.active ? 'Paused'
      : r.taperEnds ? `Enough to finish taper (ends ${fmtDate(r.taperEnds)})`
      : r.days === Infinity ? 'Plenty on hand'
      : r.days === 0 ? 'Not enough for today' : `${r.days} day${r.days === 1 ? '' : 's'} left · runs out ${fmtDate(r.runOut)}`;
    const refills = (m.refills || []).slice().reverse();
    return `<article class="card med-card ${m.active ? '' : 'paused'} ${flashMedId === m.id ? 'new-flash' : ''}">
      <div class="row"><h3>${esc(m.name)}</h3>${chip}${m.taper && m.taper.enabled ? '<span class="chip taper">Taper</span>' : ''}</div>
      <p class="sub">${esc(m.strength || '')}${m.strength ? ' · ' : ''}${fmtPills(num(m.pillsPerDose, 1))} × ${times.length} a day · ${scheduleLabel(m)}</p>
      <div class="row">${times.map(t => `<span class="time-chip">${fmtMin(t)}</span>`).join('')}</div>
      ${m.instructions ? `<div class="instr">📋 ${esc(m.instructions)}</div>` : ''}
      <div class="stock-line"><span>${fmtPills(num(m.pillsRemaining))} left${m.pillsPerBottle ? ` of ${num(m.pillsPerBottle)} per bottle` : ''}</span><span class="muted">${supply}</span></div>
      <div class="progress stock ${m.active ? r.level : ''}"><span style="width:${pct}%"></span></div>
      ${m.refillsLeft !== '' && m.refillsLeft != null ? `<p class="muted" style="margin:8px 0 0;font-size:.88rem">Refills left on prescription: ${esc(m.refillsLeft)}</p>` : ''}
      <div class="row" style="margin-top:14px">
        <button class="btn sm" data-act="refill" data-id="${m.id}">Log refill</button>
        <a class="btn ghost sm" href="#med/${m.id}">Edit</a>
        <button class="btn ghost sm" data-act="pause" data-id="${m.id}">${m.active ? 'Pause' : 'Resume'}</button>
        <button class="btn ghost sm" data-act="delete-med" data-id="${m.id}">Delete</button>
      </div>
      <details><summary>Refill history (${refills.length})</summary>
        ${refills.length ? `<ul class="mini-list">${refills.map(r => `<li><span>${fmtDate(r.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span><span>+${fmtPills(r.pills)}${r.note ? ` · ${esc(r.note)}` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No refills logged yet.</p>'}
      </details>
    </article>`;
  }).join('');
  flashMedId = null;
  return head + `<div class="grid">${cards}</div>`;
}

function scheduleLabel(m) {
  if (m.scheduleMode === 'interval') return `every ${fmtNum(num(m.intervalHours))} h`;
  if (m.scheduleMode === 'custom') return 'custom times';
  return 'spaced evenly';
}

function refillModal(id) {
  const m = getMed(id);
  openModal(`<form><h2>Log refill · ${esc(m.name)}</h2>
    <div class="field"><label for="rf-date">Date picked up</label><input id="rf-date" name="date" type="date" value="${dayKey()}" required></div>
    <div class="field"><label for="rf-pills">Pills in this bottle</label><input id="rf-pills" name="pills" type="number" min="0.5" step="0.5" value="${num(m.pillsPerBottle) || ''}" required></div>
    <div class="field"><label for="rf-note">Note <span class="help">(optional — pharmacy, Rx number…)</span></label><input id="rf-note" name="note" maxlength="120"></div>
    ${m.refillsLeft !== '' && m.refillsLeft != null && num(m.refillsLeft) > 0 ? `<label class="check"><input type="checkbox" name="countdown" checked> Use one of my ${esc(m.refillsLeft)} remaining refills</label><br>` : ''}
    <p class="muted">You have ${fmtPills(num(m.pillsRemaining))} now.</p>
    <div class="row"><button class="btn">Add pills</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>`,
  fd => {
    const pills = num(fd.get('pills'));
    if (pills <= 0) return false;
    m.refills = m.refills || [];
    m.refills.push({ date: fd.get('date'), pills, note: String(fd.get('note') || '').trim() });
    m.pillsRemaining = num(m.pillsRemaining) + pills;
    if (fd.get('countdown')) m.refillsLeft = Math.max(0, num(m.refillsLeft) - 1);
    const k = dayKey();
    delete state.notified[`refill-out|${m.id}|${k}`];
    delete state.notified[`refill-soon|${m.id}|${k}`];
    save();
    toast(`Refill logged — ${m.name} now has ${fmtPills(m.pillsRemaining)}.`, 'success');
    render();
  });
}

/* ---------- Add / edit medication ---------- */
function blankMed() {
  return {
    id: '', name: '', strength: '', instructions: '', pillsPerDose: 1, dosesPerDay: 1,
    scheduleMode: 'even', firstDose: '08:00', lastDose: '20:00', intervalHours: 8, customTimes: ['08:00'],
    pillsPerBottle: 30, pillsRemaining: 30, refillsLeft: '', active: true,
    reminder: { enabled: true, leadMin: 0 },
    taper: { enabled: false, startDate: dayKey(), startDaily: 1, reduceBy: 1, everyN: 1, unit: 'weeks', everyDays: 7 },
    refills: [],
  };
}

function viewMedForm(id) {
  const isNew = !id || id === 'new';
  const m = isNew ? blankMed() : getMed(id);
  if (!m) return `<div class="empty"><h2>Medication not found</h2><a class="btn" href="#meds">Back to medications</a></div>`;
  const t = { ...blankMed().taper, ...(m.taper || {}) };
  const rem = { enabled: true, leadMin: 0, ...(m.reminder || {}) };
  const custom = (m.customTimes && m.customTimes.length ? m.customTimes : ['08:00']);
  return `<div class="page-head"><div><h1>${isNew ? 'Add medication' : `Edit ${esc(m.name)}`}</h1><p>Copy the details from your prescription label.</p></div></div>
  <form id="medForm" novalidate>
    <fieldset><legend>Prescription</legend>
      <div class="field"><label for="f-name">Medication name *</label><input id="f-name" name="name" required value="${esc(m.name)}" placeholder="e.g. Amoxicillin" autocomplete="off"></div>
      <div class="inline-fields">
        <div class="field"><label for="f-strength">Strength</label><input id="f-strength" name="strength" value="${esc(m.strength)}" placeholder="e.g. 500 mg"></div>
        <div class="field"><label for="f-ppd">Pills per dose *</label><input id="f-ppd" name="pillsPerDose" type="number" min="0.5" step="0.5" value="${num(m.pillsPerDose, 1)}" required></div>
      </div>
      <div class="field"><label for="f-instr">Label instructions</label>
        <textarea id="f-instr" name="instructions" placeholder="e.g. Take 1 capsule by mouth 3 times daily with food until finished">${esc(m.instructions)}</textarea></div>
    </fieldset>

    <fieldset><legend>Dose spacing</legend>
      <div class="field"><span class="help">How should doses be spaced through the day?</span>
        <div class="seg" role="radiogroup">
          <label><input type="radio" name="scheduleMode" value="even" ${m.scheduleMode === 'even' ? 'checked' : ''}> Evenly while awake</label>
          <label><input type="radio" name="scheduleMode" value="interval" ${m.scheduleMode === 'interval' ? 'checked' : ''}> Every X hours</label>
          <label><input type="radio" name="scheduleMode" value="custom" ${m.scheduleMode === 'custom' ? 'checked' : ''}> Set my own times</label>
        </div></div>
      <div class="inline-fields" data-mode="even interval">
        <div class="field"><label for="f-dpd">Times per day</label><input id="f-dpd" name="dosesPerDay" type="number" min="1" max="12" step="1" value="${num(m.dosesPerDay, 1)}"></div>
        <div class="field"><label for="f-first">First dose</label><input id="f-first" name="firstDose" type="time" value="${esc(m.firstDose)}"></div>
        <div class="field" data-mode="even"><label for="f-last">Last dose (bedtime)</label><input id="f-last" name="lastDose" type="time" value="${esc(m.lastDose)}"></div>
        <div class="field" data-mode="interval"><label for="f-int">Hours between doses</label><input id="f-int" name="intervalHours" type="number" min="1" max="24" step="0.5" value="${num(m.intervalHours, 8)}"></div>
      </div>
      <div data-mode="custom">
        <div class="field"><label>Dose times</label><div id="customTimes" class="grid">
          ${custom.map(ct => customTimeRow(ct)).join('')}</div></div>
        <button type="button" class="btn ghost sm" id="addTime">+ Add a time</button>
      </div>
      <div class="preview" id="spacingPreview" style="margin-top:14px"></div>
    </fieldset>

    <fieldset><legend>Reminders</legend>
      <label class="check"><input type="checkbox" name="remEnabled" ${rem.enabled ? 'checked' : ''}> Remind me when each dose is due</label>
      <div class="field" style="margin-top:12px"><label for="f-lead">Also remind me ahead of time</label>
        <select id="f-lead" name="leadMin">${[0, 5, 10, 15, 30, 60].map(v => `<option value="${v}" ${num(rem.leadMin) === v ? 'selected' : ''}>${v ? `${v} minutes before` : 'No early reminder'}</option>`).join('')}</select></div>
      <p class="help">Missed-dose alerts are always on. ${canNotify() ? '' : 'Turn on notifications in Settings to get alerts outside the app.'}</p>
    </fieldset>

    <fieldset><legend>Supply &amp; refills</legend>
      <div class="inline-fields">
        <div class="field"><label for="f-bottle">Pills per bottle</label><input id="f-bottle" name="pillsPerBottle" type="number" min="0" step="0.5" value="${num(m.pillsPerBottle)}"></div>
        <div class="field"><label for="f-left">Pills on hand now</label><input id="f-left" name="pillsRemaining" type="number" min="0" step="0.5" value="${num(m.pillsRemaining)}"></div>
        <div class="field"><label for="f-rleft">Refills left on Rx</label><input id="f-rleft" name="refillsLeft" type="number" min="0" step="1" value="${esc(m.refillsLeft)}" placeholder="optional"></div>
      </div>
      <p class="help">You'll get an early-refill warning when the supply will run out within ${num(state.settings.refillWindowDays, 3)} days.</p>
    </fieldset>

    <fieldset><legend>Taper schedule</legend>
      <label class="check"><input type="checkbox" name="taperEnabled" id="taperEnabled" ${t.enabled ? 'checked' : ''}> This medication needs a slow taper</label>
      <div id="taperFields" ${t.enabled ? '' : 'hidden'} style="margin-top:14px">
        <div class="inline-fields">
          <div class="field"><label for="t-start">Taper starts</label><input id="t-start" name="taperStart" type="date" value="${esc(t.startDate)}"></div>
          <div class="field"><label for="t-daily">Starting pills per day</label><input id="t-daily" name="taperDaily" type="number" min="0.5" step="0.5" value="${num(t.startDaily, 1)}"></div>
          <div class="field"><label for="t-by">Reduce by (pills)</label><input id="t-by" name="taperBy" type="number" min="0.5" step="0.5" value="${num(t.reduceBy, 1)}"></div>
        </div>
        <div class="inline-fields">
          <div class="field"><label for="t-n">Every</label><input id="t-n" name="taperN" type="number" min="1" step="1" value="${num(t.everyN, 1)}"></div>
          <div class="field"><label for="t-unit">&nbsp;</label><select id="t-unit" name="taperUnit">
            <option value="days" ${t.unit === 'days' ? 'selected' : ''}>day(s)</option>
            <option value="weeks" ${t.unit !== 'days' ? 'selected' : ''}>week(s)</option></select></div>
        </div>
        <p class="help">Daily pills are split across your dose times above. When the daily amount drops below the number of dose times, later doses drop off first.</p>
        <div id="taperPreview"></div>
      </div>
    </fieldset>

    <p class="error" id="formError" role="alert"></p>
    <div class="form-actions"><button class="btn">${isNew ? 'Save medication' : 'Save changes'}</button><a class="btn ghost" href="#meds">Cancel</a></div>
  </form>`;
}

const customTimeRow = v => `<div class="row"><input type="time" name="customTime" value="${esc(v)}" style="flex:1"><button type="button" class="btn ghost sm" data-rm-time aria-label="Remove time">Remove</button></div>`;

function readMedForm(form, base) {
  const fd = new FormData(form);
  const unit = fd.get('taperUnit') || 'weeks';
  const everyN = Math.max(1, Math.round(num(fd.get('taperN'), 1)));
  const customTimes = fd.getAll('customTime').filter(Boolean);
  const mode = fd.get('scheduleMode') || 'even';
  return {
    ...base,
    name: String(fd.get('name') || '').trim(),
    strength: String(fd.get('strength') || '').trim(),
    instructions: String(fd.get('instructions') || '').trim(),
    pillsPerDose: num(fd.get('pillsPerDose'), 1),
    scheduleMode: mode,
    dosesPerDay: mode === 'custom' ? customTimes.length : Math.max(1, Math.round(num(fd.get('dosesPerDay'), 1))),
    firstDose: fd.get('firstDose') || '08:00',
    lastDose: fd.get('lastDose') || '20:00',
    intervalHours: num(fd.get('intervalHours'), 8),
    customTimes,
    pillsPerBottle: num(fd.get('pillsPerBottle')),
    pillsRemaining: num(fd.get('pillsRemaining')),
    refillsLeft: fd.get('refillsLeft') === '' ? '' : Math.max(0, Math.round(num(fd.get('refillsLeft')))),
    reminder: { enabled: !!fd.get('remEnabled'), leadMin: num(fd.get('leadMin')) },
    taper: {
      enabled: !!fd.get('taperEnabled'),
      startDate: fd.get('taperStart') || dayKey(),
      startDaily: num(fd.get('taperDaily'), 1),
      reduceBy: num(fd.get('taperBy'), 1),
      everyN, unit,
      everyDays: everyN * (unit === 'days' ? 1 : 7),
    },
  };
}

function validateMed(m) {
  if (!m.name) return 'Please enter the medication name.';
  if (m.pillsPerDose <= 0) return 'Pills per dose must be more than 0.';
  if (m.scheduleMode === 'custom' && !m.customTimes.length) return 'Add at least one dose time.';
  if (m.scheduleMode === 'interval' && m.dosesPerDay * m.intervalHours > 24) return `${m.dosesPerDay} doses every ${m.intervalHours} h doesn't fit in 24 hours. Lower the times per day or the hours between doses.`;
  if (m.taper.enabled) {
    if (m.taper.reduceBy <= 0) return 'The taper reduction must be more than 0.';
    if (m.taper.startDaily <= 0) return 'Starting pills per day must be more than 0.';
  }
  return '';
}

function bindMedForm(id) {
  const form = $('#medForm');
  if (!form) return;
  const isNew = !id || id === 'new';
  const original = isNew ? blankMed() : getMed(id);

  const syncMode = () => {
    const mode = (new FormData(form)).get('scheduleMode');
    $$('[data-mode]', form).forEach(el => { el.hidden = !el.dataset.mode.split(' ').includes(mode); });
  };
  const updatePreview = () => {
    const m = readMedForm(form, original);
    syncMode();
    const times = baseTimes(m);
    const gap = gapMin(m);
    const err = m.scheduleMode === 'interval' && m.dosesPerDay * m.intervalHours > 24;
    $('#spacingPreview').innerHTML = err
      ? `<span class="error">That many doses won't fit in 24 hours at this spacing.</span>`
      : `<strong>${times.length} dose${times.length === 1 ? '' : 's'} a day</strong>${times.length > 1 ? `, at least ${fmtHours(gap)} apart` : ''}.
         <div class="row">${times.map(t => `<span class="time-chip">${fmtMin(t)}</span>`).join('')}</div>
         <p class="help" style="margin:8px 0 0">If you take a dose late, the rest of that day's doses shift so they stay ${times.length > 1 ? fmtHours(gap) : 'properly'} apart.</p>`;
    $('#taperFields').hidden = !m.taper.enabled;
    if (m.taper.enabled) {
      const steps = taperSteps(m);
      const today = dayKey();
      $('#taperPreview').innerHTML = steps.length ? `<div class="preview" style="margin-bottom:10px">Taper finishes on <strong>${fmtDate(steps[steps.length - 1].start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</strong> after ${steps.length - 1} step${steps.length === 2 ? '' : 's'}.</div>${taperTable(m, steps, today)}` : '';
    }
  };

  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  $('#addTime').addEventListener('click', () => {
    const last = $$('input[name="customTime"]', form).pop();
    const v = last && last.value ? minToHHMM(toMin(last.value) + 240) : '08:00';
    $('#customTimes').insertAdjacentHTML('beforeend', customTimeRow(v));
    updatePreview();
  });
  $('#customTimes').addEventListener('click', e => {
    if (!e.target.matches('[data-rm-time]')) return;
    if ($$('[name="customTime"]', form).length > 1) { e.target.closest('.row').remove(); updatePreview(); }
  });
  // When enabling a taper, seed the starting daily amount from the current schedule.
  $('#taperEnabled').addEventListener('change', e => {
    if (e.target.checked && isNew) {
      const m = readMedForm(form, original);
      $('#t-daily').value = fmtNum(m.pillsPerDose * baseTimes(m).length);
      updatePreview();
    }
  });
  updatePreview();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const m = readMedForm(form, original);
    const err = validateMed(m);
    $('#formError').textContent = err;
    if (err) return;
    if (isNew) {
      m.id = uid();
      m.createdAt = new Date().toISOString();
      m.startDate = dayKey();
      m.refills = [];
      state.meds.push(m);
      flashMedId = m.id;
      toast(`${m.name} added — reminders scheduled.`, 'success');
    } else {
      Object.assign(original, m);
      toast(`${m.name} updated.`, 'success');
    }
    save();
    location.hash = '#meds';
  });
}

/* ---------- Tapers ---------- */
function taperTable(m, steps, today) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>Step</th><th>Dates</th><th>Pills / day</th><th>Per dose</th></tr></thead>
    <tbody>${steps.map(s => {
      const cls = s.end && today >= s.start && today <= s.end ? 'current' : (s.end && today > s.end ? 'past' : '');
      const split = s.daily > 0 ? slotPills(m, s.start).filter(p => p > 0).map(fmtNum).join(' + ') : '—';
      return `<tr class="${cls}"><td>${s.step}</td>
        <td>${fmtDate(s.start, { month: 'short', day: 'numeric' })}${s.end ? ` – ${fmtDate(s.end, { month: 'short', day: 'numeric' })}` : ' onward'}</td>
        <td>${s.daily > 0 ? fmtNum(s.daily) : 'Stop ✓'}</td><td>${split}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function viewTapers() {
  const tapering = state.meds.filter(m => m.taper && m.taper.enabled);
  const head = `<div class="page-head"><div><h1>Taper schedules</h1><p>Step-downs are built into your daily reminders automatically.</p></div></div>`;
  if (!tapering.length) return head + `<div class="empty"><h2>No tapers set up</h2><p class="muted">Edit a medication and turn on “This medication needs a slow taper”.</p><a class="btn" href="#meds">Go to medications</a></div>`;
  const today = dayKey();
  return head + `<div class="grid">${tapering.map(m => {
    const steps = taperSteps(m);
    const cur = steps.find(s => s.end && today >= s.start && today <= s.end);
    const t = m.taper;
    const notStarted = today < t.startDate;
    const next = steps.find(s => s.start > today);
    return `<article class="card"><div class="row"><h2 style="margin:0">${esc(m.name)}</h2><span class="chip taper">Reduce ${fmtNum(t.reduceBy)} every ${t.everyN} ${t.unit === 'days' ? (t.everyN === 1 ? 'day' : 'days') : (t.everyN === 1 ? 'week' : 'weeks')}</span></div>
      <p class="muted" style="margin:8px 0 14px">${notStarted ? `Starts ${fmtDate(t.startDate)}.` : cur ? `Now: <strong style="color:var(--linen)">${fmtPills(cur.daily)} a day</strong> (step ${cur.step} of ${steps.length - 1}).` : 'Taper complete.'}
      ${next ? ` Next change ${fmtDate(next.start)} → ${next.daily > 0 ? fmtPills(next.daily) + ' a day' : 'stop'}.` : ''}</p>
      ${taperTable(m, steps, today)}
      <div class="row" style="margin-top:12px"><a class="btn ghost sm" href="#med/${m.id}">Edit taper</a></div></article>`;
  }).join('')}</div>
  <p class="muted" style="margin-top:18px">Never change a taper without talking to your prescriber.</p>`;
}

/* ---------- Side effects ---------- */
const COMMON_EFFECTS = ['Nausea', 'Headache', 'Dizziness', 'Drowsiness', 'Insomnia', 'Upset stomach', 'Diarrhea', 'Constipation', 'Dry mouth', 'Rash', 'Fatigue', 'Anxiety', 'Mood changes', 'Loss of appetite', 'Muscle aches', 'Sweating'];
const SEV = ['', 'Very mild', 'Mild', 'Moderate', 'Strong', 'Severe'];

function viewEffects() {
  const now = new Date();
  const local = `${dayKey(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const filter = sessionFilter;
  const list = state.sideEffects.filter(e => !filter || e.medId === filter).sort((a, b) => b.at.localeCompare(a.at));
  return `<div class="page-head"><div><h1>Side effects</h1><p>Keep notes to share with your doctor or pharmacist.</p></div></div>
  <div class="grid-2">
    <form class="card" id="effectForm">
      <h2>Log a side effect</h2>
      <div class="field"><label for="e-med">Medication</label><select id="e-med" name="medId">
        ${state.meds.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}<option value="">Not sure / general</option></select></div>
      <div class="field"><label for="e-sym">What are you feeling?</label><input id="e-sym" name="symptom" list="effectList" required placeholder="e.g. Nausea">
        <datalist id="effectList">${COMMON_EFFECTS.map(x => `<option value="${x}">`).join('')}</datalist></div>
      <div class="field"><label for="e-sev">How strong? <span class="help" id="sevLabel">Moderate</span></label><input id="e-sev" name="severity" type="range" min="1" max="5" value="3"></div>
      <div class="field"><label for="e-at">When</label><input id="e-at" name="at" type="datetime-local" value="${local}" required></div>
      <div class="field"><label for="e-notes">Notes</label><textarea id="e-notes" name="notes" placeholder="How long it lasted, what helped…"></textarea></div>
      <button class="btn">Save entry</button>
      <p class="help" style="margin-top:12px">Having trouble breathing, swelling of the face or throat, or a severe reaction? Call emergency services right away.</p>
    </form>
    <div>
      <div class="row" style="margin-bottom:12px"><label for="e-filter" class="help">Show</label>
        <select id="e-filter" style="flex:1"><option value="">All medications</option>${state.meds.map(m => `<option value="${m.id}" ${filter === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
      ${list.length ? `<div class="grid">${list.map(e => {
        const m = getMed(e.medId);
        return `<article class="card effect"><div class="top"><h3>${esc(e.symptom)}</h3>
          <span class="sev" title="${SEV[e.severity]}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= e.severity ? 'on' : ''}"></i>`).join('')} <small>&nbsp;${SEV[e.severity]}</small></span></div>
          <small>${new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${m ? esc(m.name) : esc(e.medName || 'General')}</small>
          ${e.notes ? `<p class="note">${esc(e.notes)}</p>` : ''}
          <div><button class="linkish" data-act="delete-effect" data-id="${e.id}">Delete</button></div></article>`;
      }).join('')}</div>` : '<div class="empty"><p class="muted" style="margin:0">No side effects logged.</p></div>'}
    </div>
  </div>`;
}
let sessionFilter = '';

function bindEffectForm() {
  const form = $('#effectForm');
  $('#e-sev').addEventListener('input', e => { $('#sevLabel').textContent = SEV[e.target.value]; });
  $('#e-filter').addEventListener('change', e => { sessionFilter = e.target.value; render(); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const symptom = String(fd.get('symptom') || '').trim();
    if (!symptom) return;
    const med = getMed(fd.get('medId'));
    state.sideEffects.push({
      id: uid(), medId: fd.get('medId') || '', medName: med ? med.name : '',
      symptom, severity: +fd.get('severity'), at: new Date(fd.get('at')).toISOString(),
      notes: String(fd.get('notes') || '').trim(),
    });
    save();
    toast('Side effect logged.', 'success');
    render();
  });
}

/* ---------- History ---------- */
function viewHistory() {
  const rows = [];
  for (let i = 0; i < 14; i++) {
    const k = dayKey(addDays(new Date(), -i));
    const slots = allSlots(k).map(s => ({ s, st: slotStatus(s) })).filter(x => i > 0 || x.st !== 'upcoming');
    if (!slots.length) continue;
    rows.push(`<article class="card"><div class="row"><h3 style="margin:0">${i === 0 ? 'Today' : i === 1 ? 'Yesterday' : fmtDate(k)}</h3>
      <span class="spacer"></span><small>${slots.filter(x => x.st === 'taken').length} of ${slots.filter(x => x.st !== 'skipped').length} taken</small></div>
      <ul class="mini-list">${slots.map(({ s, st }) => `<li><span>${fmtMin(s.time)} · ${esc(s.med.name)} × ${fmtNum(s.pills)}</span>
        <span>${st === 'taken' ? `<span class="chip taken">Taken ${new Date(s.rec.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>` : `<span class="chip ${st}">${st[0].toUpperCase() + st.slice(1)}</span>`}
        ${s.rec ? ` <button class="linkish" data-act="undo" data-key="${s.key}">Undo</button>` : i > 0 ? ` <button class="linkish" data-act="take" data-key="${s.key}">Log as taken</button>` : ''}</span></li>`).join('')}</ul></article>`);
  }
  return `<div class="page-head"><div><h1>History</h1><p>The last 14 days of doses.</p></div></div>
    ${rows.length ? `<div class="grid">${rows.join('')}</div>` : '<div class="empty"><p class="muted" style="margin:0">No dose history yet.</p></div>'}`;
}

/* ---------- Settings ---------- */
function viewSettings() {
  const s = state.settings;
  const perm = !('Notification' in window) ? 'Not supported in this browser' : Notification.permission === 'granted' ? (s.notifications ? 'On' : 'Allowed, but turned off') : Notification.permission === 'denied' ? 'Blocked — allow it in your browser settings' : 'Off';
  return `<div class="page-head"><div><h1>Settings</h1></div></div>
  <form id="settingsForm">
    <fieldset><legend>Reminders</legend>
      <p>Notifications: <strong>${perm}</strong></p>
      <div class="row">${'Notification' in window && Notification.permission !== 'denied' ? `<button type="button" class="btn sm" data-act="notify">${canNotify() ? 'Re-check permission' : 'Turn on notifications'}</button>` : ''}
        ${canNotify() ? `<button type="button" class="btn ghost sm" id="testNotif">Send a test</button><button type="button" class="btn ghost sm" id="notifOff">Turn off</button>` : ''}</div>
      <div class="field" style="margin-top:14px"><label for="s-grace">Mark a dose as missed after</label>
        <select id="s-grace" name="graceMin">${[15, 30, 45, 60, 90, 120].map(v => `<option value="${v}" ${num(s.graceMin) === v ? 'selected' : ''}>${v} minutes</option>`).join('')}</select></div>
    </fieldset>
    <fieldset><legend>Refills</legend>
      <div class="field"><label for="s-window">Warn me when a prescription will run out within</label>
        <select id="s-window" name="refillWindowDays">${[2, 3, 4, 5, 7, 10, 14].map(v => `<option value="${v}" ${num(s.refillWindowDays) === v ? 'selected' : ''}>${v} days</option>`).join('')}</select></div>
    </fieldset>
    <fieldset><legend>Install on your phone</legend>
      <p><strong>iPhone / iPad:</strong> open this page in Safari, tap Share, then <em>Add to Home Screen</em>. Open Doseline from the Home Screen icon, then turn on notifications.</p>
      <p style="margin:0"><strong>Android:</strong> open in Chrome, tap ⋮, then <em>Install app</em> (or <em>Add to Home screen</em>).</p>
    </fieldset>
    <fieldset><legend>Your data</legend>
      <p class="help">Everything is stored only on this device. Export a backup to move it to another device.</p>
      <div class="row"><button type="button" class="btn ghost sm" id="exportBtn">Export backup</button>
        <label class="btn ghost sm" for="importFile" style="cursor:pointer">Import backup</label><input type="file" id="importFile" accept="application/json" hidden>
        <button type="button" class="btn danger sm" id="resetBtn">Erase all data</button></div>
    </fieldset>
  </form>`;
}

function bindSettings() {
  const form = $('#settingsForm');
  form.addEventListener('change', e => {
    if (e.target.name === 'graceMin' || e.target.name === 'refillWindowDays') {
      state.settings[e.target.name] = num(e.target.value);
      save();
      toast('Saved.', 'success');
    }
  });
  const test = $('#testNotif');
  if (test) test.addEventListener('click', () => sysNotify('Doseline test', 'Reminders are working. 💊', 'test'));
  const off = $('#notifOff');
  if (off) off.addEventListener('click', () => { state.settings.notifications = false; save(); render(); });
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `doseline-backup-${dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.meds)) throw new Error('bad file');
      confirmBox('Replace your data?', 'Importing replaces everything currently on this device with the backup.', 'Import', true, () => {
        state = { ...defaults(), ...data, settings: { ...defaults().settings, ...data.settings } };
        save(); toast('Backup imported.', 'success'); render();
      });
    } catch (err) { toast('That file is not a Doseline backup.', 'danger'); }
  });
  $('#resetBtn').addEventListener('click', () => confirmBox('Erase all data?', 'This deletes every medication, dose record and side-effect note on this device. Export a backup first if you might need it.', 'Erase everything', true, () => {
    state = defaults(); save(); toast('All data erased.'); location.hash = '#today'; render();
  }));
}

/* =========================================================
   Boot
   ========================================================= */

window.addEventListener('hashchange', () => { setMenu(false); render(); window.scrollTo(0, 0); $('#app').focus({ preventScroll: true }); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type !== 'notification-action' || !d.slot) return;
    if (d.action === 'take') takeDose(d.slot);
    else if (d.action === 'snooze') snoozeDose(d.slot);
    else { location.hash = '#today'; }
  });
}

// Actions arriving from a notification when the app was closed (?action=take&slot=…)
(function handleLaunchAction() {
  const p = new URLSearchParams(location.search);
  const slot = p.get('slot'), action = p.get('action');
  if (slot && action) {
    history.replaceState(null, '', location.pathname + '#today');
    if (action === 'take') takeDose(slot); else if (action === 'snooze') snoozeDose(slot);
  }
})();

document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
render();
tick();
setInterval(tick, 20000);
