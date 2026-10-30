import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List } from 'react-window';
import StockCard from '../components/StockCard';
import { useStockCatalog } from '../hooks/useStockCatalog';
import { marketApi } from '../services/api';

const QUOTE_REFRESH_MS = 1000;
const RESEARCH_REFRESH_MS = 60_000;

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const StockRow = ({ ariaAttributes, index, liveStocks, quotes, style }) => {
  const stock = liveStocks[index];
  if (!stock) return null;

  const quote = quotes.get(stock.symbol.toUpperCase());
  const currentPrice = toFiniteNumber(quote?.c);
  const hasQuote = currentPrice > 0;
  const displayedStock = hasQuote ? {
    ...stock,
    price: currentPrice,
    previousClose: toFiniteNumber(quote.pc) ?? stock.previousClose,
    change: toFiniteNumber(quote.d),
    changePercent: toFiniteNumber(quote.dp),
    high: toFiniteNumber(quote.h) ?? stock.high,
    low: toFiniteNumber(quote.l) ?? stock.low,
    volume: toFiniteNumber(quote.v) ?? stock.volume,
    isLive: quote.isLive === true && quote.isStale !== true,
    isResearch: quote.isResearch === true,
    isDemo: false,
    isStale: quote.isStale === true,
    dataSource: quote.provider || 'market provider',
    timestamp: quote.timestamp,
    quoteUpdatedAt: quote.timestamp,
  } : stock;

  return (
    <div {...ariaAttributes} style={style}>
      <StockCard stock={displayedStock} />
    </div>
  );
};

const AllStocks = () => {
  const { catalog } = useStockCatalog();
  const [visibleRange, setVisibleRange] = useState({ startIndex: 0, stopIndex: 7 });
  const [quotes, setQuotes] = useState(() => new Map());
  const [providerState, setProviderState] = useState('checking');
  const [setupMessage, setSetupMessage] = useState('');
  const [quoteRequestFailed, setQuoteRequestFailed] = useState(false);

  const ITEM_HEIGHT = 100;
  const LIST_HEIGHT = Math.min(800, ITEM_HEIGHT * catalog.length);
  const visibleStocks = useMemo(
    () => catalog.slice(visibleRange.startIndex, visibleRange.stopIndex + 1),
    [catalog, visibleRange],
  );
  const visibleStocksRef = useRef(visibleStocks);
  visibleStocksRef.current = visibleStocks;

  const handleRowsRendered = useCallback(({ startIndex, stopIndex }) => {
    setVisibleRange((current) => (
      current.startIndex === startIndex && current.stopIndex === stopIndex
        ? current
        : { startIndex, stopIndex }
    ));
  }, []);

  useEffect(() => {
    let active = true;
    marketApi.getHealth()
      .then((health) => {
        if (!active) return;
        const researchNote = health.researchDataAvailable
          ? ' Yahoo Finance research quotes may be delayed and are not live.'
          : '';
        setSetupMessage(`${health.setupRequired || 'Configure a live market provider to load current prices.'}${researchNote}`);
        setProviderState(health.realTimeAvailable ? 'ready' : health.researchDataAvailable ? 'research' : 'unavailable');
      })
      .catch(() => {
        if (active) {
          setSetupMessage('The market API is unavailable. Start the app with npm run dev.');
          setProviderState('unavailable');
        }
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    const visibleSymbols = new Set(visibleStocks.map((stock) => stock.symbol.toUpperCase()));
    setQuotes((previous) => {
      let changed = false;
      const next = new Map(previous);
      for (const [symbol, quote] of next) {
        if (!visibleSymbols.has(symbol) && quote.isLive) {
          next.set(symbol, { ...quote, isLive: false, isStale: true });
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [visibleStocks]);

  useEffect(() => {
    if (!['ready', 'research'].includes(providerState)) return undefined;

    let active = true;
    let requestPending = false;
    const refreshVisibleQuotes = async () => {
      const requestedStocks = visibleStocksRef.current;
      if (requestPending || !requestedStocks.length) return;
      requestPending = true;
      try {
        const payload = await marketApi.getBatchQuotes(requestedStocks.map((stock) => (
          stock.exchange === 'BSE' ? `BSE:${stock.symbol}` : stock.symbol
        )));
        if (!active) return;
        const liveQuotes = new Map(
          Object.entries(payload?.quotes || {})
            .map(([symbol, quote]) => [String(quote?.symbol || symbol).replace(/^(NSE|BSE):/i, '').toUpperCase(), quote])
            .filter(([, quote]) => (
              quote?.isLive === true || quote?.isResearch === true
            ) && Number(quote.c) > 0),
        );
        const currentlyVisible = new Set(visibleStocksRef.current.map((stock) => stock.symbol.toUpperCase()));
        setQuotes((previous) => {
          const next = new Map(previous);
          for (const stock of requestedStocks) {
            const symbol = stock.symbol.toUpperCase();
            const fresh = liveQuotes.get(symbol);
            if (fresh) {
              next.set(symbol, currentlyVisible.has(symbol)
                ? fresh
                : { ...fresh, isLive: false, isStale: true });
            }
            else if (next.has(symbol)) next.set(symbol, { ...next.get(symbol), isLive: false, isStale: true });
          }
          return next;
        });
        setQuoteRequestFailed(false);
      } catch {
        if (!active) return;
        setQuotes((previous) => {
          const next = new Map(previous);
          for (const stock of requestedStocks) {
            const symbol = stock.symbol.toUpperCase();
            if (next.has(symbol)) next.set(symbol, { ...next.get(symbol), isLive: false, isStale: true });
          }
          return next;
        });
        setQuoteRequestFailed(true);
      } finally {
        requestPending = false;
      }
    };

    refreshVisibleQuotes();
    const intervalId = window.setInterval(refreshVisibleQuotes, providerState === 'ready' ? QUOTE_REFRESH_MS : RESEARCH_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [providerState]);

  const visibleQuoteCount = visibleStocks.filter((stock) => {
    const quote = quotes.get(stock.symbol.toUpperCase());
    return quote?.isLive === true || quote?.isResearch === true;
  }).length;

  return (
    <div className="page all-stocks-page">
      <div className="page-title">
        <span>All Shares</span>
        <h1>Listed companies</h1>
        <p>
          {providerState === 'ready'
            ? `${visibleQuoteCount} of ${visibleStocks.length} visible shares have current provider quotes. Scroll to load more.`
            : providerState === 'research'
              ? `${visibleQuoteCount} of ${visibleStocks.length} visible shares have Yahoo Finance research quotes. They are not live. Scroll to load more.`
            : providerState === 'checking'
              ? 'Checking the live market provider…'
              : setupMessage}
          {quoteRequestFailed ? ' The latest quote request failed; prices are unavailable or stale.' : ''}
        </p>
      </div>
      <List
        defaultHeight={LIST_HEIGHT}
        rowComponent={StockRow}
        rowCount={catalog.length}
        rowHeight={ITEM_HEIGHT}
        rowProps={{ liveStocks: catalog, quotes }}
        onRowsRendered={handleRowsRendered}
        overscanCount={3}
        style={{ height: LIST_HEIGHT, width: '100%' }}
      />
    </div>
  );
};

export default AllStocks;
