process.env.PAYMENT_TEST_CONFIG_SECTION =
  process.env.PAYMENT_TEST_CONFIG_SECTION || "existingMerchantPaymentPublicTestnet";

await import("./pay-existing-merchant-testnet.ts");
