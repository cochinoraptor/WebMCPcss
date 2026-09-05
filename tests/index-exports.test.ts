import { describe, expect, it } from 'vitest';
import * as api from '../src/index';

describe('exports públicos v1.0.x', () => {
  it('expone los diez namespaces documentados (design como alias de designToWebmcp)', () => {
    const names = [
      'framework',
      'design',
      'retro',
      'a11y',
      'testing',
      'versioning',
      'doc',
      'security',
      'recommender',
      'web3',
    ] as const;
    for (const n of names) expect(typeof api[n], n).toBe('object');
    expect(api.design).toBe(api.designToWebmcp);
    expect(typeof api.design.analyzeDescription).toBe('function');
    expect(typeof api.security.validateSecurity).toBe('function');
    expect(typeof api.web3.validatePayments).toBe('function');
  });

  it('v1.1.0 expone el namespace standard (document.modelContext + API declarativa)', () => {
    expect(typeof api.standard).toBe('object');
    expect(api.standard.MODEL_CONTEXT_CANONICAL).toBe('document.modelContext');
    expect(typeof api.standard.getModelContext).toBe('function');
    expect(typeof api.standard.extractDeclarativeTools).toBe('function');
    expect(typeof api.standard.toolMapToDeclarative).toBe('function');
    expect(typeof api.standard.applyDeclarativeToHtml).toBe('function');
  });

  it('v1.2.0 expone el namespace hub (Component Hub) y sus exports planos', () => {
    expect(typeof api.hub).toBe('object');
    expect(api.hub.HUB_CATEGORIES).toContain('intelligent');
    expect(api.hub.HUB_LIBRARIES).toEqual([
      'core',
      'tailwind',
      'bootstrap',
      'mui',
      'shadcn',
    ]);
    expect(api.hub.HUB_TOOL_NAMES).toEqual([
      'list_components',
      'get_component',
      'import_component',
    ]);
    for (const fn of [
      'loadHub',
      'buildHubIndex',
      'buildHubSite',
      'checkHubSite',
      'fetchHubIndex',
      'listComponents',
      'importComponent',
      'updateComponents',
      'prepareComponent',
      'publishComponent',
      'buildDemoSite',
      'callHubTool',
    ] as const) {
      expect(typeof api.hub[fn], fn).toBe('function');
      expect(api[fn], `${fn} (plano)`).toBe(api.hub[fn]);
    }
    expect(api.DEFAULT_HUB_URL).toBe(api.hub.DEFAULT_HUB_URL);
    expect(api.HUB_TOOL_SCHEMAS.map((t) => t.name)).toEqual(api.hub.HUB_TOOL_NAMES);
  });
});
