import { describe, it, expect } from 'vitest';
import { scanForPii, redactPii } from '../pii-scanner';

describe('scanForPii', () => {
  it('detects SSN', () => {
    const findings = scanForPii('My SSN is 123-45-6789', ['ssn']);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('ssn');
    expect(findings[0].start).toBe(10);
  });

  it('detects email', () => {
    const findings = scanForPii('Email: john.doe@example.com', ['email']);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('email');
  });

  it('detects credit card (Visa)', () => {
    const findings = scanForPii('Card: 4111111111111111', ['credit_card']);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('credit_card');
  });

  it('detects credit card with dashes', () => {
    const findings = scanForPii('Card: 4111-1111-1111-1111', ['credit_card']);
    expect(findings).toHaveLength(1);
  });

  it('detects API keys (OpenAI)', () => {
    const findings = scanForPii('Key: sk-abc123def456ghi789jkl012mno345pq', ['api_key']);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('api_key');
  });

  it('detects API keys (AWS)', () => {
    const findings = scanForPii('Key: AKIAIOSFODNN7EXAMPLE', ['api_key']);
    expect(findings).toHaveLength(1);
  });

  it('detects multiple PII types', () => {
    const text = 'SSN: 123-45-6789, email: test@test.com';
    const findings = scanForPii(text, ['ssn', 'email']);
    expect(findings).toHaveLength(2);
  });

  it('returns empty array for clean text', () => {
    const findings = scanForPii('This is clean text', ['ssn', 'email', 'credit_card']);
    expect(findings).toHaveLength(0);
  });

  it('detects IP addresses', () => {
    const findings = scanForPii('Server at 192.168.1.100', ['ip_address']);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('ip_address');
  });
});

describe('redactPii', () => {
  it('redacts SSN with mask', () => {
    const result = redactPii('SSN: 123-45-6789', ['ssn']);
    expect(result.redacted).toContain('[SSN_REDACTED]');
    expect(result.redacted).not.toContain('123-45-6789');
    expect(result.findings).toHaveLength(1);
  });

  it('redacts multiple findings', () => {
    const result = redactPii(
      'SSN: 123-45-6789, email: test@example.com',
      ['ssn', 'email'],
    );
    expect(result.redacted).toContain('[SSN_REDACTED]');
    expect(result.redacted).toContain('[EMAIL_REDACTED]');
    expect(result.findings).toHaveLength(2);
  });

  it('returns unchanged text when no PII found', () => {
    const result = redactPii('Clean text here', ['ssn', 'email']);
    expect(result.redacted).toBe('Clean text here');
    expect(result.findings).toHaveLength(0);
  });
});
