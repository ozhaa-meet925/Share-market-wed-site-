// Candle granularity contract shared by every history provider branch.
// A provider may publish fewer granularities than the chart offers, so coarser
// bars are merged from an exact number of finer verified bars. Nothing here can
// invent a bar: aggregation only combines candles the provider already returned.

const IST_OFFSET_SECONDS = 5 * 60 * 60 + 30 * 60;

const RESOLUTION_SECONDS = {
  '1m': 60,
  '2m': 120,
  '3m': 180,
  '5m': 300,
  '10m': 600,
  '15m': 900,
  '20m': 1200,
  '30m': 1800,
  '45m': 2700,
  '1h': 3600,
  '2h': 7200,
  '3h': 10800,
  '4h': 14400,
  '5h': 18000,
  '6h': 21600,
  '1d': 24 * 60 * 60,
  D: 24 * 60 * 60,
  '1w': 7 * 24 * 60 * 60,
  W: 7 * 24 * 60 * 60,
  // Monthly windowing keeps the historical 30-day approximation so range
  // requests stay byte-identical to the previous provider calls.
  '1M': 30 * 24 * 60 * 60,
  M: 30 * 24 * 60 * 60,
};

// Calendar bars must come from the provider: merging intraday bars into a daily,
// weekly or monthly bar would require guessing exchange session boundaries.
export const MAX_MERGEABLE_SECONDS = 6 * 60 * 60;

export const resolutionSeconds = (resolution) => RESOLUTION_SECONDS[String(resolution)] ?? null;

export const isSupportedResolution = (resolution) => resolutionSeconds(resolution) !== null;

// Chart-facing list, in display order. Aliases (D/W/M) are accepted by the API
// but not advertised so the UI never shows two labels for one granularity.
export const SUPPORTED_RESOLUTIONS = ['1m', '3m', '5m', '10m', '15m', '30m', '45m', '1h', '2h', '4h', '1d', '1w', '1M'];

export const planResolution = (resolution, nativeResolutions) => {
  const seconds = resolutionSeconds(resolution);
  if (!seconds) return null;
  const candidates = (nativeResolutions || [])
    .map((item) => ({ resolution: item, seconds: resolutionSeconds(item) }))
    .filter((item) => item.seconds && item.seconds <= seconds && seconds % item.seconds === 0)
    .sort((first, second) => second.seconds - first.seconds);
  if (!candidates.length) return null;
  const base = candidates[0];
  if (seconds !== base.seconds && seconds > MAX_MERGEABLE_SECONDS) return null;
  return {
    resolution: String(resolution),
    seconds,
    baseResolution: base.resolution,
    baseSeconds: base.seconds,
    factor: seconds / base.seconds,
    isMerged: seconds !== base.seconds,
  };
};

export const mergeNote = (plan) => (plan && plan.isMerged
  ? `${plan.resolution} bars merged from verified ${plan.baseResolution} provider bars`
  : '');

export const aggregateCandles = (candles, bucketSeconds) => {
  const sorted = (Array.isArray(candles) ? candles : [])
    .filter((candle) => candle && Number.isFinite(Number(candle.time)))
    .sort((first, second) => Number(first.time) - Number(second.time));
  if (!sorted.length || !(bucketSeconds > 0)) return sorted.map((candle) => ({ ...candle }));

  const buckets = new Map();
  sorted.forEach((candle) => {
    const time = Number(candle.time);
    const bucketTime = Math.floor((time + IST_OFFSET_SECONDS) / bucketSeconds) * bucketSeconds
      - IST_OFFSET_SECONDS;
    const current = buckets.get(bucketTime);
    if (!current) {
      buckets.set(bucketTime, {
        ...candle,
        time: bucketTime,
        high: Number(candle.high),
        low: Number(candle.low),
        value: Number.isFinite(Number(candle.value)) ? Number(candle.value) : null,
      });
      return;
    }
    current.high = Math.max(current.high, Number(candle.high));
    current.low = Math.min(current.low, Number(candle.low));
    current.close = candle.close;
    if (Number.isFinite(Number(candle.value))) {
      current.value = (current.value || 0) + Number(candle.value);
    }
  });

  return [...buckets.values()].sort((first, second) => first.time - second.time);
};
