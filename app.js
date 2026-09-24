'use strict';

/* =========================================================
   Medsprout — medication tracker (PWA)
   All data stays on the device in localStorage.
   ========================================================= */

const STORE_KEY = 'medsprout:v1';
const LEGACY_STORE_KEY = 'doseline:v1'; // the app's name before it became Medsprout

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
  people: [{ id: 'me', name: 'User 1', color: 0 }], // family members; every med belongs to one
  viewing: 'all',   // 'all' or a person id — which family member the screens show
  meds: [],
  doses: {},        // { 'YYYY-MM-DD': { medId: { slotIdx: { status, at, pills } } } }
  sideEffects: [],
  notified: {},     // { key: timestamp } — prevents duplicate alerts
  snoozes: {},      // { slotKey: timestamp }
  settings: { graceMin: 30, refillWindowDays: 3, notifications: false },
});

/** Fill in anything missing from older saved data or backups (before family members existed). */
function upgrade(s) {
  const d = defaults();
  s = { ...d, ...s, settings: { ...d.settings, ...s.settings } };
  if (!Array.isArray(s.people) || !s.people.length) s.people = d.people;
  s.people.forEach(p => { if (p.id === 'me' && p.name === 'Me') p.name = nextUserName(s.people); });
  const first = s.people[0].id;
  const known = id => s.people.some(p => p.id === id);
  s.meds.forEach((m, i) => {
    if (!known(m.personId)) m.personId = first;
    if (m.kind !== 'vitamin') m.kind = 'med';
    if (!Number.isInteger(m.color)) m.color = i % PILL_COLORS.length;
  });
  s.sideEffects.forEach(e => {
    if (!known(e.personId)) e.personId = (s.meds.find(m => m.id === e.medId) || {}).personId || first;
  });
  if (s.viewing !== 'all' && !known(s.viewing)) s.viewing = 'all';
  return s;
}

let state = load();
function load() {
  try {
    let raw = localStorage.getItem(STORE_KEY);
    if (!raw && (raw = localStorage.getItem(LEGACY_STORE_KEY))) {
      localStorage.setItem(STORE_KEY, raw);
      localStorage.removeItem(LEGACY_STORE_KEY);
    }
    if (raw) return upgrade(JSON.parse(raw));
  } catch (e) { /* fall through */ }
  return defaults();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save — storage is unavailable in this browser.', 'danger'); }
}
const getMed = id => state.meds.find(m => m.id === id);
const isVitamin = m => m.kind === 'vitamin';
/** First colour combo not already used by another medication, so new ones stand out by default. */
function nextFreeColor(exceptId) {
  const used = new Set(state.meds.filter(m => m.id !== exceptId).map(m => m.color));
  for (let i = 0; i < PILL_COLORS.length; i++) if (!used.has(i)) return i;
  return state.meds.length % PILL_COLORS.length;
}

/* ---------- family members ---------- */
const getPerson = id => state.people.find(p => p.id === id);
/** Neutral default names — "User 1", "User 2"… — using the lowest number not already taken. */
function nextUserName(people = state.people) {
  const taken = new Set(people.map(p => p.name.trim().toLowerCase()));
  let n = 1;
  while (taken.has(`user ${n}`)) n++;
  return `User ${n}`;
}
const isFamily = () => state.people.length > 1;
/** Medications for whoever is selected in the switcher. */
const visibleMeds = () => state.viewing === 'all' ? state.meds : state.meds.filter(m => m.personId === state.viewing);
const visiblePeople = () => state.viewing === 'all' ? state.people : state.people.filter(p => p.id === state.viewing);
/** "User 2 · Amoxicillin" once there's more than one person, otherwise just "Amoxicillin". */
const medLabel = m => { const p = getPerson(m.personId); return isFamily() && p ? `${p.name} · ${m.name}` : m.name; };
/** "Sam Lee" → "SL", "Sam" → "Sa", "User 2" → "U2", so names that share a first letter still look different. */
const initials = name => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0][0].toUpperCase() + (words[0][1] || '').toLowerCase();
};
const avatar = p => p ? `<span class="avatar c${p.color % 3}" aria-hidden="true">${esc(initials(p.name))}</span>` : '';
/** Small "who" tag for cards — only shown when there's more than one person. */
const whoTag = m => { const p = getPerson(m.personId); return isFamily() && p ? `<span class="who">${avatar(p)}${esc(p.name)}</span>` : ''; };

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

