"use client";

interface MoneyDisplayProps {
  money: number;
}

// Format currency with retro styling
function formatCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  return `${sign}$${absValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function MoneyDisplay({ money }: MoneyDisplayProps) {
  const GRAY_COLORS = {
    bg: "#5a5a5a",
    borderLight: "#7a7a7a",
    borderDark: "#3a3a3a",
    shadow: "#2a2a2a",
  };

  const isNegative = money < 0;

  return (
    <div
      style={{
        background: GRAY_COLORS.bg,
        border: "2px solid",
        borderColor: `${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight}`,
        borderTopWidth: 0,
        padding: "8px 12px",
        minWidth: 140,
        height: 48,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: `1px 1px 0px ${GRAY_COLORS.shadow}`,
        borderRight: "none", // Connect to music player
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Inner inset panel */}
      <div
        style={{
          width: "100%",
          height: "100%",
          padding: "4px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000000",
          border: "1px solid",
          borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
        }}
      >
        <div
          style={{
            color: isNegative ? "#ff4444" : "#00ff00", // Red if negative, green if positive
            fontSize: 18,
            fontWeight: "700",
            fontFamily: "var(--font-pixelify), monospace",
            textShadow: "2px 2px 0 rgba(0, 0, 0, 0.9)",
            letterSpacing: "1px",
          }}
        >
          {formatCurrency(money)}
        </div>
      </div>
    </div>
  );
}
