# CrewAI

```bash
webmcpcss export tienda.webmcp.css --format crewai -o ./crew --url https://tienda.com
```

Genera `crew/webmcp_tools.py` con una función `@tool` por herramienta
(nombres en `snake_case`) y la lista `ALL_TOOLS`:

```python
from crewai import Agent, Crew, Task
from webmcp_tools import ALL_TOOLS, add_to_cart

shopper = Agent(
    role="Comprador",
    goal="Añadir productos al carrito",
    backstory="Agente de compras automatizado",
    tools=ALL_TOOLS,
)

task = Task(description="Añade 2 unidades al carrito", agent=shopper, expected_output="JSON")
Crew(agents=[shopper], tasks=[task]).kickoff()

# O directamente, sin LLM:
print(add_to_cart(quantity="2"))
```

Cada función ejecuta `webmcpcss run <url> <css> <tool> --args JSON` en un
subproceso y devuelve el JSON del resultado — el navegador, la validación y
la auto-reparación quedan del lado de WebMCPcss.

Requisitos: Node 18+ con `npm i -g webmcpcss`; el módulo funciona incluso sin
`crewai` instalado (el decorador se degrada a no-op para poder probarlo).

Ejemplo generado: [`examples/agents/crewai/`](../../examples/agents/crewai/).
