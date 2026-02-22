/**
 * Client Example for RailBridge Cross-Chain Facilitator
 * 
 * This example demonstrates how to interact with a merchant server that uses
 * the RailBridge cross-chain facilitator for x402 payments.
 * 
 * Prerequisites:
 * 1. Set CLIENT_PRIVATE_KEY in .env (your wallet private key)
 * 2. Wallet must have Base Sepolia ETH for gas
 * 3. Wallet must have testnet USDC (or update asset address)
 * 4. Facilitator and merchant server must be running
 * 
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { PaymentRequirements } from "@x402/core/types";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// Get directory of current file (for ESM modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

// Configuration
const MERCHANT_URL = process.env.MERCHANT_URL || "http://localhost:4021";
const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY as `0x${string}` | undefined;

if (!CLIENT_PRIVATE_KEY) {
  console.error("❌ CLIENT_PRIVATE_KEY environment variable is required");
  console.error("   Add it to your .env file:");
  console.error("   CLIENT_PRIVATE_KEY=0xYourPrivateKeyHere");
  process.exit(1);
}

// Create signer from private key
const signer = privateKeyToAccount(CLIENT_PRIVATE_KEY);
console.log(`📱 Client wallet: ${signer.address}\n`);

// Create viem wallet client for signing
const viemClient = createWalletClient({
  account: signer,
  chain: baseSepolia,
  transport: http(process.env.EVM_RPC_URL || "https://sepolia.base.org"),
});

// Create x402 client with custom network selector
// Option 1: Custom selector function to prefer specific networks
const preferredNetworks = [
  "eip155:84532", // Base Sepolia (preferred)
  "eip155:421614", // Arbitrum Sepolia (second choice)
  "eip155:8453",  // Base Mainnet (second choice)
  "eip155:1",     // Ethereum Mainnet (third choice)
  "eip155:137",   // Polygon (last resort)
];

const networkSelector = (
  _x402Version: number,
  options: PaymentRequirements[],
): PaymentRequirements => {
  console.log("📋 Available payment options:");
  options.forEach((opt, i) => {
    console.log(`   ${i + 1}. ${opt.network} (${opt.scheme}) - Amount: ${opt.amount}`);
  });

  // Try each preferred network in order
  for (const preferredNetwork of preferredNetworks) {
    const match = options.find(opt => opt.network === preferredNetwork);
    if (match) {
      console.log(`✨ Selected preferred network: ${match.network}`);
      return match;
    }
  }

  // Fallback to first available option
  console.log(`⚠️  No preferred network available, using: ${options[0].network}`);
  return options[0];
};

// Create x402 client
// Note: The server transforms cross-chain requirements to "exact" on source network
// So the client only needs to register "exact" scheme - no cross-chain awareness needed!
const client = new x402Client(networkSelector);

// Register EVM scheme with the client
// This enables the client to create payment payloads for EVM networks
// The server handles cross-chain transformation, so client only sees "exact" scheme
registerExactEvmScheme(client, { signer });


// Wrap fetch with payment handling
// This automatically handles 402 Payment Required responses
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

/**
 * Example 1: Same-Chain Payment
 * 
 * Makes a request to a paid endpoint. If payment is required (402),
 * the wrapped fetch automatically:
 * 1. Parses payment requirements
 * 2. Creates and signs payment payload
 * 3. Retries request with payment header
 */
