"use client";

import { useState, useRef, useEffect } from "react";
import { Bank, ActiveLoan } from "../game/types";
import { playDoubleClickSound, playClickSound } from "@/app/utils/sounds";

interface BankWindowProps {
  isVisible: boolean;
  onClose: () => void;
  banks: Bank[];
  activeLoans: ActiveLoan[];
  currentMoney: number;
  onTakeLoan: (bankId: string) => void;
  onPayLoan: (bankId: string) => void;
}

// Format currency
function formatCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  return `${sign}$${absValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function BankWindow({
  isVisible,
  onClose,
  banks,
  activeLoans,
  currentMoney,
  onTakeLoan,
  onPayLoan,
}: BankWindowProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const windowRef = useRef<HTMLDivElement>(null);

  // Reset position when window opens
  useEffect(() => {
    if (isVisible) {
      setPosition({ x: 0, y: 0 });
    }
  }, [isVisible]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent closing the window
    if (windowRef.current) {
      const rect = windowRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
      });
      setIsDragging(true);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - window.innerWidth / 2 - dragOffset.x,
          y: e.clientY - window.innerHeight / 2 - dragOffset.y,
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  if (!isVisible) return null;

  const GRAY_COLORS = {
    bg: "#B0B0B0",
    bgActive: "#909090",
    borderLight: "#D0D0D0",
    borderDark: "#707070",
    shadow: "#505050",
  };

  const getActiveLoan = (bankId: string): ActiveLoan | undefined => {
    return activeLoans.find((loan) => loan.bankId === bankId);
  };

  const canTakeLoan = (bank: Bank): boolean => {
    return !getActiveLoan(bank.id);
  };

  const canPayLoan = (bank: Bank): boolean => {
    const loan = getActiveLoan(bank.id);
    if (!loan) return false;
    return currentMoney >= loan.remainingBalance;
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        ref={windowRef}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        style={{
          background: GRAY_COLORS.bg,
          border: "3px solid",
          borderColor: `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`,
          boxShadow: `inset 2px 2px 0px ${GRAY_COLORS.shadow}, 4px 4px 0px rgba(0,0,0,0.3)`,
          padding: "20px",
          minWidth: 500,
          transform: `translate(${position.x}px, ${position.y}px)`,
          maxWidth: 700,
          maxHeight: "80vh",
          overflowY: "auto",
          position: "relative",
        }}
      >
        {/* Title */}
        <div
          onMouseDown={handleMouseDown}
          style={{
            fontSize: 24,
            fontWeight: "bold",
            fontFamily: "var(--font-pixelify), monospace",
            marginBottom: 20,
            textAlign: "center",
            color: "#000",
            textShadow: "1px 1px 0 rgba(255,255,255,0.5)",
            cursor: isDragging ? "grabbing" : "grab",
            userSelect: "none",
          }}
        >
          🏦 BANK LOANS
        </div>

        {/* Current Money Display */}
        <div
          style={{
            background: "#000",
            border: "2px solid",
            borderColor: `${GRAY_COLORS.shadow} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderDark} ${GRAY_COLORS.shadow}`,
            padding: "10px",
            marginBottom: 20,
            textAlign: "center",
          }}
        >
          <div
            style={{
              color: currentMoney < 0 ? "#ff4444" : "#00ff00",
              fontSize: 20,
              fontWeight: "bold",
              fontFamily: "var(--font-pixelify), monospace",
            }}
          >
            Balance: {formatCurrency(currentMoney)}
          </div>
        </div>

        {/* Bank List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {banks.map((bank) => {
            const loan = getActiveLoan(bank.id);
            const hasActiveLoan = !!loan;
            const monthlyPayment = loan
              ? loan.remainingBalance * loan.interestRate
              : bank.loanAmount * bank.interestRate;

            return (
              <div
                key={bank.id}
                style={{
                  background: hasActiveLoan ? "#3a3a3a" : GRAY_COLORS.bgActive,
                  border: "2px solid",
                  borderColor: `${GRAY_COLORS.borderDark} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderLight} ${GRAY_COLORS.borderDark}`,
                  padding: "15px",
                  boxShadow: `inset 1px 1px 0px ${GRAY_COLORS.shadow}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: "bold",
                        fontFamily: "var(--font-pixelify), monospace",
                        color: "#fff",
                        marginBottom: 5,
                      }}
                    >
                      {bank.name}
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontFamily: "var(--font-pixelify), monospace",
                        color: "#ccc",
                      }}
                    >
                      Loan Amount: {formatCurrency(bank.loanAmount)}
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontFamily: "var(--font-pixelify), monospace",
                        color: "#ccc",
                      }}
                    >
                      Interest Rate: {(bank.interestRate * 100).toFixed(1)}% per month
                    </div>
                    {hasActiveLoan && (
                      <>
                        <div
                          style={{
                            fontSize: 14,
                            fontFamily: "var(--font-pixelify), monospace",
                            color: "#ffaa00",
                            marginTop: 5,
                          }}
                        >
                          Remaining: {formatCurrency(loan.remainingBalance)}
                        </div>
                        <div
                          style={{
                            fontSize: 14,
                            fontFamily: "var(--font-pixelify), monospace",
                            color: "#ffaa00",
                          }}
                        >
                          Monthly Payment: {formatCurrency(monthlyPayment)}
                        </div>
                        {loan.monthsInDefault > 0 && (
                          <div
                            style={{
                              fontSize: 14,
                              fontFamily: "var(--font-pixelify), monospace",
                              color: "#ff4444",
                              marginTop: 5,
                            }}
                          >
                            ⚠️ {loan.monthsInDefault} month(s) in default
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {!hasActiveLoan ? (
                      <button
                        onClick={() => {
                          onTakeLoan(bank.id);
                          playDoubleClickSound();
                        }}
                        style={{
                          background: "#6CA6E8",
                          border: "2px solid",
                          borderColor: "#A3CDF9 #366BA8 #366BA8 #A3CDF9",
                          padding: "8px 16px",
                          cursor: "pointer",
                          fontFamily: "var(--font-pixelify), monospace",
                          fontSize: 14,
                          fontWeight: "bold",
                          color: "#fff",
                          boxShadow: "1px 1px 0px #244B7A",
                          imageRendering: "pixelated",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.filter = "brightness(1.1)")
                        }
                        onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
                        onMouseDown={(e) => {
                          e.currentTarget.style.filter = "brightness(0.9)";
                          e.currentTarget.style.borderColor =
                            "#366BA8 #A3CDF9 #A3CDF9 #366BA8";
                          e.currentTarget.style.transform = "translate(1px, 1px)";
                          e.currentTarget.style.boxShadow = "inset 1px 1px 0px #244B7A";
                        }}
                        onMouseUp={(e) => {
                          e.currentTarget.style.filter = "brightness(1.1)";
                          e.currentTarget.style.borderColor =
                            "#A3CDF9 #366BA8 #366BA8 #A3CDF9";
                          e.currentTarget.style.transform = "none";
                          e.currentTarget.style.boxShadow = "1px 1px 0px #244B7A";
                        }}
                      >
                        TAKE LOAN
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (canPayLoan(bank)) {
                            onPayLoan(bank.id);
                            playDoubleClickSound();
                          } else {
                            playClickSound();
                          }
                        }}
                        disabled={!canPayLoan(bank)}
                        style={{
                          background: canPayLoan(bank) ? "#4a8a4a" : "#5a5a5a",
                          border: "2px solid",
                          borderColor: canPayLoan(bank)
                            ? "#6ca66c #2a5a2a #2a5a2a #6ca66c"
                            : "#7a7a7a #4a4a4a #4a4a4a #7a7a7a",
                          padding: "8px 16px",
                          cursor: canPayLoan(bank) ? "pointer" : "not-allowed",
                          fontFamily: "var(--font-pixelify), monospace",
                          fontSize: 14,
                          fontWeight: "bold",
                          color: canPayLoan(bank) ? "#fff" : "#888",
                          boxShadow: canPayLoan(bank)
                            ? "1px 1px 0px #1a3a1a"
                            : "1px 1px 0px #3a3a3a",
                          imageRendering: "pixelated",
                          opacity: canPayLoan(bank) ? 1 : 0.6,
                        }}
                        onMouseEnter={(e) => {
                          if (canPayLoan(bank)) {
                            e.currentTarget.style.filter = "brightness(1.1)";
                          }
                        }}
                        onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
                        onMouseDown={(e) => {
                          if (canPayLoan(bank)) {
                            e.currentTarget.style.filter = "brightness(0.9)";
                            e.currentTarget.style.borderColor =
                              "#2a5a2a #6ca66c #6ca66c #2a5a2a";
                            e.currentTarget.style.transform = "translate(1px, 1px)";
                            e.currentTarget.style.boxShadow = "inset 1px 1px 0px #1a3a1a";
                          }
                        }}
                        onMouseUp={(e) => {
                          if (canPayLoan(bank)) {
                            e.currentTarget.style.filter = "brightness(1.1)";
                            e.currentTarget.style.borderColor =
                              "#6ca66c #2a5a2a #2a5a2a #6ca66c";
                            e.currentTarget.style.transform = "none";
                            e.currentTarget.style.boxShadow = "1px 1px 0px #1a3a1a";
                          }
                        }}
                      >
                        PAY OFF
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Close button */}
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <button
            onClick={() => {
              onClose();
              playDoubleClickSound();
            }}
            style={{
              background: "#6b2a2a",
              border: "2px solid",
              borderColor: "#ab6a6a #4a1a1a #4a1a1a #ab6a6a",
              padding: "10px 20px",
              cursor: "pointer",
              fontFamily: "var(--font-pixelify), monospace",
              fontSize: 16,
              fontWeight: "bold",
              color: "#fff",
              boxShadow: "1px 1px 0px #2a0a0a",
              imageRendering: "pixelated",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.1)")}
            onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
            onMouseDown={(e) => {
              e.currentTarget.style.filter = "brightness(0.9)";
              e.currentTarget.style.borderColor = "#4a1a1a #ab6a6a #ab6a6a #4a1a1a";
              e.currentTarget.style.transform = "translate(1px, 1px)";
              e.currentTarget.style.boxShadow = "inset 1px 1px 0px #2a0a0a";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.filter = "brightness(1.1)";
              e.currentTarget.style.borderColor = "#ab6a6a #4a1a1a #4a1a1a #ab6a6a";
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "1px 1px 0px #2a0a0a";
            }}
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
