/**
 * Doc-MCP (v1.0.0): documentación interactiva generada desde `.webmcp.css`.
 *
 * Formatos:
 * - **HTML** autocontenido (búsqueda, filtros, ejemplos de invocación por
 *   agente, copia al portapapeles; sin CDN ni dependencias).
 * - **Markdown** (una página, apta para README/wiki/Obsidian).
 * - **JSON** (modelo de documentación, consumible por otras herramientas).
 * - **Agentes**: `llms.txt` + `AGENTS.md` (formato de descubrimiento para
 *   modelos de lenguaje) con instrucciones de uso.
 */
import { analyzeFragility } from '../graph/fragility';
import type { ParamSpec, ToolMap, ToolSpec } from '../types';
import { VERSION } from '../version';

/** Opciones de generación. */
export interface DocOptions {
  /** Título del sitio/documentación. */
  title?: string;
  /** URL del sitio (para ejemplos). */
  url?: string;
  /** Ruta del `.webmcp.css` (para ejemplos de CLI). */
  cssPath?: string;
  /** Incluir análisis de fragilidad (def. true). */
  fragility?: boolean;
}

/** Documentación de un parámetro. */
export interface DocParam {
  name: string;
  source: ParamSpec['source'];
  selector?: string;
  value?: string;
  description: string;
}

/** Documentación de una herramienta. */
export interface DocTool {
  name: string;
  description: string;
  selector: string;
  params: DocParam[];
  trigger: string;
  confirmation?: string;
  intent?: string;
  permissions?: string;
  payment?: { required: boolean; network?: string; amount?: string };
  fragility?: { level: string; framework?: string };
  examples: { cli: string; mcp: Record<string, unknown>; rest: string; prompt: string };
}

/** Documentación de un dato de contexto. */
export interface DocContext {
  name: string;
  selector: string;
  format: string;
  description: string;
}

/** Modelo completo de documentación. */
export interface DocModel {
  title: string;
  url?: string;
  cssPath?: string;
  generatedBy: string;
  generatedAt: string;
  tools: DocTool[];
  context: DocContext[];
  stats: {
    tools: number;
    context: number;
    params: number;
    withConfirmation: number;
    fragile: number;
  };
}

/** Describe un parámetro en lenguaje natural. */
function describeParam(name: string, spec: ParamSpec): string {
  switch (spec.source) {
    case 'value':
      return spec.selector
        ? `Valor del campo \`${spec.selector}\``
        : 'Valor del propio elemento';
    case 'attr':
      return `Atributo \`${spec.value ?? ''}\` del elemento`;
    case 'text':
      return spec.selector ? `Texto de \`${spec.selector}\`` : 'Texto del elemento';
    case 'literal':
      return `Valor fijo \`${spec.value ?? ''}\``;
    default:
      return name;
  }
}

/** Construye los ejemplos de invocación de una herramienta. */
function buildExamples(
  name: string,
  tool: ToolSpec,
  opts: DocOptions,
): DocTool['examples'] {
  const args: Record<string, string> = {};
  for (const p of Object.keys(tool.params)) args[p] = `<${p}>`;
  const url = opts.url ?? 'https://mi-sitio.com';
  const css = opts.cssPath ?? 'webmcp.css';
  const argJson = JSON.stringify(args);
  return {
    cli: `webmcpcss run ${url} ${css} ${name}${Object.keys(args).length ? ` --args '${argJson}'` : ''}`,
    mcp: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    rest: `curl -X POST http://localhost:8090/api/tools/${name} -H 'content-type: application/json' -d '${argJson}'`,
    prompt: tool.description
      ? `webmcpcss prompt "${tool.description}" --url ${url} --css ${css}`
      : `webmcpcss prompt "ejecuta ${name}" --url ${url} --css ${css}`,
  };
}

/**
 * Construye el modelo de documentación a partir de un tool map.
 * @param map Tool map parseado.
 * @param opts Opciones.
 */
