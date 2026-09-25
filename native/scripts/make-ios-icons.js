// Writes the iOS app icon (1024 px, opaque: iOS rounds the corners itself) and the splash screens
// from the Medsprout icon. Run from native/: node scripts/make-ios-icons.js
const fs = require('fs'), path = require('path');
const { render } = require('./icon-art');

const ASSETS = path.join(__dirname, '..', 'ios', 'App', 'App', 'Assets.xcassets');
const icon = path.join(ASSETS, 'AppIcon.appiconset', 'AppIcon-512@2x.png');
fs.writeFileSync(icon, render(1024, 1024, 'splash', 1024, { opaque: true })); // full-bleed square, no transparency
const splashDir = path.join(ASSETS, 'Splash.imageset');
const splashes = fs.readdirSync(splashDir).filter(f => f.endsWith('.png'));
for (const f of splashes) fs.writeFileSync(path.join(splashDir, f), render(2732, 2732, 'splash', 700, { opaque: true }));
console.log(`Wrote the iOS app icon and ${splashes.length} splash screens.`);
