import { createUpstoxAdapter } from './upstox.js';
import { createZerodhaAdapter } from './zerodha.js';

const adapterList = [createUpstoxAdapter(), createZerodhaAdapter()];
const adapters = new Map(adapterList.map((adapter) => [adapter.id, adapter]));

export const liveTradingMasterEnabled = () => process.env.LIVE_TRADING_ENABLED === '1';

export const listAdapters = () => adapterList;

export const getAdapter = (id) => adapters.get(String(id || '').toLowerCase()) || null;

export { BrokerError } from './http.js';
