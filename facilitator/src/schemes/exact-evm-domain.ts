import { getAddress, isAddressEqual, parseErc6492Signature, parseSignature } from "viem";
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkClient,
  SchemeNetworkFacilitator,
} from "@x402/core/types";

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const eip3009ABI = [
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    name: "transferWithAuthorization",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    name: "transferWithAuthorization",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "version",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

type DomainExtra = {
  fields?: number;
  chainId?: number;
  salt?: `0x${string}`;
};

const createNonce = () => {
  const cryptoObj = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (!cryptoObj) {
    throw new Error("Crypto API not available");
  }
  const bytes = cryptoObj.getRandomValues(new Uint8Array(32));
  return `0x${Buffer.from(bytes).toString("hex")}` as const;
};

const buildDomain = (
  requirements: PaymentRequirements,
  name: string,
  version: string,
  verifyingContract: string,
) => {
  const extra = requirements.extra as { domain?: DomainExtra } | undefined;
  const domainExtra = extra?.domain;
  const chainId =
    domainExtra?.chainId ?? parseInt(requirements.network.split(":")[1]);

  const fields = domainExtra?.fields;
  const includeName = fields ? (fields & 0x1) !== 0 : true;
  const includeVersion = fields ? (fields & 0x2) !== 0 : true;
  const includeChainId = fields ? (fields & 0x4) !== 0 : domainExtra?.salt ? false : true;
  const includeVerifying = fields ? (fields & 0x8) !== 0 : true;
  const includeSalt = fields ? (fields & 0x10) !== 0 : Boolean(domainExtra?.salt);

  const domain: Record<string, unknown> = {};
  if (includeName) domain.name = name;
  if (includeVersion) domain.version = version;
  if (includeVerifying) domain.verifyingContract = getAddress(verifyingContract);
  if (includeChainId) domain.chainId = BigInt(chainId);
  if (includeSalt && domainExtra?.salt) domain.salt = domainExtra.salt;

  return domain;
};

const toErrorText = (error: unknown): string => {
  if (!error) {
    return "unknown error";
  }

  const parts: string[] = [];
  const anyError = error as any;
  if (typeof anyError.shortMessage === "string" && anyError.shortMessage) {
    parts.push(anyError.shortMessage);
  }
  if (typeof anyError.details === "string" && anyError.details) {
    parts.push(anyError.details);
  }
  if (Array.isArray(anyError.metaMessages)) {
    anyError.metaMessages
      .filter((item: unknown) => typeof item === "string" && item)
      .forEach((item: string) => parts.push(item));
  }
  if (anyError.cause) {
    parts.push(toErrorText(anyError.cause));
  }
  if (error instanceof Error && error.message) {
    parts.push(error.message);
  } else if (typeof error === "string") {
    parts.push(error);
  }

  const normalized = parts
    .map((part) => part.trim())
    .filter(Boolean);

  return normalized.length ? normalized.join(" | ") : String(error);
};

const classifySettlementErrorReason = (message: string): string => {
  const lower = message.toLowerCase();
  if (lower.includes("insufficient funds") && (lower.includes("gas") || lower.includes("fee"))) {
    return "insufficient_funds";
  }
  if (
    lower.includes("authorization is used") ||
    lower.includes("authorization has expired") ||
    lower.includes("invalid signature")
  ) {
    return "invalid_payment";
  }
  return "transaction_failed";
};

export class ExactEvmSchemeDomainClient implements SchemeNetworkClient {
  readonly scheme = "exact";

  constructor(
    private signer: {
      address: `0x${string}`;
      signTypedData: (args: {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
      }) => Promise<`0x${string}`>;
    },
  ) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    const nonce = createNonce();
    const now = Math.floor(Date.now() / 1e3);
    const authorization = {
      from: this.signer.address,
      to: getAddress(paymentRequirements.payTo),
      value: paymentRequirements.amount,
      validAfter: (now - 600).toString(),
      validBefore: (now + paymentRequirements.maxTimeoutSeconds).toString(),
      nonce,
    };

    const extra = paymentRequirements.extra as { name?: string; version?: string } | undefined;
    if (!extra?.name || !extra?.version) {
      throw new Error(
        `EIP-712 domain parameters (name, version) are required in payment requirements for asset ${paymentRequirements.asset}`,
      );
    }

    const domain = buildDomain(
      paymentRequirements,
      extra.name,
      extra.version,
      paymentRequirements.asset,
    );
    const message = {
      from: getAddress(authorization.from),
      to: getAddress(authorization.to),
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    };
    const signature = await this.signer.signTypedData({
      domain,
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization",
      message,
    });

    return {
      x402Version,
      payload: { authorization, signature },
    };
  }
}

