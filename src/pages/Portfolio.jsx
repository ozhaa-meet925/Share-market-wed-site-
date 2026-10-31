import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  PieChart,
  ArrowUpRight,
  Wallet,
  ShieldCheck,
  PlusCircle,
  Briefcase,
  Layers,
  Download,
  Share2,
} from 'lucide-react';
import CompanyLogo from '../components/CompanyLogo';
import QuickTradeModal from '../components/QuickTradeModal';
import { stocks as stockSeed } from '../data/stocks';
import { useLiveStocks } from '../hooks/useLiveStocks';
import { getPaperState } from '../services/paperTrading';

const initialHoldings = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy', qty: 12, avgBuyPrice: 2698.5 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking', qty: 40, avgBuyPrice: 1621.0 },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT', qty: 25, avgBuyPrice: 1565.2 },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking', qty: 35, avgBuyPrice: 773.4 },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', qty: 6, avgBuyPrice: 4080.0 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom', qty: 30, avgBuyPrice: 1620.0 },
];

const formatCurrency = (val) => Number.isFinite(Number(val)) && val !== null
  ? `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—';

const Portfolio = () => {
  const { stocks: liveStocks } = useLiveStocks(stockSeed);
  const [tradingStock, setTradingStock] = useState(null);
  const paperState = getPaperState();

  const liveMap = useMemo(
    () => new Map(liveStocks.map((s) => [s.symbol, s])),
    [liveStocks]
  );

  // Calculate live portfolio values
  const holdingsData = useMemo(() => {
    return initialHoldings.map((item) => {
      const live = liveMap.get(item.symbol);
      const hasDisplayQuote = live?.isLive || live?.isDemo;
      const currentPrice = hasDisplayQuote ? live.price : null;
      const change = hasDisplayQuote ? live.change : null;
      const changePercent = hasDisplayQuote ? live.changePercent : null;
      const flash = live?.flash;

      const investedVal = item.qty * item.avgBuyPrice;
      const currentVal = currentPrice === null ? null : item.qty * currentPrice;
      const totalPnl = currentVal === null ? null : currentVal - investedVal;
      const totalPnlPercent = totalPnl === null ? null : Number(((totalPnl / investedVal) * 100).toFixed(2));
      const dayGain = change === null ? null : item.qty * change;

      return {
        ...item,
        currentPrice,
        isLive: live?.isLive === true,
        isDemo: live?.isDemo === true,
        investedVal,
        currentVal,
        totalPnl,
        totalPnlPercent,
        dayGain,
        changePercent,
        flash,
      };
    });
  }, [liveMap]);

  const totalInvested = holdingsData.reduce((acc, h) => acc + h.investedVal, 0);
  const allQuotesAvailable = holdingsData.every((holding) => holding.currentVal !== null);
  const allDayChangesAvailable = holdingsData.every((holding) => holding.dayGain !== null);
  const totalCurrentValue = allQuotesAvailable
    ? holdingsData.reduce((acc, h) => acc + h.currentVal, 0)
    : null;
  const totalPnl = totalCurrentValue === null ? null : totalCurrentValue - totalInvested;
  const totalPnlPercent = totalPnl === null ? null : Number(((totalPnl / totalInvested) * 100).toFixed(2));
  const totalDayGain = allDayChangesAvailable ? holdingsData.reduce((acc, h) => acc + h.dayGain, 0) : null;
  const isOverallGain = totalPnl !== null && totalPnl >= 0;
  const isDayGain = totalDayGain !== null && totalDayGain >= 0;

  // Sector allocation
  const sectorAllocation = useMemo(() => {
    const map = {};
    for (const h of holdingsData) {
      if (h.currentVal !== null) map[h.sector] = (map[h.sector] || 0) + h.currentVal;
    }
    const liveValue = Object.values(map).reduce((total, value) => total + value, 0);
    return Object.entries(map).map(([sector, val]) => ({
      sector,
      val,
      pct: liveValue ? Math.round((val / liveValue) * 100) : 0,
    }));
  }, [holdingsData, totalCurrentValue]);

  // Export Portfolio as CSV
  const handleExportCSV = () => {
    if (!holdingsData.length) return;
    const headers = ['Symbol,Name,Sector,Quantity,Avg Buy Price,Current Price,Invested Value,Current Value,P&L,P&L %'];
    const rows = holdingsData.map((h) =>
      `"${h.symbol}","${h.name}","${h.sector}",${h.qty},${h.avgBuyPrice},${h.currentPrice ?? ''},${h.investedVal},${h.currentVal ?? ''},${h.totalPnl?.toFixed(2) ?? ''},${h.totalPnlPercent ?? ''}`
    );
    const currentTotalCell = totalCurrentValue === null ? '' : totalCurrentValue.toFixed(2);
    const pnlTotalCell = totalPnl === null ? '' : totalPnl.toFixed(2);
    const returnTotalCell = totalPnlPercent === null ? '' : `${totalPnlPercent}%`;
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows, `\n"TOTAL",,,,,,"${totalInvested.toFixed(2)}","${currentTotalCell}","${pnlTotalCell}","${returnTotalCell}"`].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `ShareMarket_Portfolio_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Share via WhatsApp
  const handleShareWhatsApp = () => {
    const text = `💼 *My ShareMarket Pro Portfolio:*\n` +
      `• *Total Value:* ${totalCurrentValue === null ? 'Awaiting live quotes' : `₹${totalCurrentValue.toLocaleString('en-IN')}`}\n` +
      `• *Total Invested:* ₹${totalInvested.toLocaleString('en-IN')}\n` +
      `• *Overall P&L:* ${totalPnl === null ? 'Awaiting live quotes' : `${isOverallGain ? '+' : ''}₹${totalPnl.toLocaleString('en-IN')} (${isOverallGain ? '+' : ''}${totalPnlPercent}%)`}\n\n` +
      `Top Holdings:\n` +
      holdingsData.slice(0, 5).map((h) => `• ${h.symbol}: ${h.currentPrice === null ? 'Awaiting live quote' : `₹${h.currentPrice} (${h.totalPnlPercent >= 0 ? '+' : ''}${h.totalPnlPercent}%)`}`).join('\n') +
      `\n\nTracked live on ShareMarket Pro!`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="page portfolio-page">
      <div className="page-title portfolio-header-title">
        <div>
          <span>Wealth & Holdings</span>
          <h1>My Investment Portfolio</h1>
        </div>
        <div className="portfolio-header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={handleExportCSV}
            title="Export Portfolio Holdings as CSV"
          >
            <Download size={15} /> Export CSV
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleShareWhatsApp}
            title="Share Portfolio Summary on WhatsApp"
          >
            <Share2 size={15} /> WhatsApp
          </button>
          <Link to="/paper-trading" className="primary-button">
            <PlusCircle size={16} /> Place Trade
          </Link>
          <Link to="/wallet" className="secondary-button">
            <Wallet size={16} /> Wallet
          </Link>
        </div>
      </div>

      {/* Portfolio Top Metrics Cards */}
      <section className="portfolio-kpi-grid">
        <div className="panel kpi-card">
          <span className="kpi-label">Total Portfolio Value</span>
          <strong className="kpi-value">{formatCurrency(totalCurrentValue)}</strong>
          <div className="kpi-subtext">
            <span>Invested: <b>{formatCurrency(totalInvested)}</b></span>
          </div>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Overall Profit / Loss</span>
          <strong className={`kpi-value ${totalPnl === null ? '' : isOverallGain ? 'gain' : 'loss'}`}>
            {totalPnl === null ? '—' : `${isOverallGain ? '+' : ''}${formatCurrency(totalPnl)}`}
          </strong>
          <div className="kpi-subtext">
            <span className={totalPnl === null ? '' : isOverallGain ? 'gain' : 'loss'}>
              {totalPnl === null ? 'Waiting for all live quotes' : <>{isOverallGain ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{isOverallGain ? '+' : ''}{totalPnlPercent}% returns</>}
            </span>
          </div>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Today's Day Gain</span>
          <strong className={`kpi-value ${totalDayGain === null ? '' : isDayGain ? 'gain' : 'loss'}`}>
            {totalDayGain === null ? '—' : `${isDayGain ? '+' : ''}${formatCurrency(totalDayGain)}`}
          </strong>
          <div className="kpi-subtext">
            <span className={totalDayGain === null ? '' : isDayGain ? 'gain' : 'loss'}>
              {totalDayGain === null ? 'Waiting for all live quotes' : isDayGain ? '▲ Market positive' : '▼ Market pressure'}
            </span>
          </div>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Available Virtual Cash</span>
          <strong className="kpi-value">{formatCurrency(paperState.cash)}</strong>
          <div className="kpi-subtext">
            <span>Positions: <b>{holdingsData.length} active</b></span>
          </div>
        </div>
      </section>

      {/* Sector Allocation Breakdown */}
      <section className="panel sector-allocation-panel">
        <div className="section-heading">
          <h3>
            <PieChart size={17} /> Sector Asset Allocation
          </h3>
          <span>Diversification across {sectorAllocation.length} core sectors</span>
        </div>
        <div className="allocation-progress-bar">
          {sectorAllocation.map((sec, idx) => (
            <div
              key={sec.sector}
              className={`alloc-bar-segment seg-${idx % 5}`}
              style={{ width: `${sec.pct}%` }}
              title={`${sec.sector}: ${sec.pct}% (${formatCurrency(sec.val)})`}
            />
          ))}
        </div>
        <div className="allocation-legend-row">
          {sectorAllocation.map((sec, idx) => (
            <div className="legend-item" key={sec.sector}>
              <span className={`legend-dot seg-${idx % 5}`} />
              <strong>{sec.sector}</strong>
              <small>{sec.pct}% ({formatCurrency(sec.val)})</small>
            </div>
          ))}
        </div>
      </section>

      {/* Detailed Holdings Table */}
      <section className="panel holdings-table-panel">
        <div className="section-heading">
          <h3>
            <Briefcase size={17} /> Holdings & Positions ({holdingsData.length})
          </h3>
          <span className="live-status-mini">
            <span className="live-dot" /> {liveStocks.filter((stock) => stock.isDemo).length ? 'Simulated demo values · not real market data' : `${liveStocks.filter((stock) => stock.isLive).length}/${holdingsData.length} live provider quotes`}
          </span>
        </div>

        <div className="table-responsive">
          <table className="holdings-table">
            <thead>
              <tr>
                <th>Stock / Sector</th>
                <th>Qty</th>
                <th>Avg Buy Price</th>
                <th>Live Price</th>
                <th>Current Value</th>
                <th>Day's Gain</th>
                <th>Total Return</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {holdingsData.map((h) => {
                const isGain = h.totalPnl !== null && h.totalPnl >= 0;
                const isDayUp = h.dayGain !== null && h.dayGain >= 0;
                const flashClass = h.flash ? `flash-${h.flash}` : '';

                return (
                  <tr key={h.symbol} className={flashClass}>
                    <td>
                      <div className="holding-stock-info">
                        <strong>{h.symbol}</strong>
                        <span>{h.name}</span>
                        <small className="badge-sector-mini">{h.sector}</small>
                      </div>
                    </td>
                    <td><b>{h.qty}</b></td>
                    <td>{formatCurrency(h.avgBuyPrice)}</td>
                    <td>
                      <b className={h.currentPrice === null ? '' : isDayUp ? 'gain' : 'loss'}>
                        {formatCurrency(h.currentPrice)}
                      </b>
                    </td>
                    <td>
                      <strong>{formatCurrency(h.currentVal)}</strong>
                    </td>
                    <td>
                      <span className={h.dayGain === null ? '' : isDayUp ? 'gain' : 'loss'}>
                        {h.dayGain === null ? '—' : `${isDayUp ? '+' : ''}${formatCurrency(h.dayGain)} (${isDayUp ? '+' : ''}${h.changePercent}%)`}
                      </span>
                    </td>
                    <td>
                      <span className={`pnl-pill ${h.totalPnl === null ? '' : isGain ? 'gain-pill' : 'loss-pill'}`}>
                        {h.totalPnl === null ? '—' : `${isGain ? '+' : ''}${formatCurrency(h.totalPnl)} (${isGain ? '+' : ''}${h.totalPnlPercent}%)`}
                      </span>
                    </td>
                    <td>
                      <div className="holding-actions">
                        <Link to={`/stocks/${h.symbol}`} className="action-btn-sm" title="Stock Analysis">
                          View <ArrowUpRight size={13} />
                        </Link>
                        <button
                          type="button"
                          className="action-btn-sm trade-btn"
                          title="Trade"
                          disabled={!h.isLive}
                          onClick={() => setTradingStock({
                            symbol: h.symbol,
                            name: h.name,
                            sector: h.sector,
                            price: h.currentPrice,
                            change: h.dayGain / h.qty,
                            changePercent: h.changePercent,
                          })}
                        >
                          Trade
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Trade Modal */}
      {tradingStock && (
        <QuickTradeModal
          stock={tradingStock}
          initialSide="Sell"
          onClose={() => setTradingStock(null)}
        />
      )}
    </div>
  );
};

export default Portfolio;
