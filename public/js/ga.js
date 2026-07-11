// Google Analytics 4 init — externalized from the per-page inline snippet so the
// Content-Security-Policy can drop 'unsafe-inline' from script-src (R7). Loaded
// right after the async gtag loader (googletagmanager.com/gtag/js).
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'G-RBH536HRZE');
