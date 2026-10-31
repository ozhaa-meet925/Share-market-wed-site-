import { useEffect, useState, useMemo } from 'react';
import { ArrowLeftRight, BellPlus, Info, Trash2, X } from 'lucide-react';
import { useStockCatalog } from '../hooks/useStockCatalog';
import { useCompareQuotes } from '../hooks/useCompareQuotes';
import CompanyLogo from '../components/CompanyLogo';
import PriceAlertForm from '../components/PriceAlertForm';
import QuickTradeModal from '../components/QuickTradeModal';
import LiveChart from '../components/LiveChart';

const formatProviderName = (provider) => {
  const knownProviders = {
    alpha_vantage: 'Alpha Vantage',
    upstox: 'Upstox',
    zerodha: 'Zerodha Kite',
    kun: 'Kunpeng Data',
    groww: 'Groww',
  };
  return knownProviders[String(provider || '').toLowerCase()]
    || String(provider || 'Market provider').replaceAll('_', ' ');
};

const toQuoteDate = (value, fallback) => {
  if (value) {
    const numeric = Number(value);
    const date = Number.isFinite(numeric)
      ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
      : new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return fallback || null;
};

const formatQuoteTime = (date) => date
  ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : 'Waiting for quote';

const formatRupees = (value, digits = 2) => value === null || value === undefined || !Number.isFinite(Number(value))
  ? 'Unavailable'
  : Number(value).toLocaleString('en-IN', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});

