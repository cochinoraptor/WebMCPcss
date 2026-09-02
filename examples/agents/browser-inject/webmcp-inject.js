/**
 * WebMCPcss browser inject — expone window.__WEBMCP_GRAPH__ para agentes de
 * navegador (Atlas, Operator, Mariner...). Generado; no editar a mano.
 * Uso: page.evaluate(script) | chrome.debugger | userscript.
 */
(function () {
  'use strict';
  var GRAPH = {
    "source": "examples/shopping-cart/webmcp.css",
    "url": "https://tienda.example.com",
    "tools": [
      {
        "name": "addToCart",
        "description": "Añade el producto actual al carrito",
        "selector": "[data-product] .btn-add",
        "params": {
          "productId": {
            "type": "string",
            "description": "Atributo data-product-id del elemento"
          },
          "quantity": {
            "type": "string",
            "description": "Valor a escribir en #qty-input"
          }
        }
      },
      {
        "name": "applyCoupon",
        "description": "Aplica un cupón de descuento",
        "selector": ".coupon-form input[type=\"text\"]",
        "params": {
          "code": {
            "type": "string",
            "description": "Valor a escribir en el elemento"
          }
        }
      }
    ]
  };
  try {
    Object.defineProperty(window, '__WEBMCP_GRAPH__', { value: GRAPH, configurable: true });
  } catch (e) {
    window.__WEBMCP_GRAPH__ = GRAPH;
  }
  // Registro opcional en navigator.modelContext (estándar WebMCP).
  var mc = typeof navigator !== 'undefined' ? navigator.modelContext : undefined;
  if (mc && typeof mc.registerTool === 'function') {
    GRAPH.tools.forEach(function (t) {
      mc.registerTool({
        name: t.name,
        description: t.description,
        inputSchema: { type: 'object', properties: t.params },
        async execute(args) {
          var el = document.querySelector(t.selector);
          if (!el) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No existe ' + t.selector }) }] };
          Object.keys(args || {}).forEach(function (k) {
            var p = GRAPH.tools.filter(function (x) { return x.name === t.name; })[0].params[k];
            void p; // los params value(...) se rellenan por selector si está presente
          });
          el.click();
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, tool: t.name }) }] };
        },
      });
    });
  }
  console.log('[WebMCPcss] __WEBMCP_GRAPH__ con ' + GRAPH.tools.length + ' herramienta(s).');
})();
