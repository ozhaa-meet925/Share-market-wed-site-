import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  ExternalLink,
  GraduationCap,
  Landmark,
  Layers3,
  Lightbulb,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Target,
  TrendingUp,
} from 'lucide-react';
import './Learn.css';

const progressStorageKey = 'sharemarket:academy-progress-v1';

const courseOutlines = [
  {
    id: 'market-foundations',
    category: 'Foundations',
    level: 'Beginner',
    duration: '18 min',
    icon: Landmark,
    accent: 'green',
    title: 'How the Indian stock market works',
    summary: 'Understand exchanges, brokers, orders, trading sessions, clearing and settlement before placing a trade.',
    lessons: [
      {
        title: 'Exchanges, regulators and brokers',
        body: 'NSE and BSE are stock exchanges where eligible securities are traded. SEBI regulates India’s securities markets. A broker registered with the relevant regulator and exchange gives investors access to those markets.',
        points: ['An exchange operates the trading platform and publishes its rules.', 'A broker routes your order; check its registration and fee schedule.', 'A depository participant provides access to your demat account.'],
        note: 'The exchange, broker, depository and regulator have different roles. Knowing who does what helps you verify notices and resolve account issues.',
      },
      {
        title: 'NSE and BSE trading sessions',
        body: 'For the regular NSE equity market, continuous trading runs from 9:15 a.m. to 3:30 p.m. India time on trading days. The exchange also publishes pre-open, closing-session and holiday schedules.',
        points: ['Check the exchange calendar before planning around a market holiday.', 'Pre-open and closing sessions have separate order rules.', 'Equity derivatives have different market closing times from cash equities.'],
        note: 'Trading hours can change by segment or exchange notice. Always confirm the current schedule on the official exchange website.',
      },
      {
        title: 'Orders, clearing and settlement',
        body: 'A market order prioritizes execution, while a limit order specifies the highest buy price or lowest sell price you accept. After a trade, clearing corporations calculate obligations and settlement moves funds and securities.',
        points: ['The normal rolling equity settlement cycle is T+1 working day.', 'An optional T+0 cycle is available for eligible securities and has separate rules.', 'A stop order can execute at a different price if the market moves quickly.'],
        note: 'Settlement timelines exclude exchange holidays. Check the security’s settlement type and the exchange’s latest circulars.',
      },
    ],
    sources: [
      { label: 'NSE market timings', url: 'https://www.nseindia.com/resources/exchange-communication-holidays' },
      { label: 'NSE settlement cycle', url: 'https://www.nseindia.com/static/products-services/equity-market-settlement-cycle' },
      { label: 'SEBI investor resources', url: 'https://investor.sebi.gov.in/' },
    ],
  },
  {
    id: 'indian-indices',
    category: 'Foundations',
    level: 'Beginner',
    duration: '14 min',
    icon: Layers3,
    accent: 'blue',
    title: 'Nifty 50 and Bank Nifty explained',
    summary: 'Learn what an index measures, how weighting affects it, and why a bank index behaves differently from a broad-market index.',
    lessons: [
      {
        title: 'What an index tells you',
        body: 'A market index tracks a defined basket of securities using a published methodology. It gives investors a benchmark, but its movement does not mean every constituent moved in the same direction.',
        points: ['Index providers define eligibility, weighting and review rules.', 'A weighted index gives larger weights to some constituents than others.', 'An index is a benchmark, not a complete picture of every listed company.'],
        note: 'Read the index factsheet and methodology to understand what a benchmark includes and how it is maintained.',
      },
      {
        title: 'Nifty 50: broad large-company exposure',
        body: 'The Nifty 50 represents 50 companies selected under NSE Indices’ methodology and spans important parts of the Indian economy. It is calculated using free-float market capitalisation weighting.',
        points: ['The index is reviewed under published eligibility rules.', 'Free-float weighting focuses on shares available for public trading.', 'Sector and company weights can change after index reviews.'],
        note: 'Compare the live factsheet with the methodology: constituent lists and weights are not permanent.',
      },
      {
        title: 'Bank Nifty: a sector index',
        body: 'Nifty Bank is designed to represent eligible, liquid banking stocks listed on NSE. Its narrower sector focus can make it respond strongly to banking results, interest-rate expectations and credit conditions.',
        points: ['Sector indices are more concentrated than broad-market benchmarks.', 'A few large constituents can materially affect index movement.', 'Index futures and options introduce leverage and additional risk.'],
        note: 'Use the official Nifty Bank factsheet for its current constituents, weights and methodology.',
      },
    ],
    sources: [
      { label: 'Nifty 50 factsheet and methodology', url: 'https://www.niftyindices.com/indices/equity/broad-based-indices/nifty--50' },
      { label: 'Nifty Bank factsheet', url: 'https://www.niftyindices.com/Factsheet/ind_nifty_bank.pdf' },
    ],
  },
  {
    id: 'trading-styles',
    category: 'Trading',
    level: 'Beginner',
    duration: '16 min',
    icon: Compass,
    accent: 'amber',
    title: 'Intraday and swing trading',
    summary: 'Compare common holding periods, build a repeatable trade plan and understand the risks that come with short-term trading.',
    lessons: [
      {
        title: 'Intraday trading',
        body: 'Intraday traders open and close a position during the same trading session. The short holding period does not make a trade safer: fast price moves, spreads, fees and execution can change the result quickly.',
        points: ['Decide your entry, invalidation level and exit before placing an order.', 'Use position sizing that fits a defined loss limit.', 'Avoid increasing size to recover a losing trade.'],
        note: 'Leverage can magnify losses. Learn order types and practise with a simulator before considering real orders.',
      },
      {
        title: 'Swing trading',
        body: 'Swing traders typically hold a position for several sessions or longer while looking for a move over a chosen time horizon. A plan should account for overnight gaps and company or market announcements.',
        points: ['Write down the setup and the evidence that would invalidate it.', 'Size the position based on the distance to the planned exit.', 'Review earnings dates, corporate actions and broader market risk.'],
        note: 'A chart pattern is a hypothesis, not a promise about future prices.',
      },
      {
        title: 'Build a trading routine',
        body: 'A trading routine creates consistency: prepare, define risk, place only planned orders and review decisions afterwards. Track process quality separately from short-term profit or loss.',
        points: ['Keep a journal with setup, entry, exit and reason for the trade.', 'Include brokerage, taxes, slippage and other transaction costs.', 'Set a daily loss limit and stop trading when it is reached.'],
        note: 'Start with paper trading. Simulated fills can differ from real-world execution, but a journal helps identify process mistakes.',
      },
    ],
    sources: [
      { label: 'NSE: Be a smart investor', url: 'https://www.nseindia.com/static/invest/be-a-smart-investor' },
      { label: 'SEBI investor education', url: 'https://investor.sebi.gov.in/' },
    ],
  },
  {
    id: 'technical-analysis',
    category: 'Technical Analysis',
    level: 'Intermediate',
    duration: '20 min',
    icon: BarChart3,
    accent: 'violet',
    title: 'Technical analysis and price action',
    summary: 'Read OHLC candles, trend structure, support and resistance, volume, and indicators without treating them as predictions.',
    lessons: [
      {
        title: 'Read a price chart',
        body: 'A candle summarises open, high, low and close prices for a selected interval. The body and wicks show where price traded, but a candle alone cannot explain why the price moved.',
        points: ['Choose an interval that matches the question you are asking.', 'Compare candles with surrounding price structure and volume.', 'Check whether the chart uses adjusted prices when reviewing older data.'],
        note: 'A single candle pattern is not a reliable stand-alone entry signal.',
      },
      {
        title: 'Trend, support and resistance',
        body: 'Traders use swing highs and lows to describe market structure. Support and resistance are zones where price has previously reacted; they can fail or shift as new information reaches the market.',
        points: ['Define the level before price reaches it to reduce hindsight bias.', 'Plan what would invalidate the idea if price moves through a zone.', 'Use multiple timeframes carefully; they can show conflicting signals.'],
        note: 'Levels are analytical references, not guaranteed floors or ceilings.',
      },
      {
        title: 'Volume and indicators',
        body: 'Volume can provide context about participation. Moving averages, RSI and MACD transform historical price data into indicators; they can lag and may behave differently in trends and ranges.',
        points: ['Use an indicator to answer a specific question, not as a signal by itself.', 'Avoid stacking many indicators that measure similar information.', 'Test rules on historical data and then review them in paper trading.'],
        note: 'Backtests can be affected by look-ahead bias, overfitting and transaction costs.',
      },
    ],
    sources: [
      { label: 'NSE interactive learning', url: 'https://www.nseindia.com/static/learn/interactive-courses' },
      { label: 'NSE: Be a smart investor', url: 'https://www.nseindia.com/static/invest/be-a-smart-investor' },
    ],
  },
  {
    id: 'fundamental-analysis',
    category: 'Fundamental Analysis',
    level: 'Intermediate',
    duration: '22 min',
    icon: TrendingUp,
    accent: 'teal',
    title: 'Fundamental analysis for investors',
    summary: 'Study a company’s business, financial statements, balance sheet, cash generation, valuation and key risks.',
    lessons: [
      {
        title: 'Understand the business',
        body: 'Start with what the company sells, who its customers are, how it earns revenue and what could weaken its position. Read company filings and compare claims with reported results.',
        points: ['Identify the main products, customers and revenue drivers.', 'Look for concentration, regulatory, operational and competitive risks.', 'Compare management commentary with audited disclosures.'],
        note: 'A strong company can still be a poor investment if the price already assumes very high growth.',
      },
      {
        title: 'Read the financial statements',
        body: 'The income statement reports performance over a period, the balance sheet shows assets and obligations at a point in time, and the cash-flow statement tracks cash generated and used.',
        points: ['Review revenue, operating margins and profit across several periods.', 'Check debt, interest costs, working capital and cash conversion.', 'Read auditor remarks, related-party disclosures and contingent liabilities.'],
        note: 'Use consolidated statements when the company has material subsidiaries, while checking what is included.',
      },
      {
        title: 'Valuation and comparison',
        body: 'Ratios such as P/E, price-to-book and EV/EBITDA can help compare businesses, but each ratio has limits. Compare companies with similar economics and account for growth, debt and cyclicality.',
        points: ['Compare valuation with peers and the company’s own history.', 'Consider earnings quality, cash generation and dilution.', 'Write down the assumptions that would make the valuation reasonable.'],
        note: 'Valuation estimates depend on assumptions and are not a prediction of the market price.',
      },
    ],
    sources: [
      { label: 'SEBI investor education', url: 'https://investor.sebi.gov.in/' },
      { label: 'NSE company disclosures', url: 'https://www.nseindia.com/companies-listing/corporate-filings-announcements' },
    ],
  },
  {
    id: 'options-basics',
    category: 'Options',
    level: 'Advanced',
    duration: '24 min',
    icon: Activity,
    accent: 'rose',
    title: 'Options trading: contracts, payoff and risk',
    summary: 'Learn calls, puts, premiums, expiry, volatility and why options require careful risk controls and product knowledge.',
    lessons: [
      {
        title: 'Calls, puts and contract terms',
        body: 'An option is a contract with defined terms such as underlying, strike, expiry and lot size. A call gives its buyer a right under the contract terms; a put gives its buyer a different right. Check the exchange contract specifications.',
        points: ['Know the underlying and expiry before evaluating an option.', 'The premium reflects several inputs, including price, time and implied volatility.', 'Contract specifications and expiry schedules can change by exchange notice.'],
        note: 'Options are derivatives. Their price can move sharply even when the underlying price moves only modestly.',
      },
      {
        title: 'Premium, time and volatility',
        body: 'An option premium has intrinsic and time value. Time value generally declines as expiry approaches, while changes in implied volatility can raise or lower the premium independently of the underlying move.',
        points: ['A correct directional view may still lose money if timing or pricing is poor.', 'Consider spread, liquidity and transaction costs in any payoff calculation.', 'Understand assignment, exercise and settlement rules for the contract.'],
        note: 'Payoff diagrams show expiry outcomes; they do not guarantee the option can be exited at a displayed price before expiry.',
      },
      {
        title: 'Risk before strategy',
        body: 'An option buyer can lose the premium paid and costs. An option writer may face substantial losses and margin requirements; an uncovered call can have theoretically unlimited loss. Strategies with multiple legs still carry risk.',
        points: ['Calculate the maximum loss and break-even before entering a position.', 'Never use borrowed money or essential savings to trade derivatives.', 'Understand margin, liquidity and gap risk before considering a strategy.'],
        note: 'SEBI reported that 93% of individual traders incurred losses in equity F&O between FY22 and FY24. Learn the product and risk before considering derivatives.',
      },
    ],
    sources: [
      { label: 'SEBI study: individual equity F&O outcomes', url: 'https://www.sebi.gov.in/media-and-notifications/press-releases/sep-2024/updated-sebi-study-reveals-93-of-individual-traders-incurred-losses-in-equity-fando-between-fy22-and-fy24-aggregate-losses-exceed-1-8-lakh-crores-over-three-years_86906.html' },
      { label: 'NSE equity derivatives', url: 'https://www.nseindia.com/static/products-services/about-equity-derivatives' },
      { label: 'NSE: Be a smart investor', url: 'https://www.nseindia.com/static/invest/be-a-smart-investor' },
    ],
  },
];

