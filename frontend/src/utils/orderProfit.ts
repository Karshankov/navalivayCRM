export function calculateExpectedProfit(finalAmount: number, totalCost: number): number {
  const difference = finalAmount - totalCost
  const rounded = Math.sign(difference) * Math.round(Math.abs(difference) * 100) / 100

  return rounded === 0 ? 0 : rounded
}
