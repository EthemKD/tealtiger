/**
 * TealTiger CopilotKit — Route-Level Budget Guard (Layer 1)
 *
 * Middleware for Next.js/Express route handlers that checks budget
 * BEFORE the CopilotKit runtime processes a request, and records
 * cost AFTER the response.
 *
 * @module tealtiger-copilotkit/route-guard
 */

import { TealTigerGovernance } from './governance';

export interface RouteGuardConfig {
  /** The governance engine instance */
  governance: TealTigerGovernance;
  /** Extract user ID from the request */
  getUserId: (req: Request) => string | undefined;
  /** Extract tenant ID from the request */
  getTenantId?: (req: Request) => string | undefined;
  /** Estimated cost per request (USD) — used for pre-check */
  estimatedCostPerRequest?: number;
  /** Cost per 1000 tokens (USD) — for calculating actual cost */
  costPer1kTokens?: number;
}

/**
 * Create a budget guard that wraps a CopilotKit route handler.
 *
 * Checks budget before processing, records cost after.
 * Returns 429 if budget exceeded.
 *
 * @example
 * ```typescript
 * // Next.js App Router
 * import { createRouteGuard } from "tealtiger-copilotkit";
 *
 * const guard = createRouteGuard({
 *   governance,
 *   getUserId: (req) => req.headers.get("x-user-id") ?? undefined,
 *   getTenantId: (req) => req.headers.get("x-tenant-id") ?? undefined,
 *   costPer1kTokens: 0.003,
 * });
 *
 * export const POST = async (req: Request) => {
 *   const budgetCheck = await guard.checkBudget(req);
 *   if (budgetCheck.denied) return budgetCheck.response;
 *
 *   const response = await handleCopilotRequest(req);
 *
 *   await guard.recordUsage(req, response);
 *   return response;
 * };
 * ```
 */
export function createRouteGuard(config: RouteGuardConfig) {
  const {
    governance,
    getUserId,
    getTenantId,
    estimatedCostPerRequest = 0.01,
    costPer1kTokens = 0.003,
  } = config;

  return {
    /**
     * Check budget before processing a request.
     * Returns a 429 Response if budget exceeded.
     */
    async checkBudget(req: Request): Promise<{ denied: boolean; response?: Response }> {
      const userId = getUserId(req);
      const tenantId = getTenantId?.(req);

      const decision = await governance.evaluateAction(
        '__budget_check__',
        { estimatedCost: estimatedCostPerRequest },
        userId,
        tenantId,
      );

      if (decision.action === 'DENY') {
        const body = JSON.stringify({
          error: 'AI budget exceeded',
          reason: decision.reason,
          reasonCodes: decision.reasonCodes,
          correlationId: decision.correlationId,
          cumulativeCost: decision.cumulativeCost,
        });

        return {
          denied: true,
          response: new Response(body, {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'X-Governance-Decision': decision.action,
              'X-Governance-Correlation-Id': decision.correlationId,
            },
          }),
        };
      }

      return { denied: false };
    },

    /**
     * Record token usage after a request completes.
     * Uses character-count estimation (~4 chars/token) since CopilotKit
     * doesn't expose token counts in response headers.
     */
    async recordUsage(req: Request, _response: Response, responseBody?: string): Promise<void> {
      const userId = getUserId(req);
      const tenantId = getTenantId?.(req);

      let cost = estimatedCostPerRequest;

      // Estimate tokens from response body if available (~4 chars per token)
      if (responseBody) {
        const estimatedTokens = Math.ceil(responseBody.length / 4);
        cost = (estimatedTokens / 1000) * costPer1kTokens;
      }

      governance.recordCost(userId, tenantId, cost);
    },
  };
}
