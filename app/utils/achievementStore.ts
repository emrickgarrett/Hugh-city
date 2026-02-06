const STORAGE_KEY = "hugh-city_achievements";

export interface UnlockedAchievement {
  id: string;
  unlockedAt: number; // Date.now() timestamp
  saveName: string; // Current save file name at time of unlock
}

export interface AchievementProgress {
  totalBuildingsPlaced: number;
  totalDemolitions: number;
  homelessLeft: number;
  tracksPlayed: string[]; // ["chill_0", "jazz_3", ...]
  midnightWitnessed: boolean;
}

export interface AchievementStoreData {
  unlockedAchievements: Record<string, UnlockedAchievement>;
  progress?: AchievementProgress;
}

export function loadAchievements(): AchievementStoreData {
  if (typeof window === "undefined") {
    return { unlockedAchievements: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn("Failed to load achievements:", e);
  }
  return { unlockedAchievements: {} };
}

export function saveAchievements(data: AchievementStoreData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to save achievements:", e);
  }
}

/**
 * Unlock an achievement. Returns the UnlockedAchievement if newly unlocked,
 * or null if it was already unlocked.
 */
export function unlockAchievement(
  id: string,
  saveName: string
): UnlockedAchievement | null {
  const data = loadAchievements();
  if (data.unlockedAchievements[id]) {
    return null; // Already unlocked
  }
  const unlock: UnlockedAchievement = {
    id,
    unlockedAt: Date.now(),
    saveName,
  };
  data.unlockedAchievements[id] = unlock;
  saveAchievements(data);
  return unlock;
}

export function isUnlocked(id: string): boolean {
  const data = loadAchievements();
  return !!data.unlockedAchievements[id];
}

export function saveProgress(progress: AchievementProgress): void {
  const data = loadAchievements();
  data.progress = progress;
  saveAchievements(data);
}

export function loadProgress(): AchievementProgress | null {
  const data = loadAchievements();
  return data.progress ?? null;
}
