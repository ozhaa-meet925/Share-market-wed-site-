import { useEffect, useMemo, useState } from 'react';
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
import { TickArrow } from '../components/PriceChange';
import { metalBySymbol, metalCatalogStocks } from '../data/metals';
import { stocks as stockSeed } from '../data/stocks';
import { useLiveStocks } from '../hooks/useLiveStocks';
import { useMetalPaperState } from '../hooks/useMetalPaperState';
import { useMetalQuotes } from '../hooks/useMetalQuotes';
import { getPaperPositions, getPaperState, PAPER_STATE_EVENT } from '../services/paperTrading';

const portfolioStocks = [...stockSeed, ...metalCatalogStocks];
const stockMeta = new Map(portfolioStocks.map((stock) => [stock.symbol, stock]));

const formatCurrency = (val) => {
  if (!Number.isFinite(Number(val)) || val === null) return '—';
  const amount = Number(val);
  return `${amount < 0 ? '-' : ''}₹${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const Portfolio = () => {
  const { stocks: liveStocks } = useLiveStocks(portfolioStocks);
  const { quotes: metalQuotes } = useMetalQuotes();
  const { state: metalPaperState } = useMetalPaperState();
  const [tradingStock, setTradingStock] = useState(null);
  const [paperState, setPaperState] = useState(getPaperState);

  useEffect(() => {
    const refresh = () => setPaperState(getPaperState());
    window.addEventListener(PAPER_STATE_EVENT, refresh);
    return () => window.removeEventListener(PAPER_STATE_EVENT, refresh);
  }, []);

  const liveMap = useMemo(
    () => new Map(liveStocks.map((s) => [s.symbol, s])),
    [liveStocks]
  );

  const holdingsData = useMemo(() => {
    const equityPositions = getPaperPositions(paperState).filter((item) => !metalBySymbol.has(item.symbol));
    const metalPositions = (metalPaperState?.holdings || [])
      .filter((item) => Number(item.quantityGrams) > 0)
      .map((item) => ({
        symbol: item.symbol,
        qty: Number(item.quantityGrams),
        avgBuyPrice: Number(item.avgPricePerGram),
        realizedPnl: Number(item.realizedPnl || 0),
      }));

    return [...equityPositions, ...metalPositions].map((item) => {
      const meta = stockMeta.get(item.symbol);
      const metal = metalBySymbol.get(item.symbol);
      const live = metal ? metalQuotes.get(item.symbol) : liveMap.get(item.symbol);
      const hasDisplayQuote = metal
        ? Number(live?.inrPerGram) > 0 && live?.isStale !== true
        : live?.isLive || live?.isDemo || live?.isResearch || live?.isSpot;
      const currentPrice = hasDisplayQuote
        ? Number(metal ? live.inrPerGram : live.price)
        : null;
      const unitsPerQuoteUnit = metal?.unitsPerQuoteUnit || 1;
      const rawChange = metal ? live?.d : live?.change;
      const change = hasDisplayQuote && rawChange !== null && rawChange !== undefined && Number.isFinite(Number(rawChange))
        ? Number((Number(rawChange) / unitsPerQuoteUnit).toFixed(2))
        : null;
      const rawChangePercent = metal ? live?.dp : live?.changePercent;
      const changePercent = hasDisplayQuote && rawChangePercent !== null && rawChangePercent !== undefined
        ? Number(rawChangePercent)
        : null;
      const flash = live?.flash;
      const investedVal = item.qty * item.avgBuyPrice;
      const currentVal = currentPrice === null ? null : item.qty * currentPrice;
      const totalPnl = currentVal === null ? null : currentVal - investedVal;
      const totalPnlPercent = totalPnl === null || investedVal === 0 ? null : Number(((totalPnl / investedVal) * 100).toFixed(2));
      const dayGain = change === null ? null : item.qty * change;

      return {
        ...item,
        name: meta?.name || item.symbol,
        sector: meta?.sector || (metal ? 'Precious Metals' : 'Other'),
        currentPrice,
        isLive: live?.isLive === true,
        isDemo: live?.isDemo === true,
        isResearch: live?.isResearch === true,
        isSpot: live?.isSpot === true,
        isMetal: Boolean(metal),
        route: metal?.route || null,
        unitLabel: metal ? metal.quantityUnit : 'share',
        priceUnit: metal ? '/g' : '',
        isDelayed: live?.isDelayed === true || live?.isResearch === true || live?.isSpot === true,
        isStale: live?.isStale === true,
        investedVal,
        currentVal,
        totalPnl,
        totalPnlPercent,
        dayGain,
        changePercent,
        flash,
      };
    });
  }, [liveMap, metalPaperState?.holdings, metalQuotes, paperState]);

  const totalInvested = holdingsData.reduce((acc, h) => acc + h.investedVal, 0);
  const equityPaperCash = Number(paperState.cash || 0);
  const metalPaperCash = Number(metalPaperState?.account?.availableCash || 0);
  const totalPaperCash = equityPaperCash + metalPaperCash;
  const hasHoldings = holdingsData.length > 0;
  const liveQuoteCount = holdingsData.filter((holding) => holding.isLive).length;
  const liveMetalCount = holdingsData.filter((holding) => holding.isMetal && holding.isLive).length;
  const researchQuoteCount = holdingsData.filter((holding) => holding.isResearch).length;
  const spotQuoteCount = holdingsData.filter((holding) => holding.isSpot).length;
  const demoQuoteCount = holdingsData.filter((holding) => holding.isDemo).length;
  const delayedQuoteCount = researchQuoteCount + spotQuoteCount;
  const quoteBasisLabel = demoQuoteCount
    ? 'Simulated demo values · not real market data'
    : delayedQuoteCount > 0 && delayedQuoteCount === holdingsData.length
      ? spotQuoteCount && !researchQuoteCount
        ? 'Delayed spot quotes · not live'
        : 'Delayed research quotes · not live'
      : delayedQuoteCount > 0
        ? `${liveQuoteCount} live · ${delayedQuoteCount} delayed (not live)`
        : `${liveQuoteCount}/${holdingsData.length} live provider quotes`;
  const allQuotesAvailable = holdingsData.every((holding) => holding.currentVal !== null);
  const allDayChangesAvailable = holdingsData.every((holding) => holding.dayGain !== null);
  const totalCurrentValue = allQuotesAvailable
    ? holdingsData.reduce((acc, h) => acc + h.currentVal, 0)
    : null;
  const totalPnl = totalCurrentValue === null ? null : totalCurrentValue - totalInvested;
  const totalPnlPercent = totalPnl === null || totalInvested === 0 ? null : Number(((totalPnl / totalInvested) * 100).toFixed(2));
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
    const headers = ['Symbol,Name,Sector,Quantity,Unit,Avg Buy Price,Current Price,Invested Value,Current Value,Unrealized P&L,P&L %,Realized P&L'];
    const rows = holdingsData.map((h) =>
      `"${h.symbol}","${h.name}","${h.sector}",${h.qty},"${h.unitLabel}",${h.avgBuyPrice},${h.currentPrice ?? ''},${h.investedVal},${h.currentVal ?? ''},${h.totalPnl?.toFixed(2) ?? ''},${h.totalPnlPercent ?? ''},${Number(h.realizedPnl || 0).toFixed(2)}`
    );
    const currentTotalCell = totalCurrentValue === null ? '' : totalCurrentValue.toFixed(2);
    const pnlTotalCell = totalPnl === null ? '' : totalPnl.toFixed(2);
    const returnTotalCell = totalPnlPercent === null ? '' : `${totalPnlPercent}%`;
    const realizedTotalCell = holdingsData.reduce((total, holding) => total + Number(holding.realizedPnl || 0), 0).toFixed(2);
    const totalRow = ['"TOTAL"', '', '', '', '', '', '', totalInvested.toFixed(2), currentTotalCell, pnlTotalCell, returnTotalCell, realizedTotalCell].join(',');
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows, '', totalRow].join('\n');
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
              {!hasHoldings ? 'No holdings yet' : totalPnl === null ? 'Waiting for quotes' : <>{isOverallGain ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{isOverallGain ? '+' : ''}{totalPnlPercent}% returns</>}
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
              {!hasHoldings ? 'No holdings yet' : totalDayGain === null ? 'Waiting for quotes' : isDayGain ? '▲ Market positive' : '▼ Market pressure'}
            </span>
          </div>
        </div>

        <div className="panel kpi-card">
          <span className="kpi-label">Available Virtual Cash</span>
          <strong className="kpi-value">{formatCurrency(totalPaperCash)}</strong>
          <div className="kpi-subtext">
            <span>Equities {formatCurrency(equityPaperCash)} · Metals {metalPaperState ? formatCurrency(metalPaperCash) : 'sign in'}</span>
          </div>
        </div>
      </section>

      {hasHoldings && delayedQuoteCount > 0 && (
        <p className="paper-note">
          {spotQuoteCount > 0 && researchQuoteCount > 0
            ? 'Equity and metal valuations use delayed research and spot quotes, not live exchange prices.'
            : spotQuoteCount > 0
              ? 'Metal valuation uses delayed spot references, not live MCX exchange prices.'
              : liveMetalCount > 0
                ? 'Metal holdings use live Upstox MCX quotes; equity valuation uses delayed research quotes.'
                : 'Valuation uses delayed research quotes, not live exchange prices.'}
        </p>
      )}

      {hasHoldings ? (
        <>
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
            <span className="live-dot" /> {quoteBasisLabel}
          </span>
        </div>

        <div className="table-responsive">
          <table className="holdings-table">
            <thead>
              <tr>
                <th>Instrument / Sector</th>
                <th>Qty</th>
                <th>Avg Buy Price</th>
                <th>Market Price</th>
                <th>Current Value</th>
                <th>Day's Gain</th>
                <th>Total Return</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {holdingsData.map((h) => {
                const isGain = h.totalPnl !== null && h.totalPnl > 0;
                const isLoss = h.totalPnl !== null && h.totalPnl < 0;
                const dayDirection = h.dayGain === null ? 'flat' : h.dayGain > 0 ? 'up' : h.dayGain < 0 ? 'down' : 'flat';
                const priceDirection = h.changePercent === null ? dayDirection : Number(h.changePercent) > 0 ? 'up' : Number(h.changePercent) < 0 ? 'down' : 'flat';
                const flashClass = h.flash === 'up' || h.flash === 'down' ? `flash-${h.flash}` : '';
                const priceTone = `price-${priceDirection}${h.flash === 'up' || h.flash === 'down' ? ` price-flash-${h.flash}` : ''}`;

                return (
                  <tr key={h.symbol} className={flashClass}>
                    <td>
                      <div className="holding-stock-info">
                        <strong>{h.symbol}</strong>
                        <span>{h.name}</span>
                        <small className="badge-sector-mini">{h.sector}</small>
                      </div>
                    </td>
                    <td><b>{h.qty} {h.unitLabel}</b></td>
                    <td>{formatCurrency(h.avgBuyPrice)}{h.priceUnit}</td>
                    <td>
                      <b className={h.currentPrice === null ? '' : priceTone}>
                        {formatCurrency(h.currentPrice)}{h.priceUnit}
                      </b>
                      {h.currentPrice !== null && h.changePercent !== null ? <TickArrow direction={priceDirection} /> : null}
                    </td>
                    <td>
                      <strong>{formatCurrency(h.currentVal)}</strong>
                    </td>
                    <td>
                      <span className={h.dayGain === null ? '' : dayDirection === 'up' ? 'gain' : dayDirection === 'down' ? 'loss' : 'price-flat'}>
                        {h.dayGain === null ? '—' : `${dayDirection === 'up' ? '+' : ''}${formatCurrency(h.dayGain)} (${dayDirection === 'up' ? '+' : ''}${Number(h.changePercent).toFixed(2)}%)`}
                      </span>
                    </td>
                    <td>
                      <span className={`pnl-pill ${h.totalPnl === null ? '' : isGain ? 'gain-pill' : isLoss ? 'loss-pill' : 'neutral-pill'}`}>
                        {h.totalPnl === null ? '—' : `${isGain ? '+' : ''}${formatCurrency(h.totalPnl)} (${isGain ? '+' : ''}${h.totalPnlPercent}%)`}
                      </span>
                    </td>
                    <td>
                      <div className="holding-actions">
                        <Link to={h.isMetal ? h.route : `/stocks/${h.symbol}`} className="action-btn-sm" title={h.isMetal ? `${h.name} market` : 'Stock Analysis'}>
                          View <ArrowUpRight size={13} />
                        </Link>
                        {h.isMetal ? (
                          <Link to={h.route} className="action-btn-sm trade-btn" title={`Trade ${h.name}`}>
                            Trade
                          </Link>
                        ) : (
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
                              isLive: h.isLive,
                              isResearch: h.isResearch,
                              isStale: h.isStale,
                              isDemo: false,
                            })}
                          >
                            Trade
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
        </>
      ) : (
        <section className="panel paper-empty-state holdings-empty-state">
          <Briefcase size={36} />
          <h3>No holdings yet</h3>
          <p>Place your first executed paper trade to start building your portfolio.</p>
          <Link to="/paper-trading" className="primary-button">
            <PlusCircle size={16} /> Place a paper trade
          </Link>
        </section>
      )}

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
