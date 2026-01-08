"use client";

import { getBuilding, getBuildingEconomics } from "@/app/data/buildings";

export interface BuildingStats {
  buildingId: string;
  originX: number;
  originY: number;
  residents: string[]; // Character IDs
  totalRevenue: number;
  monthlyRevenue: number;
  interactionsThisMonth: number;
}

interface BuildingInfoWindowProps {
  isVisible: boolean;
  onClose: () => void;
  buildingStats: BuildingStats | null;
  characterNames: Map<string, string>; // Map of character ID to name
}

// Helper to format currency
const formatCurrency = (amount: number): string => {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  return `${isNegative ? "-" : ""}$${absAmount.toLocaleString()}`;
};

export default function BuildingInfoWindow({
  isVisible,
  onClose,
  buildingStats,
  characterNames,
}: BuildingInfoWindowProps) {
  if (!isVisible || !buildingStats) return null;

  const building = getBuilding(buildingStats.buildingId);
  if (!building) return null;

  const economics = getBuildingEconomics(building);
  const isResidential = building.category === "residential";

  return (
    <div
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        minWidth: 320,
        maxWidth: 400,
        backgroundColor: "#c0c0c0",
        border: "2px solid",
        borderColor: "#ffffff #808080 #808080 #ffffff",
        boxShadow: "4px 4px 0 rgba(0,0,0,0.5)",
        fontFamily: '"MS Sans Serif", "Segoe UI", Tahoma, sans-serif',
        fontSize: 12,
      }}
    >
      {/* Title Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 4px",
          background: "linear-gradient(90deg, #000080, #1084d0)",
          color: "white",
          fontWeight: "bold",
          fontSize: 12,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          🏢 {building.name}
        </span>
        <button
          onClick={onClose}
          style={{
            width: 16,
            height: 14,
            backgroundColor: "#c0c0c0",
            border: "1px solid",
            borderColor: "#ffffff #808080 #808080 #ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: "bold",
            padding: 0,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: 12 }}>
        {/* Building Info */}
        <div
          style={{
            marginBottom: 12,
            padding: 8,
            backgroundColor: "#ffffff",
            border: "1px solid #808080",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: 4 }}>
            {building.category.charAt(0).toUpperCase() + building.category.slice(1)}
          </div>
          <div style={{ fontSize: 11, color: "#444" }}>
            Location: ({buildingStats.originX}, {buildingStats.originY})
          </div>
        </div>

        {/* Residential Info */}
        {isResidential && (
          <div
            style={{
              marginBottom: 12,
              padding: 8,
              backgroundColor: "#ffffff",
              border: "1px solid #808080",
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: 8, borderBottom: "1px solid #ccc", paddingBottom: 4 }}>
              🏠 Occupancy: {buildingStats.residents.length} / {economics.maxResidents || "?"}
            </div>
            {buildingStats.residents.length > 0 ? (
              <div style={{ maxHeight: 100, overflowY: "auto" }}>
                {buildingStats.residents.map((residentId, index) => (
                  <div
                    key={residentId}
                    style={{
                      padding: "2px 4px",
                      backgroundColor: index % 2 === 0 ? "#f0f0f0" : "#ffffff",
                      fontSize: 11,
                    }}
                  >
                    👤 {characterNames.get(residentId) || `Citizen ${residentId.slice(0, 6)}`}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "#888", fontStyle: "italic", fontSize: 11 }}>
                No residents yet
              </div>
            )}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #ccc" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span>Rent per Resident:</span>
                <span style={{ color: "#008000", fontWeight: "bold" }}>
                  {formatCurrency(economics.rentPerResident || 0)}/mo
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 4 }}>
                <span>Monthly Rent Income:</span>
                <span style={{ color: "#008000", fontWeight: "bold" }}>
                  {formatCurrency((economics.rentPerResident || 0) * buildingStats.residents.length)}/mo
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Business Info */}
        {!isResidential && (
          <div
            style={{
              marginBottom: 12,
              padding: 8,
              backgroundColor: "#ffffff",
              border: "1px solid #808080",
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: 8, borderBottom: "1px solid #ccc", paddingBottom: 4 }}>
              💼 Business Activity
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
              <span>Income per Visit:</span>
              <span style={{ color: "#008000", fontWeight: "bold" }}>
                {formatCurrency(economics.incomePerInteraction || 0)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
              <span>Visits This Month:</span>
              <span style={{ fontWeight: "bold" }}>
                {buildingStats.interactionsThisMonth}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
              <span>Revenue This Month:</span>
              <span style={{ color: "#008000", fontWeight: "bold" }}>
                {formatCurrency(buildingStats.monthlyRevenue)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid #ccc",
              }}
            >
              <span>Total Revenue (All Time):</span>
              <span style={{ color: "#006400", fontWeight: "bold" }}>
                {formatCurrency(buildingStats.totalRevenue)}
              </span>
            </div>
          </div>
        )}

        {/* Operating Costs */}
        <div
          style={{
            padding: 8,
            backgroundColor: "#fff8dc",
            border: "1px solid #daa520",
            fontSize: 11,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Monthly Operating Cost:</span>
            <span style={{ color: "#cc0000", fontWeight: "bold" }}>
              {formatCurrency(economics.monthlyOperatingCost)}
            </span>
          </div>
        </div>
      </div>

      {/* Close Button */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid #808080",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <button
          onClick={onClose}
          style={{
            padding: "4px 24px",
            backgroundColor: "#c0c0c0",
            border: "2px solid",
            borderColor: "#ffffff #808080 #808080 #ffffff",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
