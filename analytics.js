'use strict';

// Vercel Web Analytics: anonymous, cookie-free visit counts. Skipped when running locally.
// Kept in its own file (not inline) so the Content-Security-Policy can forbid inline scripts.
if (!/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  // Send only the page path. The part after "#" names in-app screens and internal medication ids
  // (e.g. #med/k3j2a9x); none of that is needed to count visits, so it never leaves the device.
  window.va('beforeSend', event => ({ ...event, url: event.url.replace(/[?#].*$/, '') }));
  const s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
}
