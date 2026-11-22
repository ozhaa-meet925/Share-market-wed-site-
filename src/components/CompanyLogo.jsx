import React, { useEffect, useMemo, useRef, useState } from 'react';
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

const NAME_NOISE = new Set(['LIMITED', 'LTD', 'THE', 'CO', 'CORP', 'CORPORATION', 'INC', 'PVT', 'PRIVATE', 'AND', 'OF']);

const getGradient = (sym = '') => {
  let hash = 0;
  for (const char of sym) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return avatarGradients[hash % avatarGradients.length];
};

export const companyInitials = (symbol = '', name = '') => {
  const words = String(name || '').toUpperCase().split(/[^A-Z0-9&]+/).filter((word) => word && !NAME_NOISE.has(word));
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`;
  const single = words[0] || String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return single.slice(0, 2) || '?';
};

const CompanyLogo = ({ symbol = '', name = '', size = 36, className = '' }) => {
  const sym = String(symbol || '').toUpperCase().trim();
  const px = Number(size) > 0 ? Number(size) : 36;
  const src = useMemo(() => getCompanyLogoUrls(sym)[0] || null, [sym]);
  const [status, setStatus] = useState(src ? 'loading' : 'failed');
  const [lowRes, setLowRes] = useState(false);
  const imgRef = useRef(null);

  const settle = (img) => {
    if (img.naturalWidth > 0) {
      setLowRes(Math.min(img.naturalWidth, img.naturalHeight) < 32);
      setStatus('loaded');
    } else {
      setStatus('failed');
    }
  };

  useEffect(() => {
    setLowRes(false);
    setStatus(src ? 'loading' : 'failed');
    const img = imgRef.current;
    if (src && img?.complete) settle(img);
  }, [src]);

  const initials = companyInitials(sym, name);
  const showImage = src && status !== 'failed';

  return (
    <div
      className={`company-logo-wrapper ${showImage && status === 'loaded' ? 'has-image' : ''} ${className}`.trim()}
      style={{
        width: `${px}px`,
        height: `${px}px`,
        minWidth: `${px}px`,
        minHeight: `${px}px`,
        borderRadius: `${Math.round(px * 0.24)}px`,
      }}
      title={name || sym}
    >
      {status !== 'loaded' && (
        <span
          className="company-logo-fallback"
          style={{ background: getGradient(sym || name), fontSize: `${Math.round(px * (initials.length > 1 ? 0.36 : 0.44))}px` }}
          aria-hidden={showImage ? 'true' : undefined}
        >
          {initials}
        </span>
      )}
      {showImage && (
        <img
          ref={imgRef}
          src={src}
          alt={`${name || sym} logo`}
          className={`company-logo-img ${status === 'loaded' ? 'is-loaded' : ''} ${lowRes ? 'is-low-res' : ''}`.trim()}
          onLoad={(event) => settle(event.currentTarget)}
          onError={() => setStatus('failed')}
          loading="lazy"
          decoding="async"
          draggable="false"
        />
      )}
    </div>
  );
};

export default CompanyLogo;
