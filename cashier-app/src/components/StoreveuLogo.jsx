/**
 * StoreveuLogo — official brand logo component.
 * Uses the exact paths from the Storeveu SVG brand files.
 *
 * Props:
 *   height     {number}  rendered height in px (width scales proportionally). Default 40.
 *   darkMode   {boolean} true = white wordmark on dark bg, false = dark wordmark on light bg. Default true.
 *   showTagline {boolean} show "POINT OF SALE" tagline. Default false.
 *   iconOnly   {boolean} render only the icon square, no wordmark. Default false.
 */
import React from 'react';

export default function StoreveuLogo({ height = 40, darkMode = true, showTagline = false, iconOnly = false }) {
  if (iconOnly) {
    const size = height;
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" rx="23" fill={darkMode ? '#1a1f38' : '#eaecf5'} />
        {/* stem */}
        <line x1="50" y1="79" x2="50" y2="44" stroke={darkMode ? '#7b95e0' : '#3d56b5'} strokeWidth="4" strokeLinecap="round" />
        {/* left leaf */}
        <path d="M50 63 C50 63 32 56 28 44 C24 32 34 26 42 34 C45 38 50 46 50 46" fill={darkMode ? '#7b95e0' : '#3d56b5'} opacity={darkMode ? 0.65 : 0.65} />
        {/* right leaf */}
        <path d="M50 56 C50 56 68 48 72 36 C76 24 66 18 58 26 C55 30 50 38 50 38" fill={darkMode ? '#a0b4ea' : '#3d56b5'} />
        {/* soil dots */}
        <circle cx="41" cy="83" r="3" fill={darkMode ? '#7b95e0' : '#3d56b5'} opacity="0.35" />
        <circle cx="50" cy="86" r="3" fill={darkMode ? '#7b95e0' : '#3d56b5'} opacity="0.35" />
        <circle cx="59" cy="83" r="3" fill={darkMode ? '#7b95e0' : '#3d56b5'} opacity="0.35" />
      </svg>
    );
  }

  // Horizontal logo — viewBox 560 × (showTagline ? 160 : 130)
  const vbH = showTagline ? 160 : 130;
  const width = Math.round(height * 560 / vbH);
  const storeColor = darkMode ? '#e8eaf6' : '#1a1f38';
  const vueColor  = darkMode ? '#7b95e0' : '#3d56b5';
  const iconBg    = darkMode ? '#1a1f38' : '#eaecf5';
  const stemColor = darkMode ? '#7b95e0' : '#3d56b5';
  const leafR     = darkMode ? '#a0b4ea' : '#3d56b5';
  const tagColor  = darkMode ? '#4a5580' : '#b0b8cc';

  return (
    <svg width={width} height={height} viewBox={`0 0 560 ${vbH}`} fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      {/* Icon square */}
      <rect x="0" y="20" width="100" height="100" rx="24" fill={iconBg} />
      {/* stem */}
      <line x1="50" y1="108" x2="50" y2="48" stroke={stemColor} strokeWidth="4" strokeLinecap="round" />
      {/* left leaf */}
      <path d="M50 80 C50 80 24 70 18 52 C12 34 28 24 40 38 C44 44 50 54 50 54" fill={stemColor} opacity="0.65" />
      {/* right leaf */}
      <path d="M50 70 C50 70 76 58 82 40 C88 22 72 12 60 26 C56 32 50 42 50 42" fill={leafR} />
      {/* soil dots */}
      <circle cx="36" cy="114" r="3.5" fill={stemColor} opacity="0.35" />
      <circle cx="50" cy="117" r="3.5" fill={stemColor} opacity="0.35" />
      <circle cx="64" cy="114" r="3.5" fill={stemColor} opacity="0.35" />

      {/* Wordmark */}
      <text
        x="120" y="100"
        fontFamily="'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontWeight="300"
        fontSize="80"
        letterSpacing="-3"
        fill={storeColor}
      >store</text>
      <text
        x="382" y="100"
        fontFamily="'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontWeight="300"
        fontStyle="italic"
        fontSize="80"
        letterSpacing="-3"
        fill={vueColor}
      >vue</text>

      {/* Tagline */}
      {showTagline && (
        <text
          x="121" y="135"
          fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
          fontWeight="300"
          fontSize="14"
          letterSpacing="6"
          fill={tagColor}
        >POINT  OF  SALE</text>
      )}
    </svg>
  );
}
