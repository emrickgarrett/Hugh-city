// Unlock tier definitions for building progression
// Buildings not listed here are always available

export interface UnlockRequirement {
  population: number; // Housed citizens needed (OR with revenue)
  revenue: number; // Daily revenue needed (OR with population)
  tier: number;
  tierName: string;
}

export const UNLOCK_TIERS: Record<
  number,
  { population: number; revenue: number; name: string }
> = {
  1: { population: 5, revenue: 500, name: "Small Town" },
  2: { population: 15, revenue: 2000, name: "Growing City" },
  3: { population: 30, revenue: 5000, name: "Thriving Metropolis" },
  4: { population: 50, revenue: 15000, name: "Major City" },
  5: { population: 80, revenue: 50000, name: "Megalopolis" },
};

function tier(t: number): UnlockRequirement {
  const def = UNLOCK_TIERS[t];
  return {
    population: def.population,
    revenue: def.revenue,
    tier: t,
    tierName: def.name,
  };
}

// Map building IDs to their unlock tier
// Buildings NOT in this map are always available
export const BUILDING_UNLOCK_REQUIREMENTS: Record<string, UnlockRequirement> = {
  // Tier 1 — Small Town (5 pop OR $500/day)
  "row-houses": tier(1),
  "80s-apartment": tier(1),
  "leafy-apartments": tier(1),
  "romanesque-townhouse": tier(1),
  "full-house": tier(1),
  "blue-painted-lady": tier(1),
  "martini-bar": tier(1),
  "bookstore": tier(1),
  "hp-house": tier(1),

  // Tier 2 — Growing City (15 pop OR $2,000/day)
  "sf-green-apartments": tier(2),
  "sf-yellow-painted-lady": tier(2),
  "sf-blue-duplex": tier(2),
  "romanesque-duplex": tier(2),
  "limestone-duplex": tier(2),
  "general-intelligence-office": tier(2),
  "palo-alto-office-center": tier(2),
  "private-school": tier(2),
  "carnegie-mansion": tier(2),

  // Tier 3 — Thriving Metropolis (30 pop OR $5,000/day)
  "alternate-brownstone": tier(3),
  "sf-duplex": tier(3),
  "sf-green-victorian-apartments": tier(3),
  "sf-yellow-victorian-apartments": tier(3),
  "medium-apartments": tier(3),
  "magicpath-office": tier(3),
  "ease-health": tier(3),
  "church": tier(3),
  "internet-archive": tier(3),

  // Tier 4 — Major City (50 pop OR $15,000/day)
  "modern-terra-condos": tier(4),
  "gothic-apartments": tier(4),
  "large-apartments-20s": tier(4),
  "palo-alto-wide-office": tier(4),
  "schwab-mansion": tier(4),
  "mushroom-kingdom-castle": tier(4),

  // Tier 5 — Megalopolis (80 pop OR $50,000/day)
  "large-apartments-60s": tier(5),
  "the-dakota": tier(5),
};

// Check if a building is unlocked given current stats
export function isBuildingUnlocked(
  buildingId: string,
  housedPopulation: number,
  dailyRevenue: number,
  unlockedIds: Set<string>
): boolean {
  if (unlockedIds.has(buildingId)) return true;

  const req = BUILDING_UNLOCK_REQUIREMENTS[buildingId];
  if (!req) return true; // No requirement = always available

  return housedPopulation >= req.population || dailyRevenue >= req.revenue;
}

// Get the unlock requirement for a building (null if always available)
export function getUnlockRequirement(
  buildingId: string
): UnlockRequirement | null {
  return BUILDING_UNLOCK_REQUIREMENTS[buildingId] ?? null;
}

// Get all newly unlocked buildings given current stats
export function getNewlyUnlockedBuildings(
  housedPopulation: number,
  dailyRevenue: number,
  previouslyUnlocked: Set<string>
): string[] {
  const newlyUnlocked: string[] = [];
  for (const [buildingId, req] of Object.entries(BUILDING_UNLOCK_REQUIREMENTS)) {
    if (previouslyUnlocked.has(buildingId)) continue;
    if (housedPopulation >= req.population || dailyRevenue >= req.revenue) {
      newlyUnlocked.push(buildingId);
    }
  }
  return newlyUnlocked;
}
