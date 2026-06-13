export const CROSS_CHAIN = "cross-chain";

export const declareCrossChainExtension = ({
  destinationNetwork,
  destinationAsset,
  destinationPayTo,
}) => ({
  info: {
    destinationNetwork,
    destinationAsset,
    destinationPayTo,
  },
  schema: {
    type: "object",
    properties: {
      destinationNetwork: {
        type: "string",
        pattern: "^eip155:\\d+$",
      },
      destinationAsset: {
        type: "string",
        pattern: "^0x[a-fA-F0-9]{40}$",
      },
      destinationPayTo: {
        type: "string",
        pattern: "^0x[a-fA-F0-9]{40}$",
      },
    },
    required: ["destinationNetwork", "destinationAsset", "destinationPayTo"],
    additionalProperties: false,
  },
});
