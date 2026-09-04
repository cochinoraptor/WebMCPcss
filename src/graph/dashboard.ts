/**
 * Dashboard interactivo del grafo.
 *
 * Genera un HTML autónomo con el grafo embebido en JSON y Cytoscape.js
 * cargado desde CDN (sin dependencias npm nuevas). Puede:
 * - escribirse a disco como archivo estático (`buildGraphHtml`), o
 * - servirse con un mini servidor HTTP (`serveGraphDashboard`) que expone
 *   además `GET /api/graph` con el JSON.
 */
import * as http from 'http';
import type { FragilityScore, Graph, GraphNode } from './types';

/** Colores por tipo de nodo (compartidos por el HTML y el SVG). */
const NODE_COLORS: Record<string, string> = {
  tool: '#3b82f6',
  selector: '#22c55e',
  page: '#f97316',
  param: '#a855f7',
  status: '#ef4444',
};

/** Color de un nodo según tipo, estado y fragilidad. */
function colorFor(node: GraphNode): string {
  if (node.type === 'status') return node.id === 'status:ok' ? '#16a34a' : '#ef4444';
  const frag = node.metadata?.fragility as FragilityScore | undefined;
  if (node.type === 'selector' && frag) {
    if (frag.level === 'high') return '#dc2626';
    if (frag.level === 'medium') return '#eab308';
  }
  return NODE_COLORS[node.type] ?? '#64748b';
}

/** Escapa texto para incrustarlo en XML/SVG. */
function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Genera un SVG estático del grafo sin dependencias (layout circular por
 * capas: páginas en el centro, herramientas en el anillo medio y
 * selectores/parámetros/estados en el exterior). Útil para documentación,
 * READMEs o exportación desde Node sin navegador.
 *
 * @param graph Grafo a dibujar.
 * @param options Tamaño del lienzo.
 * @returns Documento SVG completo.
 */
export function buildGraphSvg(
  graph: Graph,
  options: { width?: number; height?: number } = {},
): string {
  const width = options.width ?? 1200;
  const height = options.height ?? 900;
  const cx = width / 2;
  const cy = height / 2;
  const rings: Record<string, number> = { page: 0.12, tool: 0.36, selector: 0.62 };
  const outer = 0.86;
  const pos = new Map<string, { x: number; y: number }>();
  const byRing = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) {
    const ratio = rings[n.type] ?? outer;
    byRing.set(ratio, [...(byRing.get(ratio) ?? []), n]);
  }
  const radiusBase = Math.min(width, height) / 2 - 40;
  for (const [ratio, nodes] of byRing) {
    const r = radiusBase * ratio;
    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      pos.set(n.id, {
        x: nodes.length === 1 && ratio === rings.page ? cx : cx + r * Math.cos(angle),
        y: nodes.length === 1 && ratio === rings.page ? cy : cy + r * Math.sin(angle),
      });
    });
  }
  const edges = graph.edges
    .map((e) => {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) return '';
      const dashed = e.type === 'has-status' ? ' stroke-dasharray="4 3"' : '';
      const color = e.type === 'shares-selector' ? '#eab308' : '#64748b';
      return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${color}" stroke-width="1.2" opacity="0.7"${dashed}><title>${xmlEscape(e.type)}</title></line>`;
    })
    .filter(Boolean)
    .join('\n  ');
  const nodes = graph.nodes
    .map((n) => {
      const p = pos.get(n.id);
      if (!p) return '';
      const r = n.type === 'tool' ? 14 : n.type === 'page' ? 16 : 9;
      const label = n.label.length > 30 ? `${n.label.slice(0, 29)}…` : n.label;
      const frag = n.metadata?.fragility as FragilityScore | undefined;
      const title = frag ? `${n.label} · fragilidad ${frag.level}` : n.label;
      return (
        `<g class="node ${n.type}" data-id="${xmlEscape(n.id)}">` +
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${colorFor(n)}" stroke="#0f172a" stroke-width="1.5"><title>${xmlEscape(title)}</title></circle>` +
        `<text x="${p.x.toFixed(1)}" y="${(p.y + r + 11).toFixed(1)}" font-size="9" text-anchor="middle" fill="#e2e8f0">${xmlEscape(label)}</text></g>`
      );
    })
    .filter(Boolean)
    .join('\n  ');
  const m = graph.metadata;
  const caption = m
    ? `${m.totalTools} herramientas · ${m.totalSelectors} selectores · ${m.totalPages} páginas`
    : `${graph.nodes.length} nodos`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif">
  <rect width="100%" height="100%" fill="#0f172a"/>
  <text x="16" y="24" font-size="14" font-weight="600" fill="#e2e8f0">WebMCPcss · Grafo</text>
  <text x="16" y="42" font-size="11" fill="#94a3b8">${xmlEscape(caption)}</text>
  ${edges}
  ${nodes}
