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
});
