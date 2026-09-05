/**
 * Recursos estáticos del sitio del Component Hub (CSS y JavaScript vanilla,
 * sin dependencias). Se escriben en `site/components/assets/` por el
 * generador ({@link ../site}). El JavaScript evita plantillas literales para
 * poder vivir dentro de una cadena TypeScript.
 */

/** Hoja de estilos del hub (misma paleta que el sitio principal). */
export const HUB_CSS = `/* WebMCPcss Component Hub — generado por webmcpcss */
:root {
  --bg: #0b0e14; --bg2: #0e1220; --card: rgba(22, 27, 40, .72); --line: #222a3d;
  --text: #e8ebf3; --muted: #98a2b8; --acc: #4fd1c5; --acc2: #7c6cf0;
  --code: #0c1019; --ok: #34d399; --warn: #fbbf24; --danger: #f87171;
  --grad: linear-gradient(100deg, #4fd1c5, #7c6cf0);
  --radius: 14px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
body { background: var(--bg); color: var(--text); font: 16px/1.65 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; min-height: 100vh; display: flex; flex-direction: column; }
a { color: var(--acc); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre, kbd, .mono { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace; }
code { font-size: .9em; background: rgba(124, 108, 240, .12); padding: 1px 6px; border-radius: 6px; }
pre { background: var(--code); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; overflow: auto; font-size: 13px; line-height: 1.6; }
pre code { background: transparent; padding: 0; font-size: inherit; }
img { max-width: 100%; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 3px solid var(--acc); outline-offset: 2px; border-radius: 6px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.skip { position: absolute; left: -999px; top: 8px; background: var(--acc2); color: #fff; padding: 8px 14px; border-radius: 8px; z-index: 100; }
.skip:focus { left: 8px; }
.wrap { width: 100%; max-width: 1180px; margin: 0 auto; padding: 0 24px; }
.grid-bg { position: fixed; inset: 0; z-index: -2; pointer-events: none; background-image: linear-gradient(rgba(124,108,240,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(124,108,240,.045) 1px, transparent 1px); background-size: 44px 44px; mask-image: radial-gradient(1200px 800px at 50% 0%, #000 0%, transparent 75%); -webkit-mask-image: radial-gradient(1200px 800px at 50% 0%, #000 0%, transparent 75%); }
.glow { position: fixed; z-index: -1; pointer-events: none; filter: blur(110px); opacity: .28; border-radius: 50%; }
.glow.a { width: 560px; height: 560px; background: #7c6cf0; top: -220px; left: 8%; }
.glow.b { width: 480px; height: 480px; background: #4fd1c5; top: -160px; right: 4%; opacity: .18; }

/* header */
.site-header { position: sticky; top: 0; z-index: 50; background: rgba(11, 14, 20, .78); backdrop-filter: blur(14px); border-bottom: 1px solid rgba(34, 42, 61, .7); }
.site-header .wrap { display: flex; align-items: center; gap: 18px; min-height: 64px; flex-wrap: wrap; padding-top: 6px; padding-bottom: 6px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 17px; letter-spacing: -.3px; color: var(--text); white-space: nowrap; }
.brand:hover { text-decoration: none; }
.brand img { width: 30px; height: 30px; border-radius: 8px; }
.brand em { font-style: normal; background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.brand .hub { color: var(--muted); font-weight: 500; font-size: 13px; margin-left: 4px; padding-left: 10px; border-left: 1px solid var(--line); }
.site-nav { margin-left: auto; display: flex; gap: 4px; font-size: 13.5px; font-weight: 500; flex-wrap: wrap; }
.site-nav a { color: var(--muted); padding: 6px 10px; border-radius: 8px; transition: color .15s, background .15s; }
.site-nav a:hover, .site-nav a[aria-current="page"] { color: var(--text); background: rgba(124, 108, 240, .14); text-decoration: none; }
.site-nav a.gh { border: 1px solid var(--line); }

main { flex: 1; padding: 36px 0 64px; min-width: 0; }
.wrap > * { min-width: 0; }
.cards, .tiles, .examples, .steps, .stats { min-width: 0; }
.section { margin-top: 44px; }
.section > h2, .section > .h2 { font-size: 24px; letter-spacing: -.4px; margin-bottom: 14px; }
.lead { color: var(--muted); font-size: 17px; max-width: 70ch; }
.eyebrow { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; color: var(--acc); margin-bottom: 10px; }

/* hero */
.hero { padding: 36px 0 12px; }
.hero h1 { font-size: clamp(30px, 5vw, 52px); line-height: 1.05; letter-spacing: -1px; max-width: 18ch; overflow-wrap: anywhere; }
.hero h1 em { font-style: normal; background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hero p.lead { margin: 18px 0 24px; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.btn { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 9px 18px; border-radius: 10px; border: 1px solid var(--line); background: rgba(22, 27, 40, .8); color: var(--text); font-weight: 600; font-size: 14px; cursor: pointer; transition: transform .15s, border-color .15s, background .15s; text-decoration: none; }
.btn:hover { transform: translateY(-1px); border-color: rgba(124, 108, 240, .6); text-decoration: none; }
.btn.primary { background: var(--grad); color: #0b0e14; border-color: transparent; }
.btn.small { min-height: 32px; padding: 4px 12px; font-size: 13px; }
.btn.icon { padding: 4px 10px; }
.btn[aria-pressed="true"] { border-color: var(--warn); color: var(--warn); }
.stats { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 26px; }
.stats div strong { display: block; font-size: 26px; letter-spacing: -.5px; }
.stats div span { color: var(--muted); font-size: 13px; }

/* cards */
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.card { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 18px; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); transition: transform .18s, border-color .18s, box-shadow .18s; }
.card:hover { transform: translateY(-3px); border-color: rgba(124, 108, 240, .55); box-shadow: 0 20px 40px -24px rgba(124, 108, 240, .55); }
.card h3 { font-size: 17px; letter-spacing: -.2px; }
.card h3 a { color: var(--text); }
.card h3 a::after { content: ''; position: absolute; inset: 0; }
.card p { color: var(--muted); font-size: 14px; }
.card .fav { position: relative; z-index: 2; margin-left: auto; }
.card-top { display: flex; align-items: center; gap: 8px; }
.glyph { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 10px; background: rgba(124, 108, 240, .14); color: var(--acc); flex: none; }
.glyph svg { width: 20px; height: 20px; }
.badges { display: flex; gap: 6px; flex-wrap: wrap; }
.badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.badge.lib { color: var(--acc); border-color: rgba(79, 209, 197, .4); }
.badge.cat { color: var(--acc2); border-color: rgba(124, 108, 240, .45); }
.badge.v { font-family: 'JetBrains Mono', monospace; }
.tools { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
.tools code { font-size: 11.5px; }
.tile { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; color: var(--text); }
.tile:hover { border-color: rgba(79, 209, 197, .5); text-decoration: none; }
.tile strong { display: block; }
.tile span { color: var(--muted); font-size: 13px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }

/* filters */
.toolbar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 18px 0; }
.search { flex: 1 1 280px; position: relative; }
.search input { width: 100%; min-height: 44px; padding: 8px 14px 8px 40px; border-radius: 10px; border: 1px solid var(--line); background: rgba(12, 16, 25, .9); color: var(--text); font: inherit; }
.search input::placeholder { color: var(--muted); }
.search svg { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; color: var(--muted); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { border: 1px solid var(--line); background: transparent; color: var(--muted); padding: 5px 12px; border-radius: 999px; font-size: 13px; font-weight: 500; cursor: pointer; }
.chip:hover { color: var(--text); }
.chip[aria-pressed="true"] { background: rgba(124, 108, 240, .2); border-color: var(--acc2); color: var(--text); }
.chip .n { color: var(--muted); font-size: 11px; margin-left: 4px; }
.results-meta { color: var(--muted); font-size: 14px; margin: 6px 0 14px; }
.empty { padding: 40px; text-align: center; color: var(--muted); border: 1px dashed var(--line); border-radius: var(--radius); }
select.select { min-height: 40px; padding: 6px 12px; border-radius: 10px; border: 1px solid var(--line); background: rgba(12, 16, 25, .9); color: var(--text); font: inherit; }

/* detail */
.crumbs { font-size: 13px; color: var(--muted); margin-bottom: 14px; display: flex; gap: 6px; flex-wrap: wrap; }
.crumbs a { color: var(--muted); padding: 2px 0; }
.detail-head { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
.detail-head h1 { font-size: clamp(24px, 4vw, 38px); letter-spacing: -.6px; overflow-wrap: anywhere; }
.detail-head > div { min-width: 0; }
.detail-head .badges { margin: 8px 0 10px; }
.detail-head .actions { margin-left: auto; }
.import { display: flex; align-items: center; gap: 8px; margin-top: 16px; padding: 8px 8px 8px 14px; background: var(--code); border: 1px solid var(--line); border-radius: 12px; font-family: 'JetBrains Mono', monospace; font-size: 13px; flex-wrap: wrap; }
.import code { background: transparent; padding: 0; overflow-wrap: anywhere; min-width: 0; }
.import .btn { margin-left: auto; }
.studio { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; margin-top: 24px; }
.studio > * { min-width: 0; }
@media (max-width: 900px) { .studio { grid-template-columns: minmax(0, 1fr); } .editor { position: static; } }
.preview-box { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.preview-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--muted); flex-wrap: wrap; }
.preview-bar .spacer { flex: 1; }
.preview-frame { display: flex; justify-content: center; background: #f6f7fb; padding: 0; }
.preview-frame iframe { width: 100%; height: 420px; border: 0; background: transparent; transition: width .2s; display: block; }
.preview-frame[data-viewport="mobile"] iframe { width: 375px; }
.preview-frame[data-viewport="tablet"] iframe { width: 768px; max-width: 100%; }
.editor { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; display: flex; flex-direction: column; gap: 14px; align-self: start; position: sticky; top: 80px; }
.editor h2 { font-size: 15px; letter-spacing: .2px; }
.control { display: grid; gap: 6px; }
.control label { font-size: 13px; color: var(--muted); display: flex; justify-content: space-between; }
.control label output { color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 12px; }
.control input[type="color"] { width: 100%; height: 36px; border: 1px solid var(--line); border-radius: 8px; background: transparent; padding: 2px; cursor: pointer; }
.control input[type="range"] { width: 100%; accent-color: var(--acc2); }
.control input[type="text"], .control select { min-height: 36px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line); background: rgba(12, 16, 25, .9); color: var(--text); font: inherit; }
.editor pre { max-height: 180px; font-size: 12px; }
.editor .row { display: flex; gap: 8px; flex-wrap: wrap; }

.tabs { margin-top: 28px; }
[role="tablist"] { display: flex; gap: 4px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
[role="tab"] { background: transparent; border: 0; border-bottom: 2px solid transparent; color: var(--muted); padding: 10px 14px; font-weight: 600; font-size: 14px; cursor: pointer; margin-bottom: -1px; }
[role="tab"][aria-selected="true"] { color: var(--text); border-bottom-color: var(--acc); }
[role="tabpanel"] { position: relative; padding-top: 14px; }
[role="tabpanel"][hidden] { display: none; }
[role="tabpanel"] pre { max-height: 520px; }
.copy-abs { position: absolute; top: 24px; right: 10px; }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px); background: #111827; color: #fff; padding: 10px 16px; border-radius: 10px; border: 1px solid var(--line); font-size: 14px; opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; z-index: 200; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }

table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12.5px; text-transform: uppercase; letter-spacing: .6px; }
.table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 12px; }
.pill { display: inline-block; font-size: 11.5px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.pill.needed { color: var(--warn); border-color: rgba(251, 191, 36, .5); }
.pill.none { color: var(--ok); border-color: rgba(52, 211, 153, .5); }

.examples { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.example { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.example h3 { font-size: 14px; color: var(--muted); margin-bottom: 8px; }
.example ul { list-style: none; display: grid; gap: 6px; }
.example { min-width: 0; }
.example li { display: flex; gap: 8px; align-items: center; justify-content: space-between; font-size: 13.5px; min-width: 0; }
.example li code { flex: 1 1 0; min-width: 0; overflow: auto; white-space: nowrap; }
.example li .btn { flex: none; }

.steps { counter-reset: step; display: grid; gap: 10px; }
.steps li { list-style: none; position: relative; padding-left: 40px; min-width: 0; }
.steps li::before { counter-increment: step; content: counter(step); position: absolute; left: 0; top: 2px; width: 26px; height: 26px; border-radius: 50%; background: var(--grad); color: #0b0e14; display: grid; place-items: center; font-weight: 800; font-size: 13px; }
.steps pre { margin-top: 6px; }

/* docs */
.docs { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 32px; }
.docs > * { min-width: 0; }
@media (max-width: 860px) { .docs { grid-template-columns: minmax(0, 1fr); gap: 20px; } .docs aside { position: static; } }
.docs aside { position: sticky; top: 84px; align-self: start; font-size: 14px; }
.docs aside h4 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin: 14px 0 6px; }
.docs aside a { display: block; color: var(--muted); padding: 4px 0; }
.docs aside a[aria-current="page"], .docs aside a:hover { color: var(--text); }
.docs aside .toc a { padding-left: 10px; border-left: 1px solid var(--line); }
.prose h1 { font-size: 34px; letter-spacing: -.6px; margin-bottom: 10px; }
.prose h2 { font-size: 24px; margin: 34px 0 10px; letter-spacing: -.3px; }
.prose h3 { font-size: 18px; margin: 24px 0 8px; }
.prose p, .prose ul, .prose ol { margin: 10px 0; color: #d3d8e6; }
.prose ul, .prose ol { padding-left: 22px; }
.prose li { margin: 4px 0; }
.prose pre { margin: 12px 0; }
.prose blockquote { border-left: 3px solid var(--acc2); padding: 6px 14px; color: var(--muted); margin: 12px 0; background: rgba(124, 108, 240, .06); border-radius: 0 8px 8px 0; }
.prose table { margin: 12px 0; display: block; overflow-x: auto; }
.prose img, .prose pre { max-width: 100%; }
.prose p code, .prose li code { overflow-wrap: anywhere; }
.prose td code, .prose th code { white-space: nowrap; }
.prose hr { border: 0; border-top: 1px solid var(--line); margin: 24px 0; }

footer { border-top: 1px solid var(--line); padding: 26px 0; color: var(--muted); font-size: 13px; }
footer .wrap { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
footer nav { margin-left: auto; display: flex; gap: 14px; flex-wrap: wrap; }
footer a { color: var(--muted); }

/* móvil */
@media (max-width: 640px) {
  .wrap { padding: 0 16px; }
  main { padding: 24px 0 48px; }
  .section { margin-top: 34px; }
  .site-header .wrap { gap: 10px; }
  .site-nav { gap: 2px; font-size: 13px; margin-left: 0; width: 100%; }
  .site-nav a { padding: 8px 9px; }
  .brand .hub { display: none; }
  .hero { padding: 24px 0 8px; }
  .lead { font-size: 16px; }
  .stats { gap: 18px 24px; }
  .stats div strong { font-size: 22px; }
  pre { padding: 12px 14px; font-size: 12.5px; }
  .preview-frame iframe { height: 360px; }
  .preview-frame[data-viewport="mobile"] iframe, .preview-frame[data-viewport="tablet"] iframe { width: 100%; }
  .import { padding: 8px 10px; font-size: 12.5px; }
  .import .btn { margin-left: 0; width: 100%; justify-content: center; }
  [role="tab"] { padding: 8px 10px; font-size: 13px; }
  .copy-abs { top: 20px; right: 8px; }
  .prose h1 { font-size: 28px; }
  .prose h2 { font-size: 21px; }
  th, td { padding: 8px; }
  .example li { flex-wrap: wrap; }
  .example li .btn { width: 100%; justify-content: center; }
  footer nav { margin-left: 0; }
}
@media (max-width: 400px) {
  .site-nav a { padding: 8px 7px; font-size: 12.5px; }
  .actions .btn { flex: 1 1 auto; justify-content: center; }
}
`;

