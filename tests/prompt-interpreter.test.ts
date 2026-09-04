/**
 * Tests del intérprete de prompts (v0.7.0): heurísticas locales (es/en),
 * normalización de salidas de LLM y cliente LLM con `fetch` simulado.
 */
import { describe, expect, it } from 'vitest';
import {
  buildInterpreterUserPrompt,
  interpretHeuristically,
  interpretPrompt,
  normalizeActionName,
  normalizeLlmAction,
} from '../src/prompt/interpreter';
import {
  createLlmClient,
  extractJsonObject,
  FetchLlmClient,
  resolveLlmConfig,
} from '../src/prompt/llm-client';
import type { LlmClient } from '../src/prompt/types';
import {
  detectKinds,
  findColor,
  keywords,
  looksLikeSelector,
} from '../src/prompt/vocabulary';

describe('interpretHeuristically (español)', () => {
  it('upload: "sube esta imagen en el carrusel" con adjunto', () => {
    const a = interpretHeuristically('sube esta imagen en el carrusel', {
      files: ['./foto.jpg'],
    });
    expect(a.action).toBe('upload');
    expect(a.target).toBe('carrusel');
    expect(a.parameters.file).toBe('./foto.jpg');
    expect(a.source).toBe('heuristic');
  });

  it('upload: "reemplaza el logo por esta foto" → objetivo logo', () => {
    const a = interpretHeuristically('reemplaza el logo por esta foto', {
      files: ['l.png'],
    });
    expect(a.action).toBe('upload');
    expect(a.target).toBe('logo');
  });

  it('changeColor: extrae color, objetivo y propiedad', () => {
    const a = interpretHeuristically('cambia el color del botón de comprar a rojo');
    expect(a.action).toBe('changeColor');
    expect(a.parameters.color).toBe('red');
    expect(a.target).toBe('botón de comprar');

    const b = interpretHeuristically('pon el fondo de la página azul oscuro');
    expect(b.action).toBe('changeColor');
    expect(b.parameters.color).toBe('darkblue');
    expect(b.parameters.property).toBe('background-color');
    expect(b.target).toBe('página');
  });

  it('changeColor: admite hex y rgb()', () => {
    expect(interpretHeuristically('pinta el header de #ff6600').parameters.color).toBe(
      '#ff6600',
    );
    expect(
      interpretHeuristically('color del título rgb(10, 20, 30)').parameters.color,
    ).toBe('rgb(10, 20, 30)');
  });

  it('delete / hide con "todos"', () => {
    const d = interpretHeuristically('elimina el popup de cookies');
    expect(d.action).toBe('delete');
    expect(d.target).toBe('popup de cookies');

    const h = interpretHeuristically('oculta todos los anuncios');
    expect(h.action).toBe('hide');
    expect(h.target).toBe('anuncios');
    expect(h.parameters.all).toBe(true);
  });

  it('click conserva el texto original del objetivo (mayúsculas y tildes)', () => {
    const a = interpretHeuristically('haz clic en el botón Añadir al carrito');
    expect(a.action).toBe('click');
    expect(a.target).toBe('botón Añadir al carrito');
  });

  it('fill: texto entrecomillado y separador "con"', () => {
    const q = interpretHeuristically('escribe "hola mundo" en el buscador');
    expect(q.action).toBe('fill');
    expect(q.parameters.text).toBe('hola mundo');
    expect(q.target).toBe('buscador');

    const c = interpretHeuristically('rellena el campo email con juan@test.com');
    expect(c.action).toBe('fill');
    expect(c.parameters.text).toBe('juan@test.com');
    expect(c.target).toBe('campo email');
  });

  it('fill: usa --text cuando el prompt no trae valor', () => {
    const a = interpretHeuristically('rellena el campo de búsqueda', { text: 'teclado' });
    expect(a.action).toBe('fill');
    expect(a.parameters.text).toBe('teclado');
  });

  it('setText: "cambia el título a …" y "cambia el texto del botón a …"', () => {
    const t = interpretHeuristically('cambia el título a "Bienvenidos a mi tienda"');
    expect(t.action).toBe('setText');
    expect(t.target).toBe('título');
    expect(t.parameters.text).toBe('Bienvenidos a mi tienda');

    const b = interpretHeuristically(
      'cambia el texto del botón de comprar a "Comprar ya"',
    );
    expect(b.action).toBe('setText');
    expect(b.target).toBe('botón de comprar');
    expect(b.parameters.text).toBe('Comprar ya');
  });

  it('move: posición relativa y destino', () => {
    const a = interpretHeuristically('mueve el logo antes del menú');
    expect(a.action).toBe('move');
    expect(a.target).toBe('logo');
    expect(a.parameters.placement).toBe('before');
    expect(a.parameters.destination).toBe('menu');
  });

  it('setStyle: tamaño y negrita', () => {
    const a = interpretHeuristically('haz el título más grande y en negrita');
    expect(a.action).toBe('setStyle');
    expect(a.target).toBe('título');
    expect(a.parameters.styles).toEqual({ 'font-size': '1.25em', 'font-weight': 'bold' });
  });

  it('selector explícito con enclítico: "#cart-indicator ocúltalo"', () => {
    const a = interpretHeuristically('#cart-indicator ocúltalo');
    expect(a.action).toBe('hide');
    expect(a.selector).toBe('#cart-indicator');
    expect(a.target).toBe('#cart-indicator');

    const b = interpretHeuristically('bórrame el .banner-promo');
    expect(b.action).toBe('delete');
    expect(b.selector).toBe('.banner-promo');
  });

  it('sin verbo reconocible → other con confianza baja', () => {
    const a = interpretHeuristically('aplica el cupón DESCUENTO10');
    expect(a.action).toBe('other');
    expect(a.confidence).toBeLessThan(0.5);
    expect(a.rawPrompt).toBe('aplica el cupón DESCUENTO10');
  });

  it('prompt vacío lanza en interpretPrompt', async () => {
    await expect(interpretPrompt('   ')).rejects.toThrow(/vacío/);
  });

  it('"pon <campo> en <valor>" y "set X to Y" sin sustantivo textual → fill', () => {
    const a = interpretHeuristically('pon la cantidad en 3');
    expect(a.action).toBe('fill');
    expect(a.target).toBe('cantidad');
    expect(a.parameters.text).toBe('3');
    const b = interpretHeuristically('set quantity to 2');
    expect(b.action).toBe('fill');
    expect(b.parameters.text).toBe('2');
    const c = interpretHeuristically('pon "Hola" en el buscador');
    expect(c.action).toBe('fill');
    expect(c.target).toBe('buscador');
    expect(c.parameters.text).toBe('Hola');
  });

  it('"pon … en negrita" sigue siendo setStyle y "pon el fondo azul" changeColor', () => {
    expect(interpretHeuristically('pon el título en negrita').action).toBe('setStyle');
    const bg = interpretHeuristically('pon el fondo azul');
    expect(bg.action).toBe('changeColor');
    expect(bg.parameters.property).toBe('background-color');
  });
});

