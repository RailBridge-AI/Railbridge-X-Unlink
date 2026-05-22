# Circle CCTP Integration Guide

This document explains how Circle's Cross-Chain Transfer Protocol (CCTP) is integrated into the RailBridge facilitator for USDC cross-chain transfers.

## Overview

The RailBridge facilitator uses Circle CCTP to bridge USDC tokens between EVM-compatible chains. CCTP uses a burn-and-mint model where USDC is burned on the source chain and minted on the destination chain, ensuring 1:1 transfers with native USDC on both sides.

## Architecture

### Integration Flow

```
1. User Payment (Source Chain)
   └─> User pays USDC to facilitator address on source chain
   
2. Settlement
   └─> Facilitator verifies and settles payment on source chain
   
3. Transaction Confirmation
   └─> Wait for settlement transaction to confirm
   
4. Circle CCTP Bridge
   └─> Facilitator bridges USDC from source to destination chain
       ├─> Burn USDC on source chain
       ├─> Wait for attestation
       └─> Mint USDC on destination chain
   
5. Merchant Receives
   └─> USDC minted to merchant address on destination chain
```

### Key Components

1. **CircleCCTPBridgeService** (`src/services/circleCCTPBridgeService.ts`)
   - Implements the bridge service interface
   - Uses Circle BridgeKit SDK (`@circle-fin/bridge-kit`)
   - Handles chain name mapping (CAIP-2 → Circle chain names)
   - Waits for source transaction confirmation before bridging

2. **Facilitator Integration** (`src/facilitator-implementation.ts`)
   - Initializes `CircleCCTPBridgeService` on startup
   - Calls bridge service in `onAfterSettle` hook
   - Handles cross-chain payment detection via extensions

## How It Works

### 1. Payment Flow

When a cross-chain payment is made:

1. **Client Payment**: User pays USDC to facilitator on source chain (e.g., Base Sepolia)
2. **Settlement**: Facilitator settles the payment, receiving USDC
3. **Bridge Trigger**: `onAfterSettle` hook detects cross-chain extension
4. **Bridge Execution**: `CircleCCTPBridgeService.bridge()` is called with:
   - Source chain and transaction hash
   - Destination chain and recipient address
   - Amount to bridge

### 2. Bridge Execution

The bridge service:

1. **Waits for Confirmation**: Ensures source transaction is confirmed
2. **Maps Chain Names**: Converts CAIP-2 network IDs to Circle chain names
3. **Executes Bridge**: Uses Circle BridgeKit to:
   - Burn USDC on source chain
   - Fetch attestation from Circle
   - Mint USDC on destination chain
4. **Returns Result**: Provides bridge and destination transaction hashes

### 3. Chain Support

Currently supported chains (mapped in `chainNameMap`):

- **Base Sepolia** (`eip155:84532`) → `Base_Sepolia`
- **Base Mainnet** (`eip155:8453`) → `Base`
- **Arbitrum Sepolia** (`eip155:421614`) → `Arbitrum_Sepolia`
- **Arbitrum Mainnet** (`eip155:42161`) → `Arbitrum`
- **Ethereum Sepolia** (`eip155:11155111`) → `Ethereum_Sepolia`
- **Ethereum Mainnet** (`eip155:1`) → `Ethereum`
- **Polygon Amoy** (`eip155:80002`) → `Polygon_Amoy`
- **Polygon Mainnet** (`eip155:137`) → `Polygon`

## Configuration

### Environment Variables

Required:
- `FACILITATOR_EVM_PRIVATE_KEY`: Private key for facilitator wallet (used by Circle BridgeKit adapter)

Optional:
- `FACILITATOR_ADMIN_TOKEN`: admin endpoint bearer token
- `MERCHANT_OS_INGEST_TOKEN`: settlement event ingest auth token for Merchant OS

Non-secret runtime values (RPCs, cross-chain kill switch, per-chain status overrides, worker tuning, fee floors)
must be configured in `facilitator/config/runtime-config.json` or
`facilitator/config/runtime-config.local.json`.

### Bridge Config

The bridge service is initialized with:

