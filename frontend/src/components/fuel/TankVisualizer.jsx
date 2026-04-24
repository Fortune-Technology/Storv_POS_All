/**
 * TankVisualizer.jsx — horizontal cylindrical fuel tank visualization.
 *
 * Design notes:
 *   - SVG viewBox shows a side-profile of a horizontal cylinder. Fuel fills
 *     the bottom portion and the fill height is computed from the circular
 *     cross-section so the on-screen level matches physical reality
 *     (a horizontal cylinder at 50% capacity has fuel at exactly half-height
 *     only because the chord math works out that way — we do the actual
 *     inverse to map volume% → height% correctly).
 *
 *   - Continuous shimmer: a sine-wave surface animated via CSS keyframes
 *     draws across the top of the fuel. Subtle, always on, matches user's
 *     preference for "continuous shimmer + steady level side panel."
 *
 *   - Side panel: steady numeric readout (current gal, capacity, fill %,
 *     variance vs. last stick reading if present). No pulse or animation —
 *     just clean digits, so the shimmer reads as "surface" and the numbers
 *     as "level."
 *
 *   - Delivery flash: a brief 1.5s green glow fades in/out when the
 *     `justFilled` prop is true (set by parent after a new delivery is
 *     recorded). Purely additive on top of the continuous shimmer.
 *
 *   - Sale drain: same pattern but amber glow for 1.5s when `justDrained`.
 */

import React, { useMemo } from 'react';
import './TankVisualizer.css';

// Map volume% → height% for a horizontal cylinder's circular cross-section.
// This is the inverse of the chord-area formula:
//   area(h) = r² × acos((r - h) / r) − (r - h) × √(2rh − h²)
// We want h given fraction of area. Newton-Raphson over [0, 2r].
function volPctToHeightPct(volPct) {
  const v = Math.max(0, Math.min(1, volPct / 100));
  if (v === 0) return 0;
  if (v === 1) return 100;
  // Circle area = π. We're looking for the chord height h ∈ [0, 2] where the
  // segment area below h equals v × π. Normalised: r = 1.
  const target = v * Math.PI;
  // Binary search — stable, 40 iterations is more than enough
  let lo = 0, hi = 2;
  for (let i = 0; i < 40; i++) {
    const h = (lo + hi) / 2;
    const area = Math.acos(1 - h) - (1 - h) * Math.sqrt(2 * h - h * h);
    if (area < target) lo = h; else hi = h;
  }
  return ((lo + hi) / 2) * 50; // h ∈ [0, 2] → percent of diameter [0, 100]
}

