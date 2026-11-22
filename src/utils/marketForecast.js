const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sigmoid = (value) => 1 / (1 + Math.exp(-clamp(value, -25, 25)));

const sampleStd = (values) => {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1));
};

const rsiAt = (closes, index, period = 14) => {
  if (index < period) return null;
  let gains = 0;
  let losses = 0;
  for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
    const change = closes[cursor] - closes[cursor - 1];
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  if (gains === 0 && losses === 0) return 50;
  if (losses === 0) return 100;
  if (gains === 0) return 0;
  return 100 - (100 / (1 + (gains / losses)));
};

const featureAt = (candles, index) => {
  const closes = candles.map((candle) => candle.close);
  const close = closes[index];
  const logReturn = (period) => Math.log(close / closes[index - period]);
  const returns = [];
  for (let cursor = index - 19; cursor <= index; cursor += 1) returns.push(Math.log(closes[cursor] / closes[cursor - 1]));
  const sma20 = closes.slice(index - 19, index + 1).reduce((sum, value) => sum + value, 0) / 20;
  let trueRangeTotal = 0;
  for (let cursor = index - 13; cursor <= index; cursor += 1) {
    const candle = candles[cursor];
    const previousClose = closes[cursor - 1];
    trueRangeTotal += Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  }
  const atr14Percent = (trueRangeTotal / 14) / close;
  return [
    logReturn(1),
    logReturn(5),
    logReturn(20),
    sampleStd(returns),
    (close / sma20) - 1,
    atr14Percent,
    (rsiAt(closes, index, 14) - 50) / 50,
  ];
};

const standardizer = (samples) => {
  const width = samples[0].features.length;
  const mean = Array.from({ length: width }, (_, column) => samples.reduce((sum, sample) => sum + sample.features[column], 0) / samples.length);
  const scale = Array.from({ length: width }, (_, column) => {
    const deviation = sampleStd(samples.map((sample) => sample.features[column]));
    return deviation > 1e-12 ? deviation : 1;
  });
  return {
    mean,
    normalize: (features) => features.map((value, column) => (value - mean[column]) / scale[column]),
  };
};

const fitLogistic = (samples, lambda) => {
  const { mean, normalize } = standardizer(samples);
  const rows = samples.map((sample) => ({ features: normalize(sample.features), label: sample.label }));
  const weights = Array(rows[0].features.length + 1).fill(0);
  const learningRate = 0.12;
  const iterations = 500;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = Array(weights.length).fill(0);
    for (const row of rows) {
      const logit = weights[0] + row.features.reduce((sum, value, index) => sum + (value * weights[index + 1]), 0);
      const error = sigmoid(logit) - row.label;
      gradient[0] += error;
      row.features.forEach((value, index) => { gradient[index + 1] += error * value; });
    }
    const rate = learningRate / rows.length;
    weights[0] -= rate * gradient[0];
    for (let index = 1; index < weights.length; index += 1) {
      weights[index] -= rate * ((gradient[index] / rows.length) + (lambda * weights[index]));
    }
  }
  const predict = (features) => sigmoid(weights[0] + normalize(features).reduce((sum, value, index) => sum + (value * weights[index + 1]), 0));
  return {
    predict,
    neutralizedProbability: (features, featureIndex) => {
      const neutralized = [...features];
      neutralized[featureIndex] = mean[featureIndex];
      return predict(neutralized);
    },
  };
};

const buildSamples = (candles, horizon) => {
  const samples = [];
  for (let index = 20; index + horizon < candles.length; index += 1) {
    const features = featureAt(candles, index);
    const label = candles[index + horizon].close > candles[index].close ? 1 : 0;
    if (features.every(Number.isFinite)) samples.push({ index, features, label });
  }
  return samples;
};

const FEATURE_LABELS = [
  '1-day return',
  '5-day return',
  '20-day return',
  '20-day realized volatility',
  'Distance from SMA 20',
  'ATR 14 as a share of price',
  'RSI 14',
];

