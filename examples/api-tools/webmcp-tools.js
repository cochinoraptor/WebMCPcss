/* Generado por webmcpcss — no editar a mano */
(function () {
  'use strict';
  var mc = navigator.modelContext;
  if (!mc || typeof mc.registerTool !== 'function') {
    console.warn('[webmcp] navigator.modelContext no disponible');
    return;
  }
  var __webmcpText = function (el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  };
  var __webmcpParams = function (el, provided, declared) {
    var out = {};
    Object.keys(declared || {}).forEach(function (name) {
      var d = declared[name];
      if (d.source === 'attr') out[name] = el.getAttribute(d.value) || '';
      else if (d.source === 'literal') out[name] = d.value;
      else if (d.source === 'value') {
        var t = d.selector ? document.querySelector(d.selector) : el;
        out[name] = t ? (t.value || '') : '';
      } else if (d.source === 'text') {
        var t2 = d.selector ? document.querySelector(d.selector) : el;
        out[name] = t2 ? __webmcpText(t2) : '';
      }
    });
    Object.keys(provided || {}).forEach(function (k) { out[k] = provided[k]; });
    return out;
  };
  var __webmcpPick = function (elements, provided, declared) {
    var names = Object.keys(provided).filter(function (k) { return declared && k in declared; });
    if (names.length === 0) return elements[0];
    for (var i = 0; i < elements.length; i++) {
      var resolved = __webmcpParams(elements[i], {}, declared);
      var match = names.every(function (k) {
        var want = String(provided[k]).toLowerCase();
        var got = String(resolved[k] || '').toLowerCase();
        return got === want || got.indexOf(want) !== -1 || want.indexOf(got) !== -1;
      });
      if (match) return elements[i];
    }
    return elements[0];
  };
  var __webmcpDispatch = function (el, trigger) {
    if (trigger.on) {
      var target = document.querySelector(trigger.on);
      if (target) { target.dispatchEvent(new Event(trigger.event, { bubbles: true })); }
      return;
    }
    if (trigger.event === 'click') { el.click(); return; }
    el.dispatchEvent(new Event(trigger.event, { bubbles: true }));
  };
  var __webmcpWaitFor = function (selector, timeoutMs) {
    return new Promise(function (resolve) {
      var started = Date.now();
      var check = function () {
        var parts = selector.split(',').map(function (s) { return s.trim(); });
        for (var i = 0; i < parts.length; i++) {
          if (document.querySelector(parts[i])) return resolve(true);
        }
        if (Date.now() - started >= timeoutMs) return resolve(false);
        setTimeout(check, 60);
      };
      check();
    });
  };
  mc.registerTool({
    name: "clearSearch",
    description: "Limpia la búsqueda actual",
    inputSchema: {"type":"object","properties":{},"required":[]},
    execute: async function (params) {
      params = params || {};
      var elements = Array.prototype.slice.call(document.querySelectorAll(".doc-search .btn-clear-search"));
      if (elements.length === 0) {
        return { success: false, error: 'selector sin elementos: .doc-search .btn-clear-search' };
      }
      var el = __webmcpPick(elements, params, {});
      __webmcpDispatch(el, {"event":"click"});
      var confirmed = await __webmcpWaitFor("#search-status:not(:empty)", 1500);
      return {
        success: confirmed,
        params: __webmcpParams(el, params, {}),
        confirmed: confirmed
      };
    }
  });
})();
