export const getSectorHeatmapData = () => {
  return [
    {
      sector: 'Banking & Financials',
      weight: 35,
      change: 0.84,
      stocks: [
        { symbol: 'HDFCBANK', name: 'HDFC Bank', price: 1742.50, change: 1.12, mcap: 'Large' },
        { symbol: 'ICICIBANK', name: 'ICICI Bank', price: 1265.80, change: 1.45, mcap: 'Large' },
        { symbol: 'SBIN', name: 'State Bank of India', price: 812.30, change: -0.35, mcap: 'Large' },
        { symbol: 'KOTAKBANK', name: 'Kotak Mahindra', price: 1780.00, change: 0.65, mcap: 'Large' },
        { symbol: 'AXISBANK', name: 'Axis Bank', price: 1150.20, change: 0.40, mcap: 'Mid' },
      ],
    },
    {
      sector: 'Information Tech (IT)',
      weight: 15,
      change: -0.65,
      stocks: [
        { symbol: 'TCS', name: 'Tata Consultancy Services', price: 4120.00, change: -0.45, mcap: 'Large' },
        { symbol: 'INFY', name: 'Infosys Ltd', price: 1850.50, change: -1.20, mcap: 'Large' },
        { symbol: 'HCLTECH', name: 'HCL Technologies', price: 1740.00, change: 0.25, mcap: 'Large' },
        { symbol: 'WIPRO', name: 'Wipro Ltd', price: 540.20, change: -0.80, mcap: 'Mid' },
        { symbol: 'TECHM', name: 'Tech Mahindra', price: 1620.00, change: -0.95, mcap: 'Mid' },
      ],
    },
    {
      sector: 'Automobile',
      weight: 12,
      change: 1.25,
      stocks: [
        { symbol: 'TATAMOTORS', name: 'Tata Motors', price: 810.00, change: 2.15, mcap: 'Large' },
        { symbol: 'M&M', name: 'Mahindra & Mahindra', price: 2950.00, change: 1.80, mcap: 'Large' },
        { symbol: 'MARUTI', name: 'Maruti Suzuki', price: 11450.00, change: 0.50, mcap: 'Large' },
        { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto', price: 9200.00, change: 0.90, mcap: 'Mid' },
      ],
    },
    {
      sector: 'Energy & Oil/Gas',
      weight: 14,
      change: 0.42,
      stocks: [
        { symbol: 'RELIANCE', name: 'Reliance Industries', price: 1285.50, change: 0.75, mcap: 'Large' },
        { symbol: 'ONGC', name: 'ONGC', price: 260.40, change: -0.20, mcap: 'Large' },
        { symbol: 'NTPC', name: 'NTPC Ltd', price: 380.20, change: 0.60, mcap: 'Large' },
        { symbol: 'POWERGRID', name: 'Power Grid Corp', price: 315.00, change: 0.30, mcap: 'Large' },
      ],
    },
    {
      sector: 'Metals & Mining',
      weight: 8,
      change: -1.45,
      stocks: [
        { symbol: 'TATASTEEL', name: 'Tata Steel', price: 148.20, change: -1.80, mcap: 'Large' },
        { symbol: 'JSWSTEEL', name: 'JSW Steel', price: 960.00, change: -1.25, mcap: 'Large' },
        { symbol: 'HINDALCO', name: 'Hindalco', price: 650.00, change: -1.40, mcap: 'Large' },
        { symbol: 'VEDL', name: 'Vedanta Ltd', price: 440.00, change: -0.90, mcap: 'Mid' },
      ],
    },
    {
      sector: 'Pharma & Healthcare',
      weight: 9,
      change: 0.35,
      stocks: [
        { symbol: 'SUNPHARMA', name: 'Sun Pharma', price: 1810.00, change: 0.80, mcap: 'Large' },
        { symbol: 'CIPLA', name: 'Cipla Ltd', price: 1540.00, change: 0.20, mcap: 'Large' },
        { symbol: 'DRREDDY', name: 'Dr Reddys Labs', price: 1260.00, change: -0.40, mcap: 'Large' },
      ],
    },
    {
      sector: 'FMCG & Consumer',
      weight: 7,
      change: 0.15,
      stocks: [
        { symbol: 'ITC', name: 'ITC Ltd', price: 470.00, change: 0.45, mcap: 'Large' },
        { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', price: 2420.00, change: -0.30, mcap: 'Large' },
        { symbol: 'NESTLEIND', name: 'Nestle India', price: 2310.00, change: 0.10, mcap: 'Large' },
      ],
    },
  ];
};
