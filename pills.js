'use strict';

/* =========================================================
   Medsprout — pill icons
   20 two-tone and 10 solid colours. Medications are drawn as a
   capsule; vitamins/supplements as a gummy bear.
   These colours only identify medications — status colours
   (missed, refill, taken) stay reserved for the brand palette.
   ========================================================= */

const PILL_COLORS = [
  { name: 'Sky & White',       a: '#5AA9E6', b: '#F7F4EE' },
  { name: 'Navy & Sky',        a: '#2F4B8A', b: '#8EC5F0' },
  { name: 'Teal & White',      a: '#2BA39A', b: '#F7F4EE' },
  { name: 'Mint & Forest',     a: '#9FE2C0', b: '#2E7D4F' },
  { name: 'Sunflower & White', a: '#F2C94C', b: '#F7F4EE' },
  { name: 'Tangerine & Cream', a: '#F08A3C', b: '#FFE3B8' },
  { name: 'Coral & White',     a: '#F2766B', b: '#F7F4EE' },
  { name: 'Rose & Plum',       a: '#F4A6C0', b: '#8E3B73' },
  { name: 'Lavender & White',  a: '#B9A4E8', b: '#F7F4EE' },
  { name: 'Violet & Lilac',    a: '#6E4BC2', b: '#D5C6F5' },
  { name: 'Brick & Sand',      a: '#B5533C', b: '#E8D3B0' },
  { name: 'Cocoa & Tan',       a: '#6B4432', b: '#D2A679' },
  { name: 'Slate & Silver',    a: '#5F6B7A', b: '#CDD3DA' },
  { name: 'Graphite & White',  a: '#3A3F47', b: '#F7F4EE' },
  { name: 'Aqua & Navy',       a: '#5ED1E0', b: '#1F3A68' },
  { name: 'Lemon & Olive',     a: '#F4E36B', b: '#7A8B2E' },
  { name: 'Peach & Teal',      a: '#FFC7A6', b: '#2BA39A' },
  { name: 'Magenta & White',   a: '#D43F8D', b: '#F7F4EE' },
  { name: 'Red & Yellow',      a: '#D64541', b: '#F2C94C' },
  { name: 'Blue & Orange',     a: '#3E7CD6', b: '#F08A3C' },
  // Solid colours (added from user feedback). Appended so existing colour numbers never change.
  { name: 'Solid White',       a: '#F7F4EE', b: '#F7F4EE' },
  { name: 'Solid Yellow',      a: '#F5D547', b: '#F5D547' },
  { name: 'Solid Orange',      a: '#F39C33', b: '#F39C33' },
  { name: 'Solid Red',         a: '#D9383A', b: '#D9383A' },
  { name: 'Solid Pink',        a: '#F48FB1', b: '#F48FB1' },
  { name: 'Solid Purple',      a: '#8E5BD6', b: '#8E5BD6' },
  { name: 'Solid Blue',        a: '#3F6FD8', b: '#3F6FD8' },
  { name: 'Solid Baby Blue',   a: '#9FD3F5', b: '#9FD3F5' },
  { name: 'Solid Green',       a: '#3FA65A', b: '#3FA65A' },
  { name: 'Solid Brown',       a: '#8A5A3B', b: '#8A5A3B' },
];

const pillColor = i => PILL_COLORS[((Math.round(Number(i)) || 0) % PILL_COLORS.length + PILL_COLORS.length) % PILL_COLORS.length];

/** Inline SVG for a medication ({ kind, color }). A light rim keeps dark colours visible on the charcoal background. */
function pillIcon(med, size = 28) {
  const c = pillColor(med && med.color);
  const rim = 'rgba(243,233,220,.55)';
  const shape = med && med.kind === 'vitamin'
    // Gummy bear: body in colour A; snout and belly patch in colour B.
    ? `<g fill="${c.a}" stroke="${rim}" stroke-width="1.1">
         <circle cx="10.3" cy="6.4" r="2.9"/><circle cx="21.7" cy="6.4" r="2.9"/>
         <circle cx="8.3" cy="17.5" r="3"/><circle cx="23.7" cy="17.5" r="3"/>
         <circle cx="10.6" cy="26.6" r="3.1"/><circle cx="21.4" cy="26.6" r="3.1"/>
         <ellipse cx="16" cy="20.5" rx="7.6" ry="8"/>
         <circle cx="16" cy="10" r="6.4"/>
       </g>
       <ellipse cx="16" cy="21.5" rx="3.9" ry="4.3" fill="${c.b}" opacity=".9"/>
       <ellipse cx="16" cy="12.4" rx="2.6" ry="1.9" fill="${c.b}"/>
       <circle cx="13.6" cy="8.9" r=".95" fill="rgba(0,0,0,.45)"/><circle cx="18.4" cy="8.9" r=".95" fill="rgba(0,0,0,.45)"/>
       <ellipse cx="11.8" cy="18.2" rx="1.6" ry="3" fill="#fff" opacity=".3"/>`
    // Two-tone capsule.
    : `<g transform="rotate(-40 16 16)">
         <path d="M16 10 H10 a6 6 0 0 0 0 12 H16 Z" fill="${c.a}"/>
         <path d="M16 10 H22 a6 6 0 0 1 0 12 H16 Z" fill="${c.b}"/>
         <rect x="4" y="10" width="24" height="12" rx="6" fill="none" stroke="${rim}" stroke-width="1.2"/>
         <line x1="16" y1="10" x2="16" y2="22" stroke="rgba(0,0,0,.22)" stroke-width="1"/>
         <rect x="7.5" y="12.2" width="15" height="2.2" rx="1.1" fill="#fff" opacity=".35"/>
       </g>`;
  return `<svg class="pill-icon" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false">${shape}</svg>`;
}
