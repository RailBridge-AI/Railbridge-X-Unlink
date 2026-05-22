export const BACKEND_REQUIREMENTS_SNIPPET = `// Backend helper (Node/Express example)
async function resolveRailBridgeRequirements({ apiId, method, path }) {
  const response = await fetch(\`\${process.env.RB_MERCHANT_OS_URL}/v1/sdk/requirements/resolve\`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-railbridge-api-key": process.env.RB_API_KEY
    },
    body: JSON.stringify({
      apiId,
      method,
      path
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || \`resolve failed (\${response.status})\`);
  }
  return payload;
}

// Example paid route wiring (simplified)
app.get("/api/premium", async (req, res, next) => {
  try {
    const resolved = await resolveRailBridgeRequirements({
      apiId: "premium_api",
      method: "GET",
      path: "/api/premium"
    });

    // Pass resolved.requirement(s) into your payment middleware/adapter.
    // After successful payment, continue normal business logic.
    return res.json({ ok: true, requirements: resolved.requirements || [resolved.requirement] });
  } catch (error) {
    return next(error);
  }
});`;

export const BACKEND_REQUIREMENTS_CURL = `curl -X POST "$RB_MERCHANT_OS_URL/v1/sdk/requirements/resolve" \\
  -H "content-type: application/json" \\
  -H "x-railbridge-api-key: $RB_API_KEY" \\
  -d '{
    "apiId":"premium_api",
    "method":"GET",
    "path":"/api/premium"
  }'`;
