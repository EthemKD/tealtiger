# tealtiger-copilotkit

Deterministic governance middleware for [CopilotKit](https://www.copilotkit.ai/) — action authorization, PII scanning, cost budgets, and structured audit trail.

**No LLM in the governance path.** All policy evaluation is deterministic, adding <2ms latency.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Installation

```bash
npm install tealtiger-copilotkit
```

## Three-Layer Governance

| Layer | What it does | Where it runs |
|-------|-------------|---------------|
| **Route Guard** | Per-user/tenant budget check + cost recording | Next.js route handler (before/after CopilotKit runtime) |
| **Action Wrapper** | Per-action authorization + PII scanning | Individual action handlers |
| **Content Scanner** | PII detection/redaction on `useCopilotReadable` state | Before context enters the model |

## Quick Start

### 1. Create the Governance Engine

```typescript
import { TealTigerGovernance } from "tealtiger-copilotkit";

const governance = new TealTigerGovernance({
  mode: "ENFORCE", // OBSERVE | MONITOR | ENFORCE
  actionPolicy: {
    allowlist: ["searchDocs", "updatePreferences", "getAnalytics"],
    denylist: ["deleteAccount", "transferFunds", "exportAllData"],
  },
  pii: {
    scanReadable: true,
    scanActionArgs: true,
    action: "redact",
    categories: ["ssn", "credit_card", "api_key"],
  },
  budget: {
    perUser: 0.50,
    perTenant: 50.00,
  },
});
```

### 2. Route-Level Budget Guard

```typescript
import { createRouteGuard } from "tealtiger-copilotkit";

const guard = createRouteGuard({
  governance,
  getUserId: (req) => req.headers.get("x-user-id") ?? undefined,
  getTenantId: (req) => req.headers.get("x-tenant-id") ?? undefined,
  costPer1kTokens: 0.003,
});

// Next.js App Router
export const POST = async (req: Request) => {
  // Check budget BEFORE processing
  const check = await guard.checkBudget(req);
  if (check.denied) return check.response; // 429

  // Process normally
  const response = await handleCopilotRequest(req);

  // Record usage AFTER
  await guard.recordUsage(req, response);
  return response;
};
```

### 3. Action Handler Wrapper

```typescript
import { withTealTigerPolicy } from "tealtiger-copilotkit";

const actions = [
  {
    name: "deleteRecord",
    description: "Deletes a customer record",
    parameters: [{ name: "recordId", type: "string" }],
    handler: withTealTigerPolicy(
      { governance, actionName: "deleteRecord" },
      async ({ recordId }) => {
        // Only runs if governance allows
        return await db.delete(recordId);
      }
    ),
  },
];
```

### 4. Content PII Scanner

Scan arbitrary content (e.g. a serialized `useCopilotReadable` value) before it enters the model:

```typescript
const userState = getUserData(); // may contain PII
const { text: safeState, decision } = await governance.scanContent(
  JSON.stringify(userState),
  userId,
  tenantId,
);

// safeState has PII redacted — safe to pass to copilot
// decision contains audit record of what was found
```

### 4b. Scanning CopilotKit readable context

`scanCopilotKitRequest()` targets the readable context CopilotKit actually
sends to the model, and handles **both** CopilotKit generations:

- **v1** — readable context is serialized into the **system message** as a
  fenced code block (following the marker line *"The user has provided you
  with the following context:"*, emitted by `defaultSystemMessage`). The
  scanner redacts inside that fenced block only, leaving the rest of the
  prompt and all user/assistant turns untouched.
- **v2** — readable context is a structured array
  `context: [{ description, value }]` on the agent input (`runAgent` /
  `connectAgent`). The scanner redacts each entry's `value`; `description`
  labels are left intact.

```typescript
import { scanCopilotKitRequest } from "tealtiger-copilotkit";

// Works whether the body carries a v2 `context` array or a v1 system message
const { body, findings, blocked } = scanCopilotKitRequest(
  parsedRequestBody,
  ["ssn", "credit_card", "email", "api_key"],
  "redact", // "detect" | "redact" | "block"
);
// `body` is safe to forward; `findings` is the audit record
```

If neither shape is present, the scanner does **not** silently pass content
through — it emits a warning and returns the body unchanged, so a
CopilotKit format change surfaces in your logs rather than disabling PII
scanning invisibly.

> This replaces the pre-0.2.0 behavior, which targeted a `<TextContext>` tag
> that does not exist in CopilotKit and therefore never matched real traffic.
> See the [changelog](#changelog).

## Governance Modes

| Mode | Behavior |
|------|----------|
| **OBSERVE** | Log all decisions but never block. PII findings recorded, actions still execute. |
| **MONITOR** | Log + emit warnings. Actions still execute but decisions are flagged. |
| **ENFORCE** | Block violating actions. PII redacted/blocked. Budget enforced with 429. |

## Audit Trail

Every evaluation produces a structured `GovernanceDecision`:

```json
{
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-07-24T14:00:00.000Z",
  "action": "DENY",
  "mode": "ENFORCE",
  "reason": "Action 'deleteAccount' is in the denylist",
  "reasonCodes": ["ACTION_DENIED"],
  "riskScore": 80,
  "piiFindings": [],
  "costTracked": 0,
  "cumulativeCost": 0.42,
  "evaluationTimeMs": 0.8,
  "actionName": "deleteAccount",
  "userId": "user-123",
  "tenantId": "acme-corp"
}
```

Access via `governance.getDecisions()` or the `onAudit` callback.

## PII Detection

Built-in deterministic patterns for:
- Social Security Numbers (SSN)
- Credit card numbers (Visa, Mastercard, Amex, Discover)
- Email addresses
- Phone numbers (US/international)
- API keys (OpenAI, AWS, GitHub, GitLab)
- IP addresses

## Changelog

### 0.2.0

- **Fix (readable-context PII scanning):** the scanner previously targeted a
  `<TextContext>` tag that does not exist anywhere in CopilotKit, so
  `scanCopilotKitRequest()` silently no-op'd on real traffic — readable-context
  PII was never actually redacted. It now targets the real formats:
  - **v1:** the fenced context block in the system message emitted by
    `defaultSystemMessage`.
  - **v2:** the structured `context: [{ description, value }]` array on the
    agent input.
- **New:** `scanReadableContextArray(context, categories, action)` for
  directly scanning a v2 context array, exported alongside the existing
  `scanReadableContext` and `scanCopilotKitRequest`.
- When no readable context is found, the scanner now emits a warning instead
  of silently doing nothing.

### 0.1.x

- Initial three-layer governance (route guard, action wrapper, content
  scanner). The 0.1.x content scanner did not work against real CopilotKit
  output — upgrade to 0.2.0.

## License

Apache-2.0 — see [LICENSE](LICENSE).