const lessonDetails = {
  'market-foundations': [
    {
      explanation: [
        'A stock exchange is an organised marketplace with rules, surveillance and an electronic order book. Buyers and sellers place orders through brokers, and the exchange matches compatible orders. NSE and BSE operate separate markets; a listed company can trade on one or both, so liquidity and the quoted price can differ between them.',
        'SEBI regulates India’s securities market and registered intermediaries. Your broker accepts and routes your instruction, while a depository participant (DP) gives access to your demat account. NSDL and CDSL maintain securities in electronic form. These roles are separate, so check contract notes and account statements from the relevant provider.',
      ],
      example: 'When you place a limit buy order on NSE, your broker sends it to NSE’s order book. It executes only if a matching seller is available at your limit price or better.',
    },
    {
      explanation: [
        'The regular NSE cash-equity session is listed as 9:15 a.m. to 3:30 p.m. India time on trading days. A pre-open session helps establish opening prices, and other sessions have their own rules. Weekends and exchange holidays are not normal trading days.',
        'Equity derivatives have different hours from the cash market. Exchange notices can also change schedules for special sessions or operational reasons. For planning, use the exchange calendar and the page for the specific segment instead of assuming every market closes at the same time.',
      ],
      example: 'A cash-equity share and a futures contract can have different closing times. Always check the segment before placing an order near the close.',
    },
    {
      explanation: [
        'A market order asks for execution at the best prices currently available; in a fast or thin market, the final price can differ from the quote you saw. A limit order sets the worst price you accept, but it may remain unfilled. A stop order becomes active after its trigger condition is reached, and a gap can cause execution away from the trigger.',
        'After a trade, the clearing corporation calculates each member’s obligations and coordinates the transfer of funds and securities. T+1 means settlement on the next working day after trade date; an optional T+0 cycle exists for eligible securities under separate rules. Holidays affect the working-day count.',
      ],
      example: 'If a share trades near ₹100, a limit buy at ₹98 will wait unless sellers offer ₹98 or less. It protects the price limit, but it does not guarantee a purchase.',
    },
  ],
  'indian-indices': [
    {
      explanation: [
        'An index is a rule-based calculation over a selected basket of securities. The provider defines which securities qualify, how much each one counts, and when the basket is reviewed. Index values let people compare a segment of the market over time without treating one company as the whole market.',
        'Most indices are weighted, so a constituent with a larger weight can move the index more than a smaller constituent for the same percentage price move. An index is not a promise that every share in the basket rose or fell together, and it does not represent every listed company.',
      ],
      example: 'In a hypothetical index where Company A has a 60% weight and Company B has a 10% weight, a 1% move in A has a larger index effect than a 1% move in B, all else equal.',
    },
    {
      explanation: [
        'Nifty 50 tracks 50 selected companies under NSE Indices’ published eligibility and review process. It is calculated using free-float market capitalisation weighting: shares considered available for public trading contribute to the weight, while strategic or locked-in holdings are generally excluded under the methodology.',
        'The index is used as a broad large-company benchmark, but it is still concentrated in its constituents and their sectors. Constituents and weights can change after reviews, so an old list is not a reliable guide to the current index. The factsheet and methodology explain the current composition.',
      ],
      example: 'If a larger-weight constituent rises 2% while a smaller-weight constituent falls 2%, their index effects do not necessarily cancel. The weights determine each contribution.',
    },
    {
      explanation: [
        'Nifty Bank, often called Bank Nifty, is a sector index of eligible banking stocks listed on NSE. Because it focuses on banks, it can respond to bank earnings, deposit growth, credit quality, interest-rate expectations and policy changes more directly than a broad-market index.',
        'Its narrower focus also means sector-specific news and larger constituents can have a stronger effect. A Bank Nifty move is not a forecast for every bank share. Use the official factsheet for current constituents and weights, and remember that index futures and options add leverage and contract risk.',
      ],
      example: 'If technology shares lift the broad market while bank shares weaken after results, Nifty 50 and Nifty Bank can move in different directions on the same day.',
    },
  ],
  'trading-styles': [
    {
      explanation: [
        'Intraday trading means opening and closing a position within the same session. Traders may use short time intervals, but a shorter holding period does not remove risk: spreads, rapid price changes, low liquidity, order slippage, brokerage and taxes all affect the result.',
        'Before entering, write down the setup, the price or condition that would invalidate it, the planned exit and the maximum loss you can accept. Decide quantity from that loss limit. Leverage can magnify both gains and losses, and a stop instruction cannot guarantee a particular fill price during a gap or sudden move.',
      ],
      example: 'For practice only: if a hypothetical entry is ₹250 and the planned exit is ₹245, the planned price risk is ₹5 per share. A 20-share position represents ₹100 of planned price risk before costs and slippage.',
    },
    {
      explanation: [
        'Swing trading generally holds a position across multiple sessions while a trader studies a move over days or weeks. Analysis often uses daily or weekly charts, but the holding period can expose the position to overnight and weekend gaps when the market is closed.',
        'A written plan should specify the thesis, entry conditions, what would invalidate it, position size and review date. Check scheduled results, corporate actions and major market events. If price gaps through an exit level, the actual execution can be worse than the planned level.',
      ],
      example: 'Suppose a hypothetical chart has repeatedly reacted near ₹110 and ₹120. Those are observed zones, not guaranteed support or resistance; a new announcement can push price through either area.',
    },
    {
      explanation: [
        'A trading routine separates preparation, execution and review. Before the session, note relevant events and candidate setups. During the session, take only actions that match your written plan. Afterwards, record what happened and whether you followed your process.',
        'Position size is connected to the distance between entry and the planned exit, not just to the amount of cash available. A journal should include costs and execution differences. A daily stop rule can prevent an emotional loss-recovery cycle, but no single risk percentage is suitable for everyone.',
      ],
      example: 'For a hypothetical plan with a ₹500 maximum loss and ₹10 of price risk per share, the arithmetic gives 50 shares before brokerage, taxes, slippage or gaps. This illustrates sizing only; it is not a recommended risk limit.',
    },
  ],
  'technical-analysis': [
    {
      explanation: [
        'OHLC means open, high, low and close for a chosen chart interval. A candle body shows the distance between open and close; the upper and lower wicks show the extremes reached during that interval. Green or red colouring usually compares close with open, but chart settings can vary.',
        'A candle records price activity, not the cause of the move. The same shape can appear in different market conditions and have different outcomes. Read it with the larger trend, nearby levels, volume, time interval and known events rather than treating one pattern as a prediction.',
      ],
      example: 'A hypothetical 10-minute candle opens at ₹100, trades between ₹97 and ₹108, and closes at ₹105. It closed above its open, but the candle alone cannot tell you what the next interval will do.',
    },
    {
      explanation: [
        'Market structure describes the sequence of swing highs and lows. Traders may call a sequence of higher highs and higher lows an uptrend, and lower highs and lower lows a downtrend. These descriptions depend on the selected time frame and can change as new prices form.',
        'Support and resistance are better treated as zones based on past reactions than as exact lines. A zone can fail when buyers or sellers are overwhelmed, and a breakout can reverse. Decide in advance what evidence would invalidate an interpretation to reduce hindsight bias.',
      ],
      example: 'If price has reacted around ₹120 several times, a trader may mark a ₹119–₹121 area for observation. That area is a reference from prior data, not a floor that must hold.',
    },
    {
      explanation: [
        'Volume records how much of a security traded during an interval, subject to the data source and market segment. It can add context to a price move, but it does not identify every buyer’s or seller’s intention. Compare it with the security’s own typical activity and the event calendar.',
        'Moving averages smooth past prices; RSI compares recent gains and losses; MACD compares moving averages. These indicators describe historical data and can lag. A backtest can also look better than real execution because of overfitting, missing costs, survivorship bias or data errors.',
      ],
      example: 'A share reaching a new high on lower volume is an observation worth investigating, not an automatic sell or buy signal. Check the broader setup and define a testable rule.',
    },
  ],
  'fundamental-analysis': [
    {
      explanation: [
        'Begin with the company’s products, customers, suppliers and revenue sources. Ask what creates demand, how the company competes, and what could disrupt its business. Then compare management explanations with annual reports, exchange filings and audited financial statements.',
        'Business quality is not the same as investment value. A company may be well-run while its share price already reflects optimistic expectations. Consider industry cycles, regulation, customer concentration, governance and how much capital the business needs to grow.',
      ],
      example: 'If one customer contributes a large share of sales, losing that customer could affect results materially. The concentration is a risk to investigate, not proof that the business will fail.',
    },
    {
      explanation: [
        'The income statement summarises revenue and expenses over a period. The balance sheet shows assets, liabilities and equity at a date. The cash-flow statement explains cash from operations, investment and financing. Read them together because reported profit and cash received can differ.',
        'Look across multiple periods for margins, debt, interest costs, receivables, inventory and cash conversion. Notes, auditor comments, related-party transactions and contingent liabilities may explain risks hidden by headline totals. Consolidated statements include subsidiaries under accounting rules; check what the company has consolidated.',
      ],
      example: 'A hypothetical company reports rising profit while operating cash flow stays negative because customers have not paid invoices. That difference calls for more research into receivables and collection quality.',
    },
    {
      explanation: [
        'P/E divides the share price by earnings per share. Price-to-book compares price with accounting book value, while EV/EBITDA compares enterprise value with operating earnings before certain costs. Each ratio answers a different question and is less useful when earnings or accounting values are unstable.',
        'Compare companies with similar business models, growth, leverage and cyclicality. A lower ratio does not automatically mean cheap, and a higher ratio does not automatically mean expensive. Write down assumptions about future growth and risk, then consider how the conclusion changes if those assumptions are wrong.',
      ],
      example: 'If a hypothetical share trades at ₹200 and earns ₹10 per share over the measured period, its P/E is 20. That number alone does not say whether the share is fairly valued.',
    },
  ],
  'options-basics': [
    {
      explanation: [
        'An option is a derivative contract whose value depends on an underlying asset or index. A call buyer pays for a right to buy under the contract terms; a put buyer pays for a right to sell. The strike is the contract price, expiry is its end date, and lot size sets the contract quantity. Exchange specifications define how contracts work.',
        'The option buyer pays a premium and can lose that premium if the contract expires without value. The seller receives premium but takes on an obligation and may have margin requirements. Contract type, settlement method, expiry schedule and eligibility can differ, so check the current exchange specification.',
      ],
      example: 'A hypothetical call with a ₹100 strike gives its buyer value at expiry only to the extent the underlying is above ₹100; the premium paid must still be recovered before the position has a net profit.',
    },
    {
      explanation: [
        'An option premium is influenced by intrinsic value, time remaining, volatility, interest rates, dividends and other inputs. At-the-money and out-of-the-money options can consist mostly or entirely of time value. Implied volatility reflects the volatility level embedded in the market price; it is not a promise about future movement.',
        'Time value generally erodes as expiry approaches, all else equal, but price and volatility can change at the same time. A buyer can be directionally right and still lose if the move is too small, too late or accompanied by a drop in implied volatility. Bid–ask spreads and charges also affect realised results.',
      ],
      example: 'A hypothetical at-the-money option costs ₹8 when it has time left. If the underlying barely moves and volatility falls, the option premium could decline even though the underlying stays near the strike.',
    },
    {
      explanation: [
        'Before considering an options position, draw its payoff at expiry and calculate the maximum loss, break-even points and what happens under several price and volatility scenarios. Multi-leg strategies can have more than one risk driver and can be harder to exit when one leg is illiquid.',
        'A long option can lose the entire premium and costs. An uncovered call writer can face theoretically unlimited loss as the underlying rises; other short-option positions can also incur substantial losses and margin calls. SEBI’s FY22–FY24 study found 93% of individual equity F&O traders incurred losses, so product knowledge and caution matter.',
      ],
      example: 'For a hypothetical option bought for ₹8 per unit, the buyer’s expiry loss is capped at ₹8 per unit plus costs if it expires worthless. Contract quantity multiplies the rupee amount.',
    },
  ],
};

