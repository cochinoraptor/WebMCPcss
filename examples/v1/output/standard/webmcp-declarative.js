/* WebMCPcss · atributos declarativos WebMCP (toolname/tooldescription) — generado */
(function () {
  'use strict';
  var PATCHES = [{"f":"#search-btn","i":1,"a":{"toolname":"buscarProductos","tooldescription":"Busca productos en el catálogo","toolautosubmit":""},"x":[{"selector":"#q","attrs":{"toolparamtitle":"query"}}]},{"f":"#add-to-cart","i":1,"a":{"toolname":"anadirAlCarrito","tooldescription":"Añade el producto actual al carrito"},"x":[{"selector":"#qty","attrs":{"toolparamtitle":"cantidad"}}]},{"f":"#contact-form button[type=\"submit\"]","i":1,"a":{"toolname":"enviarConsulta","tooldescription":"Envía una consulta al soporte","toolautosubmit":""},"x":[{"selector":"#c-email","attrs":{"toolparamtitle":"email"}},{"selector":"#c-msg","attrs":{"toolparamtitle":"mensaje"}}]}];
  function set(el, attrs) {
    Object.keys(attrs).forEach(function (k) { if (!el.hasAttribute(k)) el.setAttribute(k, attrs[k]); });
  }
  function apply() {
    var n = 0;
    PATCHES.forEach(function (p) {
      var form = null;
      try { form = document.querySelector(p.f); } catch (e) { form = null; }
      if (form && form.tagName !== 'FORM') form = form.closest ? form.closest('form') : null;
      if (!form && p.i && p.x && p.x.length) {
        var field = null;
        try { field = document.querySelector(p.x[0].selector); } catch (e) { field = null; }
        form = field && field.closest ? field.closest('form') : null;
      }
      if (!form) return;
      set(form, p.a); n++;
      (p.x || []).forEach(function (fx) {
        var el = null;
        try { el = document.querySelector(fx.selector); } catch (e) { el = null; }
        if (el) set(el, fx.attrs);
      });
    });
    return n;
  }
  var applied = apply();
  if (typeof MutationObserver !== 'undefined' && applied < PATCHES.length) {
    var mo = new MutationObserver(function () { if (apply() >= PATCHES.length) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.__WEBMCP_DECLARATIVE__ = { applied: applied, total: PATCHES.length };
})();
