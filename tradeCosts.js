// Indian equity delivery charges for a discount broker (Zerodha-style slab).
// Rates are per-exchange published schedules and are applied to a notional
// trade value so the backtester can convert them into percentage costs.
export const EQUITY_COST_RATES = {
  brokeragePercent: 0.0003, // 0.03% per side
  brokerageCap: 20, // ₹20 per order
  sttPercent: 0.001, // 0.1% on both buy and sell (delivery)
  exchangePercent: 0.0000297, // NSE transaction charge per side
  sebiPercent: 0.000001, // ₹10 per crore per side
  stampPercent: 0.00015, // 0.015% on buy only
  gstPercent: 0.18, // on brokerage + exchange + SEBI
  dpCharge: 13.5, // per scrip on sell (delivery)
};

const round = (value) => Math.round(value * 1e6) / 1e6;

const GST_DP = EQUITY_COST_RATES.dpCharge * (1 + EQUITY_COST_RATES.gstPercent);

export const estimateEquityCosts = ({ notional }) => {
  const value = Number(notional);
  if (!Number.isFinite(value) || value <= 0) return null;
  const rates = EQUITY_COST_RATES;
  const brokerage = Math.min(value * rates.brokeragePercent, rates.brokerageCap);
  const stt = value * rates.sttPercent;
  const exchange = value * rates.exchangePercent;
  const sebi = value * rates.sebiPercent;
  const gst = (brokerage + exchange + sebi) * rates.gstPercent;
  const buy = {
    brokerage: round(brokerage),
    stt: round(stt),
    exchange: round(exchange),
    sebi: round(sebi),
    gst: round(gst),
    stamp: round(value * rates.stampPercent),
    dp: 0,
    total: round(brokerage + stt + exchange + sebi + gst + value * rates.stampPercent),
  };
  const sell = {
    brokerage: round(brokerage),
    stt: round(stt),
    exchange: round(exchange),
    sebi: round(sebi),
    gst: round(gst),
    stamp: 0,
    dp: round(GST_DP),
    total: round(brokerage + stt + exchange + sebi + gst + GST_DP),
  };
  return {
    notional: value,
    buy,
    sell,
    total: round(buy.total + sell.total),
    buyPercent: round((buy.total / value) * 100),
    sellPercent: round((sell.total / value) * 100),
    roundTripPercent: round(((buy.total + sell.total) / value) * 100),
    model: 'indian_equity_delivery',
  };
};

export const costPercentForNotional = (notional = 100000) => {
  const costs = estimateEquityCosts({ notional });
  return {
    buyPercent: costs.buyPercent,
    sellPercent: costs.sellPercent,
    roundTripPercent: costs.roundTripPercent,
    costs,
  };
};

export const COST_MODEL_LABEL = 'Indian equity delivery charges (0.03% brokerage capped at ₹20/order, 0.1% STT both sides, 0.015% stamp duty on buy, NSE exchange fee, SEBI fee, 18% GST, ₹13.50 DP on sell)';
