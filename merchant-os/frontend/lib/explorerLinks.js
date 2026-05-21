export const buildExplorerTransactionUrl = (template, txHash) => {
  const normalizedTemplate = String(template || "").trim();
  const normalizedHash = String(txHash || "").trim();
  if (!normalizedTemplate || !normalizedHash) {
    return "";
  }

  const placeholderPatterns = [/\{hash\}/gi, /\{txHash\}/gi, /\{transactionHash\}/gi];
  const hasPlaceholder = placeholderPatterns.some((pattern) => pattern.test(normalizedTemplate));
  if (hasPlaceholder) {
    let candidate = normalizedTemplate;
    placeholderPatterns.forEach((pattern) => {
      candidate = candidate.replace(pattern, normalizedHash);
    });
    try {
      const parsedCandidate = new URL(candidate);
      if (parsedCandidate.protocol !== "https:") {
        return "";
      }
      return candidate;
    } catch {
      return "";
    }
  }

  try {
    const parsed = new URL(normalizedTemplate);
    if (parsed.protocol !== "https:") {
      return "";
    }
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/${normalizedHash}`;
    return parsed.toString();
  } catch {
    return "";
  }
};

export const mapChainsByNetwork = (items) => {
  const nextChainsByNetwork = {};
  (Array.isArray(items) ? items : []).forEach((chain) => {
    const network = String(chain?.network || "").trim();
    if (!network) {
      return;
    }
    nextChainsByNetwork[network] = chain;
  });
  return nextChainsByNetwork;
};
