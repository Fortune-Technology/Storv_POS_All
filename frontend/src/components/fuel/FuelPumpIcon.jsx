/**
 * FuelPumpIcon — physical gas-pump dispenser shape with the pump number
 * overlaid inside the display window. Shared by the portal Pumps tab
 * (preview thumbnails) and the cashier-app FuelModal pump picker.
 *
 * SVG viewBox: 0 0 100 140. Scales cleanly to any size.
 *
 * Props:
 *   pumpNumber    — number to show on the display screen
 *   label         — optional text under the pump (shown only when showLabel)
 *   color         — accent hex (default brand green)
 *   size          — px size of the icon (default 96)
 *   showLabel     — whether to render the label text below the pump
 *   selected      — highlight state (thicker border + glow)
 *   disabled      — muted appearance
 */

import React from 'react';
import './FuelPumpIcon.css';

export default function FuelPumpIcon({
  pumpNumber,
  label,
  color = '#16a34a',
  size = 96,
  showLabel = false,
  selected = false,
  disabled = false,
}) {
  // "Out of service" variant: dashed body + gray accent
  const accent = disabled ? '#94a3b8' : color;

  return (
    <div
      className={
        'fpi-wrap' +
        (selected ? ' fpi-wrap--selected' : '') +
        (disabled ? ' fpi-wrap--disabled' : '')
      }
      style={{
        '--fpi-accent': accent,
        '--fpi-size':   `${size}px`,
      }}
    >
      <svg
        viewBox="0 0 100 140"
        className="fpi-svg"
        aria-label={`Pump ${pumpNumber}${label ? ' — ' + label : ''}`}
      >
        {/* Nozzle hose arc (right side) */}
        <path
          d="M 82 55 Q 96 55 96 70 L 96 112 Q 96 124 84 124 L 78 124"
          fill="none"
          stroke={accent}
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.8"
        />
        {/* Nozzle handle (top right) */}
        <rect x="75" y="42" width="10" height="16" rx="2" fill={accent} opacity="0.9" />

        {/* Main pump body */}
        <rect
          x="12"
          y="10"
          width="66"
          height="115"
          rx="8"
          ry="8"
          fill="#ffffff"
          stroke={accent}
          strokeWidth="3"
        />

        {/* Display screen (where the pump number lives) */}
        <rect
          x="20"
          y="22"
          width="50"
          height="36"
          rx="4"
          fill={accent}
          opacity="0.12"
          stroke={accent}
          strokeWidth="1.5"
        />
        <text
          x="45"
          y="50"
          textAnchor="middle"
          fontSize="26"
          fontWeight="900"
          fill={accent}
          fontFamily="system-ui, sans-serif"
        >
          {pumpNumber != null ? String(pumpNumber) : '?'}
        </text>

        {/* Button panel (3 small rectangles below screen) */}
        <rect x="20" y="64" width="50" height="4" rx="1" fill="#e2e8f0" />
        <rect x="20" y="72" width="50" height="4" rx="1" fill="#e2e8f0" />
        <rect x="20" y="80" width="50" height="4" rx="1" fill="#e2e8f0" />

        {/* Brand-colour strip near bottom */}
        <rect x="12" y="104" width="66" height="6" fill={accent} opacity="0.85" />

        {/* Base platform */}
        <rect x="6" y="125" width="78" height="8" rx="2" fill="#475569" />
      </svg>
      {showLabel && (
        <div className="fpi-label">
          <div className="fpi-pump-num">Pump {pumpNumber}</div>
          {label && <div className="fpi-pump-label">{label}</div>}
        </div>
      )}
    </div>
  );
}