async function exampleSameChainPayment() {
  console.log("=".repeat(60));
  console.log("Example 1: Same-Chain Payment");
  console.log("=".repeat(60));
  console.log(`\n📤 Making request to: ${MERCHANT_URL}/api/premium\n`);

  try {
    // Make request - payment is handled automatically
    // NOTE: wrapFetchWithPayment makes TWO calls:
    // 1. First call: Without payment → Gets 402 Payment Required
    // 2. Second call: With payment header → Should get 200 (or 402 if payment fails)
    console.log("📤 Making first request (without payment)...");
    const response = await fetchWithPayment(`${MERCHANT_URL}/api/premium`, {
      method: "GET",
    });

    console.log(`📥 Final response status: ${response.status}`);
    console.log("   (This is the result after automatic retry with payment)");

    if (response.ok) {
      // Payment was successful! (status 200)
      console.log("\n" + "=".repeat(60));
      console.log("✅✅✅ PAYMENT SUCCESSFUL! ✅✅✅");
      console.log("=".repeat(60));
      console.log("\n💡 Status 200 = Payment verified and settled on-chain");
      const data = await response.json();
      console.log("\n📦 Response data:", JSON.stringify(data, null, 2));

      // Get payment receipt from response headers
      const httpClient = new x402HTTPClient(client);
      
      // Debug: Log all response headers
      console.log("\n📋 Response headers:");
      response.headers.forEach((value, key) => {
        console.log(`   ${key}: ${value.substring(0, 100)}${value.length > 100 ? "..." : ""}`);
      });
      
      try {
        const paymentResponse = httpClient.getPaymentSettleResponse(
          (name) => response.headers.get(name),
        );

        if (paymentResponse) {
          console.log("\n💰 Payment Receipt (from response headers):");
          console.log(JSON.stringify(paymentResponse, null, 2));
          console.log(`\n   ✅ Transaction: ${paymentResponse.transaction}`);
          console.log(`   ✅ Network: ${paymentResponse.network}`);
          console.log(`   ✅ Success: ${paymentResponse.success}`);
          if (paymentResponse.payer) {
            console.log(`   ✅ Payer: ${paymentResponse.payer}`);
          }
        }
      } catch (error) {
        console.log("\n⚠️  Could not extract payment receipt from headers");
        console.log(`   Error: ${error instanceof Error ? error.message : error}`);
        console.log("   This is not critical - payment was successful, just missing receipt info");
      }
    } else {
      // Payment failed - make it very explicit
      console.log("\n" + "=".repeat(60));
      console.log("❌❌❌ PAYMENT FAILED ❌❌❌");
      console.log("=".repeat(60));
      console.error(`\n📊 Response Status: ${response.status}`);
      
      // Try to get response body first
      let errorBody: any;
      let responseText: string = "";
      try {
        responseText = await response.text();
        if (responseText) {
          errorBody = JSON.parse(responseText);
        }
      } catch (parseError) {
        // Response body might not be JSON
      }

      // If it's a 402, parse payment requirements and determine failure reason
      if (response.status === 402) {
        const httpClient = new x402HTTPClient(client);
        try {
          const getHeader = (name: string) => response.headers.get(name);
          const paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, errorBody);
          
          // Determine if payment was attempted or not
          const paymentError = paymentRequired.error;
          const paymentWasAttempted = !!paymentError;
          
          if (paymentWasAttempted && paymentError) {
            // Payment was sent but failed verification/settlement
            console.error("\n🔴 PAYMENT VERIFICATION/SETTLEMENT FAILED");
            console.error("   The payment was sent but could not be verified or settled.");
            console.error(`\n❌ Error Code: ${paymentError}`);
            
            // Provide specific error messages
            if (paymentError === "insufficient_funds") {
              console.error("\n💸 INSUFFICIENT FUNDS");
              console.error("   Your wallet doesn't have enough USDC to complete this payment.");
              const requiredAmount = paymentRequired.accepts[0]?.amount || "unknown";
              const requiredAmountUsdc = parseInt(requiredAmount) / 1e6;
              console.error(`\n   Required Amount: ${requiredAmount} (${requiredAmountUsdc} USDC)`);
              console.error(`   Asset Address: ${paymentRequired.accepts[0]?.asset || "unknown"}`);
              console.error(`   Network: ${paymentRequired.accepts[0]?.network || "unknown"}`);
              console.error("\n   💡 To fix this:");
              console.error("      1. Get testnet USDC on Base Sepolia");
              console.error("      2. Make sure your wallet has enough balance");
              console.error("      3. Try the payment again");
            } else if (paymentError === "invalid_payment") {
              console.error("\n🔐 INVALID PAYMENT");
              console.error("   The payment signature or format is invalid.");
              console.error("   This could mean:");
              console.error("      - Payment signature is malformed");
              console.error("      - Payment payload doesn't match requirements");
              console.error("      - Payment has expired");
            } else if (paymentError.includes("verification")) {
              console.error("\n🔍 VERIFICATION FAILED");
              console.error("   The facilitator could not verify your payment.");
              console.error(`   Reason: ${paymentError}`);
            } else if (paymentError.includes("signature")) {
              console.error("\n✍️  SIGNATURE INVALID");
              console.error("   The payment signature could not be verified.");
              console.error("   This could mean:");
              console.error("      - Signature doesn't match the payment data");
              console.error("      - Wrong private key was used");
              console.error("      - Payment was modified after signing");
            } else {
              console.error(`\n⚠️  PAYMENT ERROR: ${paymentError}`);
              console.error("   The payment failed for an unknown reason.");
            }
            
            // Show payment requirements for debugging
            console.error("\n📋 Payment Requirements (for debugging):");
            console.error(JSON.stringify(paymentRequired, null, 2));
          } else {
            // No payment was sent - this shouldn't happen with wrapFetchWithPayment
            console.error("\n⚠️  UNEXPECTED STATE");
            console.error("   Received 402 but no error message.");
            console.error("   This might indicate the payment wasn't sent properly.");
            console.error("\n📋 Payment Requirements:");
            console.error(JSON.stringify(paymentRequired, null, 2));
          }
        } catch (parseError) {
          console.error("\n⚠️  FAILED TO PARSE ERROR RESPONSE");
          console.error("   Could not parse the error response from the server.");
          console.error("   Error:", parseError instanceof Error ? parseError.message : parseError);
          const fallbackBody = errorBody && typeof errorBody === "object" ? errorBody : null;
          const fallbackDetails =
            fallbackBody && typeof fallbackBody.details === "string" ? fallbackBody.details : "";
          if (fallbackBody) {
            console.error("\n   Parsed fallback error body:", JSON.stringify(fallbackBody, null, 2));
          }
          if (fallbackDetails === "insufficient_funds") {
            console.error("\n💡 Likely cause: facilitator relayer has insufficient native gas on selected network.");
            console.error("   Check facilitator wallet gas balance on this chain, or switch source network.");
          } else if (fallbackDetails === "invalid_payment") {
            console.error("\n💡 Likely cause: on-chain authorization validation failed.");
            console.error("   Check USDC domain params/name/version for this network.");
          } else if (fallbackDetails === "transaction_failed") {
            console.error("\n💡 Settlement transaction reverted. Check facilitator logs for the exact revert reason.");
          }
          if (responseText) {
            console.error("\n   Raw response:", responseText.substring(0, 500));
          }
        }
      } else {
        // Non-402 error
        console.error("\n⚠️  UNEXPECTED HTTP ERROR");
        console.error(`   Status: ${response.status}`);
        if (errorBody) {
          console.error("   Response body:", JSON.stringify(errorBody, null, 2));
        } else if (responseText) {
          console.error("   Response text:", responseText.substring(0, 500));
        }
      }
      
      // Always show response headers for debugging
      console.error("\n📋 Response Headers (for debugging):");
      response.headers.forEach((value, key) => {
        console.error(`   ${key}: ${value.substring(0, 100)}${value.length > 100 ? "..." : ""}`);
      });
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error("📚 Stack trace:");
      console.error(error.stack);
    }
  }
}

