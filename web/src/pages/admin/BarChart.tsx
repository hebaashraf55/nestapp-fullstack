import { useState } from 'react';

export interface Bar {
  key: string;
  label: string;
  value: number;
}

/**
 * One series of bars over time: thin bars with rounded tops anchored to the baseline, a 2px gap
 * between bars, a recessive axis, and a tooltip on hover or keyboard focus. A table of the same
 * numbers is always offered next to it.
 */
export function BarChart({ bars, title, format }: { bars: Bar[]; title: string; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const height = 180;
  const pad = { top: 12, right: 8, bottom: 22, left: 8 };
  const max = Math.max(1, ...bars.map((b) => b.value));
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / Math.max(1, bars.length);
  const barW = Math.max(2, Math.min(28, slot - 2));
  const every = Math.ceil(bars.length / 8);
  const current = hover !== null ? bars[hover] : null;

  return (
    <figure className="chart">
      <figcaption className="chart__title">
        {title}
        <span className="chart__max muted small"> · highest {format(max === 1 && bars.every((b) => b.value === 0) ? 0 : max)}</span>
      </figcaption>
      <div className="chart__plot">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}, ${bars.length} days`} preserveAspectRatio="none">
          <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className="chart__axis" />
          {bars.map((b, i) => {
            const h = b.value > 0 ? Math.max(2, (b.value / max) * plotH) : 0;
            const x = pad.left + i * slot + (slot - barW) / 2;
            const y = height - pad.bottom - h;
            const r = Math.min(4, barW / 2, h);
            return (
              <g key={b.key}>
                {h > 0 && (
                  <path
                    className="chart__bar"
                    data-active={hover === i}
                    d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                  />
                )}
                {/* Hit target taller and wider than the bar, for mouse and keyboard */}
                <rect
                  x={pad.left + i * slot}
                  y={pad.top}
                  width={slot}
                  height={plotH}
                  className="chart__hit"
                  tabIndex={0}
                  aria-label={`${b.label}: ${format(b.value)}`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
                {i % every === 0 && (
                  <text x={pad.left + i * slot + slot / 2} y={height - 6} className="chart__tick" textAnchor="middle">
                    {b.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {current && (
          <div className="chart__tip" role="status" style={{ left: `${((hover! + 0.5) / bars.length) * 100}%` }}>
            <strong>{format(current.value)}</strong>
            <span>{current.label}</span>
          </div>
        )}
      </div>
    </figure>
  );
}