function allSlots(k, meds = state.meds) {
  return meds.flatMap(m => daySchedule(m, k)).sort((a, b) => a.time - b.time);
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
  let msg = `${medLabel(med)} taken ✓`;
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
  toast(`${medLabel(slot.med)} dose skipped.`);
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
        notifyOnce(`${slot.key}|pre`, `${medLabel(med)} in ${lead} min`, `${pillsTxt} Due at ${fmtMin(slot.time)}.`, '', slot.key);
      if (st === 'due')
        notifyOnce(`${slot.key}|due|${Math.round(slot.time)}`, `Time to take ${medLabel(med)}`, `${pillsTxt} ${med.instructions ? med.instructions : ''}`.trim(), '', slot.key);
    }
    if (st === 'missed' && !slot.rec)
      notifyOnce(`${slot.key}|missed|${Math.round(slot.time)}`, `Missed dose: ${medLabel(med)}`, `It was due at ${fmtMin(slot.time)}. Take it now or skip it and your next dose will be re-spaced.`, 'danger', slot.key);
    const sz = state.snoozes[slot.key];
    if (sz && now >= sz && !slot.rec) {
      delete state.snoozes[slot.key];
      notifyOnce(`${slot.key}|snooze|${sz}`, `Reminder: ${medLabel(med)}`, pillsTxt, st === 'missed' ? 'danger' : '', slot.key);
    }
  }
  for (const med of state.meds) {
    const r = refillStatus(med);
    if (r.level === 'out') notifyOnce(`refill-out|${med.id}|${k}`, `${medLabel(med)} needs a refill`, `You don't have enough pills for today's doses. Refill your prescription.`, 'danger');
    else if (r.level === 'soon') notifyOnce(`refill-soon|${med.id}|${k}`, `Refill ${medLabel(med)} soon`, `About ${r.days} day${r.days === 1 ? '' : 's'} left — runs out ${fmtDate(r.runOut)}.`, 'warn');
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
  else if (act === 'pause') { const m = getMed(id); m.active = !m.active; save(); toast(m.active ? `${medLabel(m)} resumed.` : `${medLabel(m)} paused.`); render(); }
  else if (act === 'delete-med') {
    const m = getMed(id);
    confirmBox('Delete medication?', `This removes <strong>${esc(medLabel(m))}</strong> and its schedule. Side-effect notes stay in your log.`, 'Delete', true, () => {
      state.meds = state.meds.filter(x => x.id !== id); save(); toast(`${medLabel(m)} deleted.`); render();
    });
  }
  else if (act === 'delete-effect') { state.sideEffects = state.sideEffects.filter(x => x.id !== id); save(); render(); }
  else if (act === 'notify') enableNotifications();
  else if (act === 'view-person') { state.viewing = id; save(); render(); }
  else if (act === 'add-person') personModal();
  else if (act === 'rename-person') personModal(id);
  else if (act === 'delete-person') deletePerson(id);
});

/* ---------- family members: switcher, add/rename, delete ---------- */
function personSwitcher() {
  if (!isFamily()) return '';
  const btn = (id, label, extra = '') => `<button class="person-tab ${state.viewing === id ? 'active' : ''}" data-act="view-person" data-id="${id}" aria-pressed="${state.viewing === id}">${extra}${label}</button>`;
  return `<div class="switcher" role="group" aria-label="Show medications for">
    ${btn('all', 'Everyone')}
    ${state.people.map(p => btn(p.id, esc(p.name), avatar(p))).join('')}
    <button class="person-tab add" data-act="add-person" aria-label="Add family member">+ Add</button>
  </div>`;
}

/** Add a family member (no id) or rename one. `onDone` receives the person, e.g. to select them in a form. */
function personModal(id, onDone) {
  const p = id && getPerson(id);
  openModal(`<form><h2>${p ? `Rename ${esc(p.name)}` : 'Add a family member'}</h2>
    <div class="field"><label for="p-name">Name</label>
      <input id="p-name" name="name" maxlength="40" value="${esc(p ? p.name : nextUserName())}" autocomplete="off"></div>
    ${p ? '' : '<p class="help">Keep the default or type any name you like. Their medications and reminders are kept separately, and everything stays on this device.</p>'}
    <div class="row"><button class="btn">${p ? 'Save' : 'Add'}</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>`,
  fd => {
    const name = String(fd.get('name') || '').trim() || (p ? p.name : nextUserName());
    if (state.people.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) { toast(`There's already someone called ${name}.`, 'warn'); return false; }
    let person = p;
    if (p) p.name = name;
    else {
      person = { id: uid(), name, color: state.people.length };
      state.people.push(person);
    }
    save();
    toast(p ? 'Name updated.' : `${name} added.`, 'success');
    if (onDone) onDone(person); else render();
  });
  setTimeout(() => { const f = $('#p-name', modal); if (f) { f.focus(); f.select(); } }, 50);
}

