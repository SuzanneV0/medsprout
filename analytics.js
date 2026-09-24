'use strict';

// Vercel Web Analytics: anonymous, cookie-free visit counts. Skipped when running locally.
// Kept in its own file (not inline) so the Content-Security-Policy can forbid inline scripts.
if (!/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  const s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
}
