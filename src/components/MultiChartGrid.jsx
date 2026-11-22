import { useState } from 'react';
import LiveChart from './LiveChart';
import { Grid, Maximize2, RefreshCw } from 'lucide-react';
import './MultiChartGrid.css';

const DEFAULT_SYMBOLS = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY'];

const MultiChartGrid = () => {
  const [layout, setLayout] = useState('2x2'); // '1x1', '1x2', '2x2'
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);

  const handleSymbolChange = (index, newSym) => {
    const next = [...symbols];
    next[index] = newSym.toUpperCase().trim();
    setSymbols(next);
  };

  const visibleSymbols = layout === '1x1' ? symbols.slice(0, 1) : layout === '1x2' ? symbols.slice(0, 2) : symbols.slice(0, 4);

  return (
    <div className="multichart-container">
      <div className="multichart-toolbar">
        <div className="toolbar-left">
          <Grid size={18} />
          <span className="toolbar-title">Multi-Chart Workspace</span>
        </div>
        <div className="layout-switcher">
          <button
            type="button"
            className={layout === '1x1' ? 'active' : ''}
            onClick={() => setLayout('1x1')}
          >
            Single (1x1)
          </button>
          <button
            type="button"
            className={layout === '1x2' ? 'active' : ''}
            onClick={() => setLayout('1x2')}
          >
            Split (1x2)
          </button>
          <button
            type="button"
            className={layout === '2x2' ? 'active' : ''}
            onClick={() => setLayout('2x2')}
          >
            Quad (2x2)
          </button>
        </div>
      </div>

      <div className={`charts-grid layout-${layout}`}>
        {visibleSymbols.map((sym, idx) => (
          <div key={`${sym}-${idx}`} className="chart-cell">
            <div className="chart-cell-header">
              <input
                type="text"
                className="symbol-input"
                defaultValue={sym}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSymbolChange(idx, e.target.value);
                }}
                onBlur={(e) => handleSymbolChange(idx, e.target.value)}
                placeholder="Type symbol..."
              />
              <span className="press-enter-hint">Press Enter to switch</span>
            </div>
            <div className="chart-cell-body">
              <LiveChart symbol={sym} stock={{ symbol: sym }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MultiChartGrid;
