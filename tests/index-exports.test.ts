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
});
