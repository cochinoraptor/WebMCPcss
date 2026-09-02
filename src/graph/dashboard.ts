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
import type { Graph } from './types';

/**
 * Construye el HTML autónomo del dashboard del grafo.
 *
 * Colores por tipo: herramienta=azul, selector=verde, página=naranja,
 * estado=rojo/verde, parámetro=gris. Incluye panel lateral de metadatos,
 * filtros por tipo/estado/fragilidad, estadísticas y exportación JSON/PNG.
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
  <h2>Filtros por tipo</h2><div id="typeFilters"></div>
  <h2>Filtro por fragilidad</h2><div id="fragFilters"></div>
  <h2>Nodo seleccionado</h2><div id="meta">Haz clic en un nodo…</div>
  <h2>Exportar</h2>
  <button id="exportJson">JSON</button>
  <button id="exportPng">PNG</button>
</aside>
<script>
var GRAPH = ${json};
var COLORS = { tool:'#3b82f6', selector:'#22c55e', page:'#f97316', param:'#a855f7', status:'#ef4444' };
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
document.getElementById('stats').innerHTML = stats.map(function(s){ return '<div class="stat"><span>'+s[0]+'</span><b>'+(s[1]==null?'—':s[1])+'</b></div>'; }).join('');
// Filtros por tipo
var types = ['tool','selector','param','page','status'];
var names = { tool:'Herramientas', selector:'Selectores', param:'Parámetros', page:'Páginas', status:'Estados' };
document.getElementById('typeFilters').innerHTML = types.map(function(t){
  return '<label><input type="checkbox" checked data-type="'+t+'"> '+names[t]+'</label>';
}).join('');
var fragLevels = ['low','medium','high'];
document.getElementById('fragFilters').innerHTML = '<label><input type="radio" name="frag" value="" checked> Todos</label>' +
  fragLevels.map(function(l){ return '<label><input type="radio" name="frag" value="'+l+'"> Solo '+l+'</label>'; }).join('');
function applyFilters(){
  var visible = {};
  types.forEach(function(t){ visible[t] = document.querySelector('input[data-type="'+t+'"]').checked; });
  var frag = document.querySelector('input[name="frag"]:checked').value;
  cy.nodes().forEach(function(n){
    var d = n.data('full'); var show = visible[d.type];
    if(show && frag && d.type==='selector'){
      var f = d.metadata && d.metadata.fragility; show = !!(f && f.level===frag);
    }
    n.style('display', show ? 'element' : 'none');
  });
}
document.querySelectorAll('#typeFilters input, #fragFilters input').forEach(function(i){ i.addEventListener('change', applyFilters); });
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
</script>
</body>
</html>
`;
}

/**
 * Sirve el dashboard del grafo en un mini servidor HTTP.
 *
 * Rutas: `GET /` (HTML autónomo) y `GET /api/graph` (JSON del grafo).
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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}