const courses = courseOutlines.map((course) => ({
  ...course,
  lessons: course.lessons.map((lesson, index) => ({
    ...lesson,
    ...lessonDetails[course.id][index],
  })),
}));

const categories = ['All topics', 'Foundations', 'Trading', 'Technical Analysis', 'Fundamental Analysis', 'Options'];

const glossaryTerms = [
  ['Equity share', 'A unit of ownership in a company. A shareholder’s rights and risks depend on the share class and applicable rules.'],
  ['Stock exchange', 'A regulated marketplace that operates trading systems and publishes rules for listed securities.'],
  ['Broker', 'A registered intermediary that accepts and routes a client’s orders to an exchange.'],
  ['Demat account', 'An account that holds securities electronically through a depository participant.'],
  ['Index', 'A rule-based measure of a selected group of securities, calculated using a stated method.'],
  ['Free float', 'Shares considered available for public trading under an index methodology; it affects free-float index weights.'],
  ['OHLC', 'Open, high, low and close prices for a chosen chart interval.'],
  ['Support / resistance', 'Areas where price previously reacted; they are observations, not guaranteed floors or ceilings.'],
  ['P/E ratio', 'Share price divided by earnings per share for a stated period; compare it with context and peers.'],
  ['T+1 settlement', 'Settlement on the next working day after trade date, subject to the security’s settlement type and holidays.'],
  ['Strike and expiry', 'The contract price and end date specified for an option. Check the current exchange contract details.'],
  ['Option premium', 'The price paid by an option buyer or received by a seller; it can change with price, time and volatility.'],
];

