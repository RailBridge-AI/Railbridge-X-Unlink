import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACT_FILE = "RevenueRegistry.sol";
const CONTRACT_NAME = "RevenueRegistry";
const CONTRACT_PATH = join(__dirname, "..", "contracts", CONTRACT_FILE);
const ETHERSCAN_V2_API_URL = "https://api.etherscan.io/v2/api";
const ARBITRUM_SEPOLIA_CHAIN_ID = "421614";

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const parseCompilerVersion = () => {
  const versionOutput = execFileSync("solc", ["--version"], {
    encoding: "utf8"
  });
  const match = versionOutput.match(/Version:\s*([0-9]+\.[0-9]+\.[0-9]+\+commit\.[0-9a-fA-F]+)/);
  if (!match?.[1]) {
    throw new Error("Unable to resolve solc compiler version from solc --version");
  }
  return `v${match[1]}`;
};

export const compileRevenueRegistry = () => {
  const sourceCode = readFileSync(CONTRACT_PATH, "utf8");
  const standardInput = {
    language: "Solidity",
    sources: {
      [CONTRACT_FILE]: {
        content: sourceCode
      }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"]
        }
      }
    }
  };

  const rawOutput = execFileSync("solc", ["--standard-json"], {
    input: JSON.stringify(standardInput),
    encoding: "utf8"
  });
  const jsonStart = rawOutput.indexOf("{");
  const parsedOutput = jsonStart >= 0 ? rawOutput.slice(jsonStart) : rawOutput;
  const output = JSON.parse(parsedOutput);
  const errors = output.errors || [];
  const fatal = errors.filter((error) => error.severity === "error");
  if (fatal.length) {
    throw new Error(`Solidity compile failed:\n${fatal.map((item) => item.formattedMessage).join("\n")}`);
  }

  const contract = output?.contracts?.[CONTRACT_FILE]?.[CONTRACT_NAME];
  if (!contract?.evm?.bytecode?.object) {
    throw new Error("Compiled bytecode missing for RevenueRegistry");
  }

  const bytecode = `0x${String(contract.evm.bytecode.object)}`;
  const abi = contract.abi;
  const compilerVersion = parseCompilerVersion();

  return {
    sourceCode,
    standardInput,
    abi,
    bytecode,
    compilerVersion
  };
};

const parseArbiscanJson = async (response) => {
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Arbiscan returned non-JSON response: ${text}`);
  }
  return body;
};

export const submitVerificationToArbiscan = async ({
  apiKey,
  contractAddress,
  constructorArguments,
  standardInput,
  compilerVersion
}) => {
  const url = new URL(ETHERSCAN_V2_API_URL);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("chainid", ARBITRUM_SEPOLIA_CHAIN_ID);
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "verifysourcecode");

  const body = new URLSearchParams({
    contractaddress: contractAddress,
    sourceCode: JSON.stringify(standardInput),
    codeformat: "solidity-standard-json-input",
    contractname: `${CONTRACT_FILE}:${CONTRACT_NAME}`,
    compilerversion: compilerVersion,
    optimizationUsed: "1",
    runs: "200",
    constructorArguments,
    licenseType: "3"
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await parseArbiscanJson(response);
  const resultText = String(data?.result || "");
  const statusText = String(data?.status || "");

  if (statusText === "1") {
    return { guid: resultText, alreadyVerified: false };
  }

  if (/already verified/i.test(resultText)) {
    return { guid: null, alreadyVerified: true };
  }

  throw new Error(`Arbiscan verify submit failed: ${resultText || JSON.stringify(data)}`);
};

export const waitForVerificationResult = async ({
  apiKey,
  guid,
  maxAttempts = 40,
  delayMs = 5000
}) => {
  for (let i = 0; i < maxAttempts; i += 1) {
    const url = new URL(ETHERSCAN_V2_API_URL);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("chainid", ARBITRUM_SEPOLIA_CHAIN_ID);
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "checkverifystatus");
    url.searchParams.set("guid", guid);

    const response = await fetch(url, {
      method: "POST",
    });
    const data = await parseArbiscanJson(response);
    const statusText = String(data?.status || "");
    const resultText = String(data?.result || "");

    if (statusText === "1") {
      return resultText || "Pass - Verified";
    }
    if (/pending in queue/i.test(resultText)) {
      await sleep(delayMs);
      continue;
    }
    throw new Error(`Arbiscan verify failed: ${resultText || JSON.stringify(data)}`);
  }

  throw new Error("Timed out waiting for Arbiscan verification result");
};
