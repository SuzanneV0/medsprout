// Copies the website (repository root) into native/www, which Capacitor bundles into the phone app.
// The web app is the single source of truth; never edit files in www directly.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(nativeDir, '..');
const www = join(nativeDir, 'www');

const files = [
  'index.html', 'styles.css', 'manifest.webmanifest',
  'analytics.js', 'legal.js', 'pills.js', 'scan.js', 'native.js', 'app.js',
  'icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
];
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
for (const f of files) cpSync(join(site, f), join(www, f));
cpSync(join(site, 'vendor'), join(www, 'vendor'), { recursive: true }); // fonts + label reader
console.log(`Copied ${files.length} files and vendor/ into native/www`);
