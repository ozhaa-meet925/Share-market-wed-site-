/**
 * mfRisk.js — pure mutual-fund risk metrics computed from AMFI NAV history.
 *
 * Input history is mfapi.in shape, newest first:
 *   [{ date: 'DD-MM-YYYY', nav: '123.45' }, ...]
 *
 * All output metrics are derived from the supplied NAV series only. Nothing is
 * estimated or filled in: a metric that cannot be computed is returned as null
 * and the status says why.
 */

const TRADING_DAYS = 252;
const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const DEFAULT_RISK_FREE_RATE = 6.5;
const MIN_RETURNS = 60;
const MAX_VOL_WINDOW = 252;

const round = (value, digits = 2) => {
  if (!Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? 0 : rounded;
};

export function parseNavDate(str) {
  if (!str) return null;
  const parts = String(str).split('-');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function sampleStdev(values) {
  if (values.length < 2) return null;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function toSeries(navHistory) {
  if (!Array.isArray(navHistory)) return [];
  const byDate = new Map();
  for (const entry of navHistory) {
    const date = parseNavDate(entry?.date);
    const nav = Number.parseFloat(entry?.nav);
    if (!date || !Number.isFinite(nav) || nav <= 0) continue;
    byDate.set(date.getTime(), { date, nav });
  }
  return [...byDate.values()].sort((a, b) => a.date - b.date);
}

function cagrAt(series, years) {
  if (!series.length) return null;
  const last = series[series.length - 1];
  const target = new Date(last.date.getTime());
  target.setUTCFullYear(target.getUTCFullYear() - years);
  const targetMs = target.getTime();

  let best = null;
  let bestDiff = Infinity;
  for (const point of series) {
    const diff = Math.abs(point.date.getTime() - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = point; }
    if (point.date.getTime() > targetMs) break;
  }
  if (!best || best === last) return null;
  const elapsedYears = (last.date.getTime() - best.date.getTime()) / ONE_YEAR_MS;
  if (elapsedYears < years * 0.9) return null;
  return (Math.pow(last.nav / best.nav, 1 / elapsedYears) - 1) * 100;
}

function maxDrawdown(series) {
  let peak = series[0].nav;
  let worst = 0;
  for (const point of series) {
    if (point.nav > peak) peak = point.nav;
    const drawdown = point.nav / peak - 1;
    if (drawdown < worst) worst = drawdown;
  }
  return worst * 100;
}

function rollingOneYear(series) {
  const samples = [];
  let start = 0;
  for (let end = 1; end < series.length; end++) {
    const cutoff = series[end].date.getTime() - ONE_YEAR_MS;
    while (start + 1 < end && series[start + 1].date.getTime() <= cutoff) start++;
    if (series[start].date.getTime() > cutoff) continue;
    if (end % 21 !== 0) continue;
    samples.push(series[end].nav / series[start].nav - 1);
  }
  return samples;
}

function riskGrade(volatilityPercent) {
  if (volatilityPercent == null) return null;
  if (volatilityPercent < 5) return 'Low';
  if (volatilityPercent < 12) return 'Moderate';
  if (volatilityPercent < 20) return 'Moderately High';
  return 'High';
}

export function computeRiskMetrics(navHistory, options = {}) {  const riskFreeRate = Number.isFinite(options.riskFreeRate) ? options.riskFreeRate : DEFAULT_RISK_FREE_RATE;
  const series = toSeries(navHistory);

  if (series.length < 2) {
    return {
      status: 'insufficient_history',
      reason: 'NAV history is too short to compute risk metrics.',
      samplePoints: series.length,
      riskFreeRate,
    };
  }

  const dailyReturns = [];
  for (let i = 1; i < series.length; i++) {
    dailyReturns.push(series[i].nav / series[i - 1].nav - 1);
  }

  const periodYears = (series[series.length - 1].date.getTime() - series[0].date.getTime()) / ONE_YEAR_MS;
  const cagr1 = cagrAt(series, 1);
  const cagr3 = cagrAt(series, 3);
  const cagr5 = cagrAt(series, 5);
  const annualReturn = cagr1 != null
    ? cagr1
    : periodYears > 0.25
      ? (Math.pow(series[series.length - 1].nav / series[0].nav, 1 / periodYears) - 1) * 100
      : null;

  if (dailyReturns.length < MIN_RETURNS) {
    return {
      status: 'insufficient_history',
      reason: `Only ${dailyReturns.length} daily NAV observations available; at least ${MIN_RETURNS} are needed for volatility.`,
      samplePoints: series.length,
      periodYears: round(periodYears, 2),
      maxDrawdownPercent: round(maxDrawdown(series)),
      cagr: {
        y1: round(cagr1),
        y3: round(cagr3),
        y5: round(cagr5),
      },
      riskFreeRate,
    };
  }

  const volWindow = dailyReturns.slice(-MAX_VOL_WINDOW);
  const volDaily = sampleStdev(volWindow);
  const volatilityPercent = volDaily != null ? volDaily * Math.sqrt(TRADING_DAYS) * 100 : null;

  const downside = volWindow.map((r) => (r < 0 ? r : 0));
  const downsideDeviation = Math.sqrt(mean(downside.map((r) => r * r))) * Math.sqrt(TRADING_DAYS) * 100;

  const sharpe = annualReturn != null && volatilityPercent > 0
    ? (annualReturn - riskFreeRate) / volatilityPercent
    : null;
  const sortino = annualReturn != null && downsideDeviation > 0
    ? (annualReturn - riskFreeRate) / downsideDeviation
    : null;

  const rolling = rollingOneYear(series);
  const rollingPositivePercent = rolling.length >= 4
    ? (rolling.filter((r) => r > 0).length / rolling.length) * 100
    : null;
  const rollingWorst = rolling.length ? Math.min(...rolling) * 100 : null;
  const rollingBest = rolling.length ? Math.max(...rolling) * 100 : null;

  return {
    status: 'ok',
    samplePoints: series.length,
    periodYears: round(periodYears, 2),
    asOf: series[series.length - 1].date.toISOString().slice(0, 10),
    volatilityPercent: round(volatilityPercent),
    maxDrawdownPercent: round(maxDrawdown(series)),
    sharpe: round(sharpe, 2),
    sortino: round(sortino, 2),
    annualReturnPercent: round(annualReturn),
    rollingOneYearPositivePercent: round(rollingPositivePercent, 1),
    rollingOneYearSamples: rolling.length,
    rollingOneYearWorstPercent: round(rollingWorst),
    rollingOneYearBestPercent: round(rollingBest),
    riskGrade: riskGrade(volatilityPercent),
    cagr: {
      y1: round(cagr1),
      y3: round(cagr3),
      y5: round(cagr5),
    },
    riskFreeRate,
  };
}

// ─────────────────────────── XIRR ─────────────────────────────────────────────

/**
 * Money-weighted return for irregular cash flows.
 * cashflows: [{ date: Date|'YYYY-MM-DD', amount: number }] — outflows negative,
 * the current value is a positive flow dated today.
 * Returns annualised % or null when a root cannot be bracketed.
 */
export function computeXirr(cashflows, options = {}) {
  if (!Array.isArray(cashflows) || cashflows.length < 2) return null;
  const flows = cashflows
    .map((flow) => {
      const date = flow?.date instanceof Date ? flow.date : new Date(flow?.date);
      const amount = Number(flow?.amount);
      return Number.isNaN(date.getTime()) || !Number.isFinite(amount) ? null : { date, amount };
    })
    .filter((flow) => flow && flow.amount !== 0)
    .sort((a, b) => a.date - b.date);
  if (flows.length < 2) return null;
  if (!flows.some((flow) => flow.amount > 0) || !flows.some((flow) => flow.amount < 0)) return null;

  const start = flows[0].date.getTime();
  const npv = (rate) => flows.reduce((sum, flow) => {
    const years = (flow.date.getTime() - start) / ONE_YEAR_MS;
    return sum + flow.amount / Math.pow(1 + rate, years);
  }, 0);

  let low = -0.9999;
  let high = Number.isFinite(options.maxRate) ? options.maxRate : 10;
  let lowValue = npv(low);
  let highValue = npv(high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const midValue = npv(mid);
    if (Math.abs(midValue) < 1e-7) { low = high = mid; break; }
    if (lowValue * midValue <= 0) { high = mid; highValue = midValue; }
    else { low = mid; lowValue = midValue; }
  }
  const rate = (low + high) / 2;
  return round(rate * 100);
}

// ─────────────────────── Capital gains (if sold today) ───────────────────────

export const CAPITAL_GAINS_RULES_AS_OF = 'Equity: STCG 20% (<=12 months), LTCG 12.5% above Rs 1.25 lakh exemption, rates effective 23-Jul-2024. Debt and other categories: taxed at your income-tax slab and not estimated. Cess and surcharge are not included.';

const LTCG_EXEMPTION = 125000;
const EQUITY_STCG_RATE = 0.20;
const EQUITY_LTCG_RATE = 0.125;

const EQUITY_RE = /equity|large.?cap|mid.?cap|small.?cap|multi.?cap|flexi.?cap|elss|index|nifty|sensex|bluechip|sectoral|thematic|focused|contra|value fund|dividend yield|momentum|quality|international|global|overseas|nasdaq/i;
const DEBT_RE = /debt|liquid|overnight|money market|gilt|bond|credit risk|banking.{0,4}psu|corporate bond|duration|floating/i;

export function classifyFundTax(category) {
  const text = String(category || '');
  if (DEBT_RE.test(text)) return 'debt';
  if (EQUITY_RE.test(text)) return 'equity';
  return 'other';
}

/**
 * Estimate capital gains tax if every holding were sold today.
 * holdings: [{ category, purchase_date, invested_amount, current_value }]
 * The Rs 1.25 lakh LTCG exemption is applied once across the portfolio.
 */
export function estimatePortfolioTax(holdings, options = {}) {
  const today = options.today ? new Date(options.today) : new Date();
  const list = Array.isArray(holdings) ? holdings : [];

  let equityStcg = 0;
  let equityLtcg = 0;
  let equityLoss = 0;
  let equityLongTermCount = 0;
  let equityShortTermCount = 0;
  const notEstimated = [];
  let unknownDate = 0;

  for (const holding of list) {
    const gain = Number(holding.current_value) - Number(holding.invested_amount);
    const taxCategory = classifyFundTax(holding.category);
    if (taxCategory !== 'equity') {
      notEstimated.push({ category: holding.category || 'Unknown', reason: taxCategory === 'debt' ? 'Debt fund gains are taxed at your income-tax slab.' : 'Category cannot be classified as equity or debt from the AMFI category text.' });
      continue;
    }
    const purchased = new Date(holding.purchase_date);
    if (!holding.purchase_date || Number.isNaN(purchased.getTime())) {
      unknownDate += 1;
      continue;
    }
    if (!Number.isFinite(gain)) continue;
    if (gain < 0) { equityLoss += -gain; continue; }
    const holdingDays = Math.floor((today.getTime() - purchased.getTime()) / 86400000);
    if (holdingDays > 365) { equityLtcg += gain; equityLongTermCount += 1; }
    else { equityStcg += gain; equityShortTermCount += 1; }
  }

  // Long-term losses may offset long-term gains; short-term losses offset either.
  // Applying every loss against long-term gains first keeps the estimate conservative.
  const taxableLongTerm = Math.max(0, equityLtcg - equityLoss);
  const ltcgTaxableAfterExemption = Math.max(0, taxableLongTerm - LTCG_EXEMPTION);
  const longTermTax = ltcgTaxableAfterExemption * EQUITY_LTCG_RATE;
  const shortTermTax = equityStcg * EQUITY_STCG_RATE;
  const estimatedTax = longTermTax + shortTermTax;

  const equityCount = equityLongTermCount + equityShortTermCount;
  let status = 'ok';
  if (equityCount === 0) status = 'not_available';
  else if (notEstimated.length || unknownDate) status = 'partial';

  return {
    status,
    estimatedTax: round(estimatedTax),
    shortTermTax: round(shortTermTax),
    longTermTax: round(longTermTax),
    equityShortTermGain: round(equityStcg),
    equityLongTermGain: round(equityLtcg),
    taxableLongTermAfterExemption: round(ltcgTaxableAfterExemption),
    ltcgExemption: LTCG_EXEMPTION,
    equityLoss: round(equityLoss),
    equityLongTermCount,
    equityShortTermCount,
    unknownPurchaseDate: unknownDate,
    notEstimated: notEstimated.slice(0, 5),
    note: CAPITAL_GAINS_RULES_AS_OF,
    asOf: today.toISOString().slice(0, 10),
  };
}
