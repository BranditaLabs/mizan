/**
 * Icons that point somewhere (arrows, chevrons, "back") mirror in right-to-left pages
 * (docs/08 §3). Logos, checkmarks and media controls never use this.
 */
export function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" className={`rtl:-scale-x-100 ${className}`}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
