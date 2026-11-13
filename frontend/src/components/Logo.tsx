import { useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * Translately mark: two overlapping speech bubbles, one text in two
 * languages ("A" and "文"). The back bubble uses `currentColor`, so the logo
 * stays visible in dark mode; the letter and the gap around the front bubble
 * are cut out of it, so it works on any background. Same drawing as
 * `public/favicon.svg`.
 */
export function Logo({ className }: { className?: string }) {
  const maskId = useId()
  return (
    <svg
      viewBox="0 0 144 112"
      className={cn('text-foreground', className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="144"
          height="112"
        >
          <rect width="144" height="112" fill="#FFFFFF" />
          <path
            d="M 21 54 L 34 24 L 47 54 M 26 44 H 42"
            fill="none"
            stroke="#000000"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <g
            fill="#000000"
            stroke="#000000"
            strokeWidth="10"
            strokeLinejoin="round"
          >
            <rect x="58" y="36" width="78" height="54" rx="18" />
            <path d="M 104 88 L 124 106 L 120 84 Z" />
          </g>
        </mask>
      </defs>
      <g fill="currentColor" mask={`url(#${maskId})`}>
        <rect x="8" y="8" width="80" height="58" rx="18" />
        <path d="M 22 60 L 18 84 L 44 64 Z" />
      </g>
      <g fill="#00C94F">
        <rect x="58" y="36" width="78" height="54" rx="18" />
        <path d="M 104 88 L 124 106 L 120 84 Z" />
      </g>
      <path
        d="M 80 54 H 114 M 97 47 V 54 M 84 78 Q 102 72 107 55 M 110 78 Q 95 73 88 61"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
