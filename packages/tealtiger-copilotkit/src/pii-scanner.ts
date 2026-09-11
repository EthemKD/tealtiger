/**
 * TealTiger CopilotKit — Deterministic PII Scanner
 *
 * Pattern-based PII detection. No LLM, no external service, <2ms.
 *
 * @module tealtiger-copilotkit/pii-scanner
 */

import type { PiiCategory, PiiFinding } from './types';

// --- PII Patterns ---

const PII_PATTERNS: Record<PiiCategory, RegExp> = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
  api_key: /\b(?:sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9\-_]{20,})\b/g,
  ip_address: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
};

// --- Redaction Masks ---

const REDACTION_MASKS: Record<PiiCategory, string> = {
  ssn: '[SSN_REDACTED]',
  credit_card: '[CC_REDACTED]',
  email: '[EMAIL_REDACTED]',
  phone: '[PHONE_REDACTED]',
  api_key: '[KEY_REDACTED]',
  ip_address: '[IP_REDACTED]',
};

/**
 * Scan text for PII patterns.
 *
 * @param text - Input text to scan
 * @param categories - Which PII categories to look for
 * @returns Array of PII findings with positions
 */
export function scanForPii(
  text: string,
  categories: PiiCategory[],
): PiiFinding[] {
  const findings: PiiFinding[] = [];

  for (const category of categories) {
    const pattern = PII_PATTERNS[category];
    if (!pattern) continue;

    // Reset regex state (global flag)
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const value = match[0];
      const masked = value.slice(0, 2) + '*'.repeat(Math.max(0, value.length - 4)) + value.slice(-2);

      findings.push({
        type: category,
        start: match.index,
        end: match.index + value.length,
        redacted: masked,
      });
    }
  }

  return findings.sort((a, b) => a.start - b.start);
}

/**
 * Redact PII from text, replacing matches with category-specific masks.
 *
 * @param text - Input text to redact
 * @param categories - Which PII categories to redact
 * @returns Object with redacted text and findings
 */
export function redactPii(
  text: string,
  categories: PiiCategory[],
): { redacted: string; findings: PiiFinding[] } {
  const findings = scanForPii(text, categories);

  if (findings.length === 0) {
    return { redacted: text, findings: [] };
  }

  // Replace from end to start to preserve positions
  let redacted = text;
  for (let i = findings.length - 1; i >= 0; i--) {
    const finding = findings[i];
    const mask = REDACTION_MASKS[finding.type];
    redacted = redacted.slice(0, finding.start) + mask + redacted.slice(finding.end);
  }

  return { redacted, findings };
}
