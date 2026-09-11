/**
 * TealTiger CopilotKit — Readable Context Scanner (Layer 3)
 *
 * Scans and redacts PII within the readable context that CopilotKit sends to
 * the model from `useCopilotReadable` / agent context. There are two real
 * shapes, depending on the CopilotKit generation:
 *
 * - **v1 (react-core v1 / `defaultSystemMessage`)** — the context is
 *   serialized into the **system message** as a plain fenced code block,
 *   preceded by the marker line
 *   `The user has provided you with the following context:`.
 *   (Source: `@copilotkit/react-core` `defaultSystemMessage`.)
 *
 * - **v2 (core `runAgent` / `connectAgent`)** — the context is a **structured
 *   array** `context: [{ description, value }]` on the agent input.
 *   (Source: `@copilotkit/core` `AgentContextInput` = `{ description, value }`.)
 *
 * This scanner targets both. It does NOT rely on any `<TextContext>` tag —
 * that tag does not exist in CopilotKit and never did.
 *
 * @module tealtiger-copilotkit/readable-scanner
 */

import type { PiiCategory, PiiFinding } from './types';
import { scanForPii, redactPii } from './pii-scanner';

/**
 * Marker line emitted by CopilotKit v1 `defaultSystemMessage` immediately
 * before the fenced context block. We locate the fenced block that follows
 * this line and scan only its contents, so PII elsewhere in the system prompt
 * (or in user/assistant turns) is left untouched.
 */
const V1_CONTEXT_MARKER = 'The user has provided you with the following context:';

/**
 * Matches the ```-fenced block that follows the v1 marker line.
 * Group 1 is the inner context payload.
 */
const V1_FENCED_BLOCK = /```(?:[^\n]*)\n([\s\S]*?)```/;

type ScanAction = 'detect' | 'redact' | 'block';

// --- v1: system-message fenced block -----------------------------------------

/**
 * Scan/redact PII inside the v1 readable-context fenced block within a system
 * message.
 *
 * Only the fenced block that follows the CopilotKit marker line is touched;
 * the rest of the system prompt is preserved. If the marker/fence is not
 * present the content is returned unchanged with no findings (callers decide
 * whether that warrants a warning — see `scanCopilotKitRequest`).
 *
 * @param systemContent - The system message content
 * @param categories - PII categories to scan for
 * @param action - `detect` | `redact` | `block`
 */
export function scanReadableContext(
  systemContent: string,
  categories: PiiCategory[],
  action: ScanAction = 'redact',
): {
  content: string;
  findings: PiiFinding[];
  blocked: boolean;
} {
  const markerIdx = systemContent.indexOf(V1_CONTEXT_MARKER);
  if (markerIdx === -1) {
    return { content: systemContent, findings: [], blocked: false };
  }

  const before = systemContent.slice(0, markerIdx);
  const after = systemContent.slice(markerIdx);

  const fence = V1_FENCED_BLOCK.exec(after);
  if (!fence) {
    return { content: systemContent, findings: [], blocked: false };
  }

  const inner = fence[1];
  const findings = scanForPii(inner, categories);

  if (action === 'detect' || findings.length === 0) {
    return { content: systemContent, findings, blocked: false };
  }

  const fenceStart = markerIdx + fence.index; // absolute start of the ``` fence
  const innerStart = fenceStart + fence[0].indexOf(inner);
  const innerEnd = innerStart + inner.length;

  if (action === 'block') {
    const replaced =
      systemContent.slice(0, innerStart) +
      '[CONTEXT_BLOCKED_BY_GOVERNANCE]' +
      systemContent.slice(innerEnd);
    return { content: replaced, findings, blocked: true };
  }

  // redact
  const { redacted } = redactPii(inner, categories);
  const replaced =
    systemContent.slice(0, innerStart) + redacted + systemContent.slice(innerEnd);
  // silence unused-var lint for `before` (kept for readability of the slice math)
  void before;
  return { content: replaced, findings, blocked: false };
}

// --- v2: structured context array --------------------------------------------

/** A single v2 readable-context entry (`AgentContextInput`). */
export interface ReadableContextEntry {
  description: string;
  value: unknown;
}