describe('interpretHeuristically (english)', () => {
  it('click / delete / hide', () => {
    expect(interpretHeuristically('click the login button')).toMatchObject({
      action: 'click',
      target: 'login button',
    });
    expect(interpretHeuristically('delete the newsletter banner')).toMatchObject({
      action: 'delete',
      target: 'newsletter banner',
    });
    expect(interpretHeuristically('hide the chat widget')).toMatchObject({
      action: 'hide',
      target: 'chat widget',
    });
  });

  it('fill: "type hello into the search box"', () => {
    const a = interpretHeuristically('type hello into the search box');
    expect(a.action).toBe('fill');
    expect(a.parameters.text).toBe('hello');
    expect(a.target).toBe('search box');
  });

  it('move: "move the footer to the top"', () => {
    const a = interpretHeuristically('move the footer to the top');
    expect(a.action).toBe('move');
    expect(a.target).toBe('footer');
    expect(a.parameters.placement).toBe('start');
    expect(a.parameters.destination).toBe('body');
  });

  it('upload with inline path', () => {
    const a = interpretHeuristically('upload ./logo.png to the profile picture');
    expect(a.action).toBe('upload');
    expect(a.parameters.file).toBe('./logo.png');
    expect(a.target).toBe('profile picture');
    expect(a.selector).toBeUndefined();
  });

  it('changeColor: "make the header background dark green"', () => {
    const a = interpretHeuristically('make the header background dark green');
    expect(a.action).toBe('changeColor');
    expect(a.parameters.color).toBe('darkgreen');
    expect(a.parameters.property).toBe('background-color');
    expect(a.target).toBe('header');
  });
});