export function buildDocModel(map: ToolMap, opts: DocOptions = {}): DocModel {
  const withFragility = opts.fragility !== false;
  const tools: DocTool[] = Object.entries(map.tools).map(([name, tool]) => {
    const meta = tool.meta ?? {};
    const frag = withFragility ? analyzeFragility(tool.selector) : undefined;
    return {
      name,
      description: tool.description ?? `Herramienta ${name}`,
      selector: tool.selector,
      params: Object.entries(tool.params).map(([pName, spec]) => ({
        name: pName,
        source: spec.source,
        selector: spec.selector,
        value: spec.value,
        description: describeParam(pName, spec),
      })),
      trigger: tool.trigger
        ? `${tool.trigger.event}${tool.trigger.selector ? ` on ${tool.trigger.selector}` : ''}`
        : 'click',
      confirmation: tool.confirmation ?? meta.confirmation,
      intent: meta.intent,
      permissions: meta.permissions,
      payment: meta.payment
        ? {
            required: meta.payment === 'required',
            network: meta.network,
            amount: meta.amount,
          }
        : undefined,
      fragility: frag ? { level: frag.level, framework: frag.framework } : undefined,
      examples: buildExamples(name, tool, opts),
    };
  });
  const context: DocContext[] = Object.entries(map.context).map(([name, ctx]) => ({
    name,
    selector: ctx.selector,
    format: ctx.format ?? 'text',
    description: `Lee \`${ctx.selector}\` como ${ctx.format ?? 'texto'}`,
  }));
  return {
    title: opts.title ?? 'Documentación WebMCP',
    url: opts.url,
    cssPath: opts.cssPath,
    generatedBy: `webmcpcss@${VERSION}`,
    generatedAt: new Date().toISOString(),
    tools,
    context,
    stats: {
      tools: tools.length,
      context: context.length,
      params: tools.reduce((n, t) => n + t.params.length, 0),
      withConfirmation: tools.filter((t) => t.confirmation && t.confirmation !== 'none')
        .length,
      fragile: tools.filter((t) => t.fragility?.level === 'high').length,
    },
  };
}

/** Escapa HTML. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Genera la documentación en Markdown.
 * @param model Modelo de documentación.
 */
