import { useState, useMemo } from 'react';
import {
  Coins,
  Calculator,
  Building2,
  Scale,
  Sparkles,
  TrendingUp,
  Percent,
  Receipt,
  PiggyBank,
  ArrowRight,
  Info
} from 'lucide-react';
import './BullionInsightsSuite.css';

const CITY_RATES_OFFSETS = [
  { city: 'Mumbai', offset: 0, tag: 'Benchmark Financial Capital' },
  { city: 'Delhi NCR', offset: 120, tag: 'North Zone Hub' },
  { city: 'Ahmedabad', offset: -40, tag: 'Gujarat Bullion Center' },
  { city: 'Jaipur', offset: 80, tag: 'Jewellery & Gem Capital' },
  { city: 'Kolkata', offset: 60, tag: 'East India Mandi' },
  { city: 'Chennai', offset: 150, tag: 'South India Sovereign Hub' },
  { city: 'Bangalore', offset: 110, tag: 'Karnataka Bullion' },
  { city: 'Hyderabad', offset: 90, tag: 'Telangana Pearl City' },
];

const BullionInsightsSuite = ({ metal = 'GOLD', basePrice = 76500, goldPrice = null, silverPrice = null }) => {
  const isSilver = metal.toUpperCase().includes('SILVER');
  const unitLabel = isSilver ? '1 Kg' : '10 Grams';

  // 1. Karat / Purity Rates (24K, 22K, 18K)
  const karats = useMemo(() => {
    if (isSilver) {
      return [
        { name: '999 Fine Silver (99.9%)', purity: 'Investment Bars', price: basePrice, tag: 'Bullion standard' },
        { name: '925 Sterling Silver (92.5%)', purity: 'Jewelry & Ornaments', price: Math.round(basePrice * 0.925), tag: 'Global Hallmark' },
        { name: '800 Silver (80%)', purity: 'Utensils & Artifacts', price: Math.round(basePrice * 0.8), tag: 'Traditional ware' },
      ];
    }
    return [
      { name: '24 Karat (99.9% Pure)', purity: 'Coins & Bullion Bars', price: basePrice, tag: 'Highest Purity' },
      { name: '22 Karat (91.6% Hallmark)', purity: 'Standard Indian Jewellery', price: Math.round(basePrice * 0.916), tag: 'Most Popular' },
      { name: '18 Karat (75.0% Diamond)', purity: 'Diamond & Studded Jewellery', price: Math.round(basePrice * 0.75), tag: 'Modern Wear' },
    ];
  }, [basePrice, isSilver]);

  // 2. City-wise Rates
  const [selectedCity, setSelectedCity] = useState(CITY_RATES_OFFSETS[0].city);
  const cityPrice = useMemo(() => {
    const item = CITY_RATES_OFFSETS.find((c) => c.city === selectedCity);
    return basePrice + (item ? item.offset : 0);
  }, [basePrice, selectedCity]);

  // 3. Jewelry & GST (3%) Bill Estimator
  const [weightGrams, setWeightGrams] = useState(isSilver ? 50 : 10);
  const [selectedKaratMultiplier, setSelectedKaratMultiplier] = useState(isSilver ? 0.925 : 0.916);
  const [makingChargePercent, setMakingChargePercent] = useState(10); // default 10%

  const jewelryCalculation = useMemo(() => {
    const ratePerGram = (basePrice / (isSilver ? 1000 : 10)) * selectedKaratMultiplier;
    const rawMetalCost = Math.round(ratePerGram * Number(weightGrams));
    const makingCharges = Math.round(rawMetalCost * (Number(makingChargePercent) / 100));
    const taxableAmount = rawMetalCost + makingCharges;
    const gstAmount = Math.round(taxableAmount * 0.03); // 3% Indian GST on Bullion/Jewelry
    const totalPayable = taxableAmount + gstAmount;

    return {
      ratePerGram: Math.round(ratePerGram),
      rawMetalCost,
      makingCharges,
      gstAmount,
      totalPayable,
    };
  }, [basePrice, isSilver, selectedKaratMultiplier, weightGrams, makingChargePercent]);

  // 4. Gold/Silver Ratio (GSR) from the latest verified quotes for both metals
  const gsr = useMemo(() => {
    const goldPerGram = Number(goldPrice) > 0 ? Number(goldPrice) / 10 : null;
    const silverPerGram = Number(silverPrice) > 0 ? Number(silverPrice) / 1000 : null;
    if (!goldPerGram || !silverPerGram) return { ratio: null, signal: null };
    const ratio = goldPerGram / silverPerGram;
    const signal = ratio > 80 ? 'Silver is cheap versus gold on this ratio' : ratio < 65 ? 'Gold is cheap versus silver on this ratio' : 'Neutral macro balance';
    return { ratio: Number(ratio.toFixed(1)), signal };
  }, [goldPrice, silverPrice]);

  // 5. Monthly SIP Accumulator
  const [monthlySip, setMonthlySip] = useState(5000);
  const [sipYears, setSipYears] = useState(3);
  const sipCalculation = useMemo(() => {
    const totalInvested = monthlySip * 12 * sipYears;
    const avgRatePerGram = basePrice / (isSilver ? 1000 : 10);
    const estimatedGrams = Math.round((totalInvested / avgRatePerGram) * 10) / 10;
    const estimatedValueWithGrowth = Math.round(totalInvested * Math.pow(1.11, sipYears)); // 11% historical CAGR for gold/silver

    return {
      totalInvested,
      estimatedGrams,
      estimatedValueWithGrowth,
      gain: estimatedValueWithGrowth - totalInvested,
    };
  }, [monthlySip, sipYears, basePrice, isSilver]);

  return (
    <div className="bullion-insights-suite">
      <div className="suite-header">
        <div className="suite-title">
          <span className="suite-eyebrow"><Sparkles size={14} /> INDIAN BULLION &amp; JEWELLERY INTELLIGENCE</span>
          <h2>Reference Purity Rates, City Premium Estimates &amp; Jewellery Estimator</h2>
          <p>BIS hallmark 22K/24K prices derived from the latest verified reference, modelled city premiums, 3% GST bill calculator &amp; bullion SIP planner</p>
        </div>
      </div>

      {/* Grid 1: Karat Rates Cards */}
      <div className="karat-cards-grid">
        {karats.map((k) => (
          <div key={k.name} className="karat-card">
            <span className="karat-tag">{k.tag}</span>
            <h4 className="karat-name">{k.name}</h4>
            <span className="karat-purity">{k.purity}</span>
            <div className="karat-price-row">
              <strong className="karat-price">₹{k.price.toLocaleString('en-IN')}</strong>
              <small className="karat-unit">/ {unitLabel}</small>
            </div>
            <div className="karat-per-gram">
              ₹{Math.round(k.price / (isSilver ? 1000 : 10)).toLocaleString('en-IN')} per gram
            </div>
          </div>
        ))}
      </div>

      {/* Grid 2: City Rates + Jewelry GST Calculator */}
      <div className="insights-two-column">
        {/* City-wise Rates Table */}
        <div className="insight-card city-card">
          <div className="card-top">
            <div className="card-icon-wrap"><Building2 size={18} /></div>
            <div>
              <h3>City Premium Model (Indicative)</h3>
              <p>Fixed transport-cess offsets applied to the national reference price — not live mandi quotes</p>
            </div>
          </div>

          <div className="city-table-responsive">
            <table className="city-table">
              <thead>
                <tr>
                  <th>City / Mandi</th>
                  <th>Region</th>
                  <th>Model rate ({unitLabel})</th>
                </tr>
              </thead>
              <tbody>
                {CITY_RATES_OFFSETS.map((c) => {
                  const rate = basePrice + c.offset;
                  const isSelected = selectedCity === c.city;
                  return (
                    <tr
                      key={c.city}
                      className={isSelected ? 'selected-row' : ''}
                      onClick={() => setSelectedCity(c.city)}
                    >
                      <td><strong>{c.city}</strong></td>
                      <td><span className="city-region-tag">{c.tag}</span></td>
                      <td className="city-price-cell">₹{rate.toLocaleString('en-IN')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Jewelry Bill & 3% GST Estimator */}
        <div className="insight-card calculator-card">
          <div className="card-top">
            <div className="card-icon-wrap"><Receipt size={18} /></div>
            <div>
              <h3>Jewellery Bill &amp; 3% GST Estimator</h3>
              <p>Calculate exact jewelry shop invoice with BIS hallmark &amp; making charges</p>
            </div>
          </div>

          <div className="calc-inputs">
            <div className="calc-input-group">
              <label>Purity Grade</label>
              <select
                value={selectedKaratMultiplier}
                onChange={(e) => setSelectedKaratMultiplier(Number(e.target.value))}
              >
                {isSilver ? (
                  <>
                    <option value={1}>999 Fine Silver (99.9%)</option>
                    <option value={0.925}>925 Sterling Silver (92.5%)</option>
                  </>
                ) : (
                  <>
                    <option value={1}>24K Pure Gold (99.9%)</option>
                    <option value={0.916}>22K Hallmark Gold (91.6% Std)</option>
                    <option value={0.75}>18K Diamond Studded (75%)</option>
                  </>
                )}
              </select>
            </div>

            <div className="calc-input-group">
              <label>Weight in Grams</label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={weightGrams}
                onChange={(e) => setWeightGrams(Math.max(0.5, Number(e.target.value) || 1))}
              />
            </div>

            <div className="calc-input-group">
              <label>Making Charges (%)</label>
              <input
                type="number"
                min="0"
                max="35"
                value={makingChargePercent}
                onChange={(e) => setMakingChargePercent(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </div>

          {/* Bill Receipt Breakdown */}
          <div className="receipt-breakdown">
            <div className="receipt-line">
              <span>Pure Metal Cost ({weightGrams}g @ ₹{jewelryCalculation.ratePerGram}/g):</span>
              <strong>₹{jewelryCalculation.rawMetalCost.toLocaleString('en-IN')}</strong>
            </div>
            <div className="receipt-line">
              <span>Making Charges ({makingChargePercent}%):</span>
              <strong>₹{jewelryCalculation.makingCharges.toLocaleString('en-IN')}</strong>
            </div>
            <div className="receipt-line">
              <span>GST (3% on Bullion + Making):</span>
              <strong>₹{jewelryCalculation.gstAmount.toLocaleString('en-IN')}</strong>
            </div>
            <div className="receipt-line total-line">
              <span>Estimated Invoice Payable:</span>
              <strong className="total-val">₹{jewelryCalculation.totalPayable.toLocaleString('en-IN')}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Grid 3: Gold/Silver Ratio Meter + Digital Gold / SGB Comparison */}
      <div className="insights-two-column">
        {/* GSR Indicator */}
        <div className="insight-card ratio-card">
          <div className="card-top">
            <div className="card-icon-wrap"><Scale size={18} /></div>
            <div>
              <h3>Gold / Silver Ratio (GSR) Meter</h3>
              <p>Computed from the latest verified gold and silver reference prices on this page</p>
            </div>
          </div>

          <div className="ratio-display-box">
            <div className="ratio-number">
              <span>Current Ratio</span>
              <strong>{gsr.ratio !== null ? `${gsr.ratio}x` : 'Unavailable'}</strong>
            </div>
            <div className="ratio-signal-tag">
              <Sparkles size={15} /> {gsr.signal || 'Both gold and silver quotes are needed to compute the ratio'}
            </div>
          </div>

          <div className="ratio-gauge-track">
            <div
              className="ratio-gauge-fill"
              style={{ width: `${gsr.ratio === null ? 0 : Math.min(100, Math.max(0, ((gsr.ratio - 45) / 50) * 100))}%` }}
            />
          </div>
          <div className="ratio-scale-labels">
            <span>60x (Gold Favored)</span>
            <span>75x (Historical Mean)</span>
            <span>85x (Silver Favored)</span>
          </div>
        </div>

        {/* Monthly Gold Accumulator (SIP) */}
        <div className="insight-card sip-card">
          <div className="card-top">
            <div className="card-icon-wrap"><PiggyBank size={18} /></div>
            <div>
              <h3>Monthly Bullion SIP Accumulator</h3>
              <p>Simulate systematic wealth building with physical or digital metal</p>
            </div>
          </div>

          <div className="sip-controls">
            <div className="sip-field">
              <label>Monthly Investment</label>
              <select value={monthlySip} onChange={(e) => setMonthlySip(Number(e.target.value))}>
                <option value={2000}>₹2,000 / month</option>
                <option value={5000}>₹5,000 / month</option>
                <option value={10000}>₹10,000 / month</option>
                <option value={25000}>₹25,000 / month</option>
              </select>
            </div>

            <div className="sip-field">
              <label>Time Horizon</label>
              <select value={sipYears} onChange={(e) => setSipYears(Number(e.target.value))}>
                <option value={1}>1 Year</option>
                <option value={3}>3 Years</option>
                <option value={5}>5 Years</option>
                <option value={10}>10 Years</option>
              </select>
            </div>
          </div>

          <div className="sip-results-box">
            <div className="sip-stat">
              <span>Invested Capital</span>
              <strong>₹{sipCalculation.totalInvested.toLocaleString('en-IN')}</strong>
            </div>
            <div className="sip-stat">
              <span>Accumulated Metal</span>
              <strong className="text-brand">~{sipCalculation.estimatedGrams} Grams</strong>
            </div>
            <div className="sip-stat highlight">
              <span>Estimated Portfolio Value</span>
              <strong className="text-gain">₹{sipCalculation.estimatedValueWithGrowth.toLocaleString('en-IN')}</strong>
            </div>
          </div>
          <p className="sip-assumption-note">
            Projection assumes 11% annual growth for illustration only — it is not a forecast of returns.
          </p>
        </div>
      </div>
    </div>
  );
};

export default BullionInsightsSuite;
