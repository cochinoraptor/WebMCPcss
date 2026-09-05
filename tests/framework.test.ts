/**
 * Tests del IA-First Web Framework (v1.0.0): componentes, generador de
 * proyectos, asistente heurístico/LLM y validación de propiedades IA-First.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_CATALOG,
  IA_COMPONENTS,
  assist,
  initProject,
  parseAccessibility,
  planHeuristically,
  planWithLlm,
  renderComponent,
  toKebab,
  toToolName,
  validateIaFirst,
} from '../src/framework';
import { parseWebMCP, serializeToolMap } from '../src/parser';
import type { LlmClient } from '../src/prompt/types';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-fw-'));

describe('framework · utilidades', () => {
  it('toToolName / toKebab normalizan nombres', () => {
    expect(toToolName('Enviar mensaje de contacto')).toBe('enviarMensajeDeContacto');
    expect(toToolName('añadir al carrito')).toBe('anadirAlCarrito');
    expect(toKebab('sendContact')).toBe('send-contact');
    expect(toKebab('Añadir Al Carrito')).toBe('anadir-al-carrito');
  });

  it('parseAccessibility convierte "k: v; k2: v2" en objeto', () => {
    expect(parseAccessibility('aria-label: Enviar; role: button')).toEqual({
      'aria-label': 'Enviar',
      role: 'button',
    });
    expect(parseAccessibility('')).toEqual({});
  });

  it('el catálogo cubre los 6 componentes con intención y confirmación por defecto', () => {
    expect(IA_COMPONENTS).toEqual(['button', 'form', 'card', 'nav', 'hero', 'grid']);
    for (const name of IA_COMPONENTS) {
      expect(COMPONENT_CATALOG[name].className).toBe(`ia-${name}`);
      expect(['submit', 'cancel', 'navigate', 'action', 'read']).toContain(
        COMPONENT_CATALOG[name].intent,
      );
      expect(['needed', 'none']).toContain(COMPONENT_CATALOG[name].confirmation);
    }
  });
});

describe('framework · renderComponent', () => {
  it('IAForm declara webmcp-component/intent/confirmation/accessibility y parámetros por campo', () => {
    const r = renderComponent('form', {
      tool: 'sendContact',
      label: 'Enviar mensaje',
      description: 'Envía el formulario de contacto',
      fields: [
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'message', label: 'Mensaje', type: 'textarea' },
      ],
    });
    expect(r.html).toContain('data-tool="send-contact-submit"');
    expect(r.html).toContain('id="send-contact-email"');
    expect(r.html).toContain('<label for="send-contact-message"');
    const map = parseWebMCP(r.css);
    const tool = map.tools.sendContact;
    expect(tool).toBeDefined();
    expect(tool.meta).toMatchObject({
      component: 'form',
      intent: 'submit',
      confirmation: 'needed',
    });
    expect(tool.meta?.accessibility).toContain('aria-label');
    expect(tool.params.email).toEqual({
      source: 'value',
      selector: '#send-contact-email',
    });
    expect(tool.params.message.source).toBe('value');
    expect(tool.trigger?.event).toBe('submit');
    expect(tool.confirmation).toContain('data-confirmation');
  });

  it('IAButton, IACard, IANav, IAHero e IAGrid producen HTML y CSS válidos', () => {
    const button = renderComponent('button', {
      tool: 'buyNow',
      label: 'Comprar ahora',
      confirmation: 'needed',
    });
    expect(button.html).toMatch(/<button[^>]*data-tool="buy-now"/);
    expect(parseWebMCP(button.css).tools.buyNow.meta?.confirmation).toBe('needed');

    const nav = renderComponent('nav', {
      tool: 'mainNav',
      items: [
        { label: 'Inicio', href: '/' },
        { label: 'Productos', href: '/productos' },
      ],
    });
    const navMap = parseWebMCP(nav.css);
    expect(Object.keys(navMap.tools)).toEqual(['goInicio', 'goProductos']);
    expect(navMap.tools.goInicio.meta?.intent).toBe('navigate');
    expect(nav.html).toContain('<nav');

    const card = renderComponent('card', {
      tool: 'productA',
      label: 'Producto A',
      body: 'Descripción',
      items: [{ label: 'Añadir al carrito', tool: 'addToCart' }],
    });
    expect(card.html).toContain('ia-card');
    const cardMap = parseWebMCP(card.css);
    expect(Object.keys(cardMap.tools)).toContain('addToCart');
    expect(cardMap.context.productATitle.selector).toBe(
      '[data-context="product-a-title"]',
    );
    expect(cardMap.context.productATitle.meta?.component).toBe('card');
    // Una card sin acción solo declara contexto.
    expect(
      Object.keys(
        parseWebMCP(renderComponent('card', { tool: 'info', label: 'Info' }).css).tools,
      ),
    ).toEqual([]);

    const hero = renderComponent('hero', {
      tool: 'welcome',
      label: 'Bienvenido',
      body: 'Subtítulo',
      items: [{ label: 'Empezar a comprar', tool: 'startShopping' }],
    });
    expect(hero.html).toContain('<h1');
    expect(parseWebMCP(hero.css).tools.startShopping.meta?.intent).toBeDefined();
    // Sin CTA, el hero no declara acciones.
    expect(
      Object.keys(
        parseWebMCP(renderComponent('hero', { tool: 'w', label: 'Hola' }).css).tools,
      ),
    ).toEqual([]);

    const grid = renderComponent('grid', {
      tool: 'products',
      items: [
        { label: 'A', tool: 'addToCart' },
        { label: 'B', tool: 'addToCart' },
        { label: 'C' },
      ],
    });
    expect(grid.html.match(/data-item-index/g)?.length).toBe(3);
    const gridMap = parseWebMCP(grid.css);
    expect(gridMap.context.productsNames.selector).toBe('[data-context="products-name"]');
    expect(gridMap.tools.addToCart.params.index).toEqual({
      source: 'attr',
      value: 'data-item-index',
    });
  });

  it('escapa HTML en etiquetas y descripciones', () => {
    const r = renderComponent('button', {
      tool: 'x',
      label: '<script>alert(1)</script>',
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
  });
});

describe('framework · validateIaFirst', () => {
  it('no reporta problemas en componentes generados', () => {
    const r = renderComponent('form', {
      tool: 'login',
      fields: [{ name: 'email', label: 'Email', type: 'email' }],
    });
    expect(validateIaFirst(parseWebMCP(r.css))).toEqual([]);
  });

  it('detecta componentes/intenciones desconocidos, confirmación inválida y falta de accesibilidad', () => {
    const css = `
      #a { webmcp-tool: "a"; webmcp-component: "widget"; webmcp-intent: "fly"; webmcp-confirmation: "maybe"; }
      #b { webmcp-tool: "deleteAccount"; webmcp-description: "Elimina la cuenta"; webmcp-component: "button"; webmcp-intent: "action"; webmcp-confirmation: "none"; }
    `;
    const issues = validateIaFirst(parseWebMCP(css));
    const messages = issues.map((i) => `${i.tool}:${i.level}:${i.message}`).join('\n');
    expect(messages).toMatch(/a:error:.*component/i);
    expect(messages).toMatch(/a:error:.*intent/i);
    expect(messages).toMatch(/a:.*accessibility/i);
    expect(messages).toMatch(/deleteAccount:.*accessib/i);
    const badConfirmation = validateIaFirst(
      parseWebMCP(
        '#c { webmcp-tool: "c"; webmcp-component: "button"; webmcp-intent: "action"; webmcp-confirmation: "maybe"; webmcp-accessibility: "aria-label: C"; }',
      ),
    );
    expect(badConfirmation.map((i) => i.message).join(' ')).toMatch(/confirmaci/i);
  });
});

describe('framework · initProject', () => {
  it('crea un proyecto ia-first completo con contrato válido y MCP', () => {
    const dir = tmp();
    const result = initProject({ dir, name: 'Tienda Test', url: 'https://tienda.test' });
    expect(result.files).toEqual(
      expect.arrayContaining([
        'index.html',
        'webmcp.css',
        'webmcp-runtime.js',
        '.well-known/webmcp.json',
        'mcp.json',
        'README.md',
      ]),
    );
    expect(result.tools.length).toBeGreaterThanOrEqual(5);
    const css = fs.readFileSync(path.join(dir, 'webmcp.css'), 'utf8');
    const map = parseWebMCP(css);
    expect(Object.keys(map.tools)).toEqual(result.tools);
    expect(validateIaFirst(map)).toEqual([]);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    // Cada selector del contrato existe en el HTML generado.
    for (const tool of Object.values(map.tools)) {
      const m = /\[data-tool="([^"]+)"\]/.exec(tool.selector);
      expect(m, tool.selector).not.toBeNull();
      expect(html).toContain(`data-tool="${m![1]}"`);
    }
    expect(html).toContain('<link rel="webmcp"');
    const wellKnown = JSON.parse(
      fs.readFileSync(path.join(dir, '.well-known/webmcp.json'), 'utf8'),
    );
    expect(wellKnown.css).toBe('/webmcp.css');
    const mcp = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'));
    expect(JSON.stringify(mcp)).toContain('webmcpcss');
    expect(JSON.stringify(mcp)).toContain('https://tienda.test');
    // Idempotente: reescribir requiere force.
    expect(() => initProject({ dir, name: 'Tienda Test' })).toThrow(/force/i);
    expect(initProject({ dir, name: 'Tienda Test', force: true }).files.length).toBe(
      result.files.length,
    );
  });

  it('la plantilla minimal genera menos archivos pero un contrato válido', () => {
    const dir = tmp();
    const result = initProject({ dir, framework: 'minimal' });
    expect(result.files).toContain('webmcp.css');
    expect(
      validateIaFirst(parseWebMCP(fs.readFileSync(path.join(dir, 'webmcp.css'), 'utf8'))),
    ).toEqual([]);
  });
});

describe('framework · assist', () => {
  it('planifica heurísticamente un formulario de contacto con campos deducidos', () => {
    const plan = planHeuristically(
      'crea un formulario de contacto con nombre, email y mensaje',
    );
    expect(plan.source).toBe('heuristic');
    expect(plan.components[0].component).toBe('form');
    const names = plan.components[0].options.fields?.map((f) => f.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(['name', 'email', 'message']));
  });

  it('deduce nav/hero/grid/botón según el vocabulario', () => {
    expect(
      planHeuristically('añade un menú de navegación con inicio y productos')
        .components[0].component,
    ).toBe('nav');
    expect(
      planHeuristically('un hero de bienvenida con botón de empezar').components.map(
        (c) => c.component,
      ),
    ).toContain('hero');
    expect(planHeuristically('grid de productos').components[0].component).toBe('grid');
    expect(planHeuristically('botón de comprar ahora').components[0].component).toBe(
      'button',
    );
  });

  it('assist sin LLM devuelve HTML + CSS parseable y coherente', async () => {
    const r = await assist('crea un formulario de login con email y contraseña', null);
    expect(r.plan.source).toBe('heuristic');
    const map = parseWebMCP(r.css);
    const [name, tool] = Object.entries(map.tools)[0];
    expect(name).toBeTruthy();
    expect(Object.keys(tool.params)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
    expect(r.html).toContain('type="password"');
    expect(serializeToolMap(map)).toContain('webmcp-component');
  });

  it('assist con LLM usa el plan del modelo y cae en heurísticas si la respuesta es inválida', async () => {
    const good: LlmClient = {
      provider: 'openai',
      model: 'test',
      complete: async () =>
        JSON.stringify({
          rationale: 'Formulario de newsletter',
          components: [
            {
              component: 'form',
              options: {
                tool: 'subscribeNewsletter',
                label: 'Suscribirme',
                fields: [
                  { name: 'email', label: 'Email', type: 'email', required: true },
                ],
              },
            },
          ],
        }),
    };
    const r = await assist('newsletter', good);
    expect(r.plan.source).toBe('llm');
    expect(parseWebMCP(r.css).tools.subscribeNewsletter).toBeDefined();

    const bad: LlmClient = {
      provider: 'openai',
      model: 'test',
      complete: async () => 'no json',
    };
    expect(await planWithLlm(bad, 'x')).toBeNull();
    const fallback = await assist('crea un formulario de contacto', bad);
    expect(fallback.plan.source).toBe('heuristic');

    const throwing: LlmClient = {
      provider: 'openai',
      model: 'test',
      complete: async () => {
        throw new Error('boom');
      },
    };
    expect((await assist('botón de comprar', throwing)).plan.source).toBe('heuristic');
  });
});
