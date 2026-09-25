// Writes every Android resource Capacitor needs from the Medsprout icon: launcher icons, adaptive-icon
// foregrounds, the status-bar notification icon and splash screens. Run from native/: node scripts/make-android-icons.js
const fs = require('fs'), path = require('path');
const { render } = require('./icon-art');

const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const write = (rel, buf) => { const f = path.join(RES, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); return rel; };
const dims = file => { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
let count = 0;
for (const [d, m] of Object.entries(DENSITIES)) {
  const launcher = Math.round(48 * m), fg = Math.round(108 * m), status = Math.round(24 * m);
  write(`mipmap-${d}/ic_launcher.png`, render(launcher, launcher, 'launcher', launcher));
  write(`mipmap-${d}/ic_launcher_round.png`, render(launcher, launcher, 'round', launcher));
  // Adaptive foreground: 108dp canvas; keep the art inside the 66dp safe circle (capsule reaches ~0.35 of its box).
  write(`mipmap-${d}/ic_launcher_foreground.png`, render(fg, fg, 'foreground', Math.round(fg * 0.86)));
  write(`drawable-${d}/ic_stat_medsprout.png`, render(status, status, 'status', status));
  count += 4;
}
// Splash screens: replace Capacitor's placeholder at each existing size.
for (const dir of fs.readdirSync(RES).filter(n => /^drawable(-(land|port)-\w+)?$/.test(n))) {
  const f = path.join(RES, dir, 'splash.png');
  if (!fs.existsSync(f)) continue;
  const [w, h] = dims(f);
  write(`${dir}/splash.png`, render(w, h, 'splash', Math.round(Math.min(w, h) * 0.32)));
  count++;
}
// Adaptive icon background colour: Charcoal Blue.
fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#273E47</color>\n</resources>\n');
console.log(`Wrote ${count} images and the adaptive icon background colour.`);
