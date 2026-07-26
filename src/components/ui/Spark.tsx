import { cn } from './cn';

export interface SparkProps {
  /** Series, oldest → newest. Fewer than two points renders nothing. */
  values: number[];
  width?: number;
  height?: number;
  /** Stroke colour class. Defaults to brass — sparks are chrome, not data. */
  className?: string;
  /** Fill the area under the line at very low alpha. */
  area?: boolean;
  /** Mark the final point. */
  head?: boolean;
  /** Accessible summary. Without it the spark is hidden from assistive tech. */
  label?: string;
}

/**
 * A ten-pixel-tall line. No axes, no grid, no tooltip — it exists to say
 * "rising" or "falling" at a glance and nothing more.
 */
export function Spark({
  values,
  width = 48,
  height = 12,
  className,
  area = false,
  head = false,
  label,
}: SparkProps) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 1;
  const innerH = height - pad * 2;

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y] as const;
  });

  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const last = pts[pts.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className={cn('overflow-visible text-brass', className)}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {area && (
        <path
          d={`${d} L${width} ${height} L0 ${height} Z`}
          fill="currentColor"
          opacity={0.1}
        />
      )}
      <path
        d={d}
        stroke="currentColor"
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {head && last && <circle cx={last[0]} cy={last[1]} r={1.4} fill="currentColor" />}
    </svg>
  );
}
