import React from 'react';

export default function StoreveuLogo({ height = 36, darkMode = true }) {
  const textColor = darkMode ? '#ffffff' : '#1a1f2e';
  return (
    <svg
      height={height}
      viewBox="0 0 160 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      {/* Store icon mark */}
      <rect x="0" y="8" width="24" height="24" rx="6" fill="#7ac143" />
      <path d="M5 16h14M5 20h10M5 24h12" stroke="white" strokeWidth="2" strokeLinecap="round" />
      {/* Wordmark */}
      <text
        x="30"
        y="28"
        fontFamily="'Outfit', 'Inter', system-ui, sans-serif"
        fontWeight="800"
        fontSize="22"
        letterSpacing="-0.5"
        fill={textColor}
      >
        Store
      </text>
      <text
        x="94"
        y="28"
        fontFamily="'Outfit', 'Inter', system-ui, sans-serif"
        fontWeight="800"
        fontSize="22"
        letterSpacing="-0.5"
        fill="#7ac143"
      >
        veu
      </text>
    </svg>
  );
}
