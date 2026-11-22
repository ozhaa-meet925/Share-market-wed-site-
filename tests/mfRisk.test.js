import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFundTax, computeRiskMetrics, computeXirr, estimatePortfolioTax, parseNavDate } from '../mfRisk.js';

const START = Date.UTC(2021, 0, 4);

const dailyHistory = (days, navAt) => Array.from({ length: days }, (_, index) => {
  const date = new Date(START + index * 86400000);
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return { date: `${dd}-${mm}-${date.getUTCFullYear()}`, nav: navAt(index).toFixed(4) };
});

// mfapi.in returns newest first
const newestFirst = (history) => [...history].reverse();

const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected} ±${tolerance}, got ${actual}`);
};

test('parseNavDate reads DD-MM-YYYY without shifting the day', () => {
  const parsed = parseNavDate('05-11-2026');
  assert.equal(parsed.toISOString().slice(0, 10), '2026-11-05');
  assert.equal(parseNavDate('not-a-date'), null);
  assert.equal(parseNavDate(null), null);
});

test('flat NAV history has zero volatility, zero drawdown and no fabricated ratios', () => {
  const metrics = computeRiskMetrics(newestFirst(dailyHistory(300, () => 100)));
  assert.equal(metrics.status, 'ok');
  assert.equal(metrics.volatilityPercent, 0);
  assert.equal(metrics.maxDrawdownPercent, 0);
  assert.ok(Object.is(metrics.maxDrawdownPercent, -0) === false, 'drawdown must not be negative zero');
  assert.equal(metrics.sharpe, null);
  assert.equal(metrics.sortino, null);
  assert.equal(metrics.rollingOneYearPositivePercent, null);
  assert.equal(metrics.riskGrade, 'Low');
});

test('alternating ±1% daily moves produce annualised volatility near 15.9%', () => {
  const walk = [100];
  for (let i = 1; i < 253; i++) walk.push(walk[i - 1] * (i % 2 === 1 ? 1.01 : 0.99));
  const metrics = computeRiskMetrics(newestFirst(dailyHistory(253, (i) => walk[i])));
  near(metrics.volatilityPercent, 15.9, 0.4, 'volatility');
  assert.equal(metrics.riskGrade, 'Moderately High');
});

test('a monotonic rising series reports positive CAGR, no drawdown and full rolling consistency', () => {
  const metrics = computeRiskMetrics(newestFirst(dailyHistory(1200, (i) => 100 * 1.0006 ** i)));
  assert.equal(metrics.status, 'ok');
  assert.ok(metrics.cagr.y1 > 0);
  assert.ok(metrics.cagr.y3 !== null, 'three-year CAGR must be available with 1200 daily points');
  assert.equal(metrics.maxDrawdownPercent, 0);
  assert.equal(metrics.rollingOneYearPositivePercent, 100);
  near(metrics.annualReturnPercent, metrics.cagr.y1, 0.01, 'annual return uses trailing 1Y CAGR');
  assert.ok(metrics.rollingOneYearSamples >= 4);
});

test('a falling series reports negative returns, a large drawdown and zero rolling consistency', () => {
  const metrics = computeRiskMetrics(newestFirst(dailyHistory(800, (i) => 200 * 0.9994 ** i)));
  assert.ok(metrics.annualReturnPercent < 0);
  assert.ok(metrics.maxDrawdownPercent < -15);
  assert.equal(metrics.rollingOneYearPositivePercent, 0);
  assert.ok(metrics.sharpe < 0);
});

test('max drawdown captures a peak-to-trough fall in the series', () => {
  const navs = [];
  for (let i = 0; i < 300; i++) {
    if (i < 100) navs.push(100);
    else if (i < 200) navs.push(100 - (i - 100) * 0.4); // falls to 60
    else navs.push(60 + (i - 200) * 0.2); // recovers to 80
  }
  const metrics = computeRiskMetrics(newestFirst(dailyHistory(300, (i) => navs[i])));
  near(metrics.maxDrawdownPercent, -40, 0.01, 'drawdown');
});

test('short history is withheld, not estimated', () => {
  const metrics = computeRiskMetrics(newestFirst(dailyHistory(10, (i) => 100 + i)));
  assert.equal(metrics.status, 'insufficient_history');
  assert.match(metrics.reason, /at least 60/i);
  assert.equal(metrics.volatilityPercent, undefined);
  assert.equal(metrics.sharpe, undefined);
});

test('empty or invalid input reports insufficient history', () => {
  assert.equal(computeRiskMetrics([]).status, 'insufficient_history');
  assert.equal(computeRiskMetrics(null).status, 'insufficient_history');
  const messy = computeRiskMetrics([
    { date: '31-02-2024', nav: '100' },
    { date: '01-01-2024', nav: 'NaN' },
    { date: '02-01-2024', nav: '0' },
  ]);
  assert.equal(messy.status, 'insufficient_history');
});

test('risk-free rate feeds Sharpe and Sortino', () => {
  const rising = newestFirst(dailyHistory(400, (i) => 100 * 1.0008 ** i));
  const zero = computeRiskMetrics(rising, { riskFreeRate: 0 });
  const six = computeRiskMetrics(rising, { riskFreeRate: 10 });
  assert.ok(six.sharpe < zero.sharpe);
  assert.equal(six.riskFreeRate, 10);

  // A monotonic series has no losing days, so Sortino stays unavailable rather than dividing by zero.
  assert.equal(zero.sortino, null);
  assert.equal(six.sortino, null);

  const walk = [100];
  for (let i = 1; i < 400; i++) walk.push(walk[i - 1] * (i % 3 === 0 ? 0.995 : 1.002));
  const choppy = newestFirst(dailyHistory(400, (i) => walk[i]));
  const choppyZero = computeRiskMetrics(choppy, { riskFreeRate: 0 });
  const choppySix = computeRiskMetrics(choppy, { riskFreeRate: 10 });
  assert.ok(choppySix.sortino < choppyZero.sortino);
});

test('XIRR solves a simple one-year 20% gain', () => {
  const xirr = computeXirr([
    { date: '2025-01-01', amount: -10000 },
    { date: '2026-01-01', amount: 12000 },
  ]);
  near(xirr, 20, 0.2, 'xirr');
});

test('XIRR returns null for a single-sign cash flow', () => {
  assert.equal(computeXirr([{ date: '2025-01-01', amount: -10000 }]), null);
  assert.equal(computeXirr([
    { date: '2025-01-01', amount: 10000 },
    { date: '2026-01-01', amount: 12000 },
  ]), null);
  assert.equal(computeXirr([]), null);
});

test('tax classification splits equity, debt and ambiguous categories', () => {
  assert.equal(classifyFundTax('Equity Scheme - Large Cap Fund'), 'equity');
  assert.equal(classifyFundTax('Equity Scheme - ELSS'), 'equity');
  assert.equal(classifyFundTax('Debt Scheme - Liquid Fund'), 'debt');
  assert.equal(classifyFundTax('Debt Scheme - Gilt Fund'), 'debt');
  assert.equal(classifyFundTax('Hybrid Scheme - Aggressive Hybrid Fund'), 'other');
  assert.equal(classifyFundTax(''), 'other');
});

test('equity capital gains apply 12.5% above the 1.25 lakh LTCG exemption and 20% STCG', () => {
  const tax = estimatePortfolioTax([
    // long-term gain 2,00,000
    { category: 'Equity Scheme - Large Cap Fund', purchase_date: '2022-01-01', invested_amount: 100000, current_value: 300000 },
    // short-term gain 10,000
    { category: 'Equity Scheme - Mid Cap Fund', purchase_date: '2026-06-01', invested_amount: 50000, current_value: 60000 },
    // debt is never estimated from NAV data
    { category: 'Debt Scheme - Liquid Fund', purchase_date: '2022-01-01', invested_amount: 100000, current_value: 110000 },
  ], { today: '2026-11-19' });

  assert.equal(tax.status, 'partial');
  assert.equal(tax.equityLongTermGain, 200000);
  assert.equal(tax.equityShortTermGain, 10000);
  assert.equal(tax.taxableLongTermAfterExemption, 75000);
  near(tax.longTermTax, 9375, 0.01, 'LTCG tax');
  near(tax.shortTermTax, 2000, 0.01, 'STCG tax');
  near(tax.estimatedTax, 11375, 0.01, 'total tax');
  assert.equal(tax.notEstimated.length, 1);
  assert.match(tax.note, /12.5%/);
});

test('holdings without a purchase date are reported, not guessed', () => {
  const tax = estimatePortfolioTax([
    { category: 'Equity Scheme - Flexi Cap Fund', purchase_date: null, invested_amount: 10000, current_value: 12000 },
  ], { today: '2026-11-19' });
  assert.equal(tax.status, 'not_available');
  assert.equal(tax.unknownPurchaseDate, 1);
  assert.equal(tax.estimatedTax, 0);
});

test('losses reduce the long-term taxable gain instead of being ignored', () => {
  const tax = estimatePortfolioTax([
    { category: 'Equity Scheme - Large Cap Fund', purchase_date: '2022-01-01', invested_amount: 100000, current_value: 250000 }, // +150k LT
    { category: 'Equity Scheme - Small Cap Fund', purchase_date: '2022-01-01', invested_amount: 100000, current_value: 60000 }, // -40k LT
  ], { today: '2026-11-19' });
  assert.equal(tax.equityLongTermGain, 150000);
  assert.equal(tax.equityLoss, 40000);
  assert.equal(tax.taxableLongTermAfterExemption, 0); // 110k gain < 125k exemption
  assert.equal(tax.estimatedTax, 0);
});
