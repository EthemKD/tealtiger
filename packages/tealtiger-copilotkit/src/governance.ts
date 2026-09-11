/**
 * TealTiger CopilotKit — Core Governance Engine
 *
 * Orchestrates action policy, PII scanning, and budget enforcement
 * into a single governance evaluation per request.
 *
 * @module tealtiger-copilotkit/governance
 */

import { randomUUID } from 'crypto';
import type {
  TealTigerCopilotKitConfig,
  GovernanceDecision,
  GovernanceAction,
  PiiFinding,
} from './types';
import { evaluateActionPolicy } from './action-policy';
import { scanForPii, redactPii } from './pii-scanner';
import { BudgetGuard } from './budget-guard';

/**
 * TealTiger Governance Engine for CopilotKit.
 *
 * Evaluates deterministic policy before copilot actions execute.
 * No LLM in the governance path. <2ms per evaluation.
 */
export class TealTigerGovernance {
  private config: TealTigerCopilotKitConfig;
  private budgetGuard: BudgetGuard | null;
  private decisions: GovernanceDecision[] = [];

  constructor(config: TealTigerCopilotKitConfig) {
    this.config = config;
    this.budgetGuard = config.budget
      ? new BudgetGuard(config.budget)
      : null;
  }

  /**
   * Evaluate governance policy for an action call.
   *
   * @param actionName - Name of the copilot action
   * @param args - Action arguments (will be scanned for PII if configured)
   * @param userId - User making the request
   * @param tenantId - Tenant/org identifier
   * @returns GovernanceDecision with action taken
   */
  async evaluateAction(
    actionName: string,
    args?: Record<string, unknown>,
    userId?: string,
    tenantId?: string,
  ): Promise<GovernanceDecision> {
    const startTime = performance.now();
    const correlationId = randomUUID();

    let action: GovernanceAction = 'ALLOW';
    let reason = 'Governance evaluation passed';
    const reasonCodes: string[] = [];
    let riskScore = 0;
    let piiFindings: PiiFinding[] = [];

    // 1. Action policy check
    const policyResult = evaluateActionPolicy(actionName, this.config.actionPolicy);
    if (policyResult.verdict === 'DENY') {
      action = 'DENY';
      reason = policyResult.reason;
      reasonCodes.push(policyResult.reasonCode);
      riskScore = 80;
    }

    // 2. PII scanning on action arguments
    if (action === 'ALLOW' && this.config.pii?.scanActionArgs && args) {
      const argsText = JSON.stringify(args);
      piiFindings = scanForPii(argsText, this.config.pii.categories);

      if (piiFindings.length > 0) {
        riskScore = Math.max(riskScore, 60);
        reasonCodes.push('PII_DETECTED_IN_ARGS');

        if (this.config.pii.action === 'block') {
          action = 'DENY';
          reason = `PII detected in action arguments: ${piiFindings.map(f => f.type).join(', ')}`;
        } else if (this.config.pii.action === 'redact') {
          action = 'REDACT';
          reason = `PII redacted from action arguments: ${piiFindings.length} findings`;
        }
      }
    }

    // 3. Budget check
    if (action === 'ALLOW' && this.budgetGuard) {
      const budgetResult = this.budgetGuard.check(userId, tenantId);
      if (budgetResult.exceeded) {
        action = 'DENY';
        reason = `Budget exceeded: ${budgetResult.reason}`;
        reasonCodes.push(budgetResult.reason!);
        riskScore = 100;
      }
    }

    // Apply mode: in OBSERVE/MONITOR mode, never actually deny
    const effectiveAction = this.config.mode === 'ENFORCE' ? action : 'ALLOW';

    const evaluationTimeMs = performance.now() - startTime;

    const decision: GovernanceDecision = {
      correlationId,
      timestamp: new Date().toISOString(),
      action: effectiveAction,
      mode: this.config.mode,
      reason,
      reasonCodes,
      riskScore,
      piiFindings,
      costTracked: 0,
      cumulativeCost: this.budgetGuard?.getState(userId, tenantId)?.sessionCost ?? 0,
      evaluationTimeMs,
      actionName,
      userId,
      tenantId,
    };

    this.decisions.push(decision);

    // Emit audit event
    if (this.config.onAudit) {
      await this.config.onAudit(decision);
    }

    return decision;
  }

  /**
   * Scan text content for PII (used for useCopilotReadable state).
   *
   * @param text - Content to scan
   * @param userId - User identifier for audit
   * @returns Object with scanned/redacted text and governance decision
   */
  async scanContent(
    text: string,
    userId?: string,
    tenantId?: string,
  ): Promise<{ text: string; decision: GovernanceDecision }> {
    const startTime = performance.now();
    const correlationId = randomUUID();

    let outputText = text;
    let action: GovernanceAction = 'ALLOW';
    let reason = 'Content scan passed';
    const reasonCodes: string[] = [];
    let riskScore = 0;
    let piiFindings: PiiFinding[] = [];

    if (this.config.pii) {
      const categories = this.config.pii.categories;

      if (this.config.pii.action === 'redact') {
        const result = redactPii(text, categories);
        piiFindings = result.findings;
        if (piiFindings.length > 0) {
          outputText = result.redacted;
          action = 'REDACT';
          reason = `PII redacted: ${piiFindings.length} findings`;
          reasonCodes.push('PII_REDACTED');
          riskScore = 40;
        }
      } else if (this.config.pii.action === 'block') {
        piiFindings = scanForPii(text, categories);
        if (piiFindings.length > 0) {
          outputText = '';
          action = 'DENY';
          reason = `PII detected: ${piiFindings.map(f => f.type).join(', ')}`;
          reasonCodes.push('PII_BLOCKED');
          riskScore = 80;
        }
      } else {
        // detect only
        piiFindings = scanForPii(text, categories);
        if (piiFindings.length > 0) {
          reasonCodes.push('PII_DETECTED');
          riskScore = 20;
        }
      }
    }

    // Apply mode
    const effectiveAction = this.config.mode === 'ENFORCE' ? action : 'ALLOW';
    if (effectiveAction === 'ALLOW' && action !== 'ALLOW') {
      outputText = text; // Don't actually redact/block in non-ENFORCE modes
    }

    const evaluationTimeMs = performance.now() - startTime;

    const decision: GovernanceDecision = {
      correlationId,
      timestamp: new Date().toISOString(),
      action: effectiveAction,
      mode: this.config.mode,
      reason,
      reasonCodes,
      riskScore,
      piiFindings,
      costTracked: 0,
      cumulativeCost: this.budgetGuard?.getState(userId, tenantId)?.sessionCost ?? 0,
      evaluationTimeMs,
      userId,
      tenantId,
    };

    this.decisions.push(decision);

    if (this.config.onAudit) {
      await this.config.onAudit(decision);
    }

    return { text: outputText, decision };
  }

  /**
   * Record cost after a request completes.
   */
  recordCost(userId?: string, tenantId?: string, cost: number = 0): void {
    this.budgetGuard?.record(userId, tenantId, cost);
  }

  /**
   * Get all governance decisions (audit trail).
   */
  getDecisions(): GovernanceDecision[] {
    return [...this.decisions];
  }

  /**
   * Clear the decision history.
   */
  clearDecisions(): void {
    this.decisions = [];
  }

  /**
   * Get the budget guard instance (for testing/inspection).
   */
  getBudgetGuard(): BudgetGuard | null {
    return this.budgetGuard;
  }
}
