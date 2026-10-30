// src/pages/Calder.jsx
import React, { useEffect, useState } from 'react';
import { fetchCalendar } from '../services/fmpCalendar';
import StockTable from '../components/StockTable';

export default function Calder() {
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStockData()
      .then(setStocks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading stock data…</p>;
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;

  return (
    <section style={{ padding: '2rem' }}>
      <h1>Calder – Stock Prices</h1>
      <StockTable data={stocks} />
    </section>
  );
}
