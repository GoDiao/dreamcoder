export function DreamCoderIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="dc-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-surface-container-lowest)" />
          <stop offset="100%" stopColor="var(--color-surface)" />
        </linearGradient>
        <linearGradient id="dc-main" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-primary-fixed-dim)" />
          <stop offset="100%" stopColor="var(--color-primary-container)" />
        </linearGradient>
        <linearGradient id="dc-sparkle" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-primary-fixed)" />
          <stop offset="100%" stopColor="var(--color-primary)" />
        </linearGradient>
        <filter id="dc-shadow" x="-5%" y="-5%" width="110%" height="115%">
          <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="var(--color-primary)" floodOpacity="0.15" />
        </filter>
        <filter id="dc-glow">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Background */}
      <rect width="512" height="512" rx="112" fill="url(#dc-bg)" />
      <rect x="6" y="6" width="500" height="500" rx="108" fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeOpacity="0.18" />

      {/* Terminal chevron */}
      <g filter="url(#dc-shadow)">
        <polyline
          points="168,174 296,256 168,338"
          fill="none"
          stroke="url(#dc-main)"
          strokeWidth="52"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Cursor bar */}
      <rect x="296" y="318" width="88" height="36" rx="18" fill="url(#dc-main)" opacity="0.85" />

      {/* Large sparkle */}
      <g filter="url(#dc-glow)" transform="translate(358, 148)">
        <ellipse rx="9" ry="38" fill="url(#dc-sparkle)" opacity="0.95" />
        <ellipse rx="38" ry="9" fill="url(#dc-sparkle)" opacity="0.95" />
        <ellipse rx="6" ry="26" fill="url(#dc-sparkle)" opacity="0.7" transform="rotate(45)" />
        <ellipse rx="6" ry="26" fill="url(#dc-sparkle)" opacity="0.7" transform="rotate(-45)" />
      </g>

      {/* Small sparkle */}
      <g filter="url(#dc-glow)" transform="translate(400, 310)" opacity="0.55">
        <ellipse rx="5" ry="20" fill="var(--color-primary)" />
        <ellipse rx="20" ry="5" fill="var(--color-primary)" />
        <ellipse rx="3.5" ry="14" fill="var(--color-primary)" transform="rotate(45)" />
        <ellipse rx="3.5" ry="14" fill="var(--color-primary)" transform="rotate(-45)" />
      </g>

      {/* Dot accents */}
      <circle cx="148" cy="152" r="10" fill="var(--color-primary-fixed)" opacity="0.5" />
      <circle cx="130" cy="172" r="5.5" fill="var(--color-primary-fixed-dim)" opacity="0.35" />
      <circle cx="200" cy="390" r="7" fill="var(--color-primary-fixed)" opacity="0.4" />
      <circle cx="178" cy="375" r="4" fill="var(--color-primary-fixed-dim)" opacity="0.3" />

      {/* Outer stroke */}
      <rect width="512" height="512" rx="112" fill="none" stroke="var(--color-primary-fixed)" strokeWidth="3" />
    </svg>
  )
}