export const Compare = () => {
  const { catalog } = useStockCatalog();
  const [selectedSymbols, setSelectedSymbols] = useState(['RELIANCE', 'TCS', 'HDFCBANK']);
  const [selectorInput, setSelectorInput] = useState('');
  const [tradingStock, setTradingStock] = useState(null);
  const [alertStock, setAlertStock] = useState(null);
  const [chartSymbol, setChartSymbol] = useState('RELIANCE');
  const quoteState = useCompareQuotes(selectedSymbols);

  const selectedStocks = useMemo(() => {
    return selectedSymbols
      .map((sym) => catalog.find((item) => item.symbol === sym))
      .filter(Boolean);
  }, [selectedSymbols, catalog]);
  const chartStock = selectedStocks.find((stock) => stock.symbol === chartSymbol) || selectedStocks[0];

  const comparedStocks = useMemo(() => selectedStocks.map((stock) => {
    const quote = quoteState.quotes.get(stock.symbol);
    const hasPrice = Number(quote?.c) > 0;
    const quoteIsDemo = hasPrice && quote?.isDemo === true;
    const price = hasPrice && (quote?.isLive === true || quoteIsDemo) ? Number(quote.c) : null;
    const previousClose = Number(quote?.pc) > 0 ? Number(quote.pc) : null;
    const change = quote?.d !== null && quote?.d !== undefined && Number.isFinite(Number(quote.d)) && hasPrice
      ? Number(quote.d)
      : previousClose && price ? price - previousClose : null;
    const changePercent = quote?.dp !== null && quote?.dp !== undefined && Number.isFinite(Number(quote.dp)) && hasPrice
      ? Number(quote.dp)
      : (previousClose && change !== null ? (change / previousClose) * 100 : null);
    const quoteProvider = quote?.provider || quoteState.provider;
    const quoteDate = toQuoteDate(quote?.timestamp || quote?.updatedAt, quoteState.lastUpdated);
    const quoteIsVerified = price !== null && quote?.isLive === true;
    const quoteIsLive = quoteIsVerified && !quoteState.hasError;

    return {
      ...stock,
      price,
      previousClose,
      change,
      changePercent,
      high: quoteIsVerified && Number(quote?.h) > 0 ? Number(quote.h) : null,
      low: quoteIsVerified && Number(quote?.l) > 0 ? Number(quote.l) : null,
      quoteIsLive,
      quoteIsDemo,
      quoteIsStale: quoteIsVerified && quoteState.hasError,
      quoteSource: hasPrice
        ? (quoteIsDemo
          ? 'Simulated demo feed · not real market data'
          : quoteState.hasError
          ? `Last quote · ${formatProviderName(quoteProvider)} · refresh failed`
          : `Live quote · ${formatProviderName(quoteProvider)}`)
        : quoteState.hasError
          ? quoteState.setupMessage || 'The configured market provider could not return quotes.'
          : quoteState.isLoading
            ? 'Checking market provider'
            : quoteState.setupMessage || 'Live quote required',
      quoteUpdatedAt: quoteDate,
      hasVerifiedDayRange: quoteIsVerified && Number(quote?.h) > 0 && Number(quote?.l) > 0,
    };
  }), [selectedStocks, quoteState]);

  useEffect(() => {
    if (!alertStock) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setAlertStock(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [alertStock]);

  useEffect(() => {
    if (selectedSymbols.includes(chartSymbol)) return;
    setChartSymbol(selectedSymbols[0] || '');
  }, [chartSymbol, selectedSymbols]);

  const handleAddStock = (sym) => {
    if (!sym || selectedSymbols.includes(sym) || selectedSymbols.length >= 4) return;
    setSelectedSymbols((prev) => [...prev, sym]);
    setSelectorInput('');
  };

  const handleRemoveStock = (sym) => {
    if (selectedSymbols.length <= 1) return;
    setSelectedSymbols((prev) => prev.filter((s) => s !== sym));
  };

  const availableOptions = useMemo(() => {
    return catalog.filter((item) => !selectedSymbols.includes(item.symbol));
  }, [catalog, selectedSymbols]);

  return (
    <div className="page compare-page">
      <div className="page-title compare-header-title">
        <div>
          <span>Analysis & Research</span>
          <h1>Stock Comparison Matrix</h1>
        </div>
        <div className="compare-header-actions">
          <span className="compare-count-badge">
            <ArrowLeftRight size={15} />
            Comparing {selectedStocks.length}/4 Stocks
          </span>
        </div>
      </div>

      {/* Stock Selection Bar */}
      <section className="panel compare-selector-panel">
        <div className="compare-selector-content">
          <div className="compare-chips">
            {selectedStocks.map((stock) => (
              <div key={stock.symbol} className="compare-chip">
                <CompanyLogo symbol={stock.symbol} name={stock.name} size={28} />
                <span className="compare-chip-symbol">{stock.symbol}</span>
                {selectedStocks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveStock(stock.symbol)}
                    className="chip-remove"
                    title={`Remove ${stock.symbol}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          {selectedStocks.length < 4 && (
            <div className="add-compare-box">
              <select
                value={selectorInput}
                onChange={(e) => handleAddStock(e.target.value)}
                className="compare-dropdown"
              >
                <option value="">+ Add stock to compare (e.g. INFY, SBIN, ITC)...</option>
                {availableOptions.slice(0, 50).map((stock) => (
                  <option key={stock.symbol} value={stock.symbol}>
                    {stock.symbol} — {stock.name} ({stock.sector})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      <section className="compare-chart-section" aria-label="Selected stock candlestick chart">
        <div className="panel compare-chart-controls">
          <div>
            <span className="compare-chart-eyebrow">Price action</span>
            <h2>Candlestick chart</h2>
          </div>
          <label htmlFor="compare-chart-symbol">
            Chart stock
            <select id="compare-chart-symbol" value={chartStock?.symbol || ''} onChange={(event) => setChartSymbol(event.target.value)}>
              {selectedStocks.map((stock) => <option key={stock.symbol} value={stock.symbol}>{stock.symbol}</option>)}
            </select>
          </label>
        </div>
        {chartStock ? <LiveChart key={chartStock.symbol} symbol={chartStock.symbol} stock={chartStock} /> : null}
      </section>

      {/* Comparison Grid Table */}
      <section className="panel compare-table-container">
        <div className="compare-table-wrapper">
          <table className="compare-table">
            <thead>
              <tr>
                <th className="feature-col">Parameters</th>
                {comparedStocks.map((stock) => (
                  <th key={stock.symbol} className="stock-col">
                    <div className="compare-th-card">
                      <CompanyLogo symbol={stock.symbol} name={stock.name} size={42} />
                      <div className="th-details">
                        <span className="th-symbol">{stock.symbol}</span>
                        <span className="th-name">{stock.name}</span>
                        <span className="th-sector">{stock.sector}</span>
                      </div>
                      <div className={`compare-quote-meta ${stock.quoteIsLive ? 'is-live' : stock.quoteIsStale ? 'is-stale' : 'is-demo'}`}>
                        <span className="compare-quote-source">{stock.quoteSource}</span>
                        <span className="compare-quote-updated">Updated {formatQuoteTime(stock.quoteUpdatedAt)}</span>
                      </div>
                      <div className="th-actions">
                        <button
                          type="button"
                          className="trade-th-btn"
                          onClick={() => setTradingStock(stock)}
                          disabled={!stock.quoteIsLive}
                          title={stock.quoteIsLive ? 'Trade using the current live quote' : 'A current live quote is required'}
                        >
                          Trade Now
                        </button>
                        <button
                          type="button"
                          className="alert-th-btn"
                          onClick={() => setAlertStock(stock)}
                          disabled={!stock.quoteIsLive}
                          aria-label={`Create a price alert for ${stock.symbol}`}
                          title={`Create a price alert for ${stock.symbol}`}
                        >
                          <BellPlus size={14} />
                          Alert
                        </button>
                        {selectedStocks.length > 1 && (
                          <button
                            type="button"
                            className="remove-th-btn"
                            onClick={() => handleRemoveStock(stock.symbol)}
                            title="Remove"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Current Price */}
              <tr className="highlight-row">
                <td className="param-label">
                  <strong>Current Quote</strong>
                  <span>Provider status and update time shown above</span>
                </td>
                {comparedStocks.map((stock) => (
                  <td key={stock.symbol} className="param-value price-cell">
                    <span className="cell-current-price">
                      {stock.quoteIsLive || stock.quoteIsDemo ? `₹${formatRupees(stock.price)}` : 'Quote unavailable'}
                    </span>
                    {(stock.quoteIsLive || stock.quoteIsDemo) && stock.change !== null && stock.changePercent !== null ? (
                      <span className={`cell-change ${stock.change >= 0 ? 'gain' : 'loss'}`}>
                        {stock.change >= 0 ? '+' : ''}{Number(stock.change).toFixed(2)} ({stock.change >= 0 ? '+' : ''}{Number(stock.changePercent).toFixed(2)}%)
                      </span>
                    ) : <span className="cell-change">Live change unavailable</span>}
                  </td>
                ))}
              </tr>

              {/* Day's Range */}
              <tr>
                <td className="param-label">
                  <strong>Day Range (High / Low)</strong>
                  <span>Verified only when supplied by the quote provider</span>
                </td>
                {comparedStocks.map((stock) => (
                  <td key={stock.symbol} className="param-value">
                    {stock.hasVerifiedDayRange ? (
                      <div className="range-display">
                        <span>L: ₹{formatRupees(stock.low)}</span>
                        <span>H: ₹{formatRupees(stock.high)}</span>
                      </div>
                    ) : (
                      <div className="compare-metric-stack">
                        <strong>Unavailable</strong>
                        <span className="metric-provenance">No verified range in latest quote</span>
                      </div>
                    )}
                  </td>
                ))}
              </tr>

              {/* Market Cap */}
              <tr>
                <td className="param-label">
                  <strong>Market Capitalization</strong>
                  <span>Estimated Total Equity Value</span>
                </td>
                {comparedStocks.map((stock) => {
                  const mcap = stock.marketCap;
                  return (
                    <td key={stock.symbol} className="param-value">
                      <div className="compare-metric-stack">
                        <strong>{mcap || 'Unavailable'}</strong>
                        {mcap ? <span className="metric-provenance">Demo estimate</span> : null}
                      </div>
                    </td>
                  );
                })}
              </tr>

              {/* P/E Ratio */}
              <tr>
                <td className="param-label">
                  <strong>Price-to-Earnings (P/E)</strong>
                  <span>Valuation multiple</span>
                </td>
                {comparedStocks.map((stock) => {
                  const pe = Number(stock.pe);
                  const hasPe = stock.pe !== null && stock.pe !== undefined && stock.pe !== '' && Number.isFinite(pe);
                  return (
                    <td key={stock.symbol} className="param-value">
                      <div className="compare-metric-stack">
                        <span className="badge-pe">{hasPe ? `${pe.toFixed(1)}x` : 'Unavailable'}</span>
                        {hasPe ? <span className="metric-provenance">Demo estimate</span> : null}
                      </div>
                    </td>
                  );
                })}
              </tr>

              {/* Dividend Yield */}
              <tr>
                <td className="param-label">
                  <strong>Dividend Yield</strong>
                  <span>Annual cash payout %</span>
                </td>
                {comparedStocks.map((stock) => {
                  const dividendYield = Number(stock.dividendYield);
                  const hasDividendYield = stock.dividendYield !== null
                    && stock.dividendYield !== undefined
                    && stock.dividendYield !== ''
                    && Number.isFinite(dividendYield);
                  return (
                    <td key={stock.symbol} className="param-value">
                      <div className="compare-metric-stack">
                        <strong>{hasDividendYield ? `${dividendYield.toFixed(2)}%` : 'Unavailable'}</strong>
                        {hasDividendYield ? <span className="metric-provenance">Demo estimate</span> : null}
                      </div>
                    </td>
                  );
                })}
              </tr>

              {/* 52-Week High / Low */}
              <tr>
                <td className="param-label">
                  <strong>52-Week Range</strong>
                  <span>1-Year extremities</span>
                </td>
                {comparedStocks.map((stock) => (
                  <td key={stock.symbol} className="param-value">
                    <div className="compare-metric-stack">
                      <strong>Unavailable</strong>
                      <span className="metric-provenance">The selected live quote does not include 52-week range data</span>
                    </div>
                  </td>
                ))}
              </tr>

              {/* Technical Signal */}
              <tr>
                <td className="param-label">
                  <strong>Technical Trend & Signal</strong>
                  <span>Needs verified historical prices</span>
                </td>
                {comparedStocks.map((stock) => (
                  <td key={stock.symbol} className="param-value">
                    <div className="compare-metric-stack">
                      <strong className="metric-unavailable">Unavailable</strong>
                      <span className="metric-provenance">No verified RSI data</span>
                    </div>
                  </td>
                ))}
              </tr>

              {/* Sector */}
              <tr>
                <td className="param-label">
                  <strong>Industry Sector</strong>
                  <span>Primary business segment</span>
                </td>
                {selectedStocks.map((stock) => (
                  <td key={stock.symbol} className="param-value">
                    <span className="sector-tag">{stock.sector || 'Diversified'}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Comparison Insights */}
      <section className="panel compare-summary-card">
        <div className="compare-insights-header">
          <Info size={18} />
          <h3>Data notes</h3>
        </div>
        <p>
          Comparing <strong>{selectedStocks.map((s) => s.symbol).join(', ')}</strong>. Quotes show their provider and update time above.
          Market capitalization, P/E, and dividend yield are estimates. Live comparison prices require a configured market provider. Charts use illustrative previews when provider history is unavailable.
        </p>
      </section>

      {/* Trade Modal Popup */}
      {tradingStock && (
        <QuickTradeModal
          stock={tradingStock}
          initialSide="Buy"
          onClose={() => setTradingStock(null)}
        />
      )}

      {alertStock && (
        <div className="compare-alert-backdrop" onMouseDown={() => setAlertStock(null)} role="presentation">
          <section
            className="compare-alert-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Set price alert for ${alertStock.symbol}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="compare-alert-context">
              <div>
                <strong>{alertStock.symbol} · ₹{formatRupees(alertStock.price)}</strong>
                <span>{alertStock.quoteSource} · Received {formatQuoteTime(alertStock.quoteUpdatedAt)}</span>
              </div>
              <button type="button" onClick={() => setAlertStock(null)} aria-label="Close price alert dialog">
                <X size={19} />
              </button>
            </div>
            <PriceAlertForm
              key={alertStock.symbol}
              stock={alertStock}
              evaluateCurrentPrice={alertStock.quoteIsLive}
            />
          </section>
        </div>
      )}
    </div>
  );
};

export default Compare;
