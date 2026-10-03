// Converte centavos de real em unidades mínimas do token (6 casas decimais).
// R$ 40,00 a 5 reais/token = 8 tokens = 8_000_000 unidades.
export const centsToTokenUnits = (cents: number, brlPerToken: number): bigint =>
  BigInt(Math.round((cents * 1e4) / brlPerToken));

export const explorerUrl = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
