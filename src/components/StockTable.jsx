// src/components/StockTable.jsx
import React from 'react';
import styles from './StockTable.module.css';

export default function StockTable({ data }) {
  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Name</th>
            <th>Current</th>
            <th>Prev Close</th>
            <th>Open</th>
            <th>High</th>
            <th>Low</th>
            <th>Volume</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {data.map((stock) => (
            <tr key={stock.symbol}>
              <td>{stock.symbol}</td>
              <td>{stock.name}</td>
              <td>{stock.currentPrice?.toLocaleString()}</td>
              <td>{stock.previousClose?.toLocaleString()}</td>
              <td>{stock.open?.toLocaleString()}</td>
              <td>{stock.high?.toLocaleString()}</td>
              <td>{stock.low?.toLocaleString()}</td>
              <td>{stock.volume?.toLocaleString()}</td>
              <td>{stock.lastUpdate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
