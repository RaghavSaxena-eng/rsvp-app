/* Runs before first paint. Pages start white; the switch saves the choice.
   The "rv" class only turns on when the browser can do quiet scroll reveals and the person has not asked for less motion. */
(function () {
  var root = document.documentElement, t = 'light';
  try { if (localStorage.getItem('rsvp-theme') === 'dark') t = 'dark'; } catch (e) {}
  root.setAttribute('data-theme', t);
  try {
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!calm && 'IntersectionObserver' in window) root.className += ' rv';
  } catch (e) {}
})();
