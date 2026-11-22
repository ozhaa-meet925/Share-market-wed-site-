const round = (value) => Number(Number(value).toFixed(2));

export const estimateMetalCharges = ({ side, turnover }) => {
  const value = Number(turnover);
  if (!(value > 0)) return null;
  const normalizedSide = String(side || '').toUpperCase();
  if (!['BUY', 'SELL'].includes(normalizedSide)) return null;
  const brokerage = Math.min(20, value * 0.0003);
  const exchangeTransaction = value * 0.000021;
  const sebi = value * 0.000001;
  const ctt = normalizedSide === 'SELL' ? value * 0.0001 : 0;
  const stampDuty = normalizedSide === 'BUY' ? value * 0.00002 : 0;
  const gst = (brokerage + exchangeTransaction) * 0.18;
  const total = brokerage + exchangeTransaction + sebi + ctt + stampDuty + gst;
  return {
    brokerage: round(brokerage),
    exchangeTransaction: round(exchangeTransaction),
    sebi: round(sebi),
    ctt: round(ctt),
    stampDuty: round(stampDuty),
    gst: round(gst),
    total: round(total),
    estimateOnly: true,
  };
};
