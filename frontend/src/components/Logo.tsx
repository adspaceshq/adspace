'use client';

type LogoProps = {
  size?: number;
  className?: string;
  label?: string;
};

/**
 * Adspaces mark: white extra-bold "a" bleeding off the right and bottom
 * edges of a black square. Keep these coordinates aligned with public/logo.svg
 * so the header and browser icon render the same artwork.
 */
export default function Logo({ size = 32, className, label = 'Adspaces home' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={label}
      className={className}
    >
      <rect width="64" height="64" fill="#000" />
      <text
        x="50"
        y="65"
        textAnchor="middle"
        fontFamily="Arial Black, Inter, 'Helvetica Neue', Arial, sans-serif"
        fontWeight={900}
        fontSize="66"
        fill="#fff"
      >
        a
      </text>
    </svg>
  );
}
