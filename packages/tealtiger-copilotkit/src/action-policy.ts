/**
 * TealTiger CopilotKit — Action Policy Evaluator
 *
 * Deterministic allowlist/denylist evaluation for copilot actions.
 * Denylist takes precedence over allowlist.
 *
 * @module tealtiger-copilotkit/action-policy
 */

import type { ActionPolicyConfig } from './types';

export type PolicyVerdict = 'ALLOW' | 'DENY';

export interface PolicyResult {
  verdict: PolicyVerdict;
  reason: string;
  reasonCode: string;
}

/**
 * Evaluate whether an action is authorized by policy.
 *
 * Rules:
 * 1. If denylist is configured and action matches → DENY
 * 2. If allowlist is configured and action does NOT match → DENY
 * 3. If neither is configured → ALLOW (no policy = passthrough)
 * 4. Glob patterns supported (e.g., "delete*" matches "deleteAccount")
 *
 * @param actionName - The action being invoked
 * @param policy - The configured action policy
 * @returns PolicyResult with verdict and reason
 */
export function evaluateActionPolicy(
  actionName: string,
  policy: ActionPolicyConfig | undefined,
): PolicyResult {
  if (!policy) {
    return {
      verdict: 'ALLOW',
      reason: 'No action policy configured',
      reasonCode: 'NO_POLICY',
    };
  }

  // Denylist takes precedence
  if (policy.denylist && policy.denylist.length > 0) {
    if (matchesPattern(actionName, policy.denylist)) {
      return {
        verdict: 'DENY',
        reason: `Action '${actionName}' is in the denylist`,
        reasonCode: 'ACTION_DENIED',
      };
    }
  }

  // Allowlist check (if configured, action must be in it)
  if (policy.allowlist && policy.allowlist.length > 0) {
    if (!matchesPattern(actionName, policy.allowlist)) {
      return {
        verdict: 'DENY',
        reason: `Action '${actionName}' is not in the allowlist`,
        reasonCode: 'ACTION_NOT_ALLOWED',
      };
    }
  }

  return {
    verdict: 'ALLOW',
    reason: 'Action authorized by policy',
    reasonCode: 'ACTION_AUTHORIZED',
  };
}

/**
 * Check if a name matches any pattern in the list.
 * Supports simple glob: * matches any characters.
 */
function matchesPattern(name: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === name) return true;
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*') + '$',
      );
      if (regex.test(name)) return true;
    }
  }
  return false;
}
