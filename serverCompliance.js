import { listAdapters, liveTradingMasterEnabled } from './serverBrokers/index.js';
import { isKunDataConfigured } from './kunDataProvider.js';
import { getYahooResearchProviderName, isYahooResearchEnabled } from './yfinanceResearchProvider.js';

const configuredMarketProvider = () => (process.env.MARKET_DATA_PROVIDER || 'kun').toLowerCase();

const marketProviderConfigured = () => {
  const provider = configuredMarketProvider();
  if (provider === 'kun') return isKunDataConfigured();
  if (provider === 'upstox') return Boolean(process.env.UPSTOX_ACCESS_TOKEN);
  if (provider === 'zerodha') return Boolean(process.env.ZERODHA_API_KEY && process.env.ZERODHA_ACCESS_TOKEN);
  if (provider === 'alpha_vantage') return Boolean(process.env.ALPHA_VANTAGE_API_KEY);
  if (provider === 'groww') return Boolean(process.env.GROWW_ACCESS_TOKEN);
  return false;
};

export const complianceStatus = () => {
  const brokers = listAdapters().map((adapter) => {
    const config = adapter.config();
    const capabilities = adapter.capabilities();
    return {
      id: adapter.id,
      name: adapter.name,
      configured: config.configured,
      missing: config.missing || [],
      mode: config.mode,
      orderPlacement: capabilities.orderPlacement,
      restQuotes: capabilities.quotes,
      streamingFeed: capabilities.marketDataFeed.supported,
      streamingReason: capabilities.marketDataFeed.reason,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    liveTrading: {
      enabled: liveTradingMasterEnabled(),
      requirement: 'Live routing needs LIVE_TRADING_ENABLED=1 on the server, per-account consent, live:true on the request, an open NSE session, and a passing Risk Shield decision.',
      ordersRouted: false,
    },
    brokers,
    dataSources: [
      {
        id: 'nse_live',
        label: 'NSE real-time quotes',
        status: marketProviderConfigured() ? 'configured' : 'not_connected',
        detail: marketProviderConfigured()
          ? `Provider ${configuredMarketProvider()} is configured. Live flag stays off until its stream is verified.`
          : `No real-time provider token is configured (selected: ${configuredMarketProvider()}).`,
        licensing: 'Real-time NSE/BSE redistribution requires an exchange market-data licence held by the provider and the distributor.',
      },
      {
        id: 'nse_index_feed',
        label: 'NSE index feed',
        status: 'available',
        detail: 'NIFTY 50, NIFTY BANK, NIFTY IT and NIFTY MIDCAP 150 come from the NSE India allIndices snapshot. A value is marked live only while the session is open and the feed timestamp is under two minutes old; otherwise it is labelled delayed or exchange close.',
        licensing: 'NSE website data is used for reference in this personal dashboard. Redistribution or commercial use requires an NSE market-data licence; configure KUN or Upstox for a licensed live feed.',
      },
      {
        id: 'bse_index_feed',
        label: 'BSE SENSEX',
        status: 'not_connected',
        detail: 'No licensed BSE index feed is configured, so SENSEX is shown as a delayed Yahoo research quote. Configure a KUN or Upstox token with BSE index permission to stream live SENSEX.',
        licensing: 'BSE index display or redistribution requires a BSE market-data licence.',
      },
      {
        id: 'yahoo_research',
        label: 'Research quotes & history',
        status: isYahooResearchEnabled() ? 'available' : 'not_available',
        detail: isYahooResearchEnabled()
          ? `${getYahooResearchProviderName()} is used for delayed research quotes and historical candles.`
          : 'The Yahoo research provider is not reachable in this deployment.',
        licensing: 'Delayed research quotes are labelled as research, not live, and must not be presented as exchange real-time data.',
      },
      {
        id: 'metals_spot',
        label: 'Gold & silver spot',
        status: 'available',
        detail: 'goldprice.dev spot with COMEX futures fallback, converted to INR. Upstox metal quotes are used only when a token is configured.',
        licensing: 'Spot and futures sources are third-party public feeds; they are delayed and not exchange tick data.',
      },
      {
        id: 'amfi_nav',
        label: 'Mutual fund NAV',
        status: 'available',
        detail: 'AMFI published NAV files, which are end-of-day values.',
        licensing: 'AMFI data is published for public reference; NAV is not a live tradable price.',
      },
      {
        id: 'nse_calendar',
        label: 'NSE/BSE calendars',
        status: 'available',
        detail: 'Keyless NSE corporate-action, results and board-meeting feeds.',
        licensing: 'Exchange website data is used for reference; commercial redistribution may need a separate agreement.',
      },
      {
        id: 'economic_calendar',
        label: 'Economic calendar',
        status: process.env.FINANCE_CALENDAR_API_KEY || process.env.FMP_API_KEY ? 'configured' : 'not_configured',
        detail: process.env.FINANCE_CALENDAR_API_KEY || process.env.FMP_API_KEY
          ? 'A licensed calendar provider key is configured.'
          : 'Add FINANCE_CALENDAR_API_KEY or FMP_API_KEY on the server to enable the India economic calendar.',
        licensing: 'Calendar events require a licensed provider contract for redistribution.',
      },
      {
        id: 'investing_com',
        label: 'Investing.com',
        status: 'not_integrated',
        detail: 'No official public API is used and nothing is scraped. Only officially permitted widgets or a licensed provider could be integrated.',
        licensing: 'Scraping Investing.com is not permitted; widget use is subject to their terms.',
      },
    ],
    disclosures: [
      {
        id: 'not-a-broker',
        title: 'Not a broker or investment adviser',
        text: 'This platform is a demonstration and paper-trading environment. It is not a SEBI-registered broker, depository participant or investment adviser, and it does not provide personalised advice.',
      },
      {
        id: 'paper-only',
        title: 'Paper trading only by default',
        text: 'Virtual balances, AI trades and performance scores are simulated educational results. They are not real holdings and create no monetary liability.',
      },
      {
        id: 'broker-authorization',
        title: 'Broker authorization is not platform authorization',
        text: 'Connecting a personal broker account authorizes that account only. Operating a public live-trading platform, including algorithmic order flow, can require exchange and SEBI approvals beyond a broker API key.',
      },
      {
        id: 'algo-rules',
        title: 'Algorithmic trading rules',
        text: 'Exchange algo rules require order tagging, audit trails, risk controls and, above the exchange threshold, registration of the algo. Orders placed here are tagged SMP and pass an independent Risk Shield.',
      },
      {
        id: 'market-data',
        title: 'Market-data licensing',
        text: 'Real-time or delayed exchange data may only be displayed or redistributed under a valid market-data licence. Unavailable feeds are labelled instead of simulated.',
      },
      {
        id: 'no-secrets',
        title: 'Credentials stay on the server',
        text: 'Broker OAuth tokens are stored AES-256-GCM encrypted and are never returned to the browser. API secrets are read from server environment variables only.',
      },
    ],
  };
};

export const registerComplianceRoutes = (app) => {
  app.get('/api/compliance/status', (req, res) => {
    res.json(complianceStatus());
  });
};
