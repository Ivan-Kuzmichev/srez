import { encode } from 'uqr';

/**
 * QR code drawn as one SVG path in theme colors: light modules on the text color, dark on the page
 * background, so scanners see the usual dark-on-light pattern.
 */
export function QrCode({ value, size = 148, label }: { value: string; size?: number; label: string }) {
  const { data, size: n } = encode(value, { ecc: 'M', border: 2 });
  let path = '';
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      className="shrink-0 rounded-control"
    >
      <rect width={n} height={n} className="fill-text" />
      <path d={path} className="fill-bg" />
    </svg>
  );
}
