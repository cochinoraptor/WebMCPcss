/* Generado por WebMCPcss (webmcpcss generate --api) - https://github.com/cochinoraptor/WebMCPcss */
/*
 * Ejemplo de uso (desde un agente):
 *
 *   const result = await document.modelContext.executeTool?.("buscarProductos", {...});
 *   // o deja que el agente del navegador descubra las herramientas registradas.
 */
(function () {
  'use strict';
  // Estándar WebMCP: document.modelContext (canónico); navigator.modelContext es el alias obsoleto (Chrome < 150).
  const mc = ((typeof document !== 'undefined' && document.modelContext) || (typeof navigator !== 'undefined' && navigator.modelContext) || undefined);
  if (!mc || typeof mc.registerTool !== 'function') {
    console.warn('[WebMCPcss] document.modelContext no está disponible (Chrome 146+ con WebMCP activado); las herramientas no se registraron.');
    return;
  }
  mc.registerTool({
    name: "buscarProductos",
    description: "Busca productos en el catálogo",
    inputSchema: {"type":"object","properties":{"query":{"type":"string","description":"Valor para el campo #q"}},"required":["query"]},
    async execute(args) {
      const el = document.querySelector("#search-btn");
      if (!el) throw new Error('Elemento no encontrado: ' + "#search-btn");
      const out = {};
      if (args && args["query"] !== undefined) {
        const input = document.querySelector("#q");
        if (!input) throw new Error('Campo no encontrado: ' + "#q");
        input.value = String(args["query"]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        out["query"] = args["query"];
      }
      document.querySelector("#search-btn")?.click();
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    },
  });

  mc.registerTool({
    name: "anadirAlCarrito",
    description: "Añade el producto actual al carrito",
    inputSchema: {"type":"object","properties":{"cantidad":{"type":"string","description":"Valor para el campo #qty"}},"required":["cantidad"]},
    async execute(args) {
      const el = document.querySelector("#add-to-cart");
      if (!el) throw new Error('Elemento no encontrado: ' + "#add-to-cart");
      const out = {};
      if (args && args["cantidad"] !== undefined) {
        const input = document.querySelector("#qty");
        if (!input) throw new Error('Campo no encontrado: ' + "#qty");
        input.value = String(args["cantidad"]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        out["cantidad"] = args["cantidad"];
      }
      document.querySelector("#add-to-cart")?.click();
      out.confirmed = !!document.querySelector(".cart-count");
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    },
  });

  mc.registerTool({
    name: "pagarPedido",
    description: "Paga el pedido del carrito",
    inputSchema: {"type":"object","properties":{},"required":[]},
    async execute(args) {
      const el = document.querySelector("#checkout");
      if (!el) throw new Error('Elemento no encontrado: ' + "#checkout");
      const out = {};
      document.querySelector("#checkout")?.click();
      out.confirmed = !!document.querySelector("#order-ok");
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    },
  });

  mc.registerTool({
    name: "descargarInforme",
    description: "Descarga el informe premium de ventas (de pago)",
    inputSchema: {"type":"object","properties":{},"required":[]},
    async execute(args) {
      const el = document.querySelector("#report");
      if (!el) throw new Error('Elemento no encontrado: ' + "#report");
      const out = {};
      document.querySelector("#report")?.click();
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    },
  });

  mc.registerTool({
    name: "enviarConsulta",
    description: "Envía una consulta al soporte",
    inputSchema: {"type":"object","properties":{"email":{"type":"string","description":"Valor para el campo #c-email"},"mensaje":{"type":"string","description":"Valor para el campo #c-msg"}},"required":["email","mensaje"]},
    async execute(args) {
      const el = document.querySelector("#contact-form button[type=\"submit\"]");
      if (!el) throw new Error('Elemento no encontrado: ' + "#contact-form button[type=\"submit\"]");
      const out = {};
      if (args && args["email"] !== undefined) {
        const input = document.querySelector("#c-email");
        if (!input) throw new Error('Campo no encontrado: ' + "#c-email");
        input.value = String(args["email"]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        out["email"] = args["email"];
      }
      if (args && args["mensaje"] !== undefined) {
        const input = document.querySelector("#c-msg");
        if (!input) throw new Error('Campo no encontrado: ' + "#c-msg");
        input.value = String(args["mensaje"]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        out["mensaje"] = args["mensaje"];
      }
      document.querySelector("#contact-form button[type=\"submit\"]")?.click();
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    },
  });
  console.info('[WebMCPcss] 5 herramienta(s) WebMCP registradas.');
})();