function deletePerson(id) {
  const p = getPerson(id);
  if (!p || state.people.length < 2) return;
  const meds = state.meds.filter(m => m.personId === id);
  confirmBox(`Remove ${p.name}?`,
    meds.length
      ? `This also deletes <strong>${meds.length} medication${meds.length === 1 ? '' : 's'}</strong> (${meds.map(m => esc(m.name)).join(', ')}), their dose history and their side-effect notes from this device. This can't be undone.`
      : `${esc(p.name)} has no medications. Their side-effect notes will also be removed.`,
    `Remove ${p.name}`, true, () => {
      const ids = new Set(meds.map(m => m.id));
      state.meds = state.meds.filter(m => !ids.has(m.id));
      state.sideEffects = state.sideEffects.filter(e => e.personId !== id);
      for (const k in state.doses) for (const mid of ids) delete state.doses[k][mid];
      for (const key in state.snoozes) if (ids.has(key.split('|')[1])) delete state.snoozes[key];
      state.people = state.people.filter(x => x.id !== id);
      if (state.viewing === id) state.viewing = 'all';
      save(); toast(`${p.name} removed.`); render();
    });
}

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
  const withSwitcher = ['today', 'meds', 'tapers', 'effects', 'history'].includes(view) || !views[view] && !LEGAL_PAGES[view];
  app.innerHTML = LEGAL_PAGES[view] ? viewLegal(view) : (withSwitcher ? personSwitcher() : '') + (views[view] || viewToday)();
  document.title = LEGAL_PAGES[view] ? `${LEGAL_PAGES[view].title} · Medsprout` : 'Medsprout';
  if (view === 'med') bindMedForm(arg);
  if (view === 'effects') bindEffectForm();
  if (view === 'settings') bindSettings();
}

