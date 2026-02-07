"use client";

import { useState, useEffect, useCallback } from "react";
import GameBoard from "./components/game/GameBoard";
import MainMenu from "./components/ui/MainMenu";
import { GameSaveData } from "./components/game/types";
import { setSfxVolume } from "./utils/sounds";

interface GameConfig {
  cityName: string;
  saveData?: GameSaveData;
}

export interface VolumeSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
}

const SETTINGS_KEY = "hugh-city_settings";

function loadVolumeSettings(): VolumeSettings {
  if (typeof window === "undefined") return { masterVolume: 1, sfxVolume: 1, musicVolume: 1 };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        masterVolume: typeof parsed.masterVolume === "number" ? parsed.masterVolume : 1,
        sfxVolume: typeof parsed.sfxVolume === "number" ? parsed.sfxVolume : 1,
        musicVolume: typeof parsed.musicVolume === "number" ? parsed.musicVolume : 1,
      };
    }
  } catch {
    // ignore parse errors
  }
  return { masterVolume: 1, sfxVolume: 1, musicVolume: 1 };
}

export default function Home() {
  const [appState, setAppState] = useState<"menu" | "game">("menu");
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
  const [volumeSettings, setVolumeSettings] = useState<VolumeSettings>(loadVolumeSettings);

  // Sync SFX volume module variable and persist to localStorage whenever settings change
  useEffect(() => {
    setSfxVolume(volumeSettings.masterVolume * volumeSettings.sfxVolume);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(volumeSettings));
  }, [volumeSettings]);

  // Individual volume change handlers
  const handleMasterVolumeChange = useCallback((v: number) => {
    setVolumeSettings((prev) => ({ ...prev, masterVolume: v }));
  }, []);

  const handleSfxVolumeChange = useCallback((v: number) => {
    setVolumeSettings((prev) => ({ ...prev, sfxVolume: v }));
  }, []);

  const handleMusicVolumeChange = useCallback((v: number) => {
    setVolumeSettings((prev) => ({ ...prev, musicVolume: v }));
  }, []);

  // Compute effective music volume for MusicPlayer
  const effectiveMusicVolume = volumeSettings.masterVolume * volumeSettings.musicVolume;

  if (appState === "menu") {
    return (
      <MainMenu
        onNewGame={(cityName) => {
          setGameConfig({ cityName });
          setAppState("game");
        }}
        onLoadGame={(saveData, saveName) => {
          const cityName = saveData.cityName ?? saveName;
          setGameConfig({ cityName, saveData });
          setAppState("game");
        }}
        masterVolume={volumeSettings.masterVolume}
        sfxVolume={volumeSettings.sfxVolume}
        musicVolume={volumeSettings.musicVolume}
        onMasterVolumeChange={handleMasterVolumeChange}
        onSfxVolumeChange={handleSfxVolumeChange}
        onMusicVolumeChange={handleMusicVolumeChange}
      />
    );
  }

  return (
    <GameBoard
      key={gameConfig!.cityName}
      cityName={gameConfig!.cityName}
      initialSaveData={gameConfig?.saveData}
      onReturnToMenu={() => {
        setAppState("menu");
        setGameConfig(null);
      }}
      masterVolume={volumeSettings.masterVolume}
      sfxVolume={volumeSettings.sfxVolume}
      musicVolume={volumeSettings.musicVolume}
      effectiveMusicVolume={effectiveMusicVolume}
      onMasterVolumeChange={handleMasterVolumeChange}
      onSfxVolumeChange={handleSfxVolumeChange}
      onMusicVolumeChange={handleMusicVolumeChange}
    />
  );
}
