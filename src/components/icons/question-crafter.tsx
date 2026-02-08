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
      viewBox="0 0 1040 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="qc_ink"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop
            offset="0%"
            stopColor="#1b2240"
          />
          <stop
            offset="100%"
            stopColor="#0f1324"
          />
        </linearGradient>
      </defs>

      <g fill="url(#qc_ink)">
        <rect
          x="151"
          y="448"
          width="60"
          height="52"
          rx="0"
        />
        <circle
          cx="97"
          cy="474"
          r="60"
        />
        <rect
          x="783"
          y="448"
          width="53"
          height="52"
          rx="0"
        />
        <circle
          cx="896"
          cy="474"
          r="60"
        />
      </g>

      <rect
        x="211"
        y="48"
        width="572"
        height="851"
        rx="120"
        fill="url(#qc_ink)"
      />
      <rect
        x="262"
        y="99"
        width="470"
        height="749"
        rx="70"
        fill="#ffffff"
      />

      <rect
        x="324"
        y="231"
        width="347"
        height="34"
        rx="17"
        fill="#9CA2AE"
      />
      <rect
        x="323"
        y="326"
        width="209"
        height="35"
        rx="17"
        fill="#9CA2AE"
      />

      <path
        d="M532.84,560.53 L461.60,560.53 L461.60,550.86
       Q461.60,534.69 468.11,522.19
       Q474.61,509.62 495.52,490.23
       L508.15,478.80
       Q519.39,468.57 524.63,459.47
       Q529.87,450.38 529.87,441.28
       Q529.87,427.52 520.40,419.75
       Q510.93,411.92 493.94,411.92
       Q477.96,411.92 459.39,418.55
       Q440.82,425.12 420.74,438.13
       L420.74,376.17
       Q444.61,367.89 464.32,363.98
       Q484.08,360.00 502.40,360.00
       Q550.59,360.00 575.85,379.64
       Q601.12,399.28 601.12,436.99
       Q601.12,456.32 593.41,471.60
       Q585.71,486.88 567.14,504.44
       L554.51,515.75
       Q541.12,527.94 536.95,535.39
       Q532.84,542.78 532.84,551.62
       L532.84,560.53 Z"
        fill="url(#qc_ink)"
      />

      <circle
        cx="497"
        cy="690"
        r="44"
        fill="url(#qc_ink)"
      />

      <g transform="translate(528 659) rotate(-42)">
        <path
          d="M60,-40 H210
         A40,40 0 0 1 250,0
         A40,40 0 0 1 210,40
         H60 L0,0 Z"
          fill="url(#qc_ink)"
        />
        <rect
          x="96"
          y="-22"
          width="120"
          height="44"
          fill="#B67B3C"
        />
        <polygon
          points="8,0 60,-32 60,32"
          fill="#F6D562"
        />
      </g>
    </svg>
  );
}