export function renderMarkdown(model: DocModel): string {
  const lines: string[] = [
    `# ${model.title}`,
    '',
    `> Generado por ${model.generatedBy} · ${model.stats.tools} herramientas · ${model.stats.context} datos de contexto${model.url ? ` · ${model.url}` : ''}`,
    '',
    '## Herramientas',
    '',
    '| Herramienta | Descripción | Parámetros | Confirmación | Intención |',
    '| --- | --- | --- | --- | --- |',
    ...model.tools.map(
      (t) =>
        `| [\`${t.name}\`](#${t.name.toLowerCase()}) | ${t.description} | ${t.params.map((p) => `\`${p.name}\``).join(', ') || '—'} | ${t.confirmation ?? '—'} | ${t.intent ?? '—'} |`,
    ),
    '',
  ];
  for (const t of model.tools) {
    lines.push(
      `### ${t.name}`,
      '',
      t.description,
      '',
      `- **Selector:** \`${t.selector}\``,
      `- **Disparador:** \`${t.trigger}\``,
    );
    if (t.confirmation) lines.push(`- **Confirmación:** \`${t.confirmation}\``);
    if (t.permissions) lines.push(`- **Permisos:** \`${t.permissions}\``);
    if (t.payment)
      lines.push(
        `- **Pago:** ${t.payment.required ? 'requerido' : 'opcional'}${t.payment.amount ? ` · ${t.payment.amount}` : ''}${t.payment.network ? ` (${t.payment.network})` : ''}`,
      );
    if (t.fragility)
      lines.push(
        `- **Fragilidad:** ${t.fragility.level}${t.fragility.framework ? ` (${t.fragility.framework})` : ''}`,
      );
    if (t.params.length) {
      lines.push('', '| Parámetro | Origen | Descripción |', '| --- | --- | --- |');
      for (const p of t.params)
        lines.push(`| \`${p.name}\` | ${p.source} | ${p.description} |`);
    }
    lines.push(
      '',
      '```bash',
      t.examples.cli,
      '```',
      '',
      '```json',
      JSON.stringify(t.examples.mcp, null, 2),
      '```',
      '',
    );
  }
  if (model.context.length) {
    lines.push(
      '## Contexto (solo lectura)',
      '',
      '| Dato | Selector | Formato |',
      '| --- | --- | --- |',
    );
    for (const c of model.context)
      lines.push(`| \`${c.name}\` | \`${c.selector}\` | ${c.format} |`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Genera `llms.txt` (descubrimiento para modelos) a partir del modelo.
 * @param model Modelo de documentación.
 */
export function renderLlmsTxt(model: DocModel): string {
  const lines = [
    `# ${model.title}`,
    '',
    `> Sitio con herramientas WebMCP declaradas en ${model.cssPath ?? 'webmcp.css'}. Los agentes pueden ejecutarlas con \`webmcpcss run\`, el servidor MCP (\`webmcpcss mcp --serve\`) o la API REST.`,
    '',
    '## Herramientas',
    '',
    ...model.tools.map(
      (t) =>
        `- ${t.name}: ${t.description}${t.params.length ? ` (params: ${t.params.map((p) => p.name).join(', ')})` : ''}${t.confirmation && t.confirmation !== 'none' ? ' [requiere confirmación]' : ''}${t.payment?.required ? ` [pago: ${t.payment.amount ?? ''} ${t.payment.network ?? ''}]`.replace(/\s+\]/, ']') : ''}`,
    ),
  ];
  if (model.context.length) {
    lines.push(
      '',
      '## Contexto',
      '',
      ...model.context.map((c) => `- ${c.name}: ${c.description}`),
    );
  }
  lines.push(
    '',
    '## Uso',
    '',
    `- MCP: webmcpcss mcp --serve --css ${model.cssPath ?? 'webmcp.css'}${model.url ? ` --url ${model.url}` : ''}`,
    `- Lenguaje natural: webmcpcss prompt "<orden>"${model.url ? ` --url ${model.url}` : ''}`,
    '',
  );
  return lines.join('\n');
}

/**
 * Genera `AGENTS.md` del sitio: instrucciones operativas para agentes.
 * @param model Modelo de documentación.
 */
export function renderAgentsMd(model: DocModel): string {
  return [
    `# AGENTS.md — ${model.title}`,
    '',
    'Instrucciones para agentes de IA que operan este sitio mediante WebMCP.',
    '',
    '## Reglas',
    '',
    '1. Usa siempre las herramientas declaradas; no infieras selectores del DOM.',
    '2. Las herramientas marcadas «requiere confirmación» necesitan aprobación humana antes de ejecutarse.',
    '3. Las herramientas con pago declaran red e importe; respeta los límites de gasto configurados.',
    '4. Lee el contexto antes de actuar (precios, totales, estados).',
    '',
    '## Herramientas',
    '',
    ...model.tools.map((t) =>
      [
        `### ${t.name}`,
        t.description,
        `- Parámetros: ${t.params.map((p) => `\`${p.name}\` (${p.description})`).join('; ') || 'ninguno'}`,
        `- Confirmación: ${t.confirmation ?? 'no'}`,
        t.permissions ? `- Permisos: ${t.permissions}` : '',
        t.payment
          ? `- Pago: ${t.payment.required ? 'requerido' : 'opcional'} ${t.payment.amount ?? ''} ${t.payment.network ?? ''}`.trimEnd()
          : '',
        '',
      ]
        .filter((l) => l !== '')
        .join('\n'),
    ),
    '## Contexto',
    '',
    ...(model.context.length
      ? model.context.map((c) => `- \`${c.name}\` — ${c.description}`)
      : ['_Sin datos de contexto._']),
    '',
  ].join('\n');
}

/**
 * Genera la documentación HTML interactiva (autocontenida, sin red).
 * @param model Modelo de documentación.
 */
export function renderHtml(model: DocModel): string {
  const data = JSON.stringify(model).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(model.title)}</title>
