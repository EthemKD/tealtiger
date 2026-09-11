/**
 * TealTiger CopilotKit — Deterministic Governance Middleware
 *
 * Three-layer governance for CopilotKit applications:
 *
 * Layer 1: Route-level budget guard (check before, record after)
 * Layer 2: Action handler wrapper (per-action authorization + PII scan)
 * Layer 3: Content scanner (useCopilotReadable PII governance)
 *
 * No LLM in the governance path. <2ms per evaluation. Structured audit trail.
 *
 * @example
 * ```typescript
 * import { TealTigerGovernance, withTealTigerPolicy, createRouteGuard } from "tealtiger-copilotkit";
 *
 * const governance = new TealTigerGovernance({
 *   mode: "ENFORCE",
 *   actionPolicy: {
 *     allowlist: ["searchDocs", "updatePreferences"],
 *     denylist: ["deleteAccount", "transferFunds"],
 *   },
 *   pii: {
 *     scanReadable: true,
 *     scanActionArgs: true,
 *     action: "redact",
 *     categories: ["ssn", "credit_card", "api_key"],
 *   },
 *   budget: {
 *     perUser: 0.50,
 *     perTenant: 50.00,
 *   },
 * });
 * ```
 *
 * @packageDocumentation
 */

// Core governance engine
export { TealTigerGovernance } from './governance';

// Layer 1: Route-level budget guard
export { createRouteGuard } from './route-guard';
export type { RouteGuardConfig } from './route-guard';

// Layer 2: Action handler wrapper
export { withTealTigerPolicy } from './with-tealtiger-policy';
export type { PolicyWrapperOptions } from './with-tealtiger-policy';

// Layer 3: PII scanner (used internally and available for direct use)
export { scanForPii, redactPii } from './pii-scanner';

// Layer 3b: CopilotKit-specific readable context scanner
// Handles both the v1 system-message fenced block and the v2 structured
// `context: [{ description, value }]` array.
export {
  scanReadableContext,
  scanReadableContextArray,
  scanCopilotKitRequest,
} from './readable-scanner';
export type { ReadableContextEntry } from './readable-scanner';

// Budget guard (available for direct use)
export { BudgetGuard } from './budget-guard';

// Action policy evaluator (available for direct use)
export { evaluateActionPolicy } from './action-policy';
export type { PolicyResult, PolicyVerdict } from './action-policy';

// Types
export type {
  TealTigerCopilotKitConfig,
  GovernanceMode,
  GovernanceAction,
  GovernanceDecision,
  PiiCategory,
  PiiAction,
  PiiConfig,
  PiiFinding,
  ActionPolicyConfig,
  BudgetConfig,
  BudgetState,
} from './types';
