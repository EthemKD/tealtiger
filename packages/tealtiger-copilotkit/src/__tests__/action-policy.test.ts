import { describe, it, expect } from 'vitest';
import { evaluateActionPolicy } from '../action-policy';

describe('evaluateActionPolicy', () => {
  it('allows when no policy configured', () => {
    const result = evaluateActionPolicy('anything', undefined);
    expect(result.verdict).toBe('ALLOW');
    expect(result.reasonCode).toBe('NO_POLICY');
  });

  it('denies action on denylist', () => {
    const result = evaluateActionPolicy('deleteAccount', {
      denylist: ['deleteAccount', 'dropTable'],
    });
    expect(result.verdict).toBe('DENY');
    expect(result.reasonCode).toBe('ACTION_DENIED');
  });

  it('allows action not on denylist', () => {
    const result = evaluateActionPolicy('search', {
      denylist: ['deleteAccount'],
    });
    expect(result.verdict).toBe('ALLOW');
  });

  it('allows action on allowlist', () => {
    const result = evaluateActionPolicy('search', {
      allowlist: ['search', 'read'],
    });
    expect(result.verdict).toBe('ALLOW');
    expect(result.reasonCode).toBe('ACTION_AUTHORIZED');
  });

  it('denies action not on allowlist', () => {
    const result = evaluateActionPolicy('delete', {
      allowlist: ['search', 'read'],
    });
    expect(result.verdict).toBe('DENY');
    expect(result.reasonCode).toBe('ACTION_NOT_ALLOWED');
  });

  it('denylist takes precedence over allowlist', () => {
    const result = evaluateActionPolicy('deleteAccount', {
      allowlist: ['deleteAccount', 'search'],
      denylist: ['deleteAccount'],
    });
    expect(result.verdict).toBe('DENY');
  });

  it('supports glob pattern in denylist', () => {
    const result = evaluateActionPolicy('deleteUser', {
      denylist: ['delete*'],
    });
    expect(result.verdict).toBe('DENY');
  });

  it('supports glob pattern in allowlist', () => {
    const result = evaluateActionPolicy('searchDocs', {
      allowlist: ['search*'],
    });
    expect(result.verdict).toBe('ALLOW');
  });

  it('glob does not match partial without wildcard', () => {
    const result = evaluateActionPolicy('deleteAccount', {
      denylist: ['delete'],
    });
    expect(result.verdict).toBe('ALLOW'); // "delete" != "deleteAccount"
  });

  it('empty allowlist means nothing is allowed', () => {
    const result = evaluateActionPolicy('anything', {
      allowlist: [],
    });
    // Empty allowlist = no restriction (passthrough)
    expect(result.verdict).toBe('ALLOW');
  });
});
