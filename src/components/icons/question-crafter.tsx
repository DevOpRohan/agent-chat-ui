export function QuestionCrafterLogoSVG({
  className,
  width,
  height,
}: {
  width?: number;
  height?: number;
  className?: string;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="4"
        y="4"
        width="72"
        height="72"
        rx="18"
        fill="#0B3D46"
      />
      <rect
        x="10"
        y="10"
        width="60"
        height="60"
        rx="14"
        fill="#106372"
      />
      <path
        d="M25 20H55C61.0751 20 66 24.9249 66 31V45C66 51.0751 61.0751 56 55 56H41.8L30 65L33.3 56H25C18.9249 56 14 51.0751 14 45V31C14 24.9249 18.9249 20 25 20Z"
        fill="#ECFEFF"
      />
      <circle
        cx="41"
        cy="38"
        r="10"
        stroke="#106372"
        strokeWidth="4.5"
      />
      <path
        d="M47.5 44.5L54 51"
        stroke="#106372"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M58 16L60.2 21.8L66 24L60.2 26.2L58 32L55.8 26.2L50 24L55.8 21.8L58 16Z"
        fill="#F59E0B"
      />
    </svg>
  );
}
