const BrandLogo = ({ size = 'medium', showTagline = true, className = '' }) => {
  const iconSizes = {
    small: 28,
    medium: 34,
    large: 44,
  };
  const iconSize = iconSizes[size] || 34;

  return (
    <div className={`brand-logo-container ${size} ${className}`}>
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="brand-logo-svg"
      >
        <defs>
          <linearGradient id="logoBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0d6f4e" />
            <stop offset="50%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#047857" />
          </linearGradient>
          <linearGradient id="logoBarGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
          </linearGradient>
          <filter id="logoGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#0d6f4e" floodOpacity="0.35" />
          </filter>
        </defs>

        {/* Squircle Background with Drop Shadow */}
        <rect
          x="3"
          y="3"
          width="42"
          height="42"
          rx="12"
          fill="url(#logoBgGrad)"
          filter="url(#logoGlow)"
        />

        {/* Modern Candlestick / Bull Trend Bars */}
        {/* Bar 1 */}
        <line x1="14" y1="20" x2="14" y2="34" stroke="white" strokeWidth="1.5" strokeOpacity="0.5" />
        <rect x="12" y="24" width="4" height="8" rx="1.5" fill="url(#logoBarGrad)" />

        {/* Bar 2 */}
        <line x1="22" y1="15" x2="22" y2="33" stroke="white" strokeWidth="1.5" strokeOpacity="0.5" />
        <rect x="20" y="18" width="4" height="12" rx="1.5" fill="url(#logoBarGrad)" />

        {/* Bar 3 (Tallest leader) */}
        <line x1="30" y1="11" x2="30" y2="31" stroke="white" strokeWidth="1.5" strokeOpacity="0.5" />
        <rect x="28" y="13" width="4" height="15" rx="1.5" fill="url(#logoBarGrad)" />

        {/* Trendline Arrow upward */}
        <path
          d="M12 28L21 20L27 23L36 12"
          stroke="#a7f3d0"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M31 12H36V17"
          stroke="#a7f3d0"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div className="brand-logo-text">
        <span className="brand-title">
          ShareMarket<span className="brand-pro-tag">PRO</span>
        </span>
        {showTagline && <small className="brand-tagline">Real-Time Indian Exchange Terminal</small>}
      </div>
    </div>
  );
};

export default BrandLogo;
