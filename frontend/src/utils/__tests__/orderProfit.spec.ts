import { describe, expect, it } from 'vitest'

import { calculateExpectedProfit } from '../orderProfit'

describe('calculateExpectedProfit', () => {
  it('keeps a negative profit instead of replacing it with zero', () => {
    expect(calculateExpectedProfit(58, 64.2)).toBeCloseTo(-6.2)
  })

  it('returns zero only when revenue equals cost', () => {
    expect(calculateExpectedProfit(58, 58)).toBe(0)
  })

  it('keeps a positive profit', () => {
    expect(calculateExpectedProfit(58, 54.2)).toBeCloseTo(3.8)
  })

  it('rounds to kopecks and does not return negative zero', () => {
    expect(calculateExpectedProfit(10, 10.004)).toBe(0)
    expect(Object.is(calculateExpectedProfit(10, 10.004), -0)).toBe(false)
    expect(calculateExpectedProfit(10, 10.006)).toBe(-0.01)
  })
})
