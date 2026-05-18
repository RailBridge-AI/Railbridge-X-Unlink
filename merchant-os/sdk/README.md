# @railbridge/sdk (Prototype)

Lightweight helpers used in the current Merchant OS integration flow.

## Exposed Helpers

1. `protectRoute(...)`
2. `resolveRequirements(...)`
3. `verifyWebhook(...)`
4. `getOnboardingStatus(...)`

## Integration Intent

Merchants use these helpers to:

1. Describe paid routes (`protectRoute`).
2. Resolve payment requirements for a route (`resolveRequirements`).
3. Verify webhook signatures (`verifyWebhook`).
4. Read onboarding checklist state (`getOnboardingStatus`).

## Requirement Resolution Contract

`resolveRequirements(...)` calls the merchant-facing endpoint:

1. `POST /v1/sdk/requirements/resolve`
2. Auth via `x-railbridge-api-key`
3. No merchant/account IDs or internal platform tokens required in merchant code

## Example Import

```js
import {
  protectRoute,
  resolveRequirements,
  verifyWebhook,
  getOnboardingStatus
} from "@railbridge/sdk";
```
