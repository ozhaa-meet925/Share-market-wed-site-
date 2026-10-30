import { useState, useMemo } from 'react';
import { useMarketIndices } from '../hooks/useMarketIndices';
import {
  Calculator as CalcIcon,
  PiggyBank,
  TrendingUp,
  Receipt,
  Gem,
  Percent,
  Crosshair,
  ShieldAlert,
} from 'lucide-react';

const formatCurrency = (val) =>
  `₹${Number(Math.round(val)).toLocaleString('en-IN')}`;

const Calculator = () => {
  const { quotes: metalQuotes } = useMarketIndices(['MCX:GOLD', 'MCX:SILVER']);
  const goldQuote = metalQuotes.get('GOLD');
  const silverQuote = metalQuotes.get('SILVER');
  const [activeTab, setActiveTab] = useState('SIP');

  // Target & Stop-Loss State
  const [tradeEntryPrice, setTradeEntryPrice] = useState(1500);
  const [tradeTargetPrice, setTradeTargetPrice] = useState(1650);
  const [tradeStopLossPrice, setTradeStopLossPrice] = useState(1450);
  const [tradePositionQty, setTradePositionQty] = useState(100);

  // SIP State
  const [sipMonthly, setSipMonthly] = useState(10000);
  const [sipRate, setSipRate] = useState(13);
  const [sipYears, setSipYears] = useState(10);

  // Stock P&L & Charges State
  const [stockBuyPrice, setStockBuyPrice] = useState(1250);
  const [stockSellPrice, setStockSellPrice] = useState(1480);
  const [stockQty, setStockQty] = useState(100);

  // Metal State
  const [goldGrams, setGoldGrams] = useState(10);
  const [goldRatePerGram, setGoldRatePerGram] = useState('');
  const [silverKg, setSilverKg] = useState(1);
  const [silverRatePerKg, setSilverRatePerKg] = useState('');

  // EMI State
  const [emiPrincipal, setEmiPrincipal] = useState(1000000);
  const [emiRate, setEmiRate] = useState(8.75);
  const [emiYears, setEmiYears] = useState(15);

  // SIP Math
  const sipResult = useMemo(() => {
    const i = sipRate / 12 / 100;
    const n = sipYears * 12;
    const totalInvested = sipMonthly * n;
    const futureValue = sipMonthly * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
    const wealthGain = futureValue - totalInvested;
    return { totalInvested, futureValue, wealthGain };
  }, [sipMonthly, sipRate, sipYears]);

  // Stock Charges & Net Profit Math
  const stockResult = useMemo(() => {
    const turnoverBuy = stockBuyPrice * stockQty;
    const turnoverSell = stockSellPrice * stockQty;
    const totalTurnover = turnoverBuy + turnoverSell;
    const grossPnl = turnoverSell - turnoverBuy;

    // Standard Indian Brokerage & STT (Delivery)
    const stt = turnoverSell * 0.001; // 0.1% on sell delivery
    const brokerage = Math.min(40, totalTurnover * 0.0003); // ₹20 per leg max
    const exchangeTurnover = totalTurnover * 0.0000345;
    const sebiCharges = totalTurnover * 0.000001;
    const gst = (brokerage + exchangeTurnover) * 0.18;
    const stampDuty = turnoverBuy * 0.00015;
    const totalCharges = stt + brokerage + exchangeTurnover + sebiCharges + gst + stampDuty;
    const netPnl = grossPnl - totalCharges;

    return {
      turnoverBuy,
      turnoverSell,
      grossPnl,
      stt,
      brokerage,
      exchangeTurnover,
      gst,
      stampDuty,
      totalCharges,
      netPnl,
    };
  }, [stockBuyPrice, stockSellPrice, stockQty]);

  // Target & Stop Loss Math
  const riskRewardResult = useMemo(() => {
    const entry = Number(tradeEntryPrice) || 1;
    const target = Number(tradeTargetPrice) || 1;
    const sl = Number(tradeStopLossPrice) || 1;
    const qty = Math.max(1, Number(tradePositionQty) || 1);

    const profitPerShare = target - entry;
    const lossPerShare = entry - sl;
    const totalProfit = profitPerShare * qty;
    const totalRisk = lossPerShare * qty;
    const ratio = lossPerShare > 0 ? (profitPerShare / lossPerShare).toFixed(2) : '0';
    const totalCapital = entry * qty;
    const returnPct = ((profitPerShare / entry) * 100).toFixed(2);
    const riskPct = ((lossPerShare / entry) * 100).toFixed(2);

    return {
      profitPerShare,
      lossPerShare,
      totalProfit,
      totalRisk,
      ratio,
      totalCapital,
      returnPct,
      riskPct,
    };
  }, [tradeEntryPrice, tradeTargetPrice, tradeStopLossPrice, tradePositionQty]);

  // Metal Math
  const currentGoldRatePerGram = goldRatePerGram !== ''
    ? Number(goldRatePerGram)
    : Number(goldQuote?.c) > 0 ? Number(goldQuote.c) / 10 : null;
  const currentSilverRatePerKg = silverRatePerKg !== ''
    ? Number(silverRatePerKg)
    : Number(silverQuote?.c) > 0 ? Number(silverQuote.c) : null;
  const metalResult = useMemo(() => {
    const goldVal = currentGoldRatePerGram === null ? null : goldGrams * currentGoldRatePerGram;
    const silverVal = currentSilverRatePerKg === null ? null : silverKg * currentSilverRatePerKg;
    const total = goldVal === null || silverVal === null ? null : goldVal + silverVal;
    return { goldVal, silverVal, total };
  }, [goldGrams, currentGoldRatePerGram, silverKg, currentSilverRatePerKg]);

  // EMI Math
  const emiResult = useMemo(() => {
    const r = emiRate / 12 / 100;
    const n = emiYears * 12;
    const emi = (emiPrincipal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    const totalPayment = emi * n;
    const totalInterest = totalPayment - emiPrincipal;
    return { emi, totalPayment, totalInterest };
  }, [emiPrincipal, emiRate, emiYears]);

  return (
    <div className="page calculator-page">
      <div className="page-title calc-header-title">
        <div>
          <span>Financial Planning Tools</span>
          <h1>Investment & Trading Calculators</h1>
        </div>
        <div className="calc-badge">
          <CalcIcon size={18} />
          <span>Accurate Indian Market Tax & Charges</span>
        </div>
      </div>

      {/* Tabs */}
      <section className="panel calc-tabs-panel">
        <div className="calc-tab-buttons">
          <button
            className={`calc-tab-btn ${activeTab === 'TARGET_SL' ? 'active' : ''}`}
            onClick={() => setActiveTab('TARGET_SL')}
          >
            <Crosshair size={16} /> Target & Stop-Loss
          </button>
          <button
            className={`calc-tab-btn ${activeTab === 'SIP' ? 'active' : ''}`}
            onClick={() => setActiveTab('SIP')}
          >
            <PiggyBank size={16} /> SIP Wealth Calculator
          </button>
          <button
            className={`calc-tab-btn ${activeTab === 'STOCK' ? 'active' : ''}`}
            onClick={() => setActiveTab('STOCK')}
          >
            <Receipt size={16} /> Stock P&L & Brokerage
          </button>
          <button
            className={`calc-tab-btn ${activeTab === 'METALS' ? 'active' : ''}`}
            onClick={() => setActiveTab('METALS')}
          >
            <Gem size={16} /> Gold & Silver Valuation
          </button>
          <button
            className={`calc-tab-btn ${activeTab === 'EMI' ? 'active' : ''}`}
            onClick={() => setActiveTab('EMI')}
          >
            <Percent size={16} /> Loan & Margin EMI
          </button>
        </div>
      </section>

      {/* Tab 0: Target & Stop-Loss Calculator */}
      {activeTab === 'TARGET_SL' && (
        <div className="calc-tab-content">
          <section className="panel calc-inputs-card">
            <h3>Trade Plan & Risk Management</h3>
            <label>
              Entry Price (₹):
              <input
                type="number"
                min="0.05"
                step="0.05"
                value={tradeEntryPrice}
                onChange={(e) => setTradeEntryPrice(Number(e.target.value))}
              />
            </label>
            <label>
              Target Price (₹):
              <input
                type="number"
                min="0.05"
                step="0.05"
                value={tradeTargetPrice}
                onChange={(e) => setTradeTargetPrice(Number(e.target.value))}
              />
            </label>
            <label>
              Stop-Loss Price (₹):
              <input
                type="number"
                min="0.05"
                step="0.05"
                value={tradeStopLossPrice}
                onChange={(e) => setTradeStopLossPrice(Number(e.target.value))}
              />
            </label>
            <label>
              Quantity (Shares):
              <input
                type="number"
                min="1"
                step="1"
                value={tradePositionQty}
                onChange={(e) => setTradePositionQty(Number(e.target.value))}
              />
            </label>
          </section>

          <section className="panel calc-results-card">
            <h3>Risk-to-Reward (R:R) Analysis</h3>
            <div className="calc-outcome-badge">
              <span>Risk-to-Reward Ratio</span>
              <strong className="large-val">1 : {riskRewardResult.ratio}</strong>
            </div>
            <div className="calc-stat-splits">
              <div className="split-row">
                <span>Total Capital Required:</span>
                <b>{formatCurrency(riskRewardResult.totalCapital)}</b>
              </div>
              <div className="split-row">
                <span>Potential Profit (Gain):</span>
                <b className="gain">+{formatCurrency(riskRewardResult.totalProfit)} (+{riskRewardResult.returnPct}%)</b>
              </div>
              <div className="split-row">
                <span>Maximum Risk (Stop-Loss):</span>
                <b className="loss">-{formatCurrency(riskRewardResult.totalRisk)} (-{riskRewardResult.riskPct}%)</b>
              </div>
              <div className="split-row">
                <span>Reward per Share:</span>
                <b className="gain">+₹{riskRewardResult.profitPerShare.toFixed(2)}</b>
              </div>
              <div className="split-row">
                <span>Risk per Share:</span>
                <b className="loss">-₹{riskRewardResult.lossPerShare.toFixed(2)}</b>
              </div>
            </div>
            <div className="calc-note">
              {Number(riskRewardResult.ratio) >= 2 ? (
                <span className="gain">✓ Favorable Trade Setup: Reward is at least 2x greater than Risk.</span>
              ) : (
                <span className="loss">⚠️ Caution: Aim for at least 1:2 Risk-to-Reward ratio for sustainable profitability.</span>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Tab 1: SIP Calculator */}
      {activeTab === 'SIP' && (
        <div className="calc-content-grid">
          <section className="panel calc-inputs-card">
            <h3>Systematic Investment Parameters</h3>
            <label>
              Monthly Investment Amount: <b>{formatCurrency(sipMonthly)}</b>
              <input
                type="range"
                min="500"
                max="200000"
                step="500"
                value={sipMonthly}
                onChange={(e) => setSipMonthly(Number(e.target.value))}
              />
            </label>
            <label>
              Expected Annual Return (%): <b>{sipRate}%</b>
              <input
                type="range"
                min="1"
                max="30"
                step="0.5"
                value={sipRate}
                onChange={(e) => setSipRate(Number(e.target.value))}
              />
            </label>
            <label>
              Time Horizon: <b>{sipYears} Years</b>
              <input
                type="range"
                min="1"
                max="35"
                step="1"
                value={sipYears}
                onChange={(e) => setSipYears(Number(e.target.value))}
              />
            </label>
          </section>

          <section className="panel calc-results-card">
            <h3>Projected Wealth Outcome</h3>
            <div className="calc-outcome-badge">
              <span>Expected Maturity Value</span>
              <strong className="gain large-val">{formatCurrency(sipResult.futureValue)}</strong>
            </div>
            <div className="calc-stat-splits">
              <div className="split-row">
                <span>Total Amount Invested:</span>
                <b>{formatCurrency(sipResult.totalInvested)}</b>
              </div>
              <div className="split-row">
                <span>Wealth Gain (Returns):</span>
                <b className="gain">+{formatCurrency(sipResult.wealthGain)}</b>
              </div>
              <div className="split-row">
                <span>Gain Multiple:</span>
                <b>{(sipResult.futureValue / sipResult.totalInvested).toFixed(2)}x</b>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Tab 2: Stock P&L & Charges */}
      {activeTab === 'STOCK' && (
        <div className="calc-content-grid">
          <section className="panel calc-inputs-card">
            <h3>Trade Execution Parameters</h3>
            <label>
              Buy Price per Share (₹):
              <input
                type="number"
                step="0.1"
                value={stockBuyPrice}
                onChange={(e) => setStockBuyPrice(Number(e.target.value))}
              />
            </label>
            <label>
              Sell Price per Share (₹):
              <input
                type="number"
                step="0.1"
                value={stockSellPrice}
                onChange={(e) => setStockSellPrice(Number(e.target.value))}
              />
            </label>
            <label>
              Quantity of Shares:
              <input
                type="number"
                min="1"
                value={stockQty}
                onChange={(e) => setStockQty(Number(e.target.value))}
              />
            </label>
          </section>

          <section className="panel calc-results-card">
            <h3>Net Realized Outcome & Regulatory Charges</h3>
            <div className="calc-outcome-badge">
              <span>Net Profit / Loss After All Charges</span>
              <strong className={`${stockResult.netPnl >= 0 ? 'gain' : 'loss'} large-val`}>
                {stockResult.netPnl >= 0 ? '+' : ''}{formatCurrency(stockResult.netPnl)}
              </strong>
            </div>
            <div className="calc-stat-splits">
              <div className="split-row">
                <span>Gross Trade P&L:</span>
                <b>{formatCurrency(stockResult.grossPnl)}</b>
              </div>
              <div className="split-row">
                <span>Securities Transaction Tax (STT):</span>
                <span>{formatCurrency(stockResult.stt)}</span>
              </div>
              <div className="split-row">
                <span>Exchange Turnover & SEBI Fees:</span>
                <span>{formatCurrency(stockResult.exchangeTurnover)}</span>
              </div>
              <div className="split-row">
                <span>GST (18%) & Stamp Duty:</span>
                <span>{formatCurrency(stockResult.gst + stockResult.stampDuty)}</span>
              </div>
              <div className="split-row total-charges-row">
                <span>Total Statutory Charges:</span>
                <b className="loss">-{formatCurrency(stockResult.totalCharges)}</b>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Tab 3: Metal Valuation */}
      {activeTab === 'METALS' && (
        <div className="calc-content-grid">
          <section className="panel calc-inputs-card">
            <h3>Precious Metal Holdings</h3>
            <small>{goldQuote?.isDemo || silverQuote?.isDemo ? 'Simulated demo feed · not real market data' : 'Upstox MCX quote'}</small>
            <label>
              Gold Quantity (Grams):
              <input
                type="number"
                min="0.1"
                step="0.5"
                value={goldGrams}
                onChange={(e) => setGoldGrams(Number(e.target.value))}
              />
            </label>
            <label>
              Gold MCX future per Gram (₹) · editable:
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={Number(goldQuote?.c) > 0 ? (Number(goldQuote.c) / 10).toFixed(2) : 'Connect Upstox or enter rate'}
                value={goldRatePerGram}
                onChange={(e) => setGoldRatePerGram(e.target.value)}
              />
            </label>
            <label>
              Silver Quantity (Kilograms):
              <input
                type="number"
                min="0.01"
                step="0.1"
                value={silverKg}
                onChange={(e) => setSilverKg(Number(e.target.value))}
              />
            </label>
            <label>
              Silver MCX future per Kg (₹) · editable:
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={Number(silverQuote?.c) > 0 ? Number(silverQuote.c).toFixed(2) : 'Connect Upstox or enter rate'}
                value={silverRatePerKg}
                onChange={(e) => setSilverRatePerKg(e.target.value)}
              />
            </label>
          </section>

          <section className="panel calc-results-card">
            <h3>Precious Metals Total Value</h3>
            <div className="calc-outcome-badge">
              <span>Total Bullion Portfolio Value</span>
              <strong className="gain large-val">{metalResult.total === null ? 'Live quote unavailable' : formatCurrency(metalResult.total)}</strong>
            </div>
            <div className="calc-stat-splits">
              <div className="split-row">
                <span>Gold ({goldGrams}g @ {currentGoldRatePerGram === null ? 'no live rate' : `₹${currentGoldRatePerGram.toFixed(2)}/g`}):</span>
                <b>{metalResult.goldVal === null ? 'Unavailable' : formatCurrency(metalResult.goldVal)}</b>
              </div>
              <div className="split-row">
                <span>Silver ({silverKg}kg @ {currentSilverRatePerKg === null ? 'no live rate' : `₹${currentSilverRatePerKg.toFixed(2)}/kg`}):</span>
                <b>{metalResult.silverVal === null ? 'Unavailable' : formatCurrency(metalResult.silverVal)}</b>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Tab 4: EMI */}
      {activeTab === 'EMI' && (
        <div className="calc-content-grid">
          <section className="panel calc-inputs-card">
            <h3>Loan / Margin Financing</h3>
            <label>
              Loan Amount Principal: <b>{formatCurrency(emiPrincipal)}</b>
              <input
                type="range"
                min="100000"
                max="10000000"
                step="50000"
                value={emiPrincipal}
                onChange={(e) => setEmiPrincipal(Number(e.target.value))}
              />
            </label>
            <label>
              Interest Rate (% p.a.): <b>{emiRate}%</b>
              <input
                type="range"
                min="5"
                max="20"
                step="0.25"
                value={emiRate}
                onChange={(e) => setEmiRate(Number(e.target.value))}
              />
            </label>
            <label>
              Tenure: <b>{emiYears} Years</b>
              <input
                type="range"
                min="1"
                max="30"
                step="1"
                value={emiYears}
                onChange={(e) => setEmiYears(Number(e.target.value))}
              />
            </label>
          </section>

          <section className="panel calc-results-card">
            <h3>Repayment Breakdown</h3>
            <div className="calc-outcome-badge">
              <span>Monthly EMI</span>
              <strong className="large-val">{formatCurrency(emiResult.emi)} / mo</strong>
            </div>
            <div className="calc-stat-splits">
              <div className="split-row">
                <span>Principal Borrowed:</span>
                <b>{formatCurrency(emiPrincipal)}</b>
              </div>
              <div className="split-row">
                <span>Total Interest Payable:</span>
                <b className="loss">{formatCurrency(emiResult.totalInterest)}</b>
              </div>
              <div className="split-row">
                <span>Total Repayment:</span>
                <b>{formatCurrency(emiResult.totalPayment)}</b>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default Calculator;
