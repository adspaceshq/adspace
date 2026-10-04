'use client';

type LogoProps = {
  size?: number;
  className?: string;
  label?: string;
};

/**
 * Adspaces mark: white extra-bold "a" bleeding off the right and bottom
 * edges of a black square. Pure #000 is faithful to the source artwork
 * (deliberately not the #020817 ink token).
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
        y="78"
        textAnchor="middle"
        fontFamily="Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontWeight={800}
        fontSize="66"
        fill="#fff"
      >
        a
      </text>
    </svg>
  );
}
