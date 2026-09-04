# DeerFlow (ByteDance)

[DeerFlow](https://github.com/bytedance/deer-flow) es un _SuperAgent_ open
source (LangGraph) con herramientas Python configurables en `config.yaml`,
servidores MCP en `extensions_config.json` y _skills_ de carga progresiva.
WebMCPcss genera las tres piezas:

```bash
webmcpcss export tienda.webmcp.css --format deerflow -o ./deerflow --url https://tienda.com
```

```
deerflow/
├── webmcp_tools.py                 # herramientas @tool del grupo browser
├── deerflow-tools.yaml             # fragmento de config.yaml
├── extensions_config.json          # servidor MCP webmcpcss + skill habilitada
├── skills/webmcp-browser/SKILL.md  # skill (frontmatter + flujo recomendado)
└── README.md
```

## A) Herramientas Python del grupo `browser`

| Herramienta                 | Qué hace                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `browser_get_webmcp_graph`  | Devuelve el grafo WebMCP (herramientas, selectores, params, contexto). Con `live=True` añade `status` por herramienta. |
| `browser_validate_selector` | ¿Existe el selector en la página? + nivel de fragilidad                                                                |
| `browser_repair_selector`   | Propone (o aplica con `apply=True`) la reparación de una herramienta rota                                              |
| `browser_prompt`            | Orden en lenguaje natural; dry-run salvo `execute=True`                                                                |
| `browser_animate`           | Animaciones declarativas; `dry_run=True` devuelve plan y conflictos                                                    |

Todas devuelven un **mensaje estructurado** JSON con `type`
(`webmcp_graph`, `webmcp_selector`, `webmcp_repair`, `webmcp_prompt`,
`webmcp_animation`). El grafo se incrusta en el módulo en el momento de
exportar, así que `browser_get_webmcp_graph` responde sin navegador y el
agente líder puede **reenviarlo a sus sub-agentes** en vez de que cada uno
escanee la página.

Instalación:

1. Copia `webmcp_tools.py` a `backend/` de DeerFlow (o a cualquier ruta del
   `PYTHONPATH`).
2. Fusiona `deerflow-tools.yaml` en `config.yaml`:

   ```yaml
   tool_groups:
     - name: browser
   tools:
     - name: browser_get_webmcp_graph
       group: browser
       use: webmcp_tools:browser_get_webmcp_graph
     # … (las cinco)
   ```

3. Variables de entorno del backend/sandbox: `WEBMCP_CSS`, `WEBMCP_URL`
   (opcional `WEBMCPCSS_BIN`, `WEBMCP_TIMEOUT`).
4. `npm i -g webmcpcss` en el sandbox (las herramientas llaman al CLI).

## B) Servidor MCP

`extensions_config.json` registra `webmcpcss mcp --serve` como servidor
stdio con _routing hints_ (`routing.mode: prefer`, palabras clave con los
nombres de tus herramientas) para que DeerFlow prefiera las herramientas
WebMCP en tareas de navegación. Las herramientas aparecen como
`webmcpcss_<nombre>` (prefijo automático de DeerFlow).

## Skill `webmcp-browser`

Copia `skills/webmcp-browser/` a `skills/custom/` (o súbela como `.skill`
por la API). La skill describe el flujo _descubre → actúa → repara →
prompt → anima_, las reglas de seguridad (confirmación humana para acciones
destructivas) y la lista de herramientas del sitio. Se carga solo cuando la
tarea toca el sitio (carga progresiva).

Ejemplo generado: [`examples/agents/deerflow/`](../../examples/agents/deerflow/).