describe('vocabulary', () => {
  it('findColor reconoce nombres es/en, tonos, hex y funciones', () => {
    expect(findColor('boton rojo')?.value).toBe('red');
    expect(findColor('light blue button')?.value).toBe('lightblue');
    expect(findColor('verde claro')?.value).toBe('lightgreen');
    expect(findColor('#abc')?.value).toBe('#abc');
    expect(findColor('hsla(1, 2%, 3%, .5)')?.value).toBe('hsla(1, 2%, 3%, .5)');
    expect(findColor('sin color aqui')).toBeNull();
  });

  it('detectKinds y keywords', () => {
    expect(detectKinds('el boton de comprar ahora').map((k) => k.id)).toEqual(['button']);
    expect(detectKinds('pie de pagina').map((k) => k.id)).toContain('footer');
    expect(keywords('el botón de Comprar ahora')).toBe('comprar ahora');
    expect(keywords('el botón de Comprar ahora', true)).toBe('boton comprar ahora');
  });

  it('looksLikeSelector distingue selectores de texto y rutas', () => {
    expect(looksLikeSelector('#id')).toBe(true);
    expect(looksLikeSelector('.card .btn')).toBe(true);
    expect(looksLikeSelector('button[type="submit"]')).toBe(true);
    expect(looksLikeSelector('form > input')).toBe(true);
    expect(looksLikeSelector('botón de comprar')).toBe(false);
    expect(looksLikeSelector('./logo.png')).toBe(false);
    expect(looksLikeSelector('https://x.test/a.png')).toBe(false);
  });
});

describe('normalización de salidas del LLM', () => {
  it('normalizeActionName acepta nombres y alias', () => {
    expect(normalizeActionName('click')).toBe('click');
    expect(normalizeActionName('remove')).toBe('delete');
    expect(normalizeActionName('change_color')).toBe('changeColor');
    expect(normalizeActionName('volar')).toBeNull();
    expect(normalizeActionName(42)).toBeNull();
  });

  it('normalizeLlmAction limpia tipos y limita la confianza', () => {
    const a = normalizeLlmAction(
      {
        action: 'changeColor',
        target: ' botón ',
        selector: '#buy',
        parameters: {
          color: 'red',
          position: { x: '1', y: 2 },
          args: { qty: 2 },
          styles: { color: 'red', bad: { nested: true } },
          all: 'yes',
        },
        confidence: 3,
        reasoning: 'ok',
      },
      'pinta el botón',
    );
    expect(a).not.toBeNull();
    expect(a?.target).toBe('botón');
    expect(a?.selector).toBe('#buy');
    expect(a?.parameters.color).toBe('red');
    expect(a?.parameters.position).toBeUndefined();
    expect(a?.parameters.args).toEqual({ qty: '2' });
    expect(a?.parameters.styles).toEqual({ color: 'red' });
    expect(a?.parameters.all).toBeUndefined();
    expect(a?.confidence).toBe(1);
    expect(a?.source).toBe('llm');
  });

  it('normalizeLlmAction devuelve null sin acción válida', () => {
    expect(normalizeLlmAction({ target: 'x' }, 'p')).toBeNull();
  });

  it('extractJsonObject tolera fences y texto alrededor', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('Claro: {"a":{"b":2}} listo')).toEqual({ a: { b: 2 } });
    expect(extractJsonObject('[1,2]')).toBeNull();
    expect(extractJsonObject('nada')).toBeNull();
  });

  it('buildInterpreterUserPrompt incluye adjuntos, herramientas y candidatos', () => {
    const p = buildInterpreterUserPrompt('sube la foto', {
      files: ['a.png'],
      text: 'hola',
      context: {
        url: 'https://x.test',
        title: 'Tienda',
        tools: ['addToCart'],
        candidates: [
          {
            selector: '#x',
            tag: 'button',
            text: 'Comprar',
            attrs: { id: 'x' },
            visible: true,
          },
        ],
      },
    });
    expect(p).toContain('Archivos adjuntos: a.png');
    expect(p).toContain('Texto adicional: hola');
    expect(p).toContain('addToCart');
    expect(p).toContain('#x | button | Comprar | id=x');
  });
});