<style>
:root{--bg:#0f172a;--panel:#1e293b;--fg:#e2e8f0;--muted:#94a3b8;--accent:#38bdf8;--ok:#22c55e;--warn:#f59e0b;--bad:#ef4444}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:1.2rem 1.5rem;border-bottom:1px solid #334155;display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
header h1{margin:0;font-size:1.2rem}header .stats{color:var(--muted);font-size:.85rem}
main{display:grid;grid-template-columns:260px 1fr;min-height:calc(100vh - 70px)}
nav{border-right:1px solid #334155;padding:1rem;overflow:auto}
nav input,nav select{width:100%;padding:.5rem;margin-bottom:.6rem;background:var(--panel);color:var(--fg);border:1px solid #334155;border-radius:6px}
nav a{display:block;padding:.35rem .5rem;color:var(--fg);text-decoration:none;border-radius:6px;font-size:.9rem}
nav a:hover,nav a.active{background:var(--panel)}
section{padding:1.5rem;max-width:960px}
article{background:var(--panel);border-radius:10px;padding:1.2rem;margin-bottom:1.2rem}
article h2{margin:0 0 .3rem;font-size:1.1rem}code,pre{font-family:ui-monospace,monospace;font-size:.85rem}
pre{background:#0b1220;padding:.8rem;border-radius:8px;overflow:auto;position:relative}
.badge{display:inline-block;padding:.1rem .5rem;border-radius:999px;font-size:.75rem;margin-right:.3rem;background:#334155}
.badge.low{background:#14532d}.badge.medium{background:#713f12}.badge.high{background:#7f1d1d}.badge.confirm{background:#4c1d95}.badge.pay{background:#1e3a8a}
table{width:100%;border-collapse:collapse;margin:.6rem 0}td,th{text-align:left;padding:.35rem;border-bottom:1px solid #334155;font-size:.85rem}
.tabs button{background:transparent;color:var(--muted);border:0;padding:.4rem .7rem;cursor:pointer;border-bottom:2px solid transparent}
.tabs button.active{color:var(--accent);border-color:var(--accent)}
.copy{position:absolute;top:.4rem;right:.4rem;background:#334155;color:var(--fg);border:0;border-radius:4px;padding:.2rem .5rem;cursor:pointer;font-size:.7rem}
.muted{color:var(--muted)}.hidden{display:none}
@media (max-width:760px){main{grid-template-columns:1fr}nav{border-right:0;border-bottom:1px solid #334155}}
</style>
</head>
<body>
<header><h1>${esc(model.title)}</h1><span class="stats">${model.stats.tools} herramientas · ${model.stats.context} contexto · ${model.stats.params} parámetros · ${model.stats.withConfirmation} con confirmación${model.url ? ` · <a href="${esc(model.url)}" style="color:var(--accent)">${esc(model.url)}</a>` : ''}</span></header>
<main>
<nav>
<input id="q" type="search" placeholder="Buscar herramienta, parámetro, selector…" aria-label="Buscar">
<select id="filter" aria-label="Filtro"><option value="">Todas</option><option value="confirm">Con confirmación</option><option value="params">Con parámetros</option><option value="pay">Con pago</option><option value="fragile">Frágiles</option></select>
<div id="list"></div>
</nav>
<section id="content"></section>
</main>
<script>
const MODEL=${data};
const list=document.getElementById('list'),content=document.getElementById('content'),q=document.getElementById('q'),filter=document.getElementById('filter');
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function matches(t,term,f){
  const hay=(t.name+' '+t.description+' '+t.selector+' '+t.params.map(p=>p.name).join(' ')).toLowerCase();
  if(term&&!hay.includes(term))return false;
  if(f==='confirm')return t.confirmation&&t.confirmation!=='none';
  if(f==='params')return t.params.length>0;
  if(f==='pay')return !!t.payment;
  if(f==='fragile')return t.fragility&&t.fragility.level==='high';
  return true;
}
function render(){
  const term=q.value.trim().toLowerCase(),f=filter.value;
  const tools=MODEL.tools.filter(t=>matches(t,term,f));
  list.innerHTML=tools.map(t=>'<a href="#'+t.name+'">'+esc(t.name)+'</a>').join('')+(MODEL.context.length?'<hr><a href="#contexto">Contexto ('+MODEL.context.length+')</a>':'');
  content.innerHTML=tools.map(t=>\`<article id="\${esc(t.name)}">
    <h2><code>\${esc(t.name)}</code></h2>
    <div>\${t.intent?'<span class="badge">'+esc(t.intent)+'</span>':''}\${t.confirmation&&t.confirmation!=='none'?'<span class="badge confirm">confirmación: '+esc(t.confirmation)+'</span>':''}\${t.payment?'<span class="badge pay">pago '+esc(t.payment.amount||'')+' '+esc(t.payment.network||'')+'</span>':''}\${t.fragility?'<span class="badge '+t.fragility.level+'">fragilidad '+t.fragility.level+(t.fragility.framework?' · '+esc(t.fragility.framework):'')+'</span>':''}\${t.permissions?'<span class="badge">permisos: '+esc(t.permissions)+'</span>':''}</div>
    <p>\${esc(t.description)}</p>
    <p class="muted">Selector <code>\${esc(t.selector)}</code> · disparador <code>\${esc(t.trigger)}</code></p>
    \${t.params.length?'<table><tr><th>Parámetro</th><th>Origen</th><th>Descripción</th></tr>'+t.params.map(p=>'<tr><td><code>'+esc(p.name)+'</code></td><td>'+esc(p.source)+'</td><td>'+esc(p.description)+'</td></tr>').join('')+'</table>':''}
    <div class="tabs" data-tool="\${esc(t.name)}"><button class="active" data-tab="cli">CLI</button><button data-tab="mcp">MCP</button><button data-tab="rest">REST</button><button data-tab="prompt">Prompt</button></div>
    <pre data-tab-content="cli"><button class="copy">copiar</button>\${esc(t.examples.cli)}</pre>
    <pre data-tab-content="mcp" class="hidden"><button class="copy">copiar</button>\${esc(JSON.stringify(t.examples.mcp,null,2))}</pre>
    <pre data-tab-content="rest" class="hidden"><button class="copy">copiar</button>\${esc(t.examples.rest)}</pre>
    <pre data-tab-content="prompt" class="hidden"><button class="copy">copiar</button>\${esc(t.examples.prompt)}</pre>
  </article>\`).join('')+(MODEL.context.length?'<article id="contexto"><h2>Contexto (solo lectura)</h2><table><tr><th>Dato</th><th>Selector</th><th>Formato</th></tr>'+MODEL.context.map(c=>'<tr><td><code>'+esc(c.name)+'</code></td><td><code>'+esc(c.selector)+'</code></td><td>'+esc(c.format)+'</td></tr>').join('')+'</table></article>':'')||'<p class="muted">Sin resultados.</p>';
}
content.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.classList.contains('copy')){navigator.clipboard&&navigator.clipboard.writeText(b.parentElement.textContent.replace(/^copiar/,'').trim());b.textContent='copiado';setTimeout(()=>b.textContent='copiar',1200);return;}
  if(b.dataset.tab){const art=b.closest('article');art.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x===b));art.querySelectorAll('[data-tab-content]').forEach(p=>p.classList.toggle('hidden',p.dataset.tabContent!==b.dataset.tab));}
});
q.addEventListener('input',render);filter.addEventListener('change',render);render();
</script>
</body>
</html>
`;
}

/** Archivos generados por `generateDocs`. */
export interface GeneratedDocs {
  'index.html': string;
  'README.md': string;
  'doc.json': string;
  'llms.txt': string;
  'AGENTS.md': string;
}

/**
 * Genera todos los formatos de documentación de una vez.
 * @param map Tool map.
 * @param opts Opciones.
 */
export function generateDocs(map: ToolMap, opts: DocOptions = {}): GeneratedDocs {
  const model = buildDocModel(map, opts);
  return {
    'index.html': renderHtml(model),
    'README.md': renderMarkdown(model),
    'doc.json': JSON.stringify(model, null, 2) + '\n',
    'llms.txt': renderLlmsTxt(model),
    'AGENTS.md': renderAgentsMd(model),
  };
}
