/* WebMCPcss Component Hub — JS vanilla, sin dependencias */
(function () {
  'use strict';
  var FAV_KEY = 'webmcpcss-hub:favorites';
  var index = window.__HUB_INDEX__ || { components: [], categories: [], libraries: [] };
  var root = document.documentElement;
  var base = root.getAttribute('data-hub-base') || './';

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- toast ---------- */
  var toastEl;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }
  window.hubToast = toast;

  /* ---------- copiar ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { toast('Copiado al portapapeles'); }, function () { legacyCopy(text); });
    }
    legacyCopy(text);
    return Promise.resolve();
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copiado al portapapeles'); } catch (e) { toast('No se pudo copiar'); }
    document.body.removeChild(ta);
  }
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-copy], [data-copy-target]');
    if (!btn) return;
    var text = btn.getAttribute('data-copy');
    if (btn.hasAttribute('data-copy-target')) {
      var src = $(btn.getAttribute('data-copy-target'));
      text = src ? (src.value !== undefined && src.tagName === 'TEXTAREA' ? src.value : src.textContent) : '';
    }
    if (text != null) copyText(text);
  });

  /* ---------- favoritos ---------- */
  function favs() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (e) { return []; } }
  function saveFavs(list) { try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { /* modo privado */ } }
  function isFav(id) { return favs().indexOf(id) !== -1; }
  function toggleFav(id) {
    var list = favs(); var i = list.indexOf(id);
    if (i === -1) list.push(id); else list.splice(i, 1);
    saveFavs(list);
    syncFavButtons();
    toast(i === -1 ? 'Añadido a favoritos' : 'Quitado de favoritos');
    return i === -1;
  }
  function syncFavButtons() {
    $$('[data-fav]').forEach(function (b) {
      var on = isFav(b.getAttribute('data-fav'));
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', (on ? 'Quitar de favoritos: ' : 'Añadir a favoritos: ') + b.getAttribute('data-name'));
      var t = b.querySelector('.fav-text'); if (t) t.textContent = on ? 'Favorito' : 'Favorito';
      var s = b.querySelector('.star'); if (s) s.textContent = on ? '\u2605' : '\u2606';
    });
    var count = $('[data-fav-count]'); if (count) count.textContent = String(favs().length);
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-fav]');
    if (!b) return;
    ev.preventDefault();
    toggleFav(b.getAttribute('data-fav'));
    if (document.body.getAttribute('data-page') === 'favorites') renderFavorites();
  });

  /* ---------- tarjetas ---------- */
  var GLYPHS = {
    buttons: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M8 12h8"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16M8 15h5"/></svg>',
    forms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="4" rx="1.5"/><rect x="4" y="11" width="16" height="4" rx="1.5"/><path d="M4 19h8"/></svg>',
    layout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="4" rx="1.5"/><rect x="3" y="10" width="7" height="10" rx="1.5"/><rect x="12" y="10" width="9" height="10" rx="1.5"/></svg>',
    animations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12a7 7 0 1 0 7-7"/><path d="M12 5l-3-3M12 5l-3 3"/><circle cx="12" cy="12" r="2"/></svg>',
    intelligent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l2.2 5.3L20 9l-4.3 3.8L17 19l-5-3-5 3 1.3-6.2L4 9l5.8-.7z"/></svg>'
  };
  function label(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label; return id; }
  function cardHtml(c) {
    var tools = c.tools.slice(0, 3).map(function (t) { return '<code>' + esc(t.name) + '</code>'; }).join('');
    if (c.tools.length > 3) tools += '<code>+' + (c.tools.length - 3) + '</code>';
    if (!c.tools.length && c.animations.length) tools = c.animations.map(function (a) { return '<code>' + esc(a.name) + '</code>'; }).join('');
    return '<article class="card" data-id="' + esc(c.id) + '">' +
      '<div class="card-top"><span class="glyph" aria-hidden="true">' + (GLYPHS[c.category] || '') + '</span>' +
      '<div class="badges"><span class="badge cat">' + esc(label(index.categories, c.category)) + '</span><span class="badge lib">' + esc(label(index.libraries, c.library)) + '</span></div>' +
      '<button class="btn small icon fav" type="button" data-fav="' + esc(c.id) + '" data-name="' + esc(c.name) + '" aria-pressed="false"><span class="star" aria-hidden="true">\u2606</span></button></div>' +
      '<h3><a href="' + base + esc(c.id) + '/">' + esc(c.name) + '</a></h3>' +
      '<p>' + esc(c.description) + '</p>' +
      '<div class="tools">' + tools + '</div>' +
      '</article>';
  }

  /* ---------- catálogo / búsqueda ---------- */
  var state = { q: '', category: '', library: '' };
  function matches(c, st) {
    if (st.category && c.category !== st.category) return false;
    if (st.library && c.library !== st.library) return false;
    if (!st.q) return true;
    var hay = [c.id, c.name, c.description, c.category, c.library].concat(c.tags, c.tools.map(function (t) { return t.name + ' ' + (t.description || ''); })).join(' ').toLowerCase();
    return st.q.toLowerCase().split(/\s+/).every(function (w) { return !w || hay.indexOf(w) !== -1; });
  }
  function filtered(st) { return index.components.filter(function (c) { return matches(c, st); }); }
  function renderCatalog() {
    var grid = $('#catalog-grid'); if (!grid) return;
    var list = filtered(state);
    grid.innerHTML = list.length ? list.map(cardHtml).join('') : '<div class="empty">Sin resultados. Prueba con otra búsqueda o quita filtros.</div>';
    var meta = $('#results-meta');
    if (meta) meta.textContent = list.length + ' de ' + index.components.length + ' componentes' + (state.q ? ' para \u201c' + state.q + '\u201d' : '');
    $$('[data-filter]').forEach(function (chip) {
      var kind = chip.getAttribute('data-filter'); var val = chip.getAttribute('data-value');
      chip.setAttribute('aria-pressed', state[kind] === val ? 'true' : 'false');
    });
    syncFavButtons();
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.library) params.set('library', state.library);
    var qs = params.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) { /* file:// */ }
  }
  function initCatalog() {
    var grid = $('#catalog-grid'); if (!grid) return;
    var params = new URLSearchParams(location.search);
    state.q = params.get('q') || ''; state.category = params.get('category') || ''; state.library = params.get('library') || '';
    var input = $('#search-input');
    if (input) {
      input.value = state.q;
      input.addEventListener('input', function () { state.q = input.value.trim(); renderCatalog(); });
      var form = input.closest('form');
      if (form) form.addEventListener('submit', function (ev) { ev.preventDefault(); state.q = input.value.trim(); renderCatalog(); });
    }
    $$('[data-filter]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var kind = chip.getAttribute('data-filter'); var val = chip.getAttribute('data-value');
        state[kind] = state[kind] === val ? '' : val;
        renderCatalog();
      });
    });
    var clear = $('#clear-filters');
    if (clear) clear.addEventListener('click', function () { state = { q: '', category: '', library: '' }; if (input) input.value = ''; renderCatalog(); });
    renderCatalog();
  }

  /* ---------- favoritos (página) ---------- */
  function renderFavorites() {
    var grid = $('#favorites-grid'); if (!grid) return;
    var ids = favs();
    var list = index.components.filter(function (c) { return ids.indexOf(c.id) !== -1; });
    grid.innerHTML = list.length ? list.map(cardHtml).join('') : '<div class="empty">Todavía no tienes favoritos. Pulsa \u2606 en cualquier componente para guardarlo aquí (se almacena en tu navegador).</div>';
    var cmd = $('#favorites-import');
    if (cmd) { cmd.textContent = list.length ? 'npx webmcpcss components import ' + list.map(function (c) { return c.id; }).join(' ') : ''; cmd.parentElement.hidden = !list.length; }
    syncFavButtons();
  }

  /* ---------- pestañas accesibles ---------- */
  function initTabs() {
    $$('[role="tablist"]').forEach(function (list) {
      var tabs = $$('[role="tab"]', list);
      function select(tab) {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute('aria-selected', on ? 'true' : 'false');
          t.tabIndex = on ? 0 : -1;
          var panel = $('#' + t.getAttribute('aria-controls'));
          if (panel) panel.hidden = !on;
        });
      }
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { select(t); });
        t.addEventListener('keydown', function (ev) {
          var next = ev.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : ev.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
          if (next) { ev.preventDefault(); next.focus(); select(next); }
        });
      });
    });
  }

  /* ---------- editor en vivo (detalle) ---------- */
  function initEditor() {
    var frame = $('#preview'); if (!frame) return;
    var overrides = {};
    var componentId = document.body.getAttribute('data-component');
    var rootSelector = document.body.getAttribute('data-root-selector') || ':root';
    function post(msg) { try { frame.contentWindow.postMessage(msg, '*'); } catch (e) { /* aún no cargado */ } }
    function renderOverride() {
      var out = $('#override-css'); if (!out) return;
      var keys = Object.keys(overrides);
      out.textContent = keys.length ? rootSelector + ' {\n' + keys.map(function (k) { return '  ' + k + ': ' + overrides[k] + ';'; }).join('\n') + '\n}' : '/* Mueve los controles para generar tu CSS personalizado */';
    }
    $$('[data-var]').forEach(function (input) {
      var name = input.getAttribute('data-var'); var unit = input.getAttribute('data-unit') || '';
      var out = input.parentElement.querySelector('output');
      function apply() {
        var value = input.value + (input.type === 'range' ? unit : '');
        overrides[name] = value;
        if (out) out.value = value;
        post({ type: 'webmcpcss:var', name: name, value: value });
        renderOverride();
      }
      input.addEventListener('input', apply);
      input.addEventListener('change', apply);
    });
    var anim = $('#anim-select');
    if (anim) anim.addEventListener('change', function () { post({ type: 'webmcpcss:animate', preset: anim.value }); });
    var replay = $('#anim-replay');
    if (replay) replay.addEventListener('click', function () { post({ type: 'webmcpcss:animate', preset: anim ? anim.value : 'declared' }); });
    var reset = $('#editor-reset');
    if (reset) reset.addEventListener('click', function () {
      overrides = {};
      $$('[data-var]').forEach(function (input) { input.value = input.getAttribute('data-default') || input.defaultValue; var o = input.parentElement.querySelector('output'); if (o) o.value = input.value + (input.type === 'range' ? (input.getAttribute('data-unit') || '') : ''); });
      if (anim) anim.value = 'none';
      post({ type: 'webmcpcss:reset' });
      renderOverride();
    });
    $$('[data-viewport]').forEach(function (b) {
      b.addEventListener('click', function () {
        $('#preview-frame').setAttribute('data-viewport', b.getAttribute('data-viewport'));
        $$('[data-viewport]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      });
    });
    window.addEventListener('message', function (ev) {
      var d = ev.data || {};
      if (d.type === 'webmcpcss:tool') toast('Herramienta \u2192 ' + d.tool + (d.detail ? ' (' + d.detail + ')' : ''));
      if (d.type === 'webmcpcss:height' && d.height) frame.style.height = Math.max(200, Math.min(900, d.height)) + 'px';
    });
    renderOverride();
    if (componentId) syncFavButtons();
  }

  /* ---------- WebMCP en el propio hub (document.modelContext) ---------- */
  function registerWebMCP() {
    var mc = document.modelContext || navigator.modelContext;
    if (!mc || typeof mc.registerTool !== 'function') return;
    function text(obj) { return { content: [{ type: 'text', text: JSON.stringify(obj) }] }; }
    try {
      mc.registerTool({
        name: 'searchComponents',
        description: 'Busca componentes IA-First del WebMCPcss Component Hub por texto, categoría (buttons, cards, forms, layout, animations, intelligent) y librería (core, tailwind, bootstrap, mui, shadcn).',
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string' }, library: { type: 'string' } } },
        annotations: { readOnlyHint: true },
        execute: function (args) {
          args = args || {};
          var list = filtered({ q: args.query || '', category: args.category || '', library: args.library || '' });
          return text(list.map(function (c) { return { id: c.id, name: c.name, category: c.category, library: c.library, description: c.description, importCommand: c.importCommand }; }));
        }
      });
      mc.registerTool({
        name: 'getComponent',
        description: 'Devuelve los metadatos, herramientas declaradas y URLs de los archivos de un componente del hub por su id.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        annotations: { readOnlyHint: true },
        execute: function (args) {
          var c = index.components.filter(function (x) { return x.id === (args || {}).id; })[0];
          return text(c ? c : { error: 'Componente no encontrado' });
        }
      });
      mc.registerTool({
        name: 'toggleFavorite',
        description: 'Añade o quita un componente de la lista de favoritos del usuario (localStorage).',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        execute: function (args) { return text({ id: (args || {}).id, favorite: toggleFav((args || {}).id) }); }
      });
    } catch (e) { /* navegador sin soporte completo */ }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initCatalog();
    renderFavorites();
    initTabs();
    initEditor();
    syncFavButtons();
    registerWebMCP();
  });
})();