const quizQuestions = [
  {
    question: 'What does the Nifty 50 represent?',
    options: ['A fixed list of the 50 most expensive shares', 'An index of 50 eligible companies under a published methodology', 'All companies listed on BSE', 'A bank deposit scheme'],
    answer: 1,
    explanation: 'Nifty 50 tracks 50 selected companies using the index provider’s published eligibility and weighting rules.',
  },
  {
    question: 'What is the regular NSE equity trading session?',
    options: ['8:00 a.m. to 2:00 p.m.', '9:15 a.m. to 3:30 p.m.', '9:30 a.m. to 4:00 p.m.', '10:00 a.m. to 5:00 p.m.'],
    answer: 1,
    explanation: 'NSE publishes the regular equity market session as 9:15 a.m. to 3:30 p.m. India time, subject to exchange holidays and notices.',
  },
  {
    question: 'What is one important risk a swing trader must plan for?',
    options: ['Overnight price gaps', 'A chart always moving in a straight line', 'No transaction costs', 'Guaranteed fills at the stop price'],
    answer: 0,
    explanation: 'News outside market hours can create a price gap, so the actual exit may differ from the planned stop level.',
  },
  {
    question: 'Which statement about technical indicators is most accurate?',
    options: ['They guarantee the next price move', 'They use historical data and can lag or fail', 'They remove market risk', 'They replace a trading plan'],
    answer: 1,
    explanation: 'Indicators transform historical data. They can lag and should be treated as analytical tools rather than predictions.',
  },
  {
    question: 'What can an option buyer lose on a purchased option held to expiry?',
    options: ['The whole stock market value', 'The premium paid plus applicable costs', 'Nothing if the underlying is a large company', 'Only the brokerage fee'],
    answer: 1,
    explanation: 'A purchased option can expire worthless, so the buyer can lose the full premium paid and transaction costs.',
  },
];