/* ---------- Today ---------- */
function viewToday() {
  const k = dayKey();
  const meds = visibleMeds();
  const who = state.viewing !== 'all' && isFamily() ? getPerson(state.viewing).name : '';
  const dateLine = fmtDate(k, { weekday: 'long', month: 'long', day: 'numeric' }) + (who ? ` · ${esc(who)}` : '');
  if (!meds.length) {
    return `<div class="page-head"><div><h1>Today</h1><p>${dateLine}</p></div></div>
      <div class="empty"><h2>${who ? `No medications for ${esc(who)} yet` : 'No medications yet'}</h2><p class="muted">Add your first prescription using the instructions on its label.</p>
      <a class="btn" href="#med/new">Add medication</a></div>`;
  }
  const slots = allSlots(k, meds);
  const statuses = slots.map(s => ({ s, st: slotStatus(s) }));
  const done = statuses.filter(x => x.st === 'taken').length;
  const counted = statuses.filter(x => x.st !== 'skipped').length;

  // alerts
  const alerts = [];
  statuses.filter(x => x.st === 'missed').forEach(({ s }) => {
    const next = daySchedule(s.med, k).find(o => o.idx > s.idx && !o.rec);
    const nearNext = next && next.base - nowMin() < gapMin(s.med) / 2;
    alerts.push(`<div class="alert missed" role="alert"><div class="alert-body">
      <strong>Missed: ${esc(medLabel(s.med))}</strong>
      <p>${fmtPills(s.pills)} was due at ${fmtMin(s.time)}.${nearNext ? ` Your next dose is at ${fmtMin(next.base)} — many labels say to skip a missed dose if the next one is close. Check your label or ask your pharmacist.` : ' Take it now and your next dose will be re-spaced automatically.'}</p></div>
      <div class="row"><button class="btn take sm" data-act="take" data-key="${s.key}">Take now</button>
      <button class="btn ghost sm" data-act="skip" data-key="${s.key}">Skip</button></div></div>`);
  });
  meds.forEach(m => {
    const r = refillStatus(m);
    if (r.level === 'out') alerts.push(`<div class="alert out" role="alert"><div class="alert-body"><strong>${isVitamin(m) ? 'Out of stock' : 'Prescription not refilled'}: ${esc(medLabel(m))}</strong>
      <p>${num(m.pillsRemaining) <= 0 ? 'You are out of pills.' : `Only ${fmtPills(num(m.pillsRemaining))} left — not enough for today.`} Refill now so you don't miss doses.</p></div>
      <button class="btn sm" data-act="refill" data-id="${m.id}">Log refill</button></div>`);
    else if (r.level === 'soon') alerts.push(`<div class="alert soon"><div class="alert-body"><strong>${isVitamin(m) ? 'Restock soon' : 'Refill soon'}: ${esc(medLabel(m))}</strong>
      <p>About ${r.days} day${r.days === 1 ? '' : 's'} of pills left — runs out ${fmtDate(r.runOut)}. ${isVitamin(m) ? 'Pick up more soon.' : 'Order your refill now.'}</p></div>
      <button class="btn sm" data-act="refill" data-id="${m.id}">Log refill</button></div>`);
  });

  const cards = statuses.map(({ s, st }) => doseCard(s, st)).join('');
  const tomorrow = allSlots(dayKey(addDays(new Date(), 1)), meds);

  return `<div class="page-head"><div><h1>Today</h1><p>${dateLine}</p></div>
    ${notifBanner()}</div>
    ${alerts.length ? `<div class="alerts">${alerts.join('')}</div>` : ''}
    <div class="card summary">
      <div><div class="big-num">${done}/${counted}</div><small>doses taken</small></div>
      <div class="progress" aria-label="Doses taken"><span style="width:${counted ? (done / counted) * 100 : 0}%"></span></div>
    </div>
    <div class="section"><h2>Schedule</h2>
      ${slots.length ? `<div class="timeline">${cards}</div>` : '<p class="muted">No doses scheduled today.</p>'}
    </div>
    ${tomorrow.length ? `<div class="section"><h2>Tomorrow</h2><div class="row">${tomorrow.map(s => `<span class="time-chip">${pillIcon(s.med, 18)}${fmtMin(s.time)} · ${esc(medLabel(s.med))} × ${fmtNum(s.pills)}</span>`).join('')}</div></div>` : ''}
    <div class="section"><h2>This week</h2>${weekStrip(meds)}</div>`;
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
      <div class="row"><h3 class="med-title">${pillIcon(m)}${esc(m.name)}</h3>${whoTag(m)}<span class="chip ${st}">${label}</span>${taperActive(m, s.k) ? '<span class="chip taper">Taper</span>' : ''}</div>
      <p class="meta">${fmtPills(s.pills)}${m.strength ? ` · ${esc(m.strength)}` : ''}${m.instructions ? ` · ${esc(m.instructions)}` : ''}</p>
      <div class="actions">${actions}</div>
    </div></article>`;
}

function weekStrip(meds = state.meds) {
  const today = new Date();
  const cells = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i), k = dayKey(d);
    const slots = allSlots(k, meds).map(s => slotStatus(s)).filter(st => st !== 'skipped' && (i > 0 || st !== 'upcoming'));
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
  if (!('Notification' in window)) { toast('This browser does not support notifications. On iPhone, add Medsprout to your Home Screen first.', 'warn', 6000); return; }
  const p = await Notification.requestPermission();
  state.settings.notifications = p === 'granted';
  save();
  toast(p === 'granted' ? 'Reminders are on.' : 'Notifications were not allowed.', p === 'granted' ? 'success' : 'warn');
  render();
}

/* ---------- Medications list ---------- */
function viewMeds() {
  const meds = visibleMeds();
  const who = state.viewing !== 'all' && isFamily() ? getPerson(state.viewing).name : '';
  const addFamily = isFamily() ? '' : `<p class="muted" style="margin:-6px 0 16px">Managing medications for someone else? <button class="linkish" data-act="add-person">Add a family member</button></p>`;
  const head = `<div class="page-head"><div><h1>Medications</h1><p>${meds.length} on file${who ? ` for ${esc(who)}` : ''}</p></div><a class="btn" href="#med/new">+ Add medication</a></div>${addFamily}`;
  if (!meds.length) return head + `<div class="empty"><h2>Nothing here yet</h2><p class="muted">Add a prescription to start tracking.</p></div>`;
  const cards = meds.map(m => {
    const r = refillStatus(m);
    const times = baseTimes(m);
    const bottle = Math.max(num(m.pillsPerBottle), num(m.pillsRemaining), 1);
    const pct = Math.min(100, (num(m.pillsRemaining) / bottle) * 100);
    const chip = !m.active ? '<span class="chip skipped">Paused</span>'
      : r.level === 'out' ? `<span class="chip out">${isVitamin(m) ? 'Restock needed' : 'Refill needed'}</span>`
      : r.level === 'soon' ? `<span class="chip soon">${isVitamin(m) ? 'Restock soon' : 'Refill soon'}</span>` : '';
    const supply = !m.active ? 'Paused'
      : r.taperEnds ? `Enough to finish taper (ends ${fmtDate(r.taperEnds)})`
      : r.days === Infinity ? 'Plenty on hand'
      : r.days === 0 ? 'Not enough for today' : `${r.days} day${r.days === 1 ? '' : 's'} left · runs out ${fmtDate(r.runOut)}`;
    const refills = (m.refills || []).slice().reverse();
    return `<article class="card med-card ${m.active ? '' : 'paused'} ${flashMedId === m.id ? 'new-flash' : ''}">
      <div class="row"><h3 class="med-title">${pillIcon(m, 32)}${esc(m.name)}</h3>${whoTag(m)}${chip}${m.taper && m.taper.enabled ? '<span class="chip taper">Taper</span>' : ''}</div>
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
  openModal(`<form><h2>Log refill · ${esc(medLabel(m))}</h2>
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
    toast(`Refill logged — ${medLabel(m)} now has ${fmtPills(m.pillsRemaining)}.`, 'success');
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
    personId: state.viewing !== 'all' ? state.viewing : state.people[0].id,
    kind: 'med',
    color: nextFreeColor(),
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
    ${isNew ? `<section class="card scan-card" aria-labelledby="scanTitle">
      <div class="scan-head"><span class="scan-emoji" aria-hidden="true">📷</span><div>
        <h2 id="scanTitle">Scan a label</h2>
        <p class="help">Take a photo of the pharmacy label or instruction sheet and Medsprout will fill in what it can read. The photo is read on this device and is never uploaded or saved.</p></div></div>
      <div class="row">
        <label class="btn sm">Take photo<input type="file" accept="image/*" capture="environment" data-scan hidden></label>
        <label class="btn ghost sm">Choose photo<input type="file" accept="image/*" data-scan hidden></label>
      </div>
      <div id="scanStatus" class="scan-status" aria-live="polite" hidden></div>
    </section>` : ''}
    <fieldset><legend>Prescription</legend>
      <div class="field"><label for="f-person">Who is this for?</label>
        <div class="row"><select id="f-person" name="personId" style="flex:1">${personOptions(m.personId)}</select>
        <button type="button" class="btn ghost sm" id="addPersonBtn">+ Add person</button></div></div>
      <div class="field"><span class="label">Type</span>
        <div class="seg" role="radiogroup" aria-label="Type">
          <label><input type="radio" name="kind" value="med" ${isVitamin(m) ? '' : 'checked'}> Medication</label>
          <label><input type="radio" name="kind" value="vitamin" ${isVitamin(m) ? 'checked' : ''}> Vitamin or supplement</label>
        </div></div>
      <div class="field"><label for="f-name">Name *</label><input id="f-name" name="name" required value="${esc(m.name)}" placeholder="${isVitamin(m) ? 'e.g. Vitamin D3' : 'e.g. Amoxicillin'}" autocomplete="off"></div>
      <div class="field"><span class="label" id="colorLabel">Colour <span class="help" id="colorName">${pillColor(m.color).name}</span></span>
        <div class="swatches" id="swatches" role="radiogroup" aria-labelledby="colorLabel">${swatchGrid(m)}</div>
        <p class="help" style="margin:6px 0 0">A dot marks colours already used by your other medications.</p></div>
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

    <div class="notice" role="note">
      <strong>🔒 Your data stays on this device.</strong>
      Everything you enter is stored locally, in this browser on this device. It is never sent to or stored by Medsprout.
      Clearing your browser data or uninstalling the app will delete it, so use <em>Settings → Export backup</em> to keep a copy.
      <a href="#privacy">Privacy Policy</a>
    </div>

    <p class="error" id="formError" role="alert"></p>
    <div class="form-actions"><button class="btn">${isNew ? 'Save medication' : 'Save changes'}</button><a class="btn ghost" href="#meds">Cancel</a></div>
  </form>`;
}

const customTimeRow = v => `<div class="row"><input type="time" name="customTime" value="${esc(v)}" style="flex:1"><button type="button" class="btn ghost sm" data-rm-time aria-label="Remove time">Remove</button></div>`;

const personOptions = selected => state.people
  .map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

/* ---------- Scan a label (reading happens in scan.js, on the device) ---------- */
async function scanIntoForm(form, file) {
  const status = $('#scanStatus');
  const buttons = $$('.scan-card .btn', form);
  const thumb = URL.createObjectURL(file);
  const show = html => { status.hidden = false; status.innerHTML = `<img class="scan-thumb" src="${thumb}" alt="Your photo">${html}`; };
  const progress = (label, frac) => show(`<div class="scan-progress"><p>${label}</p>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(frac * 100)}"><span style="width:${Math.round(frac * 100)}%"></span></div></div>`);
  buttons.forEach(b => b.classList.add('disabled'));
  progress('Getting the label reader ready…', 0);
  let text = '';
  try {
    text = await readLabel(file, (stage, frac) => stage === 'reading'
      ? progress(`Reading your label… ${Math.round(frac * 100)}%`, frac)
      : progress('Getting the label reader ready… The first scan downloads it (about 7 MB).', frac));
  } catch (err) {
    show(`<div><p><strong>Couldn't load the label reader.</strong></p>
      <p class="help">Check your internet connection and try again. The first scan needs to download the reader. After that it works faster.</p></div>`);
    buttons.forEach(b => b.classList.remove('disabled'));
    URL.revokeObjectURL(thumb);
    return;
  }

  const r = parseLabel(text);
  const rawText = text.trim() ? `<details><summary>Text read from the photo</summary><pre>${esc(text.trim())}</pre></details>` : '';
  if (r.unreadable) {
    show(`<div><p><strong>We couldn't read enough of that label.</strong></p>
      <p class="help">Try again in good light, hold the phone steady, and fill the frame with the label. Or type the details in below.</p>${rawText}</div>`);
  } else {
    fillFromScan(form, r);
    show(`<div><p><strong>Filled in: ${esc(r.found.join(', '))}.</strong></p>
      <p class="help">Fields filled from the photo are outlined. <strong>Check every one against your label before saving</strong>, because photos can be misread.</p>
      ${r.warnings.map(w => `<p class="scan-warn">${esc(w)}</p>`).join('')}${rawText}</div>`);
  }
  buttons.forEach(b => b.classList.remove('disabled'));
  // Keep the thumbnail for this view; the object URL is released when the page changes.
  window.addEventListener('hashchange', () => URL.revokeObjectURL(thumb), { once: true });
}

/** Put scanned values into the form, outline what changed, and let the form's own listeners update previews. */
function fillFromScan(form, r) {
  const set = (name, value) => {
    if (value === undefined || value === null || value === '') return;
    const els = $$(`[name="${name}"]`, form);
    if (!els.length) return;
    if (els[0].type === 'radio') {
      const el = els.find(x => x.value === String(value));
      if (!el) return;
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.closest('.seg')?.classList.add('scanned');
      return;
    }
    els[0].value = value;
    els[0].classList.add('scanned');
    els[0].dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('kind', r.kind);
  set('name', r.name);
  set('strength', r.strength);
  set('pillsPerDose', r.pillsPerDose);
  set('instructions', r.instructions);
  set('scheduleMode', r.scheduleMode);
  set('dosesPerDay', r.dosesPerDay);
  set('intervalHours', r.intervalHours);
  set('firstDose', r.firstDose);
  if (r.quantity) { set('pillsPerBottle', r.quantity); set('pillsRemaining', r.quantity); }
  set('refillsLeft', r.refills);
}

/** The 20 colour choices, drawn in the medication's current type (capsule or vitamin). */
function swatchGrid(m) {
  const used = new Set(state.meds.filter(x => x.id !== m.id).map(x => x.color));
  return PILL_COLORS.map((c, i) => `<label class="swatch ${used.has(i) ? 'used' : ''}" title="${c.name}${used.has(i) ? ' (in use)' : ''}">
      <input type="radio" name="color" value="${i}" ${i === m.color ? 'checked' : ''} aria-label="${c.name}${used.has(i) ? ', already used' : ''}">
      ${pillIcon({ kind: m.kind, color: i }, 30)}</label>`).join('');
}

function readMedForm(form, base) {
  const fd = new FormData(form);
  const unit = fd.get('taperUnit') || 'weeks';
  const everyN = Math.max(1, Math.round(num(fd.get('taperN'), 1)));
  const customTimes = fd.getAll('customTime').filter(Boolean);
  const mode = fd.get('scheduleMode') || 'even';
  return {
    ...base,
    personId: getPerson(fd.get('personId')) ? fd.get('personId') : base.personId,
    kind: fd.get('kind') === 'vitamin' ? 'vitamin' : 'med',
    color: fd.get('color') !== null ? Number(fd.get('color')) : base.color,
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

  $$('[data-scan]', form).forEach(input => input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = ''; // so the same photo can be picked again
    if (file) scanIntoForm(form, file);
  }));
  // A field filled from a scan loses its highlight once the person edits it.
  form.addEventListener('input', e => e.target.classList && e.target.classList.remove('scanned'));

  // Adding someone from here keeps whatever has been typed into the form.
  $('#addPersonBtn').addEventListener('click', () => personModal(null, person => {
    $('#f-person').innerHTML = personOptions(person.id);
  }));

  const syncMode = () => {
    const mode = (new FormData(form)).get('scheduleMode');
    $$('[data-mode]', form).forEach(el => { el.hidden = !el.dataset.mode.split(' ').includes(mode); });
  };
  let lastKind = original.kind;
  const updatePreview = () => {
    const look = readMedForm(form, original);
    if (look.kind !== lastKind) {
      lastKind = look.kind;
      $('#swatches').innerHTML = swatchGrid(look);
      $('#f-name').placeholder = isVitamin(look) ? 'e.g. Vitamin D3' : 'e.g. Amoxicillin';
    }
    $('#colorName').textContent = pillColor(look.color).name;
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
      if (state.viewing !== 'all' && state.viewing !== m.personId) state.viewing = m.personId;
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
  const tapering = visibleMeds().filter(m => m.taper && m.taper.enabled);
  const head = `<div class="page-head"><div><h1>Taper schedules</h1><p>Step-downs are built into your daily reminders automatically.</p></div></div>`;
  if (!tapering.length) return head + `<div class="empty"><h2>No tapers set up</h2><p class="muted">Edit a medication and turn on “This medication needs a slow taper”.</p><a class="btn" href="#meds">Go to medications</a></div>`;
  const today = dayKey();
  return head + `<div class="grid">${tapering.map(m => {
    const steps = taperSteps(m);
    const cur = steps.find(s => s.end && today >= s.start && today <= s.end);
    const t = m.taper;
    const notStarted = today < t.startDate;
    const next = steps.find(s => s.start > today);
    return `<article class="card"><div class="row"><h2 class="med-title" style="margin:0">${pillIcon(m, 32)}${esc(m.name)}</h2>${whoTag(m)}<span class="chip taper">Reduce ${fmtNum(t.reduceBy)} every ${t.everyN} ${t.unit === 'days' ? (t.everyN === 1 ? 'day' : 'days') : (t.everyN === 1 ? 'week' : 'weeks')}</span></div>
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
  const meds = visibleMeds(), people = visiblePeople();
  const filter = meds.some(m => m.id === sessionFilter) ? sessionFilter : '';
  const list = state.sideEffects
    .filter(e => people.some(p => p.id === e.personId) && (!filter || e.medId === filter))
    .sort((a, b) => b.at.localeCompare(a.at));
  // Options are grouped by person when there's a family; "general" notes still belong to someone.
  const medOptions = people.map(p => {
    const opts = meds.filter(m => m.personId === p.id).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')
      + `<option value="general:${p.id}">Not sure / general</option>`;
    return isFamily() ? `<optgroup label="${esc(p.name)}">${opts}</optgroup>` : opts;
  }).join('');
  return `<div class="page-head"><div><h1>Side effects</h1><p>Keep notes to share with your doctor or pharmacist.</p></div></div>
  <div class="grid-2">
    <form class="card" id="effectForm">
      <h2>Log a side effect</h2>
      <div class="field"><label for="e-med">${isFamily() ? 'Who and which medication' : 'Medication'}</label><select id="e-med" name="medId">
        ${medOptions}</select></div>
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
        <select id="e-filter" style="flex:1"><option value="">All medications</option>${meds.map(m => `<option value="${m.id}" ${filter === m.id ? 'selected' : ''}>${esc(medLabel(m))}</option>`).join('')}</select></div>
      ${list.length ? `<div class="grid">${list.map(e => {
        const m = getMed(e.medId);
        return `<article class="card effect"><div class="top"><h3>${esc(e.symptom)}</h3>
          <span class="sev" title="${SEV[e.severity]}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= e.severity ? 'on' : ''}"></i>`).join('')} <small>&nbsp;${SEV[e.severity]}</small></span></div>
          <small>${new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${m ? esc(medLabel(m)) : esc([isFamily() && getPerson(e.personId) ? getPerson(e.personId).name : '', e.medName || 'General'].filter(Boolean).join(' · '))}</small>
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
    const choice = String(fd.get('medId') || '');
    const med = getMed(choice);
    const personId = med ? med.personId : choice.replace(/^general:/, '');
    if (!getPerson(personId)) return;
    state.sideEffects.push({
      id: uid(), personId, medId: med ? med.id : '', medName: med ? med.name : '',
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
    const slots = allSlots(k, visibleMeds()).map(s => ({ s, st: slotStatus(s) })).filter(x => i > 0 || x.st !== 'upcoming');
    if (!slots.length) continue;
    rows.push(`<article class="card"><div class="row"><h3 style="margin:0">${i === 0 ? 'Today' : i === 1 ? 'Yesterday' : fmtDate(k)}</h3>
      <span class="spacer"></span><small>${slots.filter(x => x.st === 'taken').length} of ${slots.filter(x => x.st !== 'skipped').length} taken</small></div>
      <ul class="mini-list">${slots.map(({ s, st }) => `<li><span class="med-title">${pillIcon(s.med, 20)}${fmtMin(s.time)} · ${esc(medLabel(s.med))} × ${fmtNum(s.pills)}</span>
        <span>${st === 'taken' ? `<span class="chip taken">Taken ${new Date(s.rec.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>` : `<span class="chip ${st}">${st[0].toUpperCase() + st.slice(1)}</span>`}
        ${s.rec ? ` <button class="linkish" data-act="undo" data-key="${s.key}">Undo</button>` : i > 0 ? ` <button class="linkish" data-act="take" data-key="${s.key}">Log as taken</button>` : ''}</span></li>`).join('')}</ul></article>`);
  }
  return `<div class="page-head"><div><h1>History</h1><p>The last 14 days of doses.</p></div></div>
    ${rows.length ? `<div class="grid">${rows.join('')}</div>` : '<div class="empty"><p class="muted" style="margin:0">No dose history yet.</p></div>'}`;
}

/* ---------- Legal pages (content lives in legal.js) ---------- */
function viewLegal(key) {
  const page = LEGAL_PAGES[key];
  const others = Object.entries(LEGAL_PAGES).filter(([k]) => k !== key)
    .map(([k, p]) => `<a href="#${k}">${p.title}</a>`).join(' · ');
  return `<article class="doc">
    <div class="page-head"><div><h1>${page.title}</h1><p>Last updated ${LEGAL_INFO.updated}</p></div></div>
    ${page.body()}
    <p class="doc-more">${others}</p>
  </article>`;
}

/* ---------- Settings ---------- */
function viewSettings() {
  const s = state.settings;
  const perm = !('Notification' in window) ? 'Not supported in this browser' : Notification.permission === 'granted' ? (s.notifications ? 'On' : 'Allowed, but turned off') : Notification.permission === 'denied' ? 'Blocked — allow it in your browser settings' : 'Off';
  return `<div class="page-head"><div><h1>Settings</h1></div></div>
  <form id="settingsForm">
    <fieldset><legend>Family members</legend>
      <p class="help" style="margin-top:0">Keep medications for everyone you care for in one place. Each person's medications, reminders and notes are kept separate.</p>
      <ul class="people-list">${state.people.map(p => {
        const count = state.meds.filter(m => m.personId === p.id).length;
        return `<li>${avatar(p)}<span class="people-name">${esc(p.name)}<small>${count} medication${count === 1 ? '' : 's'}</small></span>
          <span class="people-actions"><button type="button" class="btn ghost sm" data-act="rename-person" data-id="${p.id}">Rename</button>
          ${state.people.length > 1 ? `<button type="button" class="btn ghost sm" data-act="delete-person" data-id="${p.id}">Remove</button>` : ''}</span></li>`;
      }).join('')}</ul>
      <button type="button" class="btn sm" data-act="add-person">+ Add family member</button>
    </fieldset>
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
      <p><strong>iPhone / iPad:</strong> open this page in Safari, tap Share, then <em>Add to Home Screen</em>. Open Medsprout from the Home Screen icon, then turn on notifications.</p>
      <p style="margin:0"><strong>Android:</strong> open in Chrome, tap ⋮, then <em>Install app</em> (or <em>Add to Home screen</em>).</p>
    </fieldset>
    <fieldset><legend>Your data</legend>
      <p class="help">Everything is stored only on this device, never on Medsprout. Export a backup to move it to another device. <a href="#privacy">Privacy Policy</a></p>
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
  if (test) test.addEventListener('click', () => sysNotify('Medsprout test', 'Reminders are working. 💊', 'test'));
  const off = $('#notifOff');
  if (off) off.addEventListener('click', () => { state.settings.notifications = false; save(); render(); });
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `medsprout-backup-${dayKey()}.json`;
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
        state = upgrade(data);
        save(); toast('Backup imported.', 'success'); render();
      });
    } catch (err) { toast('That file is not a Medsprout backup.', 'danger'); }
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

$('#year').textContent = new Date().getFullYear();
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
render();
tick();
setInterval(tick, 20000);
