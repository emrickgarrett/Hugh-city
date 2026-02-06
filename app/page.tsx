"use client";

import { useState } from "react";
import GameBoard from "./components/game/GameBoard";
import MainMenu from "./components/ui/MainMenu";
import { GameSaveData } from "./components/game/types";

interface GameConfig {
  cityName: string;
  saveData?: GameSaveData;
}

export default function Home() {
  const [appState, setAppState] = useState<"menu" | "game">("menu");
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);

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
    />
  );
}