const videoRecommendations = [
  {
    number: '01',
    kind: 'START HERE',
    level: 'Beginner',
    title: 'SEBI investor education videos',
    description: 'A trusted starting point for market basics, investing safely, and learning from videos by Indian market institutions.',
    label: 'Open SEBI video library',
    url: 'https://investor.sebi.gov.in/inv_aware_edu_videos.html',
  },
  {
    number: '02',
    kind: 'INVESTOR SAFETY',
    level: 'All levels',
    title: 'NSE Investor Awareness playlist',
    description: 'Learn how to spot common scams and protect yourself as an investor. This playlist is about safety, not trading signals.',
    label: 'Watch playlist on YouTube',
    url: 'https://youtube.com/playlist?list=PLtBlDPlcswPU_e0c6mVO2izQ0PPvaHneI',
  },
  {
    number: '03',
    kind: 'GO DEEPER',
    level: 'Beginner to intermediate',
    title: 'NSE recorded learning courses',
    description: 'Explore longer guided courses on capital-market investing, technical analysis, and chart patterns. Check the course page for format and fees.',
    label: 'Browse NSE recorded courses',
    url: 'https://www.nseindia.com/static/learn/recorded-courses',
  },
];

const readCompletedCourses = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(progressStorageKey) || '[]');
    return Array.isArray(stored) ? stored.filter((id) => courses.some((course) => course.id === id)) : [];
  } catch {
    return [];
  }
};

