import { describe, it, expect, vi } from 'vitest';
import {
  scanReadableContext,
  scanReadableContextArray,
  scanCopilotKitRequest,
} from '../readable-scanner';

// Reproduces the real v1 system message shape emitted by CopilotKit's
// `defaultSystemMessage`: a marker line followed by a ```-fenced block.
function v1SystemMessage(contextPayload: string): string {
  return [
    'Please act as an efficient, competent assistant.',
    '',
    'The user has provided you with the following context:',
    '```',
    contextPayload,
    '```',
    '',
    'Please assist them as best you can.',
  ].join('\n');
}

describe('scanReadableContext (v1 system-message fenced block)', () => {
  it('redacts PII inside the fenced context block', () => {
    const input = v1SystemMessage('Customer SSN: 123-45-6789, email: john@example.com');

    const result = scanReadableContext(input, ['ssn', 'email'], 'redact');

    expect(result.content).toContain('[SSN_REDACTED]');
    expect(result.content).toContain('[EMAIL_REDACTED]');
    expect(result.content).not.toContain('123-45-6789');
    expect(result.content).not.toContain('john@example.com');
    expect(result.findings).toHaveLength(2);
    expect(result.blocked).toBe(false);
    // The surrounding prompt is preserved
    expect(result.content).toContain('Please assist them as best you can.');
    expect(result.content).toContain(
      'The user has provided you with the following context:',
    );
  });

  it('does NOT modify PII outside the fenced context block', () => {
    const input =
      'SSN in system prompt: 999-88-7777\n' + v1SystemMessage('Clean content here');

    const result = scanReadableContext(input, ['ssn'], 'redact');

    // SSN before the marker/fence is not touched
    expect(result.content).toContain('999-88-7777');
    expect(result.findings).toHaveLength(0);
  });

  it('blocks the context payload when PII found and action is block', () => {
    const input = v1SystemMessage('Card: 4111-1111-1111-1111');

    const result = scanReadableContext(input, ['credit_card'], 'block');

    expect(result.blocked).toBe(true);
    expect(result.content).toContain('[CONTEXT_BLOCKED_BY_GOVERNANCE]');
    expect(result.content).not.toContain('4111');
    expect(result.findings).toHaveLength(1);
  });

  it('detect mode scans but does not modify', () => {
    const input = v1SystemMessage('SSN: 123-45-6789');

    const result = scanReadableContext(input, ['ssn'], 'detect');

    expect(result.content).toContain('123-45-6789'); // unchanged
    expect(result.findings).toHaveLength(1);
    expect(result.blocked).toBe(false);
  });

  it('returns content unchanged when the marker is absent (no fabricated match)', () => {
    const input = 'You are a helpful assistant. No context block here.';

    const result = scanReadableContext(input, ['ssn', 'email'], 'redact');

    expect(result.content).toBe(input);
    expect(result.findings).toHaveLength(0);
    expect(result.blocked).toBe(false);
  });

  it('passes a clean context block through unchanged', () => {
    const input = v1SystemMessage('User prefers dark mode and uses TypeScript');

    const result = scanReadableContext(input, ['ssn', 'email', 'credit_card'], 'redact');

    expect(result.content).toBe(input);
    expect(result.findings).toHaveLength(0);
  });
});

describe('scanReadableContextArray (v2 structured context)', () => {
  it('redacts PII in string values', () => {
    const context = [
      { description: 'Customer profile', value: 'SSN 123-45-6789, email a@b.com' },
      { description: 'Theme', value: 'dark' },
    ];

    const result = scanReadableContextArray(context, ['ssn', 'email'], 'redact');

    expect(result.findings).toHaveLength(2);
    expect(result.context[0].value).toContain('[SSN_REDACTED]');
    expect(result.context[0].value).toContain('[EMAIL_REDACTED]');
    expect(result.context[0].value).not.toContain('123-45-6789');
    // Clean entry untouched
    expect(result.context[1].value).toBe('dark');
    // Description label is never modified
    expect(result.context[0].description).toBe('Customer profile');
  });

  it('redacts PII inside non-string (object) values', () => {
    const context = [
      { description: 'Cart', value: { buyerEmail: 'buyer@example.com', items: 3 } },
    ];

    const result = scanReadableContextArray(context, ['email'], 'redact');

    expect(result.findings).toHaveLength(1);
    expect(String(result.context[0].value)).toContain('[EMAIL_REDACTED]');
    expect(String(result.context[0].value)).not.toContain('buyer@example.com');
  });

  it('blocks entries with PII when action is block', () => {
    const context = [{ description: 'Payment', value: 'card 4111-1111-1111-1111' }];

    const result = scanReadableContextArray(context, ['credit_card'], 'block');

    expect(result.blocked).toBe(true);
    expect(result.context[0].value).toBe('[CONTEXT_BLOCKED_BY_GOVERNANCE]');
    expect(result.findings).toHaveLength(1);
  });

  it('detect mode reports findings without modifying values', () => {
    const context = [{ description: 'Profile', value: 'SSN 123-45-6789' }];

    const result = scanReadableContextArray(context, ['ssn'], 'detect');

    expect(result.findings).toHaveLength(1);
    expect(result.context[0].value).toBe('SSN 123-45-6789');
    expect(result.blocked).toBe(false);
  });
});

describe('scanCopilotKitRequest (both shapes)', () => {
  it('scans the v2 structured context array when present', () => {
    const body = {
      context: [{ description: 'Profile', value: 'SSN: 123-45-6789' }],
      messages: [{ role: 'user', content: 'hi' }],
    };

    const result = scanCopilotKitRequest(body, ['ssn'], 'redact');

    expect(result.findings).toHaveLength(1);
    expect(result.body.context![0].value).toContain('[SSN_REDACTED]');
    // user message untouched
    expect(result.body.messages![0].content).toBe('hi');
  });

  it('scans the v1 system-message fenced block when there is no context array', () => {
    const body = {
      messages: [
        { role: 'system', content: v1SystemMessage('SSN: 123-45-6789') },
        { role: 'user', content: 'What is my SSN?' },
      ],
    };

    const result = scanCopilotKitRequest(body, ['ssn'], 'redact');

    expect(result.findings).toHaveLength(1);
    expect(result.body.messages![0].content).toContain('[SSN_REDACTED]');
    // user message untouched
    expect(result.body.messages![1].content).toBe('What is my SSN?');
  });

  it('warns and no-ops when neither readable-context shape is present', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = {
      messages: [
        { role: 'system', content: 'Clean system prompt, no context marker.' },
        { role: 'user', content: 'My SSN is 123-45-6789' },
      ],
    };

    const result = scanCopilotKitRequest(body, ['ssn'], 'redact');

    // user PII is NOT scanned (we only scan readable context, not user turns)
    expect(result.body.messages![1].content).toContain('123-45-6789');
    expect(result.findings).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('handles an empty body gracefully (warns, no throw)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = scanCopilotKitRequest({}, ['ssn'], 'redact');
    expect(result.findings).toHaveLength(0);
    expect(result.blocked).toBe(false);
    warn.mockRestore();
  });
});
