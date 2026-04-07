/**
 * StoreveuLogo — matches the exact SVG brand files (600×200 viewBox, 3:1 ratio).
 *
 * Props:
 *   height      {number}  rendered height in px; width scales 3:1 automatically. Default 40.
 *   darkMode    {boolean} true = light text / dark icon bg; false = dark text / light icon bg. Default false.
 *   showTagline {boolean} show "POINT OF SALE" tagline below wordmark. Default false.
 *   iconOnly    {boolean} render only the blue sprout icon square (200×200). Default false.
 */
import React from 'react';

export default function StoreveuLogo({
  height      = 40,
  darkMode    = false,
  showTagline = false,
  iconOnly    = false,
}) {

  /* ── Icon-only: 200×200 blue square (from storeveu_icon.svg) ─────────── */
  if (iconOnly) {
    return (
      <svg
        width={height}
        height={height}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block', flexShrink: 0 }}
      >
        <rect width="200" height="200" rx="46" fill="#3d56b5" />
        <line x1="100" y1="158" x2="100" y2="82"
          stroke="#ffffff" strokeWidth="8" strokeLinecap="round" />
        <path d="M100 126 C100 126 62 110 54 86 C46 62 68 48 88 68 C94 76 100 90 100 90"
          fill="#ffffff" opacity="0.7" />
        <path d="M100 110 C100 110 138 92 146 68 C154 44 132 30 112 50 C106 58 100 72 100 72"
          fill="#ffffff" />
        <circle cx="80"  cy="167" r="5.5" fill="#ffffff" opacity="0.35" />
        <circle cx="100" cy="171" r="5.5" fill="#ffffff" opacity="0.35" />
        <circle cx="120" cy="167" r="5.5" fill="#ffffff" opacity="0.35" />
      </svg>
    );
  }

  /* ── Horizontal logo: 600×200 viewBox (3:1) — no background rect ─────── */
  // Extend viewBox height to 230 when tagline is shown (tagline baseline at y=155).
  const vbW = 600;
  const vbH = showTagline ? 230 : 200;
  const width = Math.round(height * (vbW / vbH));

  // Exact colours from storeveu_logo_dark.svg / storeveu_logo_light.svg
  const iconBg   = darkMode ? '#1a1f38' : '#eaecf5';
  const stem     = darkMode ? '#7b95e0' : '#3d56b5';
  const leafAlt  = darkMode ? '#a0b4ea' : '#3d56b5';
  const storeClr = darkMode ? '#e8eaf6' : '#1a1f38';
  const vueClr   = darkMode ? '#7b95e0' : '#3d56b5';
  const tagClr   = darkMode ? '#232b4a' : '#b0b8cc';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${vbW} ${vbH}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* Icon square — exact coords from brand file */}
      <rect x="40" y="40" width="100" height="100" rx="24" fill={iconBg} />

      {/* Stem */}
      <line x1="90" y1="128" x2="90" y2="68"
        stroke={stem} strokeWidth="4" strokeLinecap="round" />

      {/* Left leaf */}
      <path
        d="M90 100 C90 100 64 90 58 72 C52 54 68 44 80 58 C84 64 90 74 90 74"
        fill={stem} opacity="0.65"
      />

      {/* Right leaf */}
      <path
        d="M90 90 C90 90 116 78 122 60 C128 42 112 32 100 46 C96 52 90 62 90 62"
        fill={leafAlt}
      />

      {/* Soil dots */}
      <circle cx="76"  cy="134" r="3.5" fill={stem} opacity="0.35" />
      <circle cx="90"  cy="137" r="3.5" fill={stem} opacity="0.35" />
      <circle cx="104" cy="134" r="3.5" fill={stem} opacity="0.35" />

      {/* "store" wordmark */}
      <text
        x="162" y="118"
        fontFamily="'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontWeight="400"
        fontSize="84"
        letterSpacing="0"
        fill={storeClr}
      >store</text>
      {/* "vue" wordmark — italic */}
      <text
        x="394" y="118"
        fontFamily="'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontWeight="400"
        fontStyle="italic"
        fontSize="84"
        letterSpacing="0"
        fill={vueClr}
      >veu</text>

      {/* Optional tagline */}
      {showTagline && (
        <text
          x="163" y="155"
          fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
          fontWeight="300"
          fontSize="13"
          letterSpacing="6"
          fill={tagClr}
        >one piece</text>
      )}
    </svg>
  );
}