export class ExactEvmSchemeDomainFacilitator implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "eip155:*";

  constructor(
    private signer: {
      getAddresses: () => readonly string[];
      verifyTypedData: (args: {
        address: `0x${string}`;
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
        signature: `0x${string}`;
      }) => Promise<boolean>;
      readContract: (args: {
        address: `0x${string}`;
        abi: readonly unknown[];
        functionName: string;
        args?: readonly unknown[];
      }) => Promise<unknown>;
      writeContract: (args: {
        address: `0x${string}`;
        abi: readonly unknown[];
        functionName: string;
        args: readonly unknown[];
      }) => Promise<`0x${string}`>;
      sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) => Promise<`0x${string}`>;
      waitForTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: string }>;
      getCode: (args: { address: `0x${string}` }) => Promise<`0x${string}` | undefined>;
    },
    private config?: { deployERC4337WithEIP6492?: boolean },
  ) {}

  getExtra(): Record<string, unknown> | undefined {
    return undefined;
  }

  getSigners(): string[] {
    return Array.from(this.signer.getAddresses());
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements) {
    const exactEvmPayload = payload.payload as {
      authorization: {
        from: `0x${string}`;
        to: `0x${string}`;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: `0x${string}`;
      };
      signature: `0x${string}`;
    };

    if (payload.accepted.scheme !== "exact" || requirements.scheme !== "exact") {
      return { isValid: false, invalidReason: "unsupported_scheme", payer: exactEvmPayload.authorization.from };
    }

    const extra = requirements.extra as { name?: string; version?: string } | undefined;
    if (!extra?.name || !extra?.version) {
      return { isValid: false, invalidReason: "missing_eip712_domain", payer: exactEvmPayload.authorization.from };
    }

    if (payload.accepted.network !== requirements.network) {
      return { isValid: false, invalidReason: "network_mismatch", payer: exactEvmPayload.authorization.from };
    }

    const domain = buildDomain(requirements, extra.name, extra.version, requirements.asset);
    const message = {
      from: exactEvmPayload.authorization.from,
      to: exactEvmPayload.authorization.to,
      value: BigInt(exactEvmPayload.authorization.value),
      validAfter: BigInt(exactEvmPayload.authorization.validAfter),
      validBefore: BigInt(exactEvmPayload.authorization.validBefore),
      nonce: exactEvmPayload.authorization.nonce,
    };

    try {
      const recovered = await this.signer.verifyTypedData({
        address: exactEvmPayload.authorization.from,
        domain,
        types: authorizationTypes,
        primaryType: "TransferWithAuthorization",
        message,
        signature: exactEvmPayload.signature,
      });
      if (!recovered) {
        return {
          isValid: false,
          invalidReason: "invalid_exact_evm_payload_signature",
          payer: exactEvmPayload.authorization.from,
        };
      }
    } catch {
      return {
        isValid: false,
        invalidReason: "invalid_exact_evm_payload_signature",
        payer: exactEvmPayload.authorization.from,
      };
    }

    if (getAddress(exactEvmPayload.authorization.to) !== getAddress(requirements.payTo)) {
      return {
        isValid: false,
        invalidReason: "invalid_exact_evm_payload_recipient_mismatch",
        payer: exactEvmPayload.authorization.from,
      };
    }

    const now = Math.floor(Date.now() / 1e3);
    if (BigInt(exactEvmPayload.authorization.validBefore) < BigInt(now + 6)) {
      return {
        isValid: false,
        invalidReason: "invalid_exact_evm_payload_authorization_valid_before",
        payer: exactEvmPayload.authorization.from,
      };
    }
    if (BigInt(exactEvmPayload.authorization.validAfter) > BigInt(now)) {
      return {
        isValid: false,
        invalidReason: "invalid_exact_evm_payload_authorization_valid_after",
        payer: exactEvmPayload.authorization.from,
      };
    }

    try {
      const balance = (await this.signer.readContract({
        address: getAddress(requirements.asset),
        abi: eip3009ABI,
        functionName: "balanceOf",
        args: [exactEvmPayload.authorization.from],
      })) as bigint;
      if (BigInt(balance) < BigInt(requirements.amount)) {
        return {
          isValid: false,
          invalidReason: "insufficient_funds",
          payer: exactEvmPayload.authorization.from,
        };
      }
    } catch {
      // ignore balance check failures
    }

    if (BigInt(exactEvmPayload.authorization.value) < BigInt(requirements.amount)) {
      return {
        isValid: false,
        invalidReason: "invalid_exact_evm_payload_authorization_value",
        payer: exactEvmPayload.authorization.from,
      };
    }

    return { isValid: true, invalidReason: undefined, payer: exactEvmPayload.authorization.from };
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements) {
    const exactEvmPayload = payload.payload as {
      authorization: {
        from: `0x${string}`;
        to: `0x${string}`;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: `0x${string}`;
      };
      signature: `0x${string}`;
    };

    const valid = await this.verify(payload, requirements);
    if (!valid.isValid) {
      return {
        success: false,
        network: payload.accepted.network,
        transaction: "",
        errorReason: valid.invalidReason ?? "invalid_scheme",
        payer: exactEvmPayload.authorization.from,
      };
    }

    try {
      const parseResult = parseErc6492Signature(exactEvmPayload.signature);
      const { signature, address: factoryAddress, data: factoryCalldata } = parseResult;
      if (
        this.config?.deployERC4337WithEIP6492 &&
        factoryAddress &&
        factoryCalldata &&
        !isAddressEqual(factoryAddress, "0x0000000000000000000000000000000000000000")
      ) {
        const payerAddress = exactEvmPayload.authorization.from;
        const bytecode = await this.signer.getCode({ address: payerAddress });
        if (!bytecode || bytecode === "0x") {
          const deployTx = await this.signer.sendTransaction({
            to: factoryAddress,
            data: factoryCalldata,
          });
          await this.signer.waitForTransactionReceipt({ hash: deployTx });
        }
      }

      const signatureLength = signature.startsWith("0x") ? signature.length - 2 : signature.length;
      const isECDSA = signatureLength === 130;
      let tx: `0x${string}`;

      if (isECDSA) {
        const parsedSig = parseSignature(signature);
        tx = await this.signer.writeContract({
          address: getAddress(requirements.asset),
          abi: eip3009ABI,
          functionName: "transferWithAuthorization",
          args: [
            getAddress(exactEvmPayload.authorization.from),
            getAddress(exactEvmPayload.authorization.to),
            BigInt(exactEvmPayload.authorization.value),
            BigInt(exactEvmPayload.authorization.validAfter),
            BigInt(exactEvmPayload.authorization.validBefore),
            exactEvmPayload.authorization.nonce,
            parsedSig.v || parsedSig.yParity,
            parsedSig.r,
            parsedSig.s,
          ],
        });
      } else {
        tx = await this.signer.writeContract({
          address: getAddress(requirements.asset),
          abi: eip3009ABI,
          functionName: "transferWithAuthorization",
          args: [
            getAddress(exactEvmPayload.authorization.from),
            getAddress(exactEvmPayload.authorization.to),
            BigInt(exactEvmPayload.authorization.value),
            BigInt(exactEvmPayload.authorization.validAfter),
            BigInt(exactEvmPayload.authorization.validBefore),
            exactEvmPayload.authorization.nonce,
            signature,
          ],
        });
      }

      const receipt = await this.signer.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success") {
        return {
          success: false,
          errorReason: "invalid_transaction_state",
          transaction: tx,
          network: payload.accepted.network,
          payer: exactEvmPayload.authorization.from,
        };
      }
      return {
        success: true,
        transaction: tx,
        network: payload.accepted.network,
        payer: exactEvmPayload.authorization.from,
      };
    } catch (error) {
      const errorMessage = toErrorText(error);
      const errorReason = classifySettlementErrorReason(errorMessage);
      console.error("Failed to settle transaction:", {
        network: payload.accepted.network,
        asset: requirements.asset,
        payTo: requirements.payTo,
        amount: requirements.amount,
        payer: exactEvmPayload.authorization.from,
        errorReason,
        error: errorMessage,
      });
      return {
        success: false,
        errorReason,
        transaction: "",
        network: payload.accepted.network,
        payer: exactEvmPayload.authorization.from,
      };
    }
  }
}