const evaluate = (samples, probabilities) => {
  const actualUps = samples.reduce((sum, sample) => sum + sample.label, 0);
  const correct = samples.reduce((sum, sample, index) => sum + ((probabilities[index] >= 0.5) === (sample.label === 1) ? 1 : 0), 0);
  const brier = samples.reduce((sum, sample, index) => sum + ((probabilities[index] - sample.label) ** 2), 0) / samples.length;
  return {
    sampleCount: samples.length,
    accuracyPercent: Number(((correct / samples.length) * 100).toFixed(1)),
    brierScore: Number(brier.toFixed(4)),
    testUpRatePercent: Number(((actualUps / samples.length) * 100).toFixed(1)),
  };
};

export const forecastFromDailyCandles = (input, { horizonBars = 5, minimumTrainSamples = 100, minimumTestSamples = 30 } = {}) => {
  const candles = (Array.isArray(input) ? input : [])
    .map((candle) => ({
      time: Number(candle.time),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
    }))
    .filter((candle) => Number.isFinite(candle.time) && candle.time > 0
      && [candle.open, candle.high, candle.low, candle.close].every((price) => Number.isFinite(price) && price > 0)
      && candle.high >= Math.max(candle.open, candle.close)
      && candle.low <= Math.min(candle.open, candle.close))
    .sort((first, second) => first.time - second.time)
    .filter((candle, index, all) => index === 0 || candle.time !== all[index - 1].time);

  const samples = buildSamples(candles, horizonBars);
  const splitIndex = Math.floor(candles.length * 0.7);
  const training = samples.filter((sample) => sample.index + horizonBars < splitIndex);
  const testing = samples.filter((sample) => sample.index >= splitIndex);
  if (training.length < minimumTrainSamples || testing.length < minimumTestSamples) {
    return {
      status: 'insufficient_history',
      candleCount: candles.length,
      trainSamples: training.length,
      testSamples: testing.length,
      minimumTrainSamples,
      minimumTestSamples,
      probabilityPercent: null,
      note: 'A forecast is withheld until the chronological training and out-of-sample windows are large enough.',
    };
  }

  const holdoutModels = [0.01, 0.1, 1].map((lambda) => fitLogistic(training, lambda));
  const holdoutProbabilities = testing.map((sample) => holdoutModels.reduce((sum, model) => sum + model.predict(sample.features), 0) / holdoutModels.length);
  const performance = evaluate(testing, holdoutProbabilities);
  const finalModels = [0.01, 0.1, 1].map((lambda) => fitLogistic(samples, lambda));
  const latestFeatures = featureAt(candles, candles.length - 1);
  const probabilityValues = finalModels.map((model) => model.predict(latestFeatures));
  const probability = probabilityValues.reduce((sum, value) => sum + value, 0) / probabilityValues.length;
  const probabilityMin = Math.min(...probabilityValues);
  const probabilityMax = Math.max(...probabilityValues);
  const featureSensitivities = FEATURE_LABELS.map((feature, index) => {
    const neutralizedProbability = finalModels.reduce((sum, model) => sum + model.neutralizedProbability(latestFeatures, index), 0) / finalModels.length;
    return {
      feature,
      probabilityChangePoints: Number(((probability - neutralizedProbability) * 100).toFixed(2)),
    };
  }).sort((first, second) => Math.abs(second.probabilityChangePoints) - Math.abs(first.probabilityChangePoints));

  return {
    status: 'ok',
    model: 'L2 logistic-regression ensemble',
    target: `Next ${horizonBars} daily bars close above the latest close`,
    probabilityPercent: Number((probability * 100).toFixed(1)),
    modelSensitivityRangePercent: [Number((probabilityMin * 100).toFixed(1)), Number((probabilityMax * 100).toFixed(1))],
    featureSensitivities,
    direction: probability >= 0.55 ? 'bullish' : probability <= 0.45 ? 'bearish' : 'neutral',
    candleCount: candles.length,
    trainSamples: training.length,
    testSamples: testing.length,
    performance,
    latestBarTime: candles.at(-1)?.time ?? null,
    disclaimer: 'Research estimate from a chronological holdout. The probability range measures sensitivity to regularization settings, not a calibrated confidence interval or a guarantee.',
  };
};
