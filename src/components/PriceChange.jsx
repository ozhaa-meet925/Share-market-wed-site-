// Shared price-movement helpers: ▲/▼/— indicators, green/red/grey tones and flash classes.
import { useEffect, useRef, useState } from 'react';

export const priceDirection = (change, changePercent, flash, lastTick) => {
  if (flash === 'up' || lastTick === 'up') return 'up';
  if (flash === 'down' || lastTick === 'down') return 'down';
  const cp = Number(changePercent);
  if (Number.isFinite(cp)) return cp > 0 ? 'up' : cp < 0 ? 'down' : 'flat';
  const ch = Number(change);
  if (Number.isFinite(ch)) return ch > 0 ? 'up' : ch < 0 ? 'down' : 'flat';
  return null;
};

export const tickToneClass = (direction, flash) => {
  const tone = direction === 'up' ? 'price-up' : direction === 'down' ? 'price-down' : direction === 'flat' ? 'price-flat' : 'price-neutral';
  const flashClass = flash === 'up' || flash === 'down' ? ` price-flash-${flash}` : '';
  return `${tone}${flashClass}`;
};

export const TickArrow = ({ direction, className = '' }) => (
  <span className={`tick-arrow tick-arrow-${direction || 'flat'} ${className}`.trim()} aria-hidden="true">
    {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—'}
  </span>
);

export const signedChange = (value, digits = 2) => (
  Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(digits)}` : '—'
);

export const signedPercent = (value, digits = 2) => (
  Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(digits)}%` : '—'
);

// Compares each incoming price with the previous one and reports the tick direction.
export const useTickFlash = (price, changePercent, identity = null) => {
  const previousRef = useRef(null);
  const identityRef = useRef(null);
  const timerRef = useRef(null);
  const [flash, setFlash] = useState(null);
  const numericPrice = Number(price);
  const hasPrice = Number.isFinite(numericPrice) && numericPrice > 0;

  useEffect(() => {
    if (!hasPrice) return undefined;
    if (identityRef.current !== identity) {
      identityRef.current = identity;
      previousRef.current = numericPrice;
      clearTimeout(timerRef.current);
      setFlash(null);
      return undefined;
    }
    const previous = previousRef.current;
    previousRef.current = numericPrice;
    if (previous === null || previous === numericPrice) return undefined;
    clearTimeout(timerRef.current);
    setFlash(numericPrice > previous ? 'up' : 'down');
    timerRef.current = setTimeout(() => setFlash(null), 600);
    return undefined;
  }, [hasPrice, identity, numericPrice]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const cp = Number(changePercent);
  const baseDirection = Number.isFinite(cp) ? (cp > 0 ? 'up' : cp < 0 ? 'down' : 'flat') : null;
  return { flash, direction: flash || baseDirection };
};

export default TickArrow;

// Drop-in coloured price for list/table rows: flashes when the value moves.
export const TickPrice = ({ value, changePercent = null, format, className = '', as = 'span', identity = null }) => {
  const Tag = as;
  const numeric = Number(value);
  const hasValue = Number.isFinite(numeric) && numeric > 0;
  const { flash, direction } = useTickFlash(hasValue ? numeric : null, changePercent, identity);
  const display = !hasValue
    ? '—'
    : format ? format(numeric) : `₹${numeric.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <Tag key={flash ? `${numeric}-${flash}` : 'steady'} className={`${tickToneClass(direction, flash)} ${className}`.trim()}>
      {display}
    </Tag>
  );
};