describe('interpretPrompt con LLM', () => {
  const fake = (reply: string): LlmClient => ({
    provider: 'ollama',
    model: 'fake',
    complete: async () => reply,
  });

  it('usa la respuesta del LLM cuando es válida', async () => {
    const a = await interpretPrompt(
      'quita el banner',
      {},
      fake('{"action":"delete","target":"banner","selector":".banner","confidence":0.9}'),
    );
    expect(a.source).toBe('llm');
    expect(a.action).toBe('delete');
    expect(a.selector).toBe('.banner');
  });

  it('cae a heurísticas si el LLM responde basura o falla', async () => {
    const a = await interpretPrompt('oculta el popup', {}, fake('no tengo ni idea'));
    expect(a.source).toBe('heuristic');
    expect(a.action).toBe('hide');

    const failing: LlmClient = {
      provider: 'openai',
      model: 'x',
      complete: async () => {
        throw new Error('boom');
      },
    };
    const b = await interpretPrompt('oculta el popup', {}, failing);
    expect(b.source).toBe('heuristic');
  });

  it('propaga adjuntos a upload aunque el LLM no los incluya', async () => {
    const a = await interpretPrompt(
      'pon esta imagen en el carrusel',
      { files: ['x.png', 'y.png'] },
      fake('{"action":"upload","target":"carrusel"}'),
    );
    expect(a.parameters.file).toBe('x.png');
    expect(a.parameters.files).toEqual(['x.png', 'y.png']);
  });
});

describe('llm-client', () => {
  it('resolveLlmConfig: sin variables → null; con API key → openai', () => {
    expect(resolveLlmConfig({}, {})).toBeNull();
    const c = resolveLlmConfig({}, { WEBMCP_OPENAI_API_KEY: 'sk' });
    expect(c?.provider).toBe('openai');
    expect(c?.model).toBe('gpt-4o-mini');
    expect(c?.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('resolveLlmConfig: ollama por defecto de modelo y base URL', () => {
    const c = resolveLlmConfig(
      { provider: 'ollama' },
      { WEBMCP_OLLAMA_MODEL: 'llama3.1' },
    );
    expect(c).toMatchObject({
      provider: 'ollama',
      model: 'llama3.1',
      baseUrl: 'http://localhost:11434',
    });
  });

  it('resolveLlmConfig: proveedor desconocido lanza; sin API key → null', () => {
    expect(() => resolveLlmConfig({ provider: 'gemini' }, {})).toThrow(/desconocido/);
    expect(resolveLlmConfig({ provider: 'anthropic' }, {})).toBeNull();
    expect(
      resolveLlmConfig({ provider: 'none' }, { WEBMCP_OPENAI_API_KEY: 'sk' }),
    ).toBeNull();
  });

  it('FetchLlmClient habla los tres protocolos', async () => {
    const calls: Array<{
      url: string;
      body: Record<string, unknown>;
      headers: Record<string, string>;
    }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({
        url: String(url),
        body,
        headers: init?.headers as Record<string, string>,
      });
      const u = String(url);
      const payload = u.includes('/api/chat')
        ? { message: { content: '{"from":"ollama"}' } }
        : u.includes('/chat/completions')
          ? { choices: [{ message: { content: '{"from":"openai"}' } }] }
          : { content: [{ type: 'text', text: '{"from":"anthropic"}' }] };
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as typeof fetch;

    const ollama = new FetchLlmClient(
      { provider: 'ollama', model: 'llama3', baseUrl: 'http://o' },
      fetchImpl,
    );
    expect(await ollama.complete({ system: 's', user: 'u', json: true })).toContain(
      'ollama',
    );
    expect(calls[0].url).toBe('http://o/api/chat');
    expect(calls[0].body.format).toBe('json');

    const openai = new FetchLlmClient(
      { provider: 'openai', model: 'gpt', baseUrl: 'http://a/v1', apiKey: 'k' },
      fetchImpl,
    );
    expect(await openai.complete({ system: 's', user: 'u', json: true })).toContain(
      'openai',
    );
    expect(calls[1].headers.authorization).toBe('Bearer k');
    expect(calls[1].body.response_format).toEqual({ type: 'json_object' });

    const anthropic = new FetchLlmClient(
      { provider: 'anthropic', model: 'claude', baseUrl: 'http://c', apiKey: 'k2' },
      fetchImpl,
    );
    expect(await anthropic.complete({ system: 's', user: 'u' })).toContain('anthropic');
    expect(calls[2].url).toBe('http://c/v1/messages');
    expect(calls[2].headers['x-api-key']).toBe('k2');
    expect(calls[2].body.system).toBe('s');
  });

  it('FetchLlmClient lanza con HTTP no 2xx', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    const c = new FetchLlmClient(
      { provider: 'ollama', model: 'm', baseUrl: 'http://o' },
      fetchImpl,
    );
    await expect(c.complete({ system: 's', user: 'u' })).rejects.toThrow(/500/);
  });

  it('createLlmClient devuelve null sin configuración', () => {
    expect(createLlmClient({}, {})).toBeNull();
    expect(createLlmClient({ provider: 'ollama' }, {})?.provider).toBe('ollama');
  });
});
