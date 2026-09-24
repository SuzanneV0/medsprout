'use strict';

/* =========================================================
   Medsprout — scan a prescription label
   The photo is read on the device with Tesseract.js (loaded
   from jsDelivr only when someone scans) and is never
   uploaded or saved. parseLabel() turns the text into form
   values; people always review them before saving.
   ========================================================= */

const OCR = {
  script: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
  langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
};

let ocrScript = null;
function loadOcr() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!ocrScript) {
    ocrScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = OCR.script;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { ocrScript = null; reject(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  return ocrScript;
}

/** Downscale/upscale to a size the reader likes, then greyscale and stretch contrast. */
async function prepareImage(file) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = URL.createObjectURL(file);
    });
  }
  const long = Math.max(img.width, img.height);
  const scale = long > 2200 ? 2200 / long : long < 1200 ? 1200 / long : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (img.close) img.close();

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = g;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) / range) * 255));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** Read the text on a label photo. `onProgress(stage, fraction)`; stage is 'loading' or 'reading'. */
async function readLabel(file, onProgress = () => {}) {
  onProgress('loading', 0);
  const Tesseract = await loadOcr();
  const canvas = await prepareImage(file);
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: OCR.workerPath,
    corePath: OCR.corePath,
    langPath: OCR.langPath,
    logger: m => {
      if (m.status === 'recognizing text') onProgress('reading', m.progress || 0);
      else onProgress('loading', m.progress || 0);
    },
  });
  try {
    // Labels are one column of lines in different sizes; Tesseract.js's default
    // ("single uniform block") drops or garbles lines like the large drug name.
    await worker.setParameters({ tessedit_pageseg_mode: '4' });
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}

/* ---------- turning label text into form values ---------- */

