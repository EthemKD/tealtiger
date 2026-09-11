/**
 * TealTiger CopilotKit — Action Handler Wrapper (Layer 2)
 *
 * Wraps individual CopilotKit action handlers with governance policy.
 * Use this when you want per-action governance without full middleware.
 *
 * @module tealtiger-copilotkit/with-tealtiger-policy
 */

import { TealTigerGovernance } from './governance';
import type { GovernanceDecision } from './types';

export interface PolicyWrapperOptions {
  /** The governance engine instance */
  governance: TealTigerGovernance;
  /** Override action name (defaults to the action's registered name) */
  actionName?: string;
  /** User context from server-side auth (NOT client-supplied) */
  user?: {
    id?: string;
    tenantId?: string;
    roles?: string[];
    plan?: string;
  };
  /** User ID extractor from action context (legacy — prefer `user`) */
  getUserId?: (args: Record<string, unknown>) => string | undefined;
  /** Tenant ID extractor from action context (legacy — prefer `user`) */
  getTenantId?: (args: Record<string, unknown>) => string | undefined;
}

/**
 * Wrap a CopilotKit action handler with TealTiger governance.
 *
 * Evaluates policy before the handler runs. If DENY, returns a
 * governance denial message instead of executing the action.
 *
 * @example
 * ```typescript
 * import { withTealTigerPolicy } from "tealtiger-copilotkit";
 *
 * const action = {
 *   name: "deleteRecord",
 *   handler: withTealTigerPolicy(
 *     { governance, actionName: "deleteRecord" },
 *     async ({ recordId }) => {
 *       return await db.delete(recordId);
 *     }
 *   ),
 * };
 * ```
 */
export function withTealTigerPolicy<TArgs extends Record<string, unknown>, TResult>(
  options: PolicyWrapperOptions,
  handler: (args: TArgs) => TResult | Promise<TResult>,
): (args: TArgs) => Promise<TResult | string> {
  return async (args: TArgs): Promise<TResult | string> => {
    const userId = options.user?.id ?? options.getUserId?.(args);
    const tenantId = options.user?.tenantId ?? options.getTenantId?.(args);
    const actionName = options.actionName ?? 'unknown_action';

    const decision: GovernanceDecision = await options.governance.evaluateAction(
      actionName,
      args,
      userId,
      tenantId,
    );

    if (decision.action === 'DENY') {
      return `[Governance] Action denied: ${decision.reason}`;
    }

    // If REDACT, we could transform args here in the future
    // For now, proceed with original args
    return handler(args);
  };
}
