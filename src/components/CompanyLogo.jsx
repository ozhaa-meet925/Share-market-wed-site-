import React, { useState, useEffect } from 'react';
import { getCompanyLogoUrls } from '../data/companyLogos';

const avatarGradients = [
  'linear-gradient(135deg, #0d6f4e, #10b981)',
  'linear-gradient(135deg, #1e40af, #3b82f6)',
  'linear-gradient(135deg, #6d28d9, #8b5cf6)',
  'linear-gradient(135deg, #b45309, #f59e0b)',
  'linear-gradient(135deg, #0f766e, #14b8a6)',
  'linear-gradient(135deg, #be123c, #f43f5e)',
  'linear-gradient(135deg, #334155, #64748b)',
  'linear-gradient(135deg, #c2410c, #ea580c)',
];

const getGradient = (sym = '') => {
  const code = (sym.charCodeAt(0) || 65) + (sym.charCodeAt(1) || 66);
  return avatarGradients[code % avatarGradients.length];
};

const CompanyLogo = ({ symbol = '', name = '', size = 36, className = '' }) => {
  const sym = String(symbol || '').toUpperCase().trim();
  const urls = getCompanyLogoUrls(sym);
  const [urlIndex, setUrlIndex] = useState(0);
  const [hasError, setHasError] = useState(urls.length === 0);

  useEffect(() => {
    setUrlIndex(0);
    setHasError(urls.length === 0);
  }, [sym]);

  const handleError = () => {
    if (urlIndex + 1 < urls.length) {
      setUrlIndex((prev) => prev + 1);
    } else {
      setHasError(true);
    }
  };

  const initial = sym.slice(0, 1) || (name ? name.slice(0, 1) : '?');

  return (
    <div
      className={`company-logo-wrapper ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        borderRadius: `${Math.round(size * 0.22)}px`,
      }}
      title={name || sym}
    >
      {!hasError && urls[urlIndex] ? (
        <img
          src={urls[urlIndex]}
          alt={sym}
          className="company-logo-img"
          onError={handleError}
          loading="lazy"
        />
      ) : (
        <div
          className="company-logo-fallback"
          style={{
            background: getGradient(sym),
            fontSize: `${Math.round(size * 0.45)}px`,
          }}
        >
          {initial}
        </div>
      )}
    </div>
  );
};

export default CompanyLogo;
