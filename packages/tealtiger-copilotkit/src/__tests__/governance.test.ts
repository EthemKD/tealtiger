import { describe, it, expect } from 'vitest';
import { TealTigerGovernance } from '../governance';

describe('TealTigerGovernance', () => {
  describe('evaluateAction', () => {
    it('allows action when no policy configured', async () => {
      const gov = new TealTigerGovernance({ mode: 'ENFORCE' });
      const decision = await gov.evaluateAction('anyAction');
      expect(decision.action).toBe('ALLOW');
    });

    it('denies action on denylist', async () => {
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        actionPolicy: { denylist: ['deleteAccount', 'transferFunds'] },
      });
      const decision = await gov.evaluateAction('deleteAccount');
      expect(decision.action).toBe('DENY');
      expect(decision.reasonCodes).toContain('ACTION_DENIED');
    });

    it('allows action on allowlist', async () => {
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        actionPolicy: { allowlist: ['search', 'read'] },
      });
      const decision = await gov.evaluateAction('search');
      expect(decision.action).toBe('ALLOW');
    });

    it('denies action not on allowlist', async () => {
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        actionPolicy: { allowlist: ['search', 'read'] },
      });
      const decision = await gov.evaluateAction('deleteAll');
      expect(decision.action).toBe('DENY');
      expect(decision.reasonCodes).toContain('ACTION_NOT_ALLOWED');
    });

    it('denylist takes precedence over allowlist', async () => {
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        actionPolicy: {
          allowlist: ['delete*'],
          denylist: ['deleteAccount'],
        },
      });
      const decision = await gov.evaluateAction('deleteAccount');
      expect(decision.action).toBe('DENY');
    });

    it('supports glob patterns', async () => {
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        actionPolicy: { denylist: ['delete*'] },
      });
      const decision = await gov.evaluateAction('deleteRecord');
      expect(decision.action).toBe('DENY');
    });

    it('detects PII in action args', async () => {
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        pii: {
          scanActionArgs: true,
          action: 'block',
          categories: ['ssn'],
        },
      });
      const decision = await gov.evaluateAction(
        'updateProfile',
        { ssn: '123-45-6789' },
      );
      expect(decision.action).toBe('DENY');
      expect(decision.piiFindings.length).toBeGreaterThan(0);
      expect(decision.piiFindings[0].type).toBe('ssn');
    });

    it('allows in OBSERVE mode even when policy would deny', async () => {
      const gov = new TealTigerGovernance({
        mode: 'OBSERVE',
        actionPolicy: { denylist: ['deleteAccount'] },
      });
      const decision = await gov.evaluateAction('deleteAccount');
      expect(decision.action).toBe('ALLOW');
      expect(decision.reasonCodes).toContain('ACTION_DENIED');
    });

    it('denies when budget exceeded', async () => {
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        budget: { perUser: 0.10 },
      });
      // Record cost to exceed budget
      gov.recordCost('user-1', undefined, 0.15);
      const decision = await gov.evaluateAction('search', {}, 'user-1');
      expect(decision.action).toBe('DENY');
      expect(decision.reasonCodes).toContain('PER_USER_SESSION_BUDGET_EXCEEDED');
    });

    it('includes correlation ID and timestamp', async () => {
      const gov = new TealTigerGovernance({ mode: 'ENFORCE' });
      const decision = await gov.evaluateAction('test');
      expect(decision.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(decision.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('records evaluation time under 5ms', async () => {
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        actionPolicy: { allowlist: ['search'] },
        pii: { scanActionArgs: true, action: 'detect', categories: ['ssn', 'email'] },
      });
      const decision = await gov.evaluateAction('search', { query: 'test' });
      expect(decision.evaluationTimeMs).toBeLessThan(5);
    });
  });

  describe('scanContent', () => {
    it('redacts PII from content', async () => {
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        pii: {
          scanReadable: true,
          action: 'redact',
          categories: ['ssn', 'email'],
        },
      });
      const result = await gov.scanContent(
        'Customer SSN is 123-45-6789 and email is john@example.com',
      );
      expect(result.text).toContain('[SSN_REDACTED]');
      expect(result.text).toContain('[EMAIL_REDACTED]');
      expect(result.text).not.toContain('123-45-6789');
      expect(result.text).not.toContain('john@example.com');
      expect(result.decision.action).toBe('REDACT');
    });

    it('blocks content with PII when action is block', async () => {
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        pii: {
          action: 'block',
          categories: ['credit_card'],
        },
      });
      const result = await gov.scanContent(
        'Card number: 4111-1111-1111-1111',
      );
      expect(result.text).toBe('');
      expect(result.decision.action).toBe('DENY');
    });

    it('passes clean content through unchanged', async () => {
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        pii: {
          action: 'redact',
          categories: ['ssn'],
        },
      });
      const result = await gov.scanContent('This is clean text with no PII.');
      expect(result.text).toBe('This is clean text with no PII.');
      expect(result.decision.action).toBe('ALLOW');
    });
  });

  describe('audit trail', () => {
    it('accumulates decisions', async () => {
      const gov = new TealTigerGovernance({ mode: 'ENFORCE' });
      await gov.evaluateAction('action1');
      await gov.evaluateAction('action2');
      await gov.scanContent('some text');
      expect(gov.getDecisions()).toHaveLength(3);
    });

    it('calls onAudit callback', async () => {
      const auditLog: unknown[] = [];
      const gov = new TealTigerGovernance({
        mode: 'ENFORCE',
        onAudit: (decision) => { auditLog.push(decision); },
      });
      await gov.evaluateAction('test');
      expect(auditLog).toHaveLength(1);
    });
  });
});
