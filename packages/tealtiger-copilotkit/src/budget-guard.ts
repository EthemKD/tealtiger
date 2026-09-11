/**
 * TealTiger CopilotKit — Budget Guard
 *
 * Per-user, per-tenant, and per-request cost budget enforcement.
 * In-memory tracking with configurable limits.
 *
 * @module tealtiger-copilotkit/budget-guard
 */

import type { BudgetConfig, BudgetState } from './types';

/**
 * In-memory budget tracker for copilot sessions.
 * For production, extend with Redis/DB-backed storage.
 */
export class BudgetGuard {
  private config: BudgetConfig;
  private sessions: Map<string, BudgetState> = new Map();

  constructor(config: BudgetConfig) {
    this.config = config;
  }

  /**
   * Check if a request is within budget.
   *
   * @param userId - User identifier
   * @param tenantId - Tenant/org identifier
   * @param estimatedCost - Estimated cost of the upcoming request (USD)
   * @returns Object with exceeded flag and details
   */
  check(
    userId?: string,
    tenantId?: string,
    estimatedCost: number = 0,
  ): { exceeded: boolean; reason?: string; limit?: number; used?: number; resetAt?: string } {
    const key = this.getSessionKey(userId, tenantId);
    const state = this.getOrCreateState(key, userId, tenantId);

    // Reset daily budget if new day
    this.maybeResetDaily(state);

    // Per-request check
    if (this.config.perRequest && estimatedCost > this.config.perRequest) {
      return {
        exceeded: true,
        reason: 'PER_REQUEST_BUDGET_EXCEEDED',
        limit: this.config.perRequest,
        used: estimatedCost,
      };
    }

    // Per-user session check
    if (this.config.perUser && state.sessionCost + estimatedCost > this.config.perUser) {
      return {
        exceeded: true,
        reason: 'PER_USER_SESSION_BUDGET_EXCEEDED',
        limit: this.config.perUser,
        used: state.sessionCost,
      };
    }

    // Per-tenant daily check
    if (this.config.perTenant && state.dailyCost + estimatedCost > this.config.perTenant) {
      return {
        exceeded: true,
        reason: 'PER_TENANT_DAILY_BUDGET_EXCEEDED',
        limit: this.config.perTenant,
        used: state.dailyCost,
        resetAt: this.getNextResetTime(),
      };
    }

    return { exceeded: false };
  }

  /**
   * Record cost after a request completes.
   *
   * @param userId - User identifier
   * @param tenantId - Tenant/org identifier
   * @param cost - Actual cost of the request (USD)
   */
  record(userId?: string, tenantId?: string, cost: number = 0): void {
    const key = this.getSessionKey(userId, tenantId);
    const state = this.getOrCreateState(key, userId, tenantId);

    state.sessionCost += cost;
    state.dailyCost += cost;
    state.requestCount += 1;
  }

  /**
   * Get current budget state for a user/tenant.
   */
  getState(userId?: string, tenantId?: string): BudgetState | undefined {
    const key = this.getSessionKey(userId, tenantId);
    return this.sessions.get(key);
  }

  /**
   * Reset session budget for a user (e.g., on new conversation).
   */
  resetSession(userId?: string, tenantId?: string): void {
    const key = this.getSessionKey(userId, tenantId);
    const state = this.sessions.get(key);
    if (state) {
      state.sessionCost = 0;
      state.requestCount = 0;
    }
  }

  // --- Private ---

  private getSessionKey(userId?: string, tenantId?: string): string {
    return `${tenantId ?? 'default'}:${userId ?? 'anonymous'}`;
  }

  private getOrCreateState(key: string, userId?: string, tenantId?: string): BudgetState {
    let state = this.sessions.get(key);
    if (!state) {
      state = {
        userId,
        tenantId,
        sessionCost: 0,
        dailyCost: 0,
        requestCount: 0,
        lastResetDate: new Date().toISOString().slice(0, 10),
      };
      this.sessions.set(key, state);
    }
    return state;
  }

  private maybeResetDaily(state: BudgetState): void {
    const today = new Date().toISOString().slice(0, 10);
    if (state.lastResetDate !== today) {
      state.dailyCost = 0;
      state.lastResetDate = today;
    }
  }

  private getNextResetTime(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.toISOString();
  }
}