/**
 * Example 2: Cross-Chain Payment
 * 
 * For cross-chain payments, the merchant server includes a cross-chain extension
 * in the PaymentRequired response. The client automatically copies this extension
 * into the PaymentPayload, and the facilitator handles the cross-chain routing.
 * 
 * Note: The client doesn't need to know about cross-chain details - it just
 * signs the payment for the source chain as specified in the extension.
 */
async function exampleCrossChainPayment() {
  console.log("\n" + "=".repeat(60));
  console.log("Example 2: Cross-Chain Payment");
  console.log("=".repeat(60));
  console.log("\n💡 Note: Cross-chain payments work the same way!");
  console.log("   The merchant's PaymentRequired includes a cross-chain extension");
  console.log("   The client copies it to PaymentPayload");
  console.log("   The facilitator handles routing and bridging\n");

  try {
    const response = await fetchWithPayment(`${MERCHANT_URL}/api/premium`, {
      method: "GET",
    });

    console.log(`📥 Response status: ${response.status}`);

    if (response.ok) {
      const data = await response.json();
      console.log("✅ Payment successful!");
      console.log("📦 Response data:", JSON.stringify(data, null, 2));

      // Get payment receipt
      const httpClient = new x402HTTPClient(client);
      const paymentResponse = httpClient.getPaymentSettleResponse(
        (name) => response.headers.get(name),
      );

      if (paymentResponse) {
        console.log("\n💰 Payment Receipt:");
        console.log(`   Transaction: ${paymentResponse.transaction}`);
        console.log(`   Network: ${paymentResponse.network}`);
        console.log(`   Success: ${paymentResponse.success}`);
        console.log("\n💡 For cross-chain:");
        console.log("   - Transaction is on source chain");
        console.log("   - Bridging happens asynchronously");
        console.log("   - Merchant receives on destination chain");
      }
    } else {
      const errorText = await response.text();
      console.error("❌ Request failed:");
      console.error(errorText);
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
  }
}

/**
 * Example 3: Manual Payment Flow (Advanced)
 * 
 * Shows how to manually handle the payment flow if you need more control.
 * This is useful for debugging or custom payment logic.
 */
async function exampleManualPaymentFlow() {
  console.log("\n" + "=".repeat(60));
  console.log("Example 3: Manual Payment Flow (Advanced)");
  console.log("=".repeat(60) + "\n");

  try {
    // Step 1: Make initial request
    console.log("📤 Step 1: Making initial request...");
    const response = await fetch(`${MERCHANT_URL}/api/premium`);

    if (response.status !== 402) {
      console.log("✅ No payment required");
      const data = await response.json();
      console.log("Response:", data);
      return;
    }

    console.log("💳 Step 2: Received 402 Payment Required");

    // Step 2: Parse payment requirements
    const httpClient = new x402HTTPClient(client);
    const getHeader = (name: string) => response.headers.get(name);
    let body: any;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    const paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, body);
    console.log("📋 Payment Requirements:");
    console.log(JSON.stringify(paymentRequired, null, 2));

    // Step 3: Create payment payload
    console.log("\n✍️  Step 3: Creating payment payload...");
    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    console.log("✅ Payment payload created");

    // Step 4: Encode payment header
    console.log("\n📦 Step 4: Encoding payment header...");
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
    console.log("✅ Payment header encoded");

    // Step 5: Retry with payment
    console.log("\n🔄 Step 5: Retrying request with payment...");
    const retryResponse = await fetch(`${MERCHANT_URL}/api/premium`, {
      headers: paymentHeaders,
    });

    console.log(`📥 Response status: ${retryResponse.status}`);

    if (retryResponse.ok) {
      const data = await retryResponse.json();
      console.log("✅ Payment successful!");
      console.log("📦 Response data:", JSON.stringify(data, null, 2));

      // Get payment receipt
      const paymentResponse = httpClient.getPaymentSettleResponse(
        (name) => retryResponse.headers.get(name),
      );

      if (paymentResponse) {
        console.log("\n💰 Payment Receipt:");
        console.log(JSON.stringify(paymentResponse, null, 2));
      }
    } else {
      const errorText = await retryResponse.text();
      console.error("❌ Payment failed:");
      console.error(errorText);
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
  }
}

/**
 * Main function
 */
async function main() {
  console.log("🚀 RailBridge Client Example\n");
  console.log(`Merchant URL: ${MERCHANT_URL}`);
  console.log(`Client Address: ${signer.address}\n`);

  // Run examples
  await exampleSameChainPayment();
  // await exampleCrossChainPayment(); // Commented out for testing
  // await exampleManualPaymentFlow(); // Commented out for testing

  console.log("\n" + "=".repeat(60));
  console.log("Examples complete!");
  console.log("=".repeat(60) + "\n");
}

// Run if executed directly
// This check ensures main() only runs when the file is executed as a script,
// not when it's imported as a module
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && fileURLToPath(`file://${process.argv[1]}`) === currentFilePath) {
  main().catch(console.error);
}

export { exampleSameChainPayment, exampleCrossChainPayment, exampleManualPaymentFlow };