```typescript
const bridgeService = new CircleCCTPBridgeService({
  provider: "cctp",
  facilitatorAddress: evmAccount.address,
  rpcUrls: {
    // Optional: Chain-specific RPC URLs
    "eip155:84532": "https://sepolia.base.org",
    // ... more chains
  },
});
```

## Example Usage

### Your Working Example

Your example in `src/integration_demo/usdc_cctp.ts` demonstrates the core bridge functionality:

```typescript
const result = await kit.bridge({
  from: { adapter, chain: "Base_Sepolia" },
  to: { adapter, chain: "Arbitrum_Sepolia", recipientAddress: "0x..." },
  amount: "0.01",
});
```

This same pattern is used in `CircleCCTPBridgeService.bridge()`, but integrated into the facilitator's payment flow.

### Integration Points

1. **After Settlement**: Bridge is triggered automatically in `onAfterSettle` hook
2. **Error Handling**: Bridge failures are logged but don't affect settlement
3. **Transaction Tracking**: Bridge and destination transaction hashes are returned

## Key Features

### 1. Transaction Confirmation Waiting

The service waits for source transaction confirmation before bridging:

```typescript
await this.waitForSourceConfirmation(sourceChain, sourceTxHash);
```

This ensures:
- Settlement transaction is confirmed
- Funds are available in facilitator wallet
- Reduces bridge failures due to unconfirmed transactions

### 2. Chain Name Mapping

Automatic conversion between:
- CAIP-2 network identifiers (used by x402): `eip155:84532`
- Circle BridgeKit chain names: `Base_Sepolia`

### 3. RPC URL Resolution

The service resolves RPC URLs in this order:
1. `config.rpcUrls[chain]` (if provided)
2. `chainRpcMap[chain]` (default RPC for chain)
3. `config.defaultRpcUrl` (runtime/env fallback)

### 4. Error Handling

- Bridge failures are caught and logged
- Settlement already succeeded, so funds are safe
- Errors don't prevent future bridge attempts
- TODO: Implement retry logic for failed bridges

## Limitations

1. **USDC Only**: CCTP only supports USDC transfers
2. **Supported Chains**: Only chains supported by Circle CCTP
3. **No Retry Logic**: Failed bridges are logged but not automatically retried
4. **Synchronous**: Bridge happens synchronously in the settlement hook

## Future Enhancements

1. **Retry Logic**: Queue failed bridges for retry with exponential backoff
2. **Async Bridging**: Move bridge to background job queue
3. **Status Tracking**: Store bridge status in database
4. **Notifications**: Alert merchants when bridge completes
5. **Monitoring**: Add metrics and alerts for bridge failures

## Testing

To test the integration:

1. **Run the demo**:
   ```bash
   npm run demo:cctp
   ```

2. **Test with facilitator**:
   - Start facilitator: `npm run dev`
   - Make a cross-chain payment via client
   - Check logs for bridge execution

3. **Verify on-chain**:
   - Check source chain for burn transaction
   - Check destination chain for mint transaction
   - Verify USDC received at merchant address

## Troubleshooting

### Bridge Fails

- Check `FACILITATOR_EVM_PRIVATE_KEY` is set correctly
- Check per-chain RPCs in `facilitator/config/runtime-config.json`
- Verify facilitator wallet has sufficient USDC on source chain
- Ensure both chains are supported by Circle CCTP
- Check RPC URLs are accessible

### Transaction Confirmation Timeout

- Increase timeout in `waitForSourceConfirmation()`
- Check RPC URL is correct for source chain
- Verify network connectivity

### Unsupported Chain Pair

- Check `chainNameMap` includes both chains
- Verify Circle CCTP supports the chain pair
- Add chain mapping if needed

## Related Files

- `src/services/circleCCTPBridgeService.ts` - Circle CCTP bridge implementation
- `src/facilitator-implementation.ts` - Facilitator with bridge integration
- `src/integration_demo/usdc_cctp.ts` - Standalone CCTP example
- `src/types/bridge.ts` - Bridge service types

## References

- [Circle BridgeKit Documentation](https://developers.circle.com/docs/bridgekit)
- [Circle CCTP Overview](https://developers.circle.com/cctp)
- [x402 Protocol Documentation](https://docs.cdp.coinbase.com/x402/docs/welcome)
