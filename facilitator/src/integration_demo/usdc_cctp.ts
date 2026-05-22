// Import Bridge Kit and its dependencies
import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { inspect } from "util";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "..", "..", ".env");
dotenv.config({ path: envPath });

// Initialize the SDK
const kit = new BridgeKit();

// const bridgeUSDC = async (): Promise<void> => {
//   try {
//     // Initialize the adapter which lets you transfer tokens from your wallet on any EVM-compatible chain
//     const adapter = createViemAdapterFromPrivateKey({
//       privateKey: process.env.FACILITATOR_EVM_PRIVATE_KEY as string,
//     });

//     console.log("---------------Starting Bridging---------------");

//     // Use the same adapter for the source and destination blockchains
//     const result = await kit.bridge({
//       from: { adapter, chain: "Base_Sepolia" },
//       to: { adapter, chain: "Arbitrum_Sepolia", recipientAddress: "0xe30887D4204055643dbde63e64c132Add039367b"},
//       amount: "0.01",
//     });

//     console.log("RESULT", inspect(result, false, null, true));
//   } catch (err) {
//     console.log("ERROR", inspect(err, false, null, true));
//   }
// };

// List supported chains
const chainDef = kit.getSupportedChains(); 
console.log("Supported chains:", chainDef); 

// Dont run the bridge function
// void bridgeUSDC();
