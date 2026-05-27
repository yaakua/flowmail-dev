export function BrandMark({ className = "brand-mark-icon" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path
        className="brand-mark-frame"
        d="M15 15.5C15 11.9 17.9 9 21.5 9h27.8C52.4 9 55 11.6 55 14.7v28.8C55 47.1 52.1 50 48.5 50H20.7C17.6 50 15 47.4 15 44.3V15.5Z"
      />
      <path
        className="brand-mark-fold"
        d="M22 21h25.8c1.2 0 1.7 1.5.8 2.3L35.2 35.1a5 5 0 0 1-6.5 0L19.4 27c-.9-.8-.3-2.3.8-2.3H47"
      />
      <path className="brand-mark-ledger" d="M21.5 39.5h18.8M21.5 45.5h12.2" />
      <path className="brand-mark-route" d="M43 38.5h7.5c2.5 0 4.5-2 4.5-4.5v-5.5" />
      <circle className="brand-mark-signal" cx="55" cy="26" r="3.2" />
    </svg>
  );
}