/** JavaScript del sitio (catálogo, búsqueda, favoritos, editor en vivo, WebMCP). */
export const HUB_JS = `/* WebMCPcss Component Hub — JS vanilla, sin dependencias */
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
      var s = b.querySelector('.star'); if (s) s.textContent = on ? '\\u2605' : '\\u2606';
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
      '<button class="btn small icon fav" type="button" data-fav="' + esc(c.id) + '" data-name="' + esc(c.name) + '" aria-pressed="false"><span class="star" aria-hidden="true">\\u2606</span></button></div>' +
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
    return st.q.toLowerCase().split(/\\s+/).every(function (w) { return !w || hay.indexOf(w) !== -1; });
  }
  function filtered(st) { return index.components.filter(function (c) { return matches(c, st); }); }
  function renderCatalog() {
    var grid = $('#catalog-grid'); if (!grid) return;
    var list = filtered(state);
    grid.innerHTML = list.length ? list.map(cardHtml).join('') : '<div class="empty">Sin resultados. Prueba con otra búsqueda o quita filtros.</div>';
    var meta = $('#results-meta');
    if (meta) meta.textContent = list.length + ' de ' + index.components.length + ' componentes' + (state.q ? ' para \\u201c' + state.q + '\\u201d' : '');
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
    grid.innerHTML = list.length ? list.map(cardHtml).join('') : '<div class="empty">Todavía no tienes favoritos. Pulsa \\u2606 en cualquier componente para guardarlo aquí (se almacena en tu navegador).</div>';
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
      out.textContent = keys.length ? rootSelector + ' {\\n' + keys.map(function (k) { return '  ' + k + ': ' + overrides[k] + ';'; }).join('\\n') + '\\n}' : '/* Mueve los controles para generar tu CSS personalizado */';
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
      if (d.type === 'webmcpcss:tool') toast('Herramienta \\u2192 ' + d.tool + (d.detail ? ' (' + d.detail + ')' : ''));
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
`;

/** Script que corre dentro del iframe de previsualización. */
export const PREVIEW_JS = `/* WebMCPcss Component Hub — preview */
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
`;

/** Estilos base del iframe de previsualización. */
export const PREVIEW_CSS = `html, body { margin: 0; }
body { display: flex; align-items: flex-start; justify-content: center; padding: 24px; box-sizing: border-box; }
[data-preview-root] { width: 100%; display: flex; justify-content: center; }
[data-preview-root][data-category="layout"], [data-preview-root][data-category="intelligent"][data-kind="layout"] { display: block; }
[data-preview-root] > * { max-width: 100%; min-width: 0; box-sizing: border-box; }
[data-preview-root] img, [data-preview-root] svg, [data-preview-root] video, [data-preview-root] canvas { max-width: 100%; }
@media (max-width: 480px) { body { padding: 12px; } }
.wm-hover-glow { transition: box-shadow .25s, transform .25s; }
.wm-hover-glow:hover { box-shadow: 0 0 0 4px rgba(124, 108, 240, .25), 0 18px 40px -16px rgba(124, 108, 240, .7) !important; transform: translateY(-2px); }
`;