/**
 * Scan/redact PII in a v2 structured context array
 * (`context: [{ description, value }]`).
 *
 * Each entry's `value` is stringified (if not already a string), scanned, and
 * — for `redact`/`block` — replaced. Non-string values that contained PII are
 * returned as the processed string so the redaction is actually applied.
 * `description` is treated as a label and left untouched.
 *
 * @param context - The structured context array from the agent input
 * @param categories - PII categories to scan for
 * @param action - `detect` | `redact` | `block`
 */
export function scanReadableContextArray(
  context: ReadableContextEntry[],
  categories: PiiCategory[],
  action: ScanAction = 'redact',
): {
  context: ReadableContextEntry[];
  findings: PiiFinding[];
  blocked: boolean;
} {
  const allFindings: PiiFinding[] = [];
  let blocked = false;

  const processed = context.map((entry) => {
    const asText =
      typeof entry.value === 'string' ? entry.value : safeStringify(entry.value);
    const findings = scanForPii(asText, categories);
    if (findings.length === 0) return entry;

    allFindings.push(...findings);

    if (action === 'detect') return entry;

    if (action === 'block') {
      blocked = true;
      return { ...entry, value: '[CONTEXT_BLOCKED_BY_GOVERNANCE]' };
    }

    // redact
    const { redacted } = redactPii(asText, categories);
    return { ...entry, value: redacted };
  });

  return { context: processed, findings: allFindings, blocked };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// --- request-level entry point ------------------------------------------------

interface CopilotKitRequestBody {
  /** v1: chat messages; readable context lives in the system message. */
  messages?: Array<{ role: string; content: string }>;
  /** v2: structured readable-context array on the agent input. */
  context?: ReadableContextEntry[];
}

/**
 * Scan a CopilotKit request body for PII in readable context, handling BOTH
 * the v1 (system-message fenced block) and v2 (structured `context` array)
 * shapes.
 *
 * Resolution:
 * - If `body.context` is a non-empty array → v2 path (scan each `value`).
 * - Else if a system message contains the v1 marker → v1 path (scan the
 *   fenced block).
 * - Else → no readable context found; returns the body unchanged and emits a
 *   single warning so teams know scanning did not run (rather than silently
 *   passing PII through undetected).
 *
 * @param requestBody - Parsed JSON body from the CopilotKit endpoint / agent input
 * @param categories - PII categories to scan
 * @param action - What to do with findings
 */
export function scanCopilotKitRequest(
  requestBody: CopilotKitRequestBody,
  categories: PiiCategory[],
  action: ScanAction = 'redact',
): {
  body: CopilotKitRequestBody;
  findings: PiiFinding[];
  blocked: boolean;
} {
  // v2 first: structured array is the current, stable shape.
  if (Array.isArray(requestBody.context) && requestBody.context.length > 0) {
    const result = scanReadableContextArray(requestBody.context, categories, action);
    return {
      body: { ...requestBody, context: result.context },
      findings: result.findings,
      blocked: result.blocked,
    };
  }

  // v1: readable context in the system message fenced block.
  if (Array.isArray(requestBody.messages)) {
    const systemIdx = requestBody.messages.findIndex(
      (m) => m.role === 'system' && typeof m.content === 'string',
    );
    if (systemIdx !== -1 && requestBody.messages[systemIdx].content.includes(V1_CONTEXT_MARKER)) {
      const result = scanReadableContext(
        requestBody.messages[systemIdx].content,
        categories,
        action,
      );
      const messages = requestBody.messages.slice();
      messages[systemIdx] = { ...messages[systemIdx], content: result.content };
      return {
        body: { ...requestBody, messages },
        findings: result.findings,
        blocked: result.blocked,
      };
    }
  }

  // Neither shape present — do not silently imply scanning happened.
  console.warn(
    '[tealtiger-copilotkit] No readable context found to scan. ' +
      'Expected either a v2 `context: [{ description, value }]` array or a v1 ' +
      'system message containing "' + V1_CONTEXT_MARKER + '". ' +
      'PII scanning on useCopilotReadable did not run — verify your ' +
      '@copilotkit/runtime version and how context is passed.',
  );
  return { body: requestBody, findings: [], blocked: false };
}
