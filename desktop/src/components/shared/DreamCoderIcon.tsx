/**
 * DreamCoder mark: a prompt-shaped crescent moon and a star as the cursor,
 * white on a brand-coloured tile. The tile follows the theme's brand colour;
 * the same artwork is in desktop/electron/build/app-icon.svg for the app icons.
 */
export function DreamCoderIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="14.4" fill="var(--color-brand)" />
      <g transform="translate(7.1 7.1) scale(0.778)" fill="#FFFAF4">
        <g transform="translate(1 -3)">
          <path
            d="M12 14 L29 32 L12 50 A40 40 0 0 0 12 14 Z"
            stroke="#FFFAF4"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M45 28 Q45 42 59 42 Q45 42 45 56 Q45 42 31 42 Q45 42 45 28 Z" />
        </g>
      </g>
    </svg>
  )
}
