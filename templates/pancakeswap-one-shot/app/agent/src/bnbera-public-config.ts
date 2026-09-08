/*
 * Build fixture for the checked-in template. Creator materialization replaces
 * this module with the draft's canonical configuration before deployment.
 */
export const configuration = {
  protocol: "pancakeswap-v2",
  tradingPair: "tbnb-cake",
  inputAmountWei: "1000000000000000",
  slippageBps: 50,
  quoteMaxAgeSeconds: 60,
  deadlineSeconds: 120,
} as const;
export const configurationDigest = "183d368911ab7d2b0cde381dae1076aa0305bb58e9c830bd986e039fd678034b";
