import {
  getPolicy,
  getTenantProfile,
  getTimeline,
  listApiKeys,
  listApiProducts,
  listChainCatalog,
  listWebhookEndpoints
} from "../db.js";
import { nowIso } from "../utils.js";

const isSystemIssuedApiKeyName = (name) => {
  const value = String(name || "").trim().toLowerCase();
  return value === "default api key" || value.startsWith("console session ");
};

export const buildOnboardingChecklist = (merchantId, accountId) => {
  const apiKeys = listApiKeys(merchantId, accountId);
  const userCreatedActiveApiKeys = apiKeys.filter(
    (key) => key.status === "active" && !isSystemIssuedApiKeyName(key.name)
  );
  const webhooks = listWebhookEndpoints(merchantId, accountId);
  const products = listApiProducts(merchantId, accountId);
  const hasActiveWebhook = webhooks.some((webhook) => webhook.status === "active");
  const hasActiveProduct = products.some((product) => Boolean(product.enabled));
  const timeline = getTimeline(merchantId, accountId, 10).filter((item) => item.itemType === "settlement");
  const payouts = getTimeline(merchantId, accountId, 20).filter((item) => item.itemType === "payout");
  const hasSandboxSettlement = timeline.length > 0;
  const hasPayout = payouts.some((item) => item.status === "completed");

  return {
    merchantId,
    accountId,
    steps: [
      {
        id: "api_key",
        label: "Create API key",
        completed: userCreatedActiveApiKeys.length > 0
      },
      {
        id: "webhook",
        label: "Register webhook endpoint",
        completed: hasActiveWebhook
      },
      {
        id: "product",
        label: "Create first paid product",
        completed: hasActiveProduct
      },
      {
        id: "sandbox_payment",
        label: "Receive first sandbox payment",
        completed: hasSandboxSettlement
      },
      {
        id: "payout_test",
        label: "Run payout test",
        completed: hasPayout
      }
    ],
    completedAt: hasSandboxSettlement && hasPayout ? nowIso() : null
  };
};

export const buildTenantSettingsPayload = (merchantId, accountId) => {
  const profile = getTenantProfile(merchantId, accountId);
  const policy = getPolicy(merchantId, accountId);
  return {
    merchantId,
    accountId,
    merchantName: profile?.merchantName || "",
    accountName: profile?.accountName || "",
    user: profile?.userEmail
      ? {
          email: profile.userEmail,
          role: profile.userRole || "admin"
        }
      : null,
    apiKeys: listApiKeys(merchantId, accountId),
    webhooks: listWebhookEndpoints(merchantId, accountId),
    chains: listChainCatalog(),
    policy: policy || null,
    checklist: buildOnboardingChecklist(merchantId, accountId)
  };
};
