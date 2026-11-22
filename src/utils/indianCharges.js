// Statutory + modelled brokerage rates for one NSE/BSE equity leg.
// The numbers mirror the schedule used by the brokerage calculator page so a
// single table governs every estimate in the app. The executing broker's own
// slab decides the real debit; this is always labelled an estimate.
export const CHARGE_RATES = Object.freeze({
  intraday: {
    sttSell: 0.00025,
    sttBuy: 0,
    brokerageRate: 0.0003,
    brokerageCapPerLeg: 20,
    exchangeTurnover: 0.000029,
    sebiPerTurnover: 0.000001,
    gstRate: 0.18,
    stampDutyBuy: 0.00003,
  },
  delivery: {
    sttSell: 0.001,
    sttBuy: 0.001,
    brokerageRate: 0.0003,
    brokerageCapPerLeg: 20,
    exchangeTurnover: 0.0000345,
    sebiPerTurnover: 0.000001,
    gstRate: 0.18,
    stampDutyBuy: 0.00015,
  },
});

const round2 = (value) => Number(value.toFixed(2));

export const estimateOrderCharges = (side, turnover, product = 'intraday') => {
  const rates = CHARGE_RATES[product] || CHARGE_RATES.intraday;
  const notional = Math.max(0, Number(turnover) || 0);
  if (!notional) return null;
  const isBuy = side === 'BUY';
  const brokerage = Math.min(rates.brokerageCapPerLeg, notional * rates.brokerageRate);
  const exchangeTurnover = notional * rates.exchangeTurnover;
  const sebi = notional * rates.sebiPerTurnover;
  const gst = (brokerage + exchangeTurnover) * rates.gstRate;
  const stt = notional * (isBuy ? rates.sttBuy : rates.sttSell);
  const stampDuty = isBuy ? notional * rates.stampDutyBuy : 0;
  const total = brokerage + exchangeTurnover + sebi + gst + stt + stampDuty;
  return {
    product,
    brokerage: round2(brokerage),
    exchangeTurnover: round2(exchangeTurnover),
    sebi: round2(sebi),
    gst: round2(gst),
    stt: round2(stt),
    stampDuty: round2(stampDuty),
    total: round2(total),
  };
};
