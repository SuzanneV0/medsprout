'use strict';

/* =========================================================
   Medsprout — installed phone app (Capacitor)
   On the website this file does nothing (Native.on is false).
   In the Android/iOS app it hands reminders to the phone's own
   notification scheduler, so they arrive even when Medsprout is
   closed. Everything stays on the device, as on the web.
   ========================================================= */

const Native = (() => {
  const cap = window.Capacitor;
  const on = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  if (!on) return { on: false };

  const LN = cap.registerPlugin('LocalNotifications');
  const HORIZON_MS = 48 * 3600000; // schedule two days ahead…
  const MAX_PENDING = 60;          // …but stay under iOS's limit of 64 pending notifications
  const api = { on: true, permission: 'default', exactAlarm: 'granted', platform: cap.getPlatform() };

  // Notification ids must be 32-bit integers; derive a stable one from the dose key.
  const idFor = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 1) || 1; };

  /** Every reminder that should be pending right now, soonest first. Uses the same schedule as the app. */
  function plannedReminders() {
    const now = Date.now(), until = now + HORIZON_MS, grace = num(state.settings.graceMin, 30) * 60000;
    const out = [];
    const add = (at, kind, extra) => { if (at > now + 5000 && at < until) out.push({ at, kind, ...extra }); };
    for (let d = 0; d < 3; d++) {
      for (const slot of allSlots(dayKey(addDays(new Date(), d)))) {
        if (slot.rec) continue;
        const med = slot.med, rem = med.reminder || { enabled: true, leadMin: 0 };
        const base = { med, slot, key: slot.key };
        if (rem.enabled) {
          add(slot.at, 'due', base);
          if (num(rem.leadMin) > 0) add(slot.at - num(rem.leadMin) * 60000, 'pre', { ...base, lead: num(rem.leadMin) });
        }
        add(slot.at + grace, 'missed', base);
        const sz = state.snoozes[slot.key];
        if (sz) add(sz, 'snooze', base);
      }
    }
    // Refill warnings: once, at 9 AM the next morning (or later today if it's still before 9).
    const nine = new Date(); nine.setHours(9, 0, 0, 0); if (nine.getTime() <= now) nine.setDate(nine.getDate() + 1);
    for (const med of state.meds) {
      const r = refillStatus(med);
      if (r.level === 'out' || r.level === 'soon') add(nine.getTime(), r.level === 'out' ? 'refill-out' : 'refill-soon', { med, r, key: `refill|${med.id}` });
    }
    return out.sort((a, b) => a.at - b.at).slice(0, MAX_PENDING);
  }

  async function reschedule() {
    if (api.permission !== 'granted' || !state.settings.notifications) {
      await cancelAll();
      return;
    }
    await cancelAll();
    const notifications = plannedReminders().map(p => {
      const msg = reminderMessage(p.kind, p);
      const isDose = !p.kind.startsWith('refill');
      return {
        id: idFor(`${p.key}|${p.kind}|${p.at}`),
        title: msg.lockTitle,
        body: msg.lockBody,
        schedule: { at: new Date(p.at), allowWhileIdle: true },
        channelId: 'doses',
        ...(isDose ? { actionTypeId: 'dose' } : {}),
        extra: { slot: isDose ? p.key : null },
      };
    });
    if (notifications.length) await LN.schedule({ notifications });
  }

  async function cancelAll() {
    try {
      const { notifications } = await LN.getPending();
      if (notifications.length) await LN.cancel({ notifications: notifications.map(n => ({ id: n.id })) });
    } catch (e) { /* nothing pending */ }
  }

  // Many saves can happen in a row (take a dose, re-render…); reschedule once they settle.
  let timer = null;
  api.queueReschedule = () => { clearTimeout(timer); timer = setTimeout(() => reschedule().catch(() => {}), 800); };

  api.refreshPermission = async () => {
    try {
      const p = await LN.checkPermissions();
      api.permission = p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'default';
      if (api.platform === 'android' && LN.checkExactNotificationSetting) {
        api.exactAlarm = (await LN.checkExactNotificationSetting()).exact_alarm;
      }
    } catch (e) { /* keep defaults */ }
    return api.permission;
  };

  api.requestPermission = async () => {
    try { const p = await LN.requestPermissions(); api.permission = p.display === 'granted' ? 'granted' : 'denied'; }
    catch (e) { api.permission = 'denied'; }
    return api.permission;
  };

  /** Android 12+: exact alarms must be allowed in system settings for on-time reminders. */
  api.allowExactAlarms = async () => {
    try { api.exactAlarm = (await LN.changeExactNotificationSetting()).exact_alarm; } catch (e) { /* not supported */ }
    return api.exactAlarm;
  };

  /** Settings → "Send a test": a real system notification in two seconds. */
  api.test = () => LN.schedule({ notifications: [{ id: 1, title: 'Medsprout test', body: 'Reminders are working, even when the app is closed. 💊', schedule: { at: new Date(Date.now() + 2000), allowWhileIdle: true }, channelId: 'doses' }] });

  api.start = async () => {
    // Notification channels exist only on Android; keep that separate so iOS still gets its buttons.
    if (api.platform === 'android') {
      try { await LN.createChannel({ id: 'doses', name: 'Dose reminders', description: 'Medication reminders and refill warnings', importance: 5, visibility: 1, vibration: true }); }
      catch (e) { /* the default channel is used instead */ }
    }
    try {
      await LN.registerActionTypes({ types: [{ id: 'dose', actions: [{ id: 'take', title: 'Mark taken' }, { id: 'snooze', title: 'Snooze 10 min' }] }] });
      await LN.addListener('localNotificationActionPerformed', ({ actionId, notification }) => {
        const slot = notification && notification.extra && notification.extra.slot;
        if (slot && actionId === 'take') takeDose(slot);
        else if (slot && actionId === 'snooze') snoozeDose(slot);
        else location.hash = '#today';
      });
    } catch (e) { /* the app still works; reminders just won't have buttons */ }
    await api.refreshPermission();
    render();
    api.queueReschedule();
  };

  // Reminders only change when data changes, but time moves on: top the schedule up regularly.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) api.queueReschedule(); });
  setInterval(api.queueReschedule, 30 * 60000);

  return api;
})();