const Learn = () => {
  const [selectedCategory, setSelectedCategory] = useState('All topics');
  const [searchTerm, setSearchTerm] = useState('');
  const [completedCourses, setCompletedCourses] = useState(readCompletedCourses);
  const [activeCourseId, setActiveCourseId] = useState(null);
  const [activeLessonIndex, setActiveLessonIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(progressStorageKey, JSON.stringify(completedCourses));
    } catch {
      // Academy progress remains usable if browser storage is unavailable.
    }
  }, [completedCourses]);

  const filteredCourses = useMemo(() => courses.filter((course) => {
    const matchesCategory = selectedCategory === 'All topics' || course.category === selectedCategory;
    const query = searchTerm.trim().toLowerCase();
    const matchesSearch = !query || [course.title, course.summary, course.category, ...course.lessons.map((lesson) => lesson.title)]
      .some((value) => value.toLowerCase().includes(query));
    return matchesCategory && matchesSearch;
  }), [searchTerm, selectedCategory]);

  const activeCourse = courses.find((course) => course.id === activeCourseId) || null;
  const currentLesson = activeCourse?.lessons[activeLessonIndex] || null;
  const completionPercent = Math.round((completedCourses.length / courses.length) * 100);
  const quizScore = quizQuestions.reduce((score, question, index) => score + (quizAnswers[index] === question.answer ? 1 : 0), 0);

  const openCourse = (courseId) => {
    setActiveCourseId(courseId);
    setActiveLessonIndex(0);
    window.setTimeout(() => document.getElementById('academy-lesson')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  };

  const markCourseComplete = (courseId) => {
    setCompletedCourses((current) => current.includes(courseId) ? current : [...current, courseId]);
  };

  const resetProgress = () => {
    setCompletedCourses([]);
    setQuizAnswers({});
    setQuizSubmitted(false);
  };

  const handleAnswer = (questionIndex, optionIndex) => {
    if (quizSubmitted) return;
    setQuizAnswers((current) => ({ ...current, [questionIndex]: optionIndex }));
  };

  return (
    <div className="page academy-page">
      <header className="academy-hero">
        <div className="academy-hero-copy">
          <span className="academy-eyebrow"><GraduationCap size={16} /> SHAREMARKET ACADEMY</span>
          <h1>Learn the market.<br /><span>Build your process.</span></h1>
          <p>Practical, structured lessons on India’s markets—from NSE and BSE basics to chart reading, company research and derivatives risk.</p>
          <div className="academy-hero-actions">
            <button className="academy-primary-link" type="button" onClick={() => openCourse(activeCourseId || courses[0].id)}>
              <Play size={16} fill="currentColor" /> Start learning
            </button>
            <a className="academy-secondary-link" href="#academy-quiz">Take the knowledge check <ArrowRight size={16} /></a>
          </div>
          <div className="academy-trust-line"><ShieldCheck size={15} /> Learn from clear concepts, official references and risk-first examples.</div>
        </div>

        <aside className="academy-progress-card" aria-label="Your academy progress">
          <div className="academy-progress-card-top"><span>Your learning path</span><span className="academy-progress-icon"><BookOpen size={19} /></span></div>
          <div className="academy-progress-count">{completedCourses.length}<span> / {courses.length} modules</span></div>
          <div className="academy-progress-track" role="progressbar" aria-label="Course progress" aria-valuemin="0" aria-valuemax={courses.length} aria-valuenow={completedCourses.length}>
            <span style={{ width: `${completionPercent}%` }} />
          </div>
          <p>{completionPercent === 0 ? 'Choose a topic to begin. Your progress saves on this device.' : `${completionPercent}% complete · keep going at your pace.`}</p>
          <div className="academy-progress-divider" />
          <div className="academy-progress-next">
            <span className="academy-next-icon"><Target size={17} /></span>
            <div><strong>{completedCourses.length === courses.length ? 'Path complete' : 'Next milestone'}</strong><span>{completedCourses.length === courses.length ? 'Review the official resources below' : 'Finish a module to track your progress'}</span></div>
          </div>
        </aside>
        <div className="academy-hero-decoration academy-hero-decoration-one" />
        <div className="academy-hero-decoration academy-hero-decoration-two" />
      </header>

      <section className="academy-metrics" aria-label="Academy overview">
        <div className="academy-metric"><span className="academy-metric-icon mint"><BookOpen size={18} /></span><div><strong>{courses.length} focused modules</strong><span>Foundations to options</span></div></div>
        <div className="academy-metric"><span className="academy-metric-icon blue"><Clock3 size={18} /></span><div><strong>10–24 minutes</strong><span>Learn in short sessions</span></div></div>
        <div className="academy-metric"><span className="academy-metric-icon gold"><Lightbulb size={18} /></span><div><strong>Interactive learning</strong><span>Lessons, progress and quiz</span></div></div>
        <div className="academy-metric"><span className="academy-metric-icon rose"><ShieldCheck size={18} /></span><div><strong>Risk-first approach</strong><span>Education, not trade calls</span></div></div>
      </section>

      <section className="academy-curriculum" id="academy-curriculum" aria-labelledby="academy-curriculum-title">
        <div className="academy-section-heading">
          <div><span className="academy-section-kicker">THE CURRICULUM</span><h2 id="academy-curriculum-title">Build your market knowledge</h2><p>Choose a module, work through the lessons and mark it complete when you’re ready.</p></div>
          {completedCourses.length > 0 && <button className="academy-reset-progress" type="button" onClick={resetProgress}><RotateCcw size={14} /> Reset progress</button>}
        </div>

        <div className="academy-course-controls">
          <div className="academy-category-list" role="group" aria-label="Filter by topic">
            {categories.map((category) => (
              <button key={category} type="button" className={`academy-category-button${selectedCategory === category ? ' active' : ''}`} onClick={() => setSelectedCategory(category)} aria-pressed={selectedCategory === category}>
                {category}
              </button>
            ))}
          </div>
          <label className="academy-search"><Search size={17} /><span className="sr-only">Search academy topics</span><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search topics" /></label>
        </div>

        {filteredCourses.length ? (
          <div className="academy-course-grid">
            {filteredCourses.map((course, index) => {
              const Icon = course.icon;
              const isComplete = completedCourses.includes(course.id);
              const isActive = activeCourseId === course.id;
              return (
                <article className={`academy-course-card${isActive ? ' selected' : ''}`} key={course.id}>
                  <div className="academy-course-card-top">
                    <span className={`academy-course-icon ${course.accent}`}><Icon size={20} /></span>
                    <span className="academy-course-number">0{index + 1}</span>
                  </div>
                  <div className="academy-course-meta"><span>{course.category}</span><span>{course.level}</span></div>
                  <h3>{course.title}</h3>
                  <p>{course.summary}</p>
                  <div className="academy-course-facts"><span><BookOpen size={14} /> {course.lessons.length} lessons</span><span><Clock3 size={14} /> {course.duration}</span></div>
                  {isComplete && <div className="academy-complete-note"><CheckCircle2 size={15} /> Completed</div>}
                  <button className="academy-course-button" type="button" onClick={() => openCourse(course.id)}>
                    {isComplete ? 'Review module' : isActive ? 'Continue module' : 'Start module'}
                    {isComplete ? <CheckCircle2 size={16} /> : <ChevronRight size={17} />}
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="academy-no-results"><Search size={20} /><strong>No topics found</strong><span>Try another search term or choose a different category.</span></div>
        )}
      </section>

      {activeCourse && currentLesson && (
        <section className="academy-lesson" id="academy-lesson" aria-labelledby="academy-lesson-title">
          <div className="academy-lesson-heading">
            <div><span className="academy-section-kicker">CONTINUE LEARNING · {activeCourse.category.toUpperCase()}</span><h2 id="academy-lesson-title">{activeCourse.title}</h2></div>
            <button className="academy-close-lesson" type="button" onClick={() => setActiveCourseId(null)} aria-label="Close lesson">×</button>
          </div>
          <div className="academy-lesson-layout">
            <nav className="academy-lesson-nav" aria-label="Module lessons">
              <span className="academy-lesson-nav-title">IN THIS MODULE</span>
              {activeCourse.lessons.map((lesson, index) => (
                <button key={lesson.title} type="button" className={`academy-lesson-nav-item${activeLessonIndex === index ? ' active' : ''}`} onClick={() => setActiveLessonIndex(index)} aria-current={activeLessonIndex === index ? 'step' : undefined}>
                  <span>{String(index + 1).padStart(2, '0')}</span>{lesson.title}
                </button>
              ))}
              <div className="academy-module-progress"><span>{completedCourses.includes(activeCourse.id) ? 'Module complete' : `${activeLessonIndex + 1} of ${activeCourse.lessons.length} lessons`}</span><div><span style={{ width: completedCourses.includes(activeCourse.id) ? '100%' : `${((activeLessonIndex + 1) / activeCourse.lessons.length) * 100}%` }} /></div></div>
            </nav>
            <article className="academy-lesson-content">
              <div className="academy-lesson-label"><span>LESSON {String(activeLessonIndex + 1).padStart(2, '0')}</span><span><Clock3 size={13} /> Self-paced</span></div>
              <h3>{currentLesson.title}</h3>
              <p className="academy-lesson-body">{currentLesson.body}</p>
              <div className="academy-explanation">
                <h4>Detailed explanation</h4>
                {currentLesson.explanation.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
              <div className="academy-example"><Lightbulb size={18} /><div><strong>Hypothetical example</strong><p>{currentLesson.example}</p></div></div>
              <div className="academy-key-points"><h4><Lightbulb size={16} /> Key points</h4><ul>{currentLesson.points.map((point) => <li key={point}><CheckCircle2 size={16} /><span>{point}</span></li>)}</ul></div>
              <div className="academy-lesson-note"><ShieldCheck size={18} /><p>{currentLesson.note}</p></div>
              <div className="academy-lesson-sources"><strong>Official reading</strong>{activeCourse.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}<ExternalLink size={13} /></a>)}</div>
              <div className="academy-lesson-actions">
                <button className="academy-previous-button" type="button" disabled={activeLessonIndex === 0} onClick={() => setActiveLessonIndex((index) => Math.max(0, index - 1))}><ChevronLeft size={16} /> Previous</button>
                {activeLessonIndex < activeCourse.lessons.length - 1 ? (
                  <button className="academy-next-button" type="button" onClick={() => setActiveLessonIndex((index) => Math.min(activeCourse.lessons.length - 1, index + 1))}>Next lesson <ChevronRight size={16} /></button>
                ) : (
                  <button className="academy-next-button" type="button" onClick={() => markCourseComplete(activeCourse.id)}><CheckCircle2 size={16} /> {completedCourses.includes(activeCourse.id) ? 'Module completed' : 'Mark module complete'}</button>
                )}
              </div>
            </article>
          </div>
        </section>
      )}

      <section className="academy-risk-banner">
        <div className="academy-risk-icon"><ShieldCheck size={23} /></div>
        <div><span>RISK BEFORE REWARD</span><h2>Learn the product before you trade it.</h2><p>SEBI’s FY22–FY24 study found 93% of individual equity F&O traders incurred losses. Options and leveraged products can result in rapid losses.</p></div>
        <a href="https://www.sebi.gov.in/media-and-notifications/press-releases/sep-2024/updated-sebi-study-reveals-93-of-individual-traders-incurred-losses-in-equity-fando-between-fy22-and-fy24-aggregate-losses-exceed-1-8-lakh-crores-over-three-years_86906.html" target="_blank" rel="noreferrer">Read SEBI study <ExternalLink size={14} /></a>
      </section>

      <section className="academy-glossary" aria-labelledby="academy-glossary-title">
        <div className="academy-section-heading"><div><span className="academy-section-kicker">QUICK REFERENCE</span><h2 id="academy-glossary-title">Market terms, in plain language</h2><p>Use this glossary while working through the lessons.</p></div></div>
        <div className="academy-glossary-grid">
          {glossaryTerms.map(([term, definition]) => <article className="academy-glossary-card" key={term}><strong>{term}</strong><p>{definition}</p></article>)}
        </div>
      </section>

      <section className="academy-videos" aria-labelledby="academy-videos-title">
        <div className="academy-section-heading academy-videos-heading">
          <div><span className="academy-section-kicker">CURATED VIDEO PATH</span><h2 id="academy-videos-title">Good videos to learn the market</h2><p>Start with the official SEBI library, learn investor safety, then explore longer NSE courses.</p></div>
          <span className="academy-videos-note"><Play size={14} fill="currentColor" /> 3 trusted picks</span>
        </div>
        <div className="academy-video-grid">
          {videoRecommendations.map((video) => (
            <a className="academy-video-card" href={video.url} key={video.number} target="_blank" rel="noreferrer">
              <div className="academy-video-card-top"><span className="academy-video-number">{video.number}</span><span className="academy-video-level">{video.level}</span></div>
              <span className="academy-video-kind">{video.kind}</span>
              <h3>{video.title}</h3>
              <p>{video.description}</p>
              <span className="academy-video-link">{video.label}<ExternalLink size={14} /></span>
            </a>
          ))}
        </div>
      </section>

      <section className="academy-quiz" id="academy-quiz" aria-labelledby="academy-quiz-title">
        <div className="academy-quiz-heading">
          <div className="academy-quiz-icon"><Award size={21} /></div>
          <div><span className="academy-section-kicker">CHECK YOUR UNDERSTANDING</span><h2 id="academy-quiz-title">Market basics knowledge check</h2><p>Answer all five questions to see your score and explanations.</p></div>
          {quizSubmitted && <div className="academy-quiz-score"><strong>{quizScore}<span> / {quizQuestions.length}</span></strong><small>{quizScore >= 4 ? 'Strong foundation' : 'Keep learning'}</small></div>}
        </div>
        <div className="academy-quiz-list">
          {quizQuestions.map((question, questionIndex) => (
            <fieldset className="academy-quiz-question" key={question.question}>
              <legend><span>{String(questionIndex + 1).padStart(2, '0')}</span>{question.question}</legend>
              <div className="academy-quiz-options">
                {question.options.map((option, optionIndex) => {
                  const selected = quizAnswers[questionIndex] === optionIndex;
                  let stateClass = selected ? ' selected' : '';
                  if (quizSubmitted && optionIndex === question.answer) stateClass = ' correct';
                  else if (quizSubmitted && selected) stateClass = ' incorrect';
                  return <button className={`academy-quiz-option${stateClass}`} type="button" key={option} onClick={() => handleAnswer(questionIndex, optionIndex)} disabled={quizSubmitted} aria-pressed={selected}><span>{String.fromCharCode(65 + optionIndex)}</span>{option}</button>;
                })}
              </div>
              {quizSubmitted && <p className="academy-quiz-explanation"><CheckCircle2 size={15} /> {question.explanation}</p>}
            </fieldset>
          ))}
        </div>
        <div className="academy-quiz-footer">
          <span>{Object.keys(quizAnswers).length} of {quizQuestions.length} answered</span>
          {!quizSubmitted ? (
            <button className="academy-next-button" type="button" disabled={Object.keys(quizAnswers).length < quizQuestions.length} onClick={() => setQuizSubmitted(true)}>Submit answers <ArrowRight size={16} /></button>
          ) : (
            <button className="academy-previous-button" type="button" onClick={() => { setQuizAnswers({}); setQuizSubmitted(false); }}><RotateCcw size={15} /> Retake quiz</button>
          )}
        </div>
      </section>

      <section className="academy-resources">
        <div className="academy-resources-heading"><div><span className="academy-section-kicker">TRUSTED SOURCES</span><h2>Keep learning from official sources</h2></div><p>Rules and index details can change. Check current exchange and regulator information.</p></div>
        <div className="academy-resource-grid">
          <a className="academy-resource-card" href="https://investor.sebi.gov.in/" target="_blank" rel="noreferrer"><span className="academy-resource-icon green"><ShieldCheck size={18} /></span><div><strong>SEBI Investor</strong><span>Investor education and market safeguards</span></div><ExternalLink size={15} /></a>
          <a className="academy-resource-card" href="https://www.nseindia.com/static/learn/interactive-courses" target="_blank" rel="noreferrer"><span className="academy-resource-icon blue"><Landmark size={18} /></span><div><strong>NSE Learn</strong><span>Exchange and market learning resources</span></div><ExternalLink size={15} /></a>
          <a className="academy-resource-card" href="https://www.niftyindices.com/" target="_blank" rel="noreferrer"><span className="academy-resource-icon violet"><TrendingUp size={18} /></span><div><strong>NSE Indices</strong><span>Factsheets, constituents and methodology</span></div><ExternalLink size={15} /></a>
        </div>
      </section>

      <footer className="academy-disclaimer"><ShieldCheck size={16} /><p>ShareMarket Academy is for general education only. It does not provide investment advice, recommendations, assured returns or a substitute for your own research.</p><Link to="/paper-trading">Practice with paper trading <ArrowRight size={14} /></Link></footer>
    </div>
  );
};

export default Learn;