export default function TankVisualizer({
  label,
  fuelTypeName,
  fuelColor,
  currentGal,
  capacityGal,
  variancePct,
  justFilled = false,
  justDrained = false,
  width,    // default set by CSS (.tv-root expands to container); this prop overrides
  height,
}) {
  const fillPct = capacityGal > 0 ? (currentGal / capacityGal) * 100 : 0;
  const heightPct = useMemo(() => volPctToHeightPct(fillPct), [fillPct]);

  // SVG layout — cylinder occupies the full viewBox minus a small margin
  const W = 400, H = 200;
  const padX = 30, padY = 24;
  const cylW = W - padX * 2;
  const cylH = H - padY * 2;
  const rx = 18; // end-cap roundness

  // Fuel rectangle — grows from bottom
  const fuelH = (cylH * heightPct) / 100;
  const fuelY = H - padY - fuelH;

  // Surface wave path — sine riding on top of the fuel
  const surfaceY = fuelY;
  const wavePath = useMemo(() => {
    const points = [];
    const segments = 32;
    for (let i = 0; i <= segments; i++) {
      const x = padX + (cylW * i) / segments;
      points.push(`${x},${surfaceY}`);
    }
    return points.join(' ');
  }, [cylW, surfaceY, padX]);

  const accent = fuelColor || '#3b82f6';
  // SVG IDs must be URL-safe — strip anything that's not alphanumeric so
  // labels like "Tank A - Regular 87 (A1) ★" don't break the gradient ref.
  const idSafe = useMemo(
    () => (label || 'tank').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) || 'tank',
    [label],
  );

  // Low-level warning threshold: < 20%
  const lowLevel = fillPct < 20;

  return (
    <div className={'tv-root' + (justFilled ? ' tv-root--filling' : '') + (justDrained ? ' tv-root--draining' : '')}
         style={width ? { width, maxWidth: '100%' } : undefined}>
      <div className="tv-header">
        <div className="tv-label">{label}</div>
        {fuelTypeName && (
          <div className="tv-fueltype" style={{ background: accent + '22', color: accent }}>
            {fuelTypeName}
          </div>
        )}
      </div>

      <div className="tv-svg-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="tv-svg"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Defs — gradient for fuel, wave clip */}
          <defs>
            <linearGradient id={`tv-grad-${idSafe}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={accent} stopOpacity="0.9" />
              <stop offset="100%" stopColor={accent} stopOpacity="0.6" />
            </linearGradient>
            <clipPath id={`tv-clip-${idSafe}`}>
              <rect x={padX} y={padY} width={cylW} height={cylH} rx={rx} ry={rx} />
            </clipPath>
          </defs>

          {/* Tank body outline */}
          <rect
            x={padX} y={padY}
            width={cylW} height={cylH}
            rx={rx} ry={rx}
            className="tv-body"
          />

          {/* Fuel fill — clipped to the cylinder */}
          <g clipPath={`url(#tv-clip-${idSafe})`}>
            <rect
              x={padX}
              y={fuelY}
              width={cylW}
              height={fuelH}
              fill={`url(#tv-grad-${idSafe})`}
              className="tv-fuel"
            />
            {/* Continuous wave — CSS animates its transform. Height of 8px
                gives a subtle ripple that reads as surface motion without
                being distracting. */}
            {fillPct > 0.5 && fillPct < 99.5 && (
              <g className="tv-wave-group" style={{ '--tv-base-y': surfaceY }}>
                <path
                  d={`M ${padX} ${surfaceY} Q ${padX + cylW * 0.25} ${surfaceY - 5}, ${padX + cylW * 0.5} ${surfaceY} T ${padX + cylW} ${surfaceY} L ${padX + cylW} ${surfaceY + 14} L ${padX} ${surfaceY + 14} Z`}
                  fill={accent}
                  opacity="0.35"
                  className="tv-wave-1"
                />
                <path
                  d={`M ${padX} ${surfaceY} Q ${padX + cylW * 0.33} ${surfaceY - 3}, ${padX + cylW * 0.66} ${surfaceY} T ${padX + cylW} ${surfaceY} L ${padX + cylW} ${surfaceY + 10} L ${padX} ${surfaceY + 10} Z`}
                  fill="#ffffff"
                  opacity="0.18"
                  className="tv-wave-2"
                />
              </g>
            )}
          </g>

          {/* Tank outline on top (sits above the fuel) */}
          <rect
            x={padX} y={padY}
            width={cylW} height={cylH}
            rx={rx} ry={rx}
            fill="none"
            stroke="rgba(100,116,139,0.55)"
            strokeWidth="2"
          />

          {/* Fill gauge marks — 25 / 50 / 75 / 100% on right side */}
          {[100, 75, 50, 25].map(p => {
            const y = H - padY - (cylH * p) / 100;
            return (
              <g key={p}>
                <line
                  x1={W - padX - 6} y1={y}
                  x2={W - padX}     y2={y}
                  stroke="rgba(100,116,139,0.55)"
                  strokeWidth="1"
                />
                <text
                  x={W - padX - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="tv-gauge-text"
                >
                  {p}%
                </text>
              </g>
            );
          })}
        </svg>

        {/* Cadence side panel — steady numbers, no animation */}
        <div className="tv-panel">
          <div className="tv-panel-row">
            <div className="tv-panel-label">CURRENT</div>
            <div className="tv-panel-value" style={{ color: accent }}>
              {Number(currentGal || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
              <span className="tv-panel-unit"> gal</span>
            </div>
          </div>
          <div className="tv-panel-row">
            <div className="tv-panel-label">CAPACITY</div>
            <div className="tv-panel-value tv-panel-value--small">
              {Number(capacityGal || 0).toLocaleString()}
              <span className="tv-panel-unit"> gal</span>
            </div>
          </div>
          <div className="tv-panel-row">
            <div className="tv-panel-label">FILL</div>
            <div className={'tv-panel-value tv-panel-value--small' + (lowLevel ? ' tv-panel-value--low' : '')}>
              {fillPct.toFixed(1)}<span className="tv-panel-unit">%</span>
            </div>
          </div>
          {variancePct != null && (
            <div className="tv-panel-row">
              <div className="tv-panel-label">VARIANCE</div>
              <div className={'tv-panel-value tv-panel-value--small ' + (Math.abs(variancePct) > 2 ? 'tv-panel-value--warn' : 'tv-panel-value--ok')}>
                {variancePct >= 0 ? '+' : ''}{Number(variancePct).toFixed(2)}<span className="tv-panel-unit">%</span>
              </div>
            </div>
          )}
          {lowLevel && (
            <div className="tv-panel-alert">⚠ Low level — reorder soon</div>
          )}
        </div>
      </div>
    </div>
  );
}
