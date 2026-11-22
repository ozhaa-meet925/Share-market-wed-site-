import { Link } from 'react-router-dom';
import { Layers, Lock } from 'lucide-react';
import {
  isLiveMetalQuote,
  metalQuoteSourceLabel,
  metals,
  unsupportedMetalContracts,
} from '../data/metals';

const MetalInstrumentsPanel = ({ activeSymbol, quotes }) => {
  const liveSymbols = metals
    .filter((metal) => isLiveMetalQuote(quotes?.get?.(metal.symbol)))
    .map((metal) => metal.name);

  return (
    <section className="panel metal-instruments-panel" aria-label="Metal instrument availability">
      <div className="section-heading">
        <h3><Layers size={17} /> Instruments &amp; availability</h3>
        <span>Only instruments supported by the connected market source are tradable.</span>
      </div>

      <div className="metal-instrument-grid">
        {metals.map((metal) => {
          const quote = quotes?.get?.(metal.symbol);
          const isLive = isLiveMetalQuote(quote);
          return (
            <article
              key={metal.symbol}
              className={`metal-instrument-card is-available ${metal.symbol === activeSymbol ? 'is-active' : ''}`}
            >
              <span className="metal-instrument-status">
                {isLive ? 'Available · live MCX' : `Available · ${metalQuoteSourceLabel(quote)}`}
              </span>
              <h4>{metal.name}</h4>
              <p>{metal.description}</p>
              <Link to={metal.route}>{metal.symbol === activeSymbol ? 'Trade on this page' : `Open ${metal.name}`}</Link>
            </article>
          );
        })}

        {unsupportedMetalContracts.map((contract) => (
          <article key={contract.symbol} className="metal-instrument-card is-unavailable">
            <span className="metal-instrument-status"><Lock size={12} /> Unavailable</span>
            <h4>{contract.name}</h4>
            <p>{contract.symbol} · {contract.reason}</p>
            <span className="metal-instrument-lock">No order buttons · feed not connected</span>
          </article>
        ))}
      </div>

      <p className="metal-instrument-note">
        {liveSymbols.length
          ? `${liveSymbols.join(' and ')} stream live Upstox MCX quotes and can be paper-traded here.`
          : 'Gold and Silver are supported through verified delayed futures or spot references and can be paper-traded here.'}
        {' '}Gold Mini, Gold Petal, Silver Mini and Silver Micro stay unavailable until a verified quote feed is mapped for those contracts.
      </p>
    </section>
  );
};

export default MetalInstrumentsPanel;