const WORD_NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, '½': 0.5, '1/2': 0.5 };
const UNITS = 'tablets?|tabs?|capsules?|caps?|pills?|softgels?|gummies|gummy|chewables?|puffs?|lozenges?|drops?|sprays?';
const STRENGTH = /(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?)\s?(mg|mcg|µg|ug|g|ml|iu|units?)(?![a-z])/i;
const DIRECTION_START = /^\s*(take|give|use|apply|inhale|chew|dissolve|place|swallow|instill|insert|spray)\b/i;
const FIELD_LINE = /^\s*(qty|quantity|refills?|repeats?|rpts?|dr\b|dr\.|doctor|prescriber|rx\b|rx#|rx:|din\b|date|filled|pharm|mfr|mfg|exp|lot\b|disc|discard|use before|patient|pt\b|npi|phone|tel|rfl|supplement facts|nutrition|ingredients|warnings?|caution|keep out|store)/i;
const VITAMIN = /\b(vitamin|multivitamin|multi-vitamin|supplement|omega|fish oil|calcium|magnesium|iron|zinc|probiotic|biotin|b12|d3|folic|melatonin|gumm(y|ies)|prenatal)\b/i;

const NAME_WORD = /^[a-z][a-z0-9/-]{1,}$/i; // allows D3, B12, amoxicillin/clav

const clean = s => s.replace(/[|_~`^*]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Mostly-capitals text (labels are often printed in caps; OCR adds stray lowercase). */
const shouty = s => { const letters = s.replace(/[^a-z]/gi, ''); return letters.length > 0 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7; };
const titleCase = s => (shouty(s) ? s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : s)
  .replace(/\bHcl\b/g, 'HCl')
  .replace(/\b([a-z])(\d+)\b/gi, (w, l, n) => l.toUpperCase() + n); // d3 → D3, b12 → B12
const sentenceCase = s => {
  const t = shouty(s) ? s.toLowerCase() : s;
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const wordNum = w => {
  if (w == null) return null;
  const k = String(w).toLowerCase();
  if (k in WORD_NUMS) return WORD_NUMS[k];
  const n = parseFloat(k.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * Best-effort extraction from pharmacy-label text. Returns only what it found,
 * plus `found` (human-readable list) and `warnings`.
 */
/** Common OCR slips on labels: "IU" read as TU/1U/lU, "mg" read as rng/mq. */
const fixOcr = l => l
  .replace(/(\d)\s?(?:TU|1U|lU|IU|I\.U\.?)(?![a-z])/gi, '$1 IU')
  .replace(/(\d)\s?(?:rng|mq)(?![a-z])/gi, '$1 mg');

function parseLabel(raw) {
  const lines = String(raw || '').split(/\r?\n/).map(clean).map(fixOcr).filter(l => l.length > 1);
  const text = lines.join('\n');
  const out = { found: [], warnings: [] };

  // Directions: the line starting "Take…/Use…" plus its continuation lines.
  let start = lines.findIndex(l => DIRECTION_START.test(l));
  if (start < 0) start = lines.findIndex(l => /\btake\b/i.test(l));
  let directions = '';
  if (start >= 0) {
    const parts = [lines[start].slice(Math.max(0, lines[start].search(/\b(take|give|use|apply|inhale|chew|dissolve|place|swallow|instill|insert|spray)\b/i)))];
    for (let i = start + 1; i < lines.length && parts.length < 4; i++) {
      if (FIELD_LINE.test(lines[i]) || STRENGTH.test(lines[i]) && !/\b(take|with|daily|times|hours)\b/i.test(lines[i])) break;
      parts.push(lines[i]);
    }
    directions = sentenceCase(parts.join(' ').replace(/\s+([.,])/g, '$1'));
    out.instructions = directions;
    out.found.push('directions');
  }
  const d = directions.toLowerCase();

  // Pills per dose: "take 1 tablet", "take two (2) capsules", "take ½ tablet".
  const dose = d.match(new RegExp(`\\b(?:take|give|chew|swallow|use|inhale|dissolve|place)\\s+(\\d+(?:[.,]\\d+)?|\\d\\/\\d|½|one|two|three|four|five|six|half|an?)\\s*(?:\\(\\s*\\d+\\s*\\)\\s*)?(?:${UNITS})\\b`));
  if (dose) {
    const n = wordNum(dose[1]);
    if (n) { out.pillsPerDose = n; out.found.push(`${n} per dose`); }
  }

  // How often.
  const every = d.match(/\bevery\s+(\d+(?:\.\d+)?)\s*(?:(?:to|-)\s*\d+\s*)?(?:hours?|hrs?|h)\b/) || d.match(/\bq\s?(\d+)\s?h\b/);
  if (every) {
    const h = parseFloat(every[1]);
    if (h > 0 && h <= 24) {
      out.scheduleMode = 'interval';
      out.intervalHours = h;
      out.dosesPerDay = Math.max(1, Math.min(12, Math.floor(24 / h)));
      out.found.push(`every ${h} hours`);
    }
  } else {
    const perDay = /\b(four|4)\s*(times|x)\b|\bqid\b/.test(d) ? 4
      : /\b(three|3)\s*(times|x)\b|\bthrice\b|\btid\b/.test(d) ? 3
      : /\b(twice|two\s*times|2\s*(times|x))\b|\bbid\b/.test(d) ? 2
      : /\b(once|one\s*time|1\s*(time|x))\b|\bdaily\b|\ba day\b|\beach day\b|\bevery (day|morning|evening|night)\b|\bnightly\b|\bat bedtime\b|\bqd\b|\bqhs\b/.test(d) ? 1
      : null;
    if (perDay) {
      out.scheduleMode = 'even';
      out.dosesPerDay = perDay;
      out.found.push(perDay === 1 ? 'once a day' : `${perDay} times a day`);
      if (perDay === 1) {
        if (/\b(bedtime|at night|nightly|qhs|hs)\b/.test(d)) out.firstDose = '21:30';
        else if (/\b(evening|supper|dinner)\b/.test(d)) out.firstDose = '18:00';
        else if (/\bmorning|breakfast\b/.test(d)) out.firstDose = '08:00';
      }
    }
  }
  if (/\bweekly\b|\bonce a week\b|\bevery week\b/.test(d)) out.warnings.push('This looks like a weekly medication. Medsprout schedules daily doses, so adjust the schedule to match your label.');
  if (/\bas needed\b|\bprn\b|\bif needed\b/.test(d)) out.warnings.push('The label says “as needed”. Only keep reminders on if your prescriber wants you to take it on a schedule.');
  if (/\btaper|decrease|reduce\b/.test(d)) out.warnings.push('The directions mention a taper. Set it up in the Taper schedule section below.');

  // Name and strength: the line with a strength like "500 MG" that isn't the directions or quantity.
  const nameLine = lines.find(l => STRENGTH.test(l) && !DIRECTION_START.test(l) && !FIELD_LINE.test(l) && l !== directions);
  if (nameLine) {
    const m = nameLine.match(STRENGTH);
    out.strength = `${m[1].replace(/\s+/g, '')} ${/iu/i.test(m[2]) ? 'IU' : /^u(nits?)?$/i.test(m[2]) ? 'units' : m[2].toLowerCase()}`;
    out.found.push('strength');
    const before = nameLine.slice(0, m.index).replace(/^\s*(rx\s*#?\s*\d*|\d+[\s.)-]*)/i, '');
    const words = before.split(/\s+/).filter(w => NAME_WORD.test(w) && !/^(rx|qty|din|tab|tabs|tablet|cap|caps|capsule)$/i.test(w));
    let name = words.slice(-4).join(' ');
    if (!name) {
      const prev = lines[lines.indexOf(nameLine) - 1] || '';
      name = prev.split(/\s+/).filter(w => NAME_WORD.test(w) && w.length > 2).slice(-3).join(' ');
    }
    if (name.length >= 3) { out.name = titleCase(name); out.found.unshift('name'); }
  }
  if (!out.name) {
    const formLine = lines.find(l => new RegExp(`\\b(${UNITS})\\b`, 'i').test(l) && !DIRECTION_START.test(l) && !FIELD_LINE.test(l));
    const words = formLine ? formLine.split(/\s+/).filter(w => NAME_WORD.test(w) && !new RegExp(`^(${UNITS})$`, 'i').test(w)) : [];
    if (words.length) { out.name = titleCase(words.slice(0, 3).join(' ')); out.found.unshift('name'); }
  }

  // Quantity and refills.
  // "Qty" is often misread (Qly, Qily, Oty). Accept those only with a separator, so "take 1 or 2" isn't a quantity.
  const qty = text.match(/\b(?:qty|quantity|qté)\b\s*[:.#]?\s*(\d{1,4})\b/i)
    || text.match(/\b[qo][a-z1|!]{1,3}\s*[:=#]\s*(\d{1,4})\b/i) || text.match(/(?:^|\s)#\s?(\d{1,4})\s*(?:tabs?|tablets?|caps?|capsules?)?\b/i);
  // Supplement bottles print a count ("120 softgels") rather than "Qty".
  const count = qty ? null : text.match(new RegExp(`(?<!take\\s)\\b(\\d{2,4})\\s*(?:${UNITS}|caplets|count|ct)\\b`, 'i'));
  if (qty || count) { out.quantity = parseInt((qty || count)[1], 10); out.found.push(`quantity ${out.quantity}`); }
  if (/\bno (refills?|repeats?)\b/i.test(text)) { out.refills = 0; out.found.push('no refills'); }
  else {
    const rf = text.match(/\b(?:refills?|repeats?|rpts?|rfl)\b[^\d\n]{0,20}(\d{1,2})\b/i);
    if (rf) { out.refills = parseInt(rf[1], 10); out.found.push(`${out.refills} refill${out.refills === 1 ? '' : 's'}`); }
  }

  if (VITAMIN.test(`${out.name || ''} ${text}`)) out.kind = 'vitamin';

  // Without directions or a strength, whatever we "found" is probably noise — don't fill the form with it.
  if (!out.instructions && !out.strength) return { found: [], warnings: [], unreadable: true };
  return out;
}
