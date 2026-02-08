"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { playClickSound, playDoubleClickSound } from "@/app/utils/sounds";
import { GameSaveData } from "@/app/components/game/types";
import LoadWindow from "./LoadWindow";
import AchievementsWindow from "./AchievementsWindow";
import SettingsWindow from "./SettingsWindow";

interface MainMenuProps {
  onNewGame: (cityName: string) => void;
  onLoadGame: (saveData: GameSaveData, saveName: string) => void;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  onMasterVolumeChange: (v: number) => void;
  onSfxVolumeChange: (v: number) => void;
  onMusicVolumeChange: (v: number) => void;
}

type MenuView = "main" | "newGame" | "credits";

export default function MainMenu({
  onNewGame,
  onLoadGame,
  masterVolume,
  sfxVolume,
  musicVolume,
  onMasterVolumeChange,
  onSfxVolumeChange,
  onMusicVolumeChange,
}: MainMenuProps) {
  const [view, setView] = useState<MenuView>("main");
  const [cityName, setCityName] = useState("");
  const [nameError, setNameError] = useState("");
  const [isLoadWindowVisible, setIsLoadWindowVisible] = useState(false);
  const [isAchievementsVisible, setIsAchievementsVisible] = useState(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when entering new game view
  useEffect(() => {
    if (view === "newGame" && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [view]);

  const handleStartGame = useCallback(() => {
    const trimmed = cityName.trim();
    if (!trimmed) {
      setNameError("Please enter a city name.");
      return;
    }
    // Check if a save with this name already exists
    const existingKey = `hugh-city_save_${trimmed}`;
    if (localStorage.getItem(existingKey)) {
      setNameError(`A city named "${trimmed}" already exists. Choose another name or load it.`);
      return;
    }
    playDoubleClickSound();
    onNewGame(trimmed);
  }, [cityName, onNewGame]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleStartGame();
      } else if (e.key === "Escape") {
        setView("main");
        setCityName("");
        setNameError("");
      }
    },
    [handleStartGame]
  );

  const handleLoadGame = useCallback(
    (saveData: GameSaveData, saveName: string) => {
      setIsLoadWindowVisible(false);
      onLoadGame(saveData, saveName);
    },
    [onLoadGame]
  );

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#4a5d6a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      {/* Main menu frame */}
      <div
        className="rct-frame"
        style={{
          width: 420,
          maxWidth: "90vw",
          userSelect: "none",
        }}
      >
        {/* Title bar */}
        <div
          className="rct-titlebar"
          style={{ justifyContent: "center", cursor: "default" }}
        >
          <span>Hugh-City</span>
        </div>

        {/* Content panel */}
        <div
          className="rct-panel"
          style={{
            padding: "24px 32px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          {view === "main" && (
            <>
              {/* Title */}
              <div
                style={{
                  fontSize: 48,
                  fontFamily: "var(--font-jersey), monospace",
                  color: "var(--rct-text)",
                  textShadow: "2px 2px 0 var(--rct-panel-dark)",
                  marginBottom: 4,
                  textAlign: "center",
                  lineHeight: 1,
                }}
              >
                Hugh-City
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontFamily: "var(--font-pixelify), monospace",
                  color: "var(--rct-text)",
                  opacity: 0.7,
                  marginBottom: 12,
                  textAlign: "center",
                }}
              >
                A Retro City Builder
              </div>

              {/* Menu buttons */}
              <MenuButton
                label="New Game"
                onClick={() => {
                  playClickSound();
                  setView("newGame");
                }}
              />
              <MenuButton
                label="Load Game"
                onClick={() => {
                  playClickSound();
                  setIsLoadWindowVisible(true);
                }}
              />
              <MenuButton
                label="Achievements"
                onClick={() => {
                  playClickSound();
                  setIsAchievementsVisible(true);
                }}
              />
              <MenuButton
                label="Settings"
                onClick={() => {
                  playClickSound();
                  setIsSettingsVisible(true);
                }}
              />
              <MenuButton
                label="Credits"
                onClick={() => {
                  playClickSound();
                  setView("credits");
                }}
              />
            </>
          )}

          {view === "newGame" && (
            <>
              <div
                style={{
                  fontSize: 28,
                  fontFamily: "var(--font-jersey), monospace",
                  color: "var(--rct-text)",
                  textShadow: "1px 1px 0 var(--rct-panel-dark)",
                  marginBottom: 4,
                }}
              >
                Name Your City
              </div>
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={cityName}
                  onChange={(e) => {
                    setCityName(e.target.value);
                    setNameError("");
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter city name..."
                  maxLength={30}
                  className="rct-inset"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    fontSize: 18,
                    fontFamily: "var(--font-jersey), Arial, sans-serif",
                    color: "var(--rct-text-light)",
                    background: "var(--rct-panel-dark)",
                    border: "2px solid",
                    borderColor:
                      "var(--rct-panel-dark) var(--rct-panel-light) var(--rct-panel-light) var(--rct-panel-dark)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                {nameError && (
                  <div
                    style={{
                      color: "#cc3333",
                      fontSize: 13,
                      fontFamily: "var(--font-pixelify), monospace",
                    }}
                  >
                    {nameError}
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  width: "100%",
                  justifyContent: "center",
                  marginTop: 8,
                }}
              >
                <MenuButton
                  label="Back"
                  onClick={() => {
                    playClickSound();
                    setView("main");
                    setCityName("");
                    setNameError("");
                  }}
                  width={140}
                />
                <MenuButton
                  label="Start Game"
                  onClick={handleStartGame}
                  width={140}
                />
              </div>
            </>
          )}

          {view === "credits" && (
            <>
              <div
                style={{
                  fontSize: 28,
                  fontFamily: "var(--font-jersey), monospace",
                  color: "var(--rct-text)",
                  textShadow: "1px 1px 0 var(--rct-panel-dark)",
                  marginBottom: 8,
                }}
              >
                Credits
              </div>
              <div
                className="rct-inset"
                style={{
                  width: "100%",
                  padding: "16px 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  fontSize: 15,
                  fontFamily: "var(--font-pixelify), monospace",
                  color: "var(--rct-text-light)",
                  lineHeight: 1.5,
                }}
              >
                <div style={{ textAlign: "center", fontSize: 20, fontFamily: "var(--font-jersey), monospace" }}>
                  Hugh-City
                </div>
                <div style={{ textAlign: "center", opacity: 0.7 }}>
                  A Retro City Builder
                </div>
                <hr style={{ border: "none", borderTop: "1px solid var(--rct-panel-mid)", margin: "4px 0" }} />
                <div><strong>Built with:</strong> Next.js, React, Phaser 3, Tailwind CSS</div>
                <div><strong>Fonts:</strong> Jersey 10, Pixelify Sans</div>
                <div><strong>Engine & Art:</strong> <a href="https://x.com/ghosttyped" target="_blank" rel="noopener noreferrer" style={{ color: "var(--rct-text)", textDecoration: "underline" }}>@ghosttyped</a></div>
                <div><strong>AI Assistant:</strong> Claude by Anthropic</div>
                <hr style={{ border: "none", borderTop: "1px solid var(--rct-panel-mid)", margin: "4px 0" }} />
                <div style={{ textAlign: "center", opacity: 0.5, fontSize: 12 }}>
                  Inspired by RollerCoaster Tycoon & SimCity
                </div>
              </div>
              <MenuButton
                label="Back"
                onClick={() => {
                  playClickSound();
                  setView("main");
                }}
                width={140}
              />
            </>
          )}
        </div>
      </div>

      {/* Load Window overlay */}
      <LoadWindow
        isVisible={isLoadWindowVisible}
        onClose={() => setIsLoadWindowVisible(false)}
        onLoad={handleLoadGame}
      />

      {/* Settings Window overlay */}
      <SettingsWindow
        isVisible={isSettingsVisible}
        onClose={() => setIsSettingsVisible(false)}
        masterVolume={masterVolume}
        sfxVolume={sfxVolume}
        musicVolume={musicVolume}
        onMasterVolumeChange={onMasterVolumeChange}
        onSfxVolumeChange={onSfxVolumeChange}
        onMusicVolumeChange={onMusicVolumeChange}
      />

      {/* Achievements Window overlay */}
      <AchievementsWindow
        isVisible={isAchievementsVisible}
        onClose={() => setIsAchievementsVisible(false)}
        progress={{
          housedCitizens: 0,
          dailyRevenue: 0,
          totalBuildingsPlaced: 0,
          totalDemolitions: 0,
          homelessLeft: 0,
          carCount: 0,
          midnightWitnessed: false,
          tracksPlayedCount: 0,
        }}
      />
    </div>
  );
}

// Reusable menu button (defined outside to avoid remounting)
function MenuButton({
  label,
  onClick,
  width = 240,
}: {
  label: string;
  onClick: () => void;
  width?: number;
}) {
  return (
    <button
      className="rct-button"
      onClick={onClick}
      style={{
        width,
        padding: "10px 16px",
        fontSize: 22,
        fontFamily: "var(--font-jersey), monospace",
        cursor: "pointer",
        textAlign: "center",
        display: "block",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.filter = "brightness(1.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = "none";
      }}
    >
      {label}
    </button>
  );
}
