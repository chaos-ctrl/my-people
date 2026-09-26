// Applies the saved light/dark choice before the page paints (a classic script, so it runs first).
try {
  var t = localStorage.getItem('mp.theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* storage unavailable: follow the system */ }
