# LangGraph / LangChain

```bash
webmcpcss export tienda.webmcp.css --format langgraph -o ./lg --url https://tienda.com
```

Genera:

- **`webmcp_langgraph.py`** — una función `@tool` (de `langchain_core.tools`)
  por herramienta + la lista `TOOLS`.
- **`webmcp_graph.json`** — los nodos del grafo con sus esquemas (útil para
  construir StateGraphs personalizados).

```python
from langgraph.prebuilt import create_react_agent
from webmcp_langgraph import TOOLS

agent = create_react_agent("openai:gpt-4o", TOOLS)
agent.invoke({"messages": [("user", "Añade 2 unidades al carrito")]})
```

Con LangChain clásico: `AgentExecutor` acepta la misma lista `TOOLS`.

Ejemplo generado: [`examples/agents/langgraph/`](../../examples/agents/langgraph/).