</svg>
`;
}

/**
 * Construye el HTML autónomo del dashboard del grafo.
 *
 * Colores por tipo: herramienta=azul, selector=verde, página=naranja,
 * estado=rojo/verde, parámetro=gris. Incluye panel lateral de metadatos,
 * filtros por tipo, estado (OK/roto), fragilidad, página y framework
 * detectado, estadísticas (con frameworks) y exportación JSON/PNG/SVG.
 *
 * @param graph Grafo a visualizar.
 * @returns Documento HTML completo.
 */
export function buildGraphHtml(graph: Graph): string {
  const json = JSON.stringify(graph).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>WebMCPcss · Grafo</title>
<script src="https://unpkg.com/cytoscape@3/dist/cytoscape.min.js"></script>
<style>
  :root { --bg:#0f172a; --panel:#1e293b; --text:#e2e8f0; --dim:#94a3b8; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, sans-serif; background:var(--bg); color:var(--text); display:flex; height:100vh; }
  #cy { flex:1; }
  aside { width:320px; background:var(--panel); padding:16px; overflow:auto; border-left:1px solid #334155; }
  h1 { font-size:16px; margin:0 0 12px; } h2 { font-size:13px; color:var(--dim); text-transform:uppercase; margin:16px 0 6px; }
  .stat { display:flex; justify-content:space-between; font-size:13px; padding:2px 0; }
  .legend span { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; }
  label { display:block; font-size:13px; padding:3px 0; cursor:pointer; }
  #meta { font-size:12px; background:#0b1220; border-radius:8px; padding:10px; white-space:pre-wrap; word-break:break-all; min-height:80px; }
  button { background:#334155; color:var(--text); border:0; border-radius:6px; padding:6px 10px; margin:4px 4px 0 0; cursor:pointer; font-size:12px; }
  button:hover { background:#475569; }
  select { width:100%; background:#0b1220; color:var(--text); border:1px solid #334155; border-radius:6px; padding:5px; font-size:12px; }
  .fw { font-size:12px; } .fw .stat b { color:#fbbf24; } .fw .none { color:var(--dim); }
</style>
</head>
<body>
<div id="cy"></div>
<aside>
  <h1>🗺️ WebMCPcss · Grafo</h1>
  <h2>Estadísticas</h2><div id="stats"></div>
  <h2>Leyenda</h2>
  <div class="legend" style="font-size:13px">
    <div><span style="background:#3b82f6"></span>Herramienta</div>
    <div><span style="background:#22c55e"></span>Selector</div>
    <div><span style="background:#f97316"></span>Página</div>
    <div><span style="background:#a855f7"></span>Parámetro</div>
    <div><span style="background:#ef4444"></span>Estado roto · <span style="background:#16a34a"></span>Estado OK</div>
  </div>
  <h2>Frameworks detectados</h2><div id="frameworks" class="fw"></div>
  <h2>Filtros por tipo</h2><div id="typeFilters"></div>
  <h2>Filtro por estado</h2><div id="statusFilters"></div>
  <h2>Filtro por fragilidad</h2><div id="fragFilters"></div>
  <h2>Filtro por página</h2><select id="pageFilter"></select>
  <h2>Filtro por framework</h2><select id="frameworkFilter"></select>
  <h2>Nodo seleccionado</h2><div id="meta">Haz clic en un nodo…</div>
  <h2>Exportar</h2>
  <button id="exportJson">JSON</button>
  <button id="exportPng">PNG</button>
  <button id="exportSvg">SVG</button>
</aside>
<script>
var GRAPH = ${json};
var COLORS = ${JSON.stringify(NODE_COLORS)};
function nodeColor(n){
  if(n.type==='status') return n.id==='status:ok' ? '#16a34a' : '#ef4444';
  var frag = n.metadata && n.metadata.fragility;
  if(n.type==='selector' && frag){
    if(frag.level==='high') return '#dc2626';
    if(frag.level==='medium') return '#eab308';
  }
  return COLORS[n.type] || '#64748b';
}
var cy = cytoscape({
  container: document.getElementById('cy'),
  elements: {
    nodes: GRAPH.nodes.map(function(n){ return { data: { id:n.id, label:n.label.length>28?n.label.slice(0,27)+'…':n.label, type:n.type, full:n } }; }),
    edges: GRAPH.edges.map(function(e,i){ return { data: { id:'e'+i, source:e.source, target:e.target, type:e.type } }; })
  },
  style: [
    { selector:'node', style:{ 'background-color': function(el){ return nodeColor(el.data('full')); },
      label:'data(label)', color:'#e2e8f0', 'font-size':'9px', 'text-valign':'bottom', 'text-margin-y':4,
      width: function(el){ return el.data('type')==='tool'?34:22; }, height: function(el){ return el.data('type')==='tool'?34:22; } } },
    { selector:'edge', style:{ width:1.2, 'line-color':'#475569', 'target-arrow-color':'#475569',
      'target-arrow-shape':'triangle', 'arrow-scale':0.7, 'curve-style':'bezier', opacity:0.7 } },
    { selector:'edge[type="has-status"]', style:{ 'line-style':'dashed' } },
    { selector:'edge[type="shares-selector"]', style:{ 'line-color':'#eab308', 'target-arrow-shape':'none' } },
    { selector:'.faded', style:{ opacity:0.08 } },
    { selector:':selected', style:{ 'border-width':3, 'border-color':'#e2e8f0' } }
  ],
  layout: { name:'cose', animate:false, nodeRepulsion: 12000, idealEdgeLength: 70 }
});
// Estadísticas
var m = GRAPH.metadata || {};
var stats = [ ['Herramientas', m.totalTools], ['Selectores', m.totalSelectors], ['Páginas', m.totalPages] ];
if(m.statusCounts) stats.push(['Estado', '✅ '+m.statusCounts.ok+' · ❌ '+m.statusCounts.broken]);
if(m.fragilitySummary) stats.push(['Fragilidad', '🟢 '+(m.fragilitySummary.low||0)+' 🟡 '+(m.fragilitySummary.medium||0)+' 🔴 '+(m.fragilitySummary.high||0)]);
function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
document.getElementById('stats').innerHTML = stats.map(function(s){ return '<div class="stat"><span>'+s[0]+'</span><b>'+(s[1]==null?'—':esc(s[1]))+'</b></div>'; }).join('');
// Frameworks detectados (metadata.frameworkSummary o cálculo a partir de los selectores)
var FW = m.frameworkSummary || (function(){
  var acc = {}; GRAPH.nodes.forEach(function(n){ var f = n.metadata && n.metadata.fragility; ((f && f.frameworks) || []).forEach(function(fw){ acc[fw] = (acc[fw]||0)+1; }); }); return acc;
})();
var fwNames = Object.keys(FW).sort(function(a,b){ return FW[b]-FW[a]; });
document.getElementById('frameworks').innerHTML = fwNames.length
  ? fwNames.map(function(f){ return '<div class="stat"><span>'+esc(f)+'</span><b>'+FW[f]+'</b></div>'; }).join('')
  : '<div class="none">Ninguno: todos los selectores son agnósticos 🎉</div>';
// Estado y página de cada nodo (para filtrar herramientas, selectores y parámetros por su herramienta)
var TOOL_STATUS = {}; var TOOL_PAGE = {};
GRAPH.edges.forEach(function(e){
  if(e.type==='has-status') TOOL_STATUS[e.source] = e.target==='status:ok' ? 'ok' : 'broken';
  if(e.type==='belongs-to' && e.source.indexOf('tool:')===0) TOOL_PAGE[e.source] = e.target;
});
function toolsOf(n){
  if(n.type==='tool') return [n.id];
  if(n.type==='param') return ['tool:'+(n.metadata&&n.metadata.tool)];
  if(n.type==='selector') return GRAPH.edges.filter(function(e){ return e.type==='uses' && e.target===n.id; }).map(function(e){ return e.source; });
  return [];
}
function statusOf(n){ var st = toolsOf(n).map(function(t){ return TOOL_STATUS[t]; }).filter(Boolean); if(!st.length) return n.type==='status' ? (n.id==='status:ok'?'ok':'broken') : ''; return st.indexOf('broken')>=0 ? 'broken' : 'ok'; }
function pagesOf(n){ if(n.type==='page') return [n.id]; return toolsOf(n).map(function(t){ return TOOL_PAGE[t]; }).filter(Boolean); }
// Filtros por tipo
var types = ['tool','selector','param','page','status'];
var names = { tool:'Herramientas', selector:'Selectores', param:'Parámetros', page:'Páginas', status:'Estados' };
document.getElementById('typeFilters').innerHTML = types.map(function(t){
  return '<label><input type="checkbox" checked data-type="'+t+'"> '+names[t]+'</label>';
}).join('');
var fragLevels = ['low','medium','high'];
document.getElementById('fragFilters').innerHTML = '<label><input type="radio" name="frag" value="" checked> Todos</label>' +
  fragLevels.map(function(l){ return '<label><input type="radio" name="frag" value="'+l+'"> Solo '+l+'</label>'; }).join('');
document.getElementById('statusFilters').innerHTML = [['','Todos'],['ok','Solo OK ✅'],['broken','Solo rotos ❌']].map(function(o){
  return '<label><input type="radio" name="status" value="'+o[0]+'"'+(o[0]===''?' checked':'')+'> '+o[1]+'</label>';
}).join('');
var pages = GRAPH.nodes.filter(function(n){ return n.type==='page'; });
document.getElementById('pageFilter').innerHTML = '<option value="">Todas las páginas</option>' +
  pages.map(function(p){ return '<option value="'+esc(p.id)+'">'+esc(p.label)+'</option>'; }).join('');
document.getElementById('frameworkFilter').innerHTML = '<option value="">Todos los frameworks</option>' +
  fwNames.map(function(f){ return '<option value="'+esc(f)+'">'+esc(f)+' ('+FW[f]+')</option>'; }).join('');
function applyFilters(){
  var visible = {};
  types.forEach(function(t){ visible[t] = document.querySelector('input[data-type="'+t+'"]').checked; });
  var frag = document.querySelector('input[name="frag"]:checked').value;
  var status = document.querySelector('input[name="status"]:checked').value;
  var page = document.getElementById('pageFilter').value;
  var fw = document.getElementById('frameworkFilter').value;
  cy.nodes().forEach(function(n){
    var d = n.data('full'); var show = visible[d.type];
    var f = d.metadata && d.metadata.fragility;
    if(show && frag && d.type==='selector') show = !!(f && f.level===frag);
    if(show && fw && d.type==='selector') show = !!(f && (f.frameworks||[]).indexOf(fw)>=0);
    if(show && status && d.type!=='page'){ var st = statusOf(d); show = st==='' ? false : st===status; }
    if(show && page && d.type!=='status'){ show = pagesOf(d).indexOf(page)>=0; }
    n.style('display', show ? 'element' : 'none');
  });
}
document.querySelectorAll('#typeFilters input, #fragFilters input, #statusFilters input, #pageFilter, #frameworkFilter').forEach(function(i){ i.addEventListener('change', applyFilters); });
// Panel de metadatos + resaltado de vecinos
cy.on('tap','node',function(evt){
  var d = evt.target.data('full');
  document.getElementById('meta').textContent = JSON.stringify(d, null, 2);
  cy.elements().addClass('faded');
  evt.target.closedNeighborhood().removeClass('faded');
});
cy.on('tap',function(evt){ if(evt.target===cy){ cy.elements().removeClass('faded'); document.getElementById('meta').textContent='Haz clic en un nodo…'; } });
// Exportación
document.getElementById('exportJson').addEventListener('click',function(){
  var a=document.createElement('a'); a.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(GRAPH,null,2)); a.download='webmcp-graph.json'; a.click();
});
document.getElementById('exportPng').addEventListener('click',function(){
  var a=document.createElement('a'); a.href=cy.png({ full:true, scale:2, bg:'#0f172a' }); a.download='webmcp-graph.png'; a.click();
});
// SVG: se construye a partir de las posiciones actuales del layout (sin extensiones de Cytoscape).
function buildSvg(){
  var bb = cy.elements(':visible').boundingBox(); var pad = 40;
  var w = Math.max(200, bb.w + pad*2), h = Math.max(200, bb.h + pad*2);
  var tx = function(x){ return (x - bb.x1 + pad).toFixed(1); }, ty = function(y){ return (y - bb.y1 + pad).toFixed(1); };
  var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" font-family="system-ui, sans-serif">', '<rect width="100%" height="100%" fill="#0f172a"/>'];
  cy.edges(':visible').forEach(function(e){
    if(e.source().style('display')==='none' || e.target().style('display')==='none') return;
    var s = e.source().position(), t = e.target().position(); var type = e.data('type');
    out.push('<line x1="'+tx(s.x)+'" y1="'+ty(s.y)+'" x2="'+tx(t.x)+'" y2="'+ty(t.y)+'" stroke="'+(type==='shares-selector'?'#eab308':'#64748b')+'" stroke-width="1.2" opacity="0.7"'+(type==='has-status'?' stroke-dasharray="4 3"':'')+'/>');
  });
  cy.nodes(':visible').forEach(function(n){
    if(n.style('display')==='none') return;
    var d = n.data('full'); var p = n.position(); var r = d.type==='tool' ? 14 : 9;
    out.push('<circle cx="'+tx(p.x)+'" cy="'+ty(p.y)+'" r="'+r+'" fill="'+nodeColor(d)+'" stroke="#0f172a" stroke-width="1.5"><title>'+esc(d.label)+'</title></circle>');
    out.push('<text x="'+tx(p.x)+'" y="'+(parseFloat(ty(p.y))+r+11).toFixed(1)+'" font-size="9" text-anchor="middle" fill="#e2e8f0">'+esc(n.data('label'))+'</text>');
  });
  out.push('</svg>');
  return out.join('\\n');
}
document.getElementById('exportSvg').addEventListener('click',function(){
  var a=document.createElement('a'); a.href='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(buildSvg()); a.download='webmcp-graph.svg'; a.click();
});
</script>
</body>
</html>
`;
}

/**
 * Sirve el dashboard del grafo en un mini servidor HTTP.
 *
 * Rutas: `GET /` (HTML autónomo), `GET /api/graph` (JSON del grafo) y
 * `GET /api/graph.svg` (SVG estático).
 *
 * @param graph Grafo a servir.
 * @param port Puerto de escucha (def. 3100).
 * @param host Host de escucha (def. 0.0.0.0).
 * @returns El servidor ya escuchando.
 */
export function serveGraphDashboard(
  graph: Graph,
  port = 3100,
  host = '0.0.0.0',
): Promise<http.Server> {
  const html = buildGraphHtml(graph);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/api/graph') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(graph));
      return;
    }
    if (url.pathname === '/api/graph.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
      res.end(buildGraphSvg(graph));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}
