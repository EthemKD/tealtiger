/**
 * TealTiger CopilotKit Governance — Type Definitions
 *
 * @module tealtiger-copilotkit/types
 */

// --- Governance Modes ---

export type GovernanceMode = 'OBSERVE' | 'MONITOR' | 'ENFORCE';

// --- PII Categories ---

export type PiiCategory =
  | 'ssn'
  | 'credit_card'
  | 'email'
  | 'phone'
  | 'api_key'
  | 'ip_address';

export type PiiAction = 'detect' | 'redact' | 'block';

// --- Configuration ---

export interface ActionPolicyConfig {
  /** Actions the copilot IS allowed to call */
  allowlist?: string[];
  /** Actions the copilot is NOT allowed to call (takes precedence) */
  denylist?: string[];
}

export interface PiiConfig {
  /** Scan useCopilotReadable state before it enters the model */
  scanReadable?: boolean;
  /** Scan action arguments before execution */
  scanActionArgs?: boolean;
  /** What to do when PII is found */
  action: PiiAction;
  /** Which PII categories to detect */
  categories: PiiCategory[];
}

export interface BudgetConfig {
  /** Max USD per user per session */
  perUser?: number;
  /** Max USD per tenant per day */
  perTenant?: number;
  /** Max USD per single request */
  perRequest?: number;
  /**
   * Token estimation method.
   * - "char-count" (default): ~4 chars/token approximation. May vary ±50%
   *   for code, JSON, or non-English content.
   * - Future: "tiktoken" | "provider-api" for exact tracking.
   *
   * For budget caps, char-count estimation is safe (errs conservative).
   * For exact cost reporting, integrate with your LLM provider's usage API.
   */
  estimationMethod?: 'char-count';
}

export interface TealTigerCopilotKitConfig {
  /** Governance mode: OBSERVE (log only), MONITOR (log + warn), ENFORCE (block) */
  mode: GovernanceMode;
  /** Tool/action authorization policy */
  actionPolicy?: ActionPolicyConfig;
  /** PII scanning configuration */
  pii?: PiiConfig;
  /** Cost budget configuration */
  budget?: BudgetConfig;
  /** Custom audit handler — receives governance decisions */
  onAudit?: (decision: GovernanceDecision) => void | Promise<void>;
}

// --- Governance Decision ---

export type GovernanceAction = 'ALLOW' | 'DENY' | 'REDACT';

export interface PiiFinding {
  type: PiiCategory;
  start: number;
  end: number;
  redacted: string;
}

export interface GovernanceDecision {
  /** Unique identifier for this decision */
  correlationId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** The governance action taken */
  action: GovernanceAction;
  /** Governance mode at time of evaluation */
  mode: GovernanceMode;
  /** Human-readable reason for the decision */
  reason: string;
  /** Machine-readable reason codes */
  reasonCodes: string[];
  /** Risk score 0-100 */
  riskScore: number;
  /** PII findings (if any) */
  piiFindings: PiiFinding[];
  /** Cost tracked for this evaluation */
  costTracked: number;
  /** Cumulative session cost */
  cumulativeCost: number;
  /** Evaluation latency in milliseconds */
  evaluationTimeMs: number;
  /** Action name being evaluated (if applicable) */
  actionName?: string;
  /** User ID (if available) */
  userId?: string;
  /** Tenant ID (if available) */
  tenantId?: string;
}

// --- Budget State ---

export interface BudgetState {
  userId?: string;
  tenantId?: string;
  sessionCost: number;
  dailyCost: number;
  requestCount: number;
  lastResetDate: string;
}
