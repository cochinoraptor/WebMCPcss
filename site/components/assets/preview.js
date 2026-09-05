/* WebMCPcss Component Hub — preview */
(function () {
  'use strict';
  var root = document.documentElement;
  var target = document.querySelector('[data-preview-root] > *') || document.body.firstElementChild;
  var PRESETS = {
    'fade-in': [[{ opacity: 0 }, { opacity: 1 }], { duration: 800, easing: 'ease-out' }],
    'slide-up': [[{ opacity: 0, transform: 'translateY(32px)' }, { opacity: 1, transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' }],
    'pulse': [[{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 900, iterations: 3, easing: 'ease-in-out' }],
    'hover-glow': null
  };
  var current = null;
  function stop() { if (current && current.cancel) current.cancel(); current = null; if (target) target.classList.remove('wm-hover-glow'); }
  function play(preset) {
    stop();
    if (!target) return;
    if (preset === 'hover-glow') { target.classList.add('wm-hover-glow'); return; }
    if (preset === 'declared') { runDeclared(); return; }
    var p = PRESETS[preset];
    if (!p || !target.animate) return;
    current = target.animate(p[0], p[1]);
  }
  function runDeclared() {
    var map = window.__WEBMCP_ANIMATIONS__;
    var ns = window.webmcpcss;
    if (!map || !ns || !ns.animation) return;
    try {
      var result = ns.animation.run(map, { strategy: 'queue' });
      if (result && result.then) result.then(function (r) { parent.postMessage({ type: 'webmcpcss:animations', result: r }, '*'); }, function () {});
    } catch (e) { /* motor no disponible */ }
  }
  window.addEventListener('message', function (ev) {
    var d = ev.data || {};
    if (d.type === 'webmcpcss:var') root.style.setProperty(d.name, d.value);
    if (d.type === 'webmcpcss:reset') { root.removeAttribute('style'); stop(); }
    if (d.type === 'webmcpcss:animate') play(d.preset);
  });
  /* Las acciones no navegan ni envían nada: avisan al hub */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-tool], [toolname]');
    if (!el) return;
    if (el.tagName === 'A') ev.preventDefault();
    var name = el.getAttribute('data-tool') || el.getAttribute('toolname');
    if (name) parent.postMessage({ type: 'webmcpcss:tool', tool: name }, '*');
  });
  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var form = ev.target;
    var name = form.getAttribute('toolname') || 'submit';
    var fields = [];
    Array.prototype.forEach.call(form.elements, function (f) { if (f.name) fields.push(f.name + '=' + (f.type === 'password' ? '***' : f.value)); });
    parent.postMessage({ type: 'webmcpcss:tool', tool: name, detail: fields.join(', ') }, '*');
  });
  function reportHeight() {
    var rootEl = document.querySelector('[data-preview-root]') || document.body;
    parent.postMessage({ type: 'webmcpcss:height', height: Math.ceil(rootEl.getBoundingClientRect().height) + 48 }, '*');
  }
  window.addEventListener('load', function () { reportHeight(); setTimeout(reportHeight, 400); if (window.__WEBMCP_ANIMATIONS__) setTimeout(runDeclared, 150); });
  if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(document.body);
})();
