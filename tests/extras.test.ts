/**
 * Tests de utilidades v0.2.0: sugeridor IA (parseo/aplicación, sin red)
 * e historial/estadísticas del dashboard.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { applyAiSuggestions, getAiConfig, parseAiSuggestions } from '../src/generator';
import { parseWebMCP } from '../src/parser';
import { appendHistory, computeStats, readHistory } from '../src/utils/history';

describe('ai-suggester (sin red)', () => {
  it('getAiConfig devuelve null sin API key', () => {
    expect(getAiConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('getAiConfig lee las variables de entorno', () => {
    const cfg = getAiConfig({
      WEBMCPCSS_AI_API_KEY: 'sk-x',
      WEBMCPCSS_AI_BASE_URL: 'https://ollama.local/v1/',
      WEBMCPCSS_AI_MODEL: 'llama3',
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({
      apiKey: 'sk-x',
      baseUrl: 'https://ollama.local/v1',
      model: 'llama3',
    });
  });

  it('parseAiSuggestions tolera fences de markdown', () => {
    const raw = '```json\n[{"originalName":"tool1","name":"addToCart"}]\n```';
    expect(parseAiSuggestions(raw)).toEqual([
      { originalName: 'tool1', name: 'addToCart' },
    ]);
  });

  it('parseAiSuggestions descarta basura', () => {
    expect(parseAiSuggestions('no hay json aquí')).toEqual([]);
    expect(parseAiSuggestions('[{"sinOriginalName":true}]')).toEqual([]);
  });

  it('applyAiSuggestions renombra y describe sin colisiones', () => {
    const map = parseWebMCP('.a { webmcp-tool: "tool1"; } .b { webmcp-tool: "busy"; }');
    const applied = applyAiSuggestions(map, [
      { originalName: 'tool1', name: 'addToCart', description: 'Añade al carrito' },
      { originalName: 'busy', name: 'addToCart' }, // colisión: se ignora el rename
      { originalName: 'noExiste', name: 'x' },
    ]);
    expect(applied).toBe(1);
    expect(map.tools.addToCart.description).toBe('Añade al carrito');
    expect(map.tools.busy).toBeDefined();
  });
});

describe('historial y estadísticas (dashboard)', () => {
  it('appendHistory + readHistory + computeStats', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wmcp-')), 'h.json');
    appendHistory({ type: 'execute', tool: 'addToCart', ok: true }, file);
    appendHistory({ type: 'repair', tool: 'price', ok: true }, file);
    appendHistory({ type: 'validate', url: 'x', ok: false }, file);
    const events = readHistory(file);
    expect(events).toHaveLength(3);
    expect(events[0].ts).toMatch(/^\d{4}-/);
    const stats = computeStats(events);
    expect(stats.total).toBe(3);
    expect(stats.executions).toEqual({ total: 1, ok: 1, failed: 0 });
    expect(stats.validations.failed).toBe(1);
  });

  it('readHistory devuelve [] con archivo inexistente o corrupto', () => {
    expect(readHistory('/no/existe.json')).toEqual([]);
  });
});
