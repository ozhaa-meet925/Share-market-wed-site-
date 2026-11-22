import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Download,
  FileText,
  Info,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { metalBySymbol, metalCatalogStocks } from '../data/metals';
import { stocks as stockSeed } from '../data/stocks';
import { createCatalogStock } from '../hooks/useStockCatalog';
import { useCatalogQuotes } from '../hooks/useCatalogQuotes';
import { useMetalPaperState } from '../hooks/useMetalPaperState';
import { useMetalQuotes } from '../hooks/useMetalQuotes';
import { getPaperPositions, getPaperState, PAPER_STATE_EVENT } from '../services/paperTrading';
import './ReportsEnhancements.css';

const stockMeta = new Map([...stockSeed, ...metalCatalogStocks].map((stock) => [stock.symbol, stock]));

const formatCurrency = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const amount = Number(value);
  return `${amount < 0 ? '-' : ''}₹${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatSigned = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${Number(value) >= 0 ? '+' : ''}${formatCurrency(value)}`;
};

const monthKeyFromTimestamp = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : null;
};

const formatMonthKey = (value) => {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(new Date(year, month - 1, 1));
};

const Reports = () => {
  const [paperState, setPaperState] = useState(getPaperState);
  const { state: metalPaperState } = useMetalPaperState();
  const { quotes: metalQuotes, lastUpdated: metalsLastUpdated } = useMetalQuotes();

  useEffect(() => {
    const refresh = () => setPaperState(getPaperState());
    window.addEventListener(PAPER_STATE_EVENT, refresh);
    return () => window.removeEventListener(PAPER_STATE_EVENT, refresh);
  }, []);

  const positions = useMemo(
    () => getPaperPositions(paperState).filter((position) => !metalBySymbol.has(position.symbol)),
    [paperState],
  );

  const positionStocks = useMemo(() => positions.map((position) => (
    stockMeta.get(position.symbol) || createCatalogStock(position.symbol, position.symbol)
  )), [positions]);

  const { quotes, lastUpdated } = useCatalogQuotes(positionStocks);

  const report = useMemo(() => {
    const realized = new Map();
    const lots = new Map();
    const closedTrades = [];
    const unmatchedSells = [];
    const monthlyPnl = new Map();
    const addMonthlyPnl = (timestamp, pnl) => {
      const month = monthKeyFromTimestamp(timestamp);
      if (!month || !Number.isFinite(pnl)) return;
      const summary = monthlyPnl.get(month) || { month, pnl: 0, trades: 0 };
      summary.pnl += pnl;
      summary.trades += 1;
      monthlyPnl.set(month, summary);
    };
    let executedCount = 0;
    let turnover = 0;

    const executedOrders = (paperState.orders || [])
      .filter((order) => order.status === 'Executed' && !metalBySymbol.has(order.symbol))
      .slice()
      .reverse();

    for (const order of executedOrders) {
      const symbol = String(order.symbol || '').toUpperCase();
      const qty = Number(order.qty);
      const price = Number(order.price);
      if (!symbol || !(qty > 0) || !(price > 0)) continue;
      executedCount += 1;
      turnover += qty * price;

      const row = realized.get(symbol) || {
        symbol,
        buyQty: 0,
        buyValue: 0,
        sellQty: 0,
        sellValue: 0,
        realizedPnl: 0,
        unmatchedSellQty: 0,
        charges: 0,
      };

      if (order.side === 'Buy') {
        row.buyQty += qty;
        row.buyValue += qty * price;
        lots.set(symbol, [...(lots.get(symbol) || []), { qty, price }]);
      } else {
        row.sellQty += qty;
        row.sellValue += qty * price;
        const symbolLots = lots.get(symbol) || [];
        let remaining = qty;
        let cost = 0;
        while (remaining > 0 && symbolLots.length) {
          const lot = symbolLots[0];
          const take = Math.min(lot.qty, remaining);
          cost += take * lot.price;
          lot.qty -= take;
          remaining -= take;
          if (lot.qty <= 0) symbolLots.shift();
        }
        lots.set(symbol, symbolLots);
        const matchedQty = qty - remaining;
        if (matchedQty > 0) {
          const pnl = matchedQty * price - cost;
          row.realizedPnl += pnl;
          const executedAt = order.executedAt || order.filledAt || order.createdAt || order.timestamp || null;
          closedTrades.push({ symbol, qty: matchedQty, pnl, executedAt });
          addMonthlyPnl(executedAt, pnl);
        }
        if (remaining > 0) {
          row.unmatchedSellQty += remaining;
          unmatchedSells.push({ symbol, qty: remaining });
        }
      }
      realized.set(symbol, row);
    }

    const positionBySymbol = new Map(positions.map((position) => [position.symbol, position]));
    const equitySymbols = new Set([...realized.keys(), ...positionBySymbol.keys()]);
    const equityRows = [...equitySymbols].map((symbol) => {
      const meta = stockMeta.get(symbol);
      const realizedRow = realized.get(symbol) || {
        symbol, buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0, realizedPnl: 0, unmatchedSellQty: 0, charges: 0,
      };
      const position = positionBySymbol.get(symbol);
      const openQty = position?.qty || 0;
      const avgBuyPrice = position?.avgBuyPrice || 0;
      const rawPrice = Number(quotes.get(symbol)?.c);
      const currentPrice = rawPrice > 0 ? rawPrice : null;
      const openCost = openQty * avgBuyPrice;
      const marketValue = openQty === 0 ? 0 : currentPrice === null ? null : openQty * currentPrice;
      return {
        symbol,
        name: meta?.name || symbol,
        sector: meta?.sector || 'Other',
        unit: 'share',
        route: `/stocks/${symbol}`,
        ...realizedRow,
        openQty,
        avgBuyPrice,
        currentPrice,
        openCost,
        marketValue,
        unrealizedPnl: marketValue === null ? null : marketValue - openCost,
      };
    });

    const filledMetalOrders = (metalPaperState?.orders || []).filter((order) => order.status === 'FILLED');
    const metalCostBasis = new Map();
    for (const order of filledMetalOrders.slice().sort((left, right) => new Date(left.filledAt || left.createdAt || 0) - new Date(right.filledAt || right.createdAt || 0))) {
      const symbol = String(order.symbol || '').toUpperCase();
      const quantity = Number(order.quantityGrams);
      const price = Number(order.executionPricePerGram);
      if (!symbol || !(quantity > 0) || !(price > 0)) continue;
      const charges = Number(order.charges || 0);
      const current = metalCostBasis.get(symbol) || { quantity: 0, average: 0 };
      if (order.side === 'BUY') {
        const nextQuantity = current.quantity + quantity;
        const nextCost = current.quantity * current.average + quantity * price + charges;
        metalCostBasis.set(symbol, { quantity: nextQuantity, average: nextCost / nextQuantity });
      } else if (order.side === 'SELL' && current.quantity >= quantity) {
        const realizedPnl = (price - current.average) * quantity - charges;
        addMonthlyPnl(order.filledAt || order.createdAt, realizedPnl);
        current.quantity -= quantity;
        if (current.quantity <= 0) current.average = 0;
        metalCostBasis.set(symbol, current);
      }
    }
    const metalHoldingBySymbol = new Map((metalPaperState?.holdings || []).map((holding) => [holding.symbol, holding]));
    const metalSymbols = new Set([
      ...filledMetalOrders.map((order) => order.symbol),
      ...(metalPaperState?.holdings || []).filter((holding) => Number(holding.quantityGrams) > 0 || Number(holding.realizedPnl) !== 0).map((holding) => holding.symbol),
    ]);
    const metalRows = [...metalSymbols].map((symbol) => {
      const meta = stockMeta.get(symbol);
      const metal = metalBySymbol.get(symbol);
      const holding = metalHoldingBySymbol.get(symbol);
      const symbolOrders = filledMetalOrders.filter((order) => order.symbol === symbol);
      const buys = symbolOrders.filter((order) => order.side === 'BUY');
      const sells = symbolOrders.filter((order) => order.side === 'SELL');
      const quote = metalQuotes.get(symbol);
      const currentPrice = Number(quote?.inrPerGram) > 0 && quote?.isStale !== true ? Number(quote.inrPerGram) : null;
      const openQty = Number(holding?.quantityGrams || 0);
      const avgBuyPrice = Number(holding?.avgPricePerGram || 0);
      const openCost = openQty * avgBuyPrice;
      const marketValue = openQty === 0 ? 0 : currentPrice === null ? null : openQty * currentPrice;
      const rowCharges = symbolOrders.reduce((total, order) => total + Number(order.charges || 0), 0);
      executedCount += symbolOrders.length;
      turnover += symbolOrders.reduce((total, order) => total + Number(order.grossValue || 0), 0);
      return {
        symbol,
        name: meta?.name || symbol,
        sector: meta?.sector || 'Precious Metals',
        unit: metal?.quantityUnit || 'g',
        route: metal?.route || '/',
        buyQty: buys.reduce((total, order) => total + Number(order.quantityGrams), 0),
        buyValue: buys.reduce((total, order) => total + Number(order.grossValue || 0), 0),
        sellQty: sells.reduce((total, order) => total + Number(order.quantityGrams), 0),
        sellValue: sells.reduce((total, order) => total + Number(order.grossValue || 0), 0),
        realizedPnl: Number(holding?.realizedPnl || 0),
        unmatchedSellQty: 0,
        charges: rowCharges,
        openQty,
        avgBuyPrice,
        currentPrice,
        openCost,
        marketValue,
        unrealizedPnl: marketValue === null ? null : marketValue - openCost,
      };
    });

    const rows = [...equityRows, ...metalRows]
      .sort((first, second) => Math.abs(second.realizedPnl) - Math.abs(first.realizedPnl));
    const realizedTotal = rows.reduce((total, row) => total + row.realizedPnl, 0);
    const unrealizedTotal = rows.every((row) => row.unrealizedPnl !== null)
      ? rows.reduce((total, row) => total + (row.unrealizedPnl || 0), 0)
      : null;
    const wins = closedTrades.filter((trade) => trade.pnl > 0).length;
    const losses = closedTrades.filter((trade) => trade.pnl < 0).length;

    return {
      rows,
      realizedTotal,
      unrealizedTotal,
      totalPnl: unrealizedTotal === null ? null : realizedTotal + unrealizedTotal,
      turnover,
      totalCharges: metalRows.reduce((total, row) => total + row.charges, 0),
      executedCount,
      closedTrades: closedTrades.length,
      wins,
      losses,
      unmatchedSells,
      monthlyPnl: [...monthlyPnl.values()].sort((left, right) => left.month.localeCompare(right.month)),
    };
  }, [metalPaperState?.holdings, metalPaperState?.orders, metalQuotes, paperState.orders, positions, quotes]);

  const exportCsv = () => {
    const headers = 'Symbol,Name,Sector,Buy Qty,Buy Value,Sell Qty,Sell Value,Estimated Charges,Realized P&L,Open Qty,Avg Cost,Current Price,Market Value,Unrealized P&L';
    const lines = report.rows.map((row) => [
      row.symbol,
      `"${row.name}"`,
      `"${row.sector}"`,
      row.buyQty,
      row.buyValue.toFixed(2),
      row.sellQty,
      row.sellValue.toFixed(2),
      Number(row.charges || 0).toFixed(2),
      row.realizedPnl.toFixed(2),
      row.openQty,
      row.avgBuyPrice.toFixed(2),
      row.currentPrice === null ? '' : row.currentPrice.toFixed(2),
      row.marketValue === null ? '' : row.marketValue.toFixed(2),
      row.unrealizedPnl === null ? '' : row.unrealizedPnl.toFixed(2),
    ].join(','));
    const summary = [
      `"REALIZED P&L",${report.realizedTotal.toFixed(2)}`,
      `"UNREALIZED P&L",${report.unrealizedTotal === null ? '' : report.unrealizedTotal.toFixed(2)}`,
      `"TURNOVER",${report.turnover.toFixed(2)}`,
      `"METALS ESTIMATED CHARGES",${report.totalCharges.toFixed(2)}`,
    ];
    const blob = new Blob([[headers, ...lines, '', ...summary].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ShareMarket_Paper_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const isRealizedGain = report.realizedTotal >= 0;
  const isUnrealizedGain = (report.unrealizedTotal ?? 0) >= 0;
  const isTotalGain = (report.totalPnl ?? 0) >= 0;
  const closedTrades = report.wins + report.losses;
  const winRate = closedTrades ? Math.round((report.wins / closedTrades) * 100) : null;

  return (
    <div className="page reports-page">
      <div className="page-title reports-header">
        <div>
          <span>Reports & Statements</span>
          <h1>Paper ledger report</h1>
          <p>Realized and unrealized performance from your virtual trades.</p>
        </div>
        <div className="reports-header-actions">
          <button type="button" className="secondary-button" onClick={exportCsv} disabled={!report.rows.length}>
            <Download size={15} /> Export CSV
          </button>
          <Link to="/orders" className="secondary-button">View orders <ArrowUpRight size={15} /></Link>
        </div>
      </div>

      <div className="reports-source-note" role="status">
        <Info size={15} />
        <span>
          This report is built from virtual paper ledgers only — it is not a broker contract note, tax statement or realized capital-gains report.
          Metals realized P&amp;L and average cost include persisted estimated charges; equity paper calculations exclude charges. {lastUpdated ? `Equity positions use research quotes refreshed at ${lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}. ` : ''}{metalsLastUpdated ? `Metals use verified provider quotes refreshed at ${metalsLastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.` : 'Open metals positions wait for a verified provider quote.'}
        </span>
      </div>

      <section className="reports-kpi-grid" aria-label="Report summary">
        <div className="panel kpi-card">
          <span className="kpi-label">Realized P&L</span>
          <strong className={`kpi-value ${isRealizedGain ? 'gain' : 'loss'}`}>{formatSigned(report.realizedTotal)}</strong>
          <small className="kpi-subtext">{report.closedTrades} matched sell {report.closedTrades === 1 ? 'trade' : 'trades'} · FIFO</small>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Unrealized P&L</span>
          <strong className={`kpi-value ${report.unrealizedTotal === null ? '' : isUnrealizedGain ? 'gain' : 'loss'}`}>{report.unrealizedTotal === null ? 'Awaiting quotes' : formatSigned(report.unrealizedTotal)}</strong>
          <small className="kpi-subtext">{report.rows.filter((row) => row.openQty > 0).length} open positions</small>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Total P&L</span>
          <strong className={`kpi-value ${report.totalPnl === null ? '' : isTotalGain ? 'gain' : 'loss'}`}>{report.totalPnl === null ? 'Awaiting quotes' : formatSigned(report.totalPnl)}</strong>
          <small className="kpi-subtext">Realized + unrealized</small>
        </div>
        <div className="panel kpi-card">
          <span className="kpi-label">Executed Turnover</span>
          <strong className="kpi-value">{formatCurrency(report.turnover)}</strong>
          <small className="kpi-subtext">{report.executedCount} executed orders · metals charges {formatCurrency(report.totalCharges)}</small>
        </div>
      </section>

      <section className="panel reports-monthly-panel" aria-labelledby="monthly-pnl-title">
        <div className="section-heading">
          <div>
            <span>Monthly performance</span>
            <h2 id="monthly-pnl-title">Realized paper P&amp;L by month</h2>
          </div>
          <FileText size={19} />
        </div>
        {report.monthlyPnl.length ? (
          <div className="reports-monthly-grid">
            {report.monthlyPnl.slice(-12).map((month) => (
              <article key={month.month} className="reports-monthly-card">
                <span>{formatMonthKey(month.month)}</span>
                <strong className={month.pnl >= 0 ? 'gain' : 'loss'}>{formatSigned(month.pnl)}</strong>
                <small>{month.trades} matched sell {month.trades === 1 ? 'trade' : 'trades'}</small>
              </article>
            ))}
          </div>
        ) : (
          <p className="reports-monthly-empty">Monthly realized P&amp;L will appear for matched sells with a recorded execution timestamp. Older trades without a timestamp are excluded.</p>
        )}
        {report.monthlyPnl.length ? <p className="reports-monthly-empty">Only timestamped, matched paper sells are included. Older equity orders without execution timestamps are omitted; this is a virtual ledger summary, not a tax statement.</p> : null}
      </section>

      <section className="panel reports-breakdown">
        <div className="section-heading">
          <div>
            <span>Performance</span>
            <h2>Win rate & unmatched sells</h2>
          </div>
          <Wallet size={20} />
        </div>
        <div className="reports-winrate">
          <div>
            <span>Winning sells</span>
            <strong className="gain">{report.wins}</strong>
          </div>
          <div>
            <span>Losing sells</span>
            <strong className="loss">{report.losses}</strong>
          </div>
          <div>
            <span>Win rate</span>
            <strong>{winRate === null ? '—' : `${winRate}%`}</strong>
          </div>
          <div>
            <span>Unmatched sell qty</span>
            <strong>{report.unmatchedSells.reduce((total, item) => total + item.qty, 0) || '—'}</strong>
          </div>
        </div>
        {winRate !== null ? (
          <>
            <div className="reports-rate-track" role="img" aria-label={`Win rate ${winRate}% across ${closedTrades} closed sells`}>
              <span style={{ width: `${winRate}%` }} />
            </div>
            <div className="reports-rate-label">
              <span>{report.wins} winning</span>
              <span>{report.losses} losing</span>
            </div>
          </>
        ) : null}
        {report.unmatchedSells.length ? (
          <p className="reports-warning">
            Some sells were placed without an earlier paper buy, so their P&L cannot be matched and is excluded: {report.unmatchedSells.map((item) => `${item.symbol} × ${item.qty}`).join(', ')}.
          </p>
        ) : null}
      </section>

      <section className="panel reports-table-panel">
        <div className="section-heading">
          <div>
            <span>Ledger detail</span>
            <h2>Per-symbol breakdown</h2>
          </div>
          <FileText size={19} />
        </div>
        <div className="table-responsive">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Buy qty / value</th>
                <th>Sell qty / value</th>
                <th>Est. charges</th>
                <th>Realized P&L</th>
                <th>Open qty</th>
                <th>Avg cost</th>
                <th>Current price</th>
                <th>Unrealized P&L</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const realizedGain = row.realizedPnl >= 0;
                const unrealizedGain = (row.unrealizedPnl ?? 0) >= 0;
                return (
                  <tr key={row.symbol}>
                    <td>
                      <Link to={row.route} className="reports-symbol">
                        <b>{row.symbol}</b>
                        <span>{row.name}</span>
                      </Link>
                    </td>
                    <td>{row.buyQty} · {formatCurrency(row.buyValue)}</td>
                    <td>{row.sellQty} · {formatCurrency(row.sellValue)}</td>
                    <td>{row.charges ? formatCurrency(row.charges) : '—'}</td>
                    <td className={realizedGain ? 'gain' : 'loss'}>
                      {realizedGain ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {formatSigned(row.realizedPnl)}
                    </td>
                    <td>{row.openQty || '—'} {row.openQty ? row.unit : ''}</td>
                    <td>{row.avgBuyPrice ? formatCurrency(row.avgBuyPrice) : '—'}</td>
                    <td>{formatCurrency(row.currentPrice)}</td>
                    <td className={row.unrealizedPnl === null ? '' : unrealizedGain ? 'gain' : 'loss'}>{row.unrealizedPnl === null ? 'Awaiting quote' : formatSigned(row.unrealizedPnl)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!report.rows.length ? (
          <div className="reports-empty">
            <FileText size={30} />
            <strong>No paper trades to report yet</strong>
            <span>Executed paper orders and open paper positions will appear here.</span>
          </div>
        ) : null}
      </section>

      <div className="reports-links">
        <Link to="/portfolio">Open portfolio <ArrowUpRight size={14} /></Link>
        <Link to="/paper-trading">Paper trading <ArrowUpRight size={14} /></Link>
        <Link to="/calculators">Brokerage calculator <ArrowUpRight size={14} /></Link>
      </div>
    </div>
  );
};

export default Reports;
