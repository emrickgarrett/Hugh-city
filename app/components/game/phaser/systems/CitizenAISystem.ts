import {
  TileType,
  Direction,
  GRID_WIDTH,
  GRID_HEIGHT,
  GameSpeed,
  GameTime,
  CharacterWithResidence,
  MoodletType,
  GridCell,
  MOOD_SPEED_MULTIPLIERS,
} from "../../types";
import { getBuilding, getBuildingFootprint, getBuildingEconomics } from "@/app/data/buildings";
import { directionVectors, oppositeDirection, allDirections } from "../utils/directions";
import { MIN_DAILY_BUDGET } from "../utils/constants";
import { PathfindingSystem } from "./PathfindingSystem";

/**
 * Context interface that provides the CitizenAISystem access to
 * scene-level state and callbacks without a direct MainScene dependency.
 */
export interface CitizenAIContext {
  grid: GridCell[][];
  gameSpeed: GameSpeed;
  currentGameTime: GameTime | null;
  buildingOccupancy: Map<string, string[]>;
  onBuildingInteraction?: (
    buildingId: string,
    buildingOriginX: number,
    buildingOriginY: number,
    interactionType: "income" | "move_in",
    characterId?: string
  ) => void;
  onCitizenSpend?: (citizenId: string, amount: number) => void;
}

/**
 * CitizenAISystem handles the citizen/character AI state machine,
 * building interactions, need calculations, moodlets, and lifecycle events.
 */
export class CitizenAISystem {
  private pathfinding: PathfindingSystem;

  constructor(pathfinding: PathfindingSystem) {
    this.pathfinding = pathfinding;
  }

  // ============================================
  // BUDGET & NEED CALCULATIONS
  // ============================================

  /**
   * Calculate how much money a citizen should reserve for other needs.
   * Uses actual building costs to ensure citizens can afford both food and entertainment.
   */
  calculateReservedMoney(
    char: CharacterWithResidence,
    forType: "food" | "entertainment",
    grid: GridCell[][]
  ): number {
    const framesSinceFood = ((char as any).framesSinceLastFood || 0);
    const needsFood = !char.ateToday || framesSinceFood >= 1200;
    const needsEntertainment = !char.entertainedToday;

    const { minFoodCost, minEntertainmentCost } = this.findCheapestOptions(char.x, char.y, grid);

    let reserved = 0;

    if (forType === "food") {
      if (needsEntertainment) {
        reserved = minEntertainmentCost;
      }
    } else if (forType === "entertainment") {
      if (needsFood) {
        reserved = minFoodCost;
      }
    }

    return reserved;
  }

  /**
   * Find the cheapest food and entertainment options available in the city.
   * Used for budget planning when citizens choose homes.
   */
  findCheapestOptions(charX: number, charY: number, grid: GridCell[][]): { minFoodCost: number; minEntertainmentCost: number } {
    let minFoodCost = 30;
    let minEntertainmentCost = 35;

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = grid[y][x];
        if (cell.type !== TileType.Building || !cell.buildingId || !cell.isOrigin) continue;

        const building = getBuilding(cell.buildingId);
        if (!building || building.category === "residential") continue;

        const economics = getBuildingEconomics(building);
        const cost = economics.incomePerInteraction;
        if (cost === undefined) continue;

        const buildingName = building.name.toLowerCase();
        const isFoodBusiness =
          buildingName.includes("dunkin") ||
          buildingName.includes("popeyes") ||
          buildingName.includes("checkers") ||
          buildingName.includes("martini") ||
          buildingName.includes("bar") ||
          buildingName.includes("restaurant") ||
          buildingName.includes("cafe") ||
          buildingName.includes("food");

        if (isFoodBusiness) {
          minFoodCost = Math.min(minFoodCost, cost);
        } else {
          minEntertainmentCost = Math.min(minEntertainmentCost, cost);
        }
      }
    }

    return { minFoodCost, minEntertainmentCost };
  }

  // ============================================
  // BUILDING INTERACTION
  // ============================================

  /**
   * Check if character is at a building and can interact.
   * Returns the updated character with new residence/cooldown if interaction occurred.
   */
  checkBuildingInteraction(char: CharacterWithResidence, ctx: CitizenAIContext): CharacterWithResidence {
    const charTileX = Math.floor(char.x);
    const charTileY = Math.floor(char.y);

    if (char.interactionCooldown && char.interactionCooldown > 0) {
      return char;
    }

    const MAX_INTERACTION_DISTANCE = 3;
    const checkedBuildings = new Set<string>();

    for (let dy = -MAX_INTERACTION_DISTANCE; dy <= MAX_INTERACTION_DISTANCE; dy++) {
      for (let dx = -MAX_INTERACTION_DISTANCE; dx <= MAX_INTERACTION_DISTANCE; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > MAX_INTERACTION_DISTANCE) continue;

        const checkX = charTileX + dx;
        const checkY = charTileY + dy;

        if (checkX < 0 || checkX >= GRID_WIDTH || checkY < 0 || checkY >= GRID_HEIGHT) {
          continue;
        }

        const cell = ctx.grid[checkY][checkX];
        if (cell.type !== TileType.Building) continue;

        let buildingId = cell.buildingId;
        let originX = cell.originX;
        let originY = cell.originY;

        if (!buildingId && originX !== undefined && originY !== undefined) {
          const originCell = ctx.grid[originY]?.[originX];
          if (originCell) {
            buildingId = originCell.buildingId;
          }
        }

        if (!buildingId && originX !== undefined && originY !== undefined) {
          const originCell = ctx.grid[originY]?.[originX];
          buildingId = originCell?.buildingId;
        }

        if (!buildingId) continue;

        if (originX === undefined) originX = checkX;
        if (originY === undefined) originY = checkY;

        const buildingKey = `${originX},${originY}`;

        if (checkedBuildings.has(buildingKey)) continue;
        checkedBuildings.add(buildingKey);

        const building = getBuilding(buildingId);
        if (!building) continue;

        const economics = getBuildingEconomics(building);

        // Check if citizen is arriving at their home (heading_home state)
        if (
          building.category === "residential" &&
          char.state === "heading_home" &&
          char.residenceX === originX &&
          char.residenceY === originY
        ) {
          if (char.brokeUntilNextDay) {
            return {
              ...char,
              state: "resting_at_home",
              currentDestination: undefined,
              interactionCooldown: 0,
            };
          } else {
            return {
              ...char,
              state: "wandering",
              currentDestination: undefined,
              interactionCooldown: 1000,
            };
          }
        }

        // Residential building: try to move in if no residence
        if (
          building.category === "residential" &&
          char.residenceX === undefined &&
          economics.maxResidents
        ) {
          const currentResidents = ctx.buildingOccupancy.get(buildingKey) || [];
          if (currentResidents.length < economics.maxResidents) {
            currentResidents.push(char.id);
            ctx.buildingOccupancy.set(buildingKey, currentResidents);
            ctx.onBuildingInteraction?.(
              buildingId,
              originX,
              originY,
              "move_in",
              char.id
            );
            return {
              ...char,
              residenceX: originX,
              residenceY: originY,
              interactionCooldown: 3000,
              state: "wandering",
              currentDestination: undefined,
              lastFailedBuildingKey: undefined,
              isTourist: false,
              willLeaveAtMonthEnd: false,
              homelessSince: undefined,
            };
          } else {
            if (char.currentDestination?.buildingOriginX === originX &&
                char.currentDestination?.buildingOriginY === originY) {
              return {
                ...char,
                interactionCooldown: 3000,
                state: "wandering",
                currentDestination: undefined,
                lastFailedBuildingKey: buildingKey,
              };
            }
          }
        }

        // Business/Civic/Landmark: generate income
        if (economics.incomePerInteraction && building.category !== "residential") {
          const cost = economics.incomePerInteraction;
          const citizenMoney = char.money ?? 0;

          const buildingName = building.name.toLowerCase();
          const isFoodBusiness = buildingName.includes("dunkin") ||
                                   buildingName.includes("popeyes") ||
                                   buildingName.includes("checkers") ||
                                   buildingName.includes("martini") ||
                                   buildingName.includes("bar") ||
                                   buildingName.includes("restaurant") ||
                                   buildingName.includes("cafe") ||
                                   buildingName.includes("food");

          const reservedMoney = this.calculateReservedMoney(
            char,
            isFoodBusiness ? "food" : "entertainment",
            ctx.grid
          );

          if (citizenMoney >= cost + reservedMoney) {
            ctx.onCitizenSpend?.(char.id, cost);
            ctx.onBuildingInteraction?.(
              buildingId,
              originX,
              originY,
              "income",
              char.id
            );

            const updatedNeeds: Partial<CharacterWithResidence> = {};
            if (isFoodBusiness) {
              updatedNeeds.ateToday = true;
              (updatedNeeds as any).framesSinceLastFood = 0;
            }
            if (!isFoodBusiness) {
              updatedNeeds.entertainedToday = true;
            }

            return {
              ...char,
              money: citizenMoney - cost,
              interactionCooldown: 5000,
              ...updatedNeeds,
            };
          }
          return {
            ...char,
            interactionCooldown: 3000,
            brokeUntilNextDay: true,
            state: "wandering",
            currentDestination: undefined,
          };
        }
      }
    }

    return char;
  }

  // ============================================
  // MOODLET CALCULATION
  // ============================================

  calculateMoodlet(char: CharacterWithResidence & { framesSinceLastFood?: number }): { moodlet: MoodletType; reason: string } {
    const hasHome = char.residenceX !== undefined && char.residenceY !== undefined;
    const citizenMoney = char.money ?? 0;
    const ateToday = char.ateToday ?? false;
    const entertainedToday = char.entertainedToday ?? false;

    const framesSinceFood = (char as any).framesSinceLastFood || (ateToday ? 0 : 1200);
    const hoursSinceFood = Math.floor((framesSinceFood / 3600) * 24);
    const needsFood = !ateToday || framesSinceFood >= 1200;

    if (!hasHome) {
      if (char.isTourist) {
        return { moodlet: "happy", reason: "I'm a tourist exploring the city! Looking for a place to live." };
      }
      if (char.homelessSince === undefined) {
        return { moodlet: "depressed", reason: "I'm homeless and searching for a place to live..." };
      }
      return { moodlet: "depressed", reason: "I've been homeless too long... I might have to leave this city" };
    }

    if (citizenMoney <= 5 && needsFood) {
      return { moodlet: "angry", reason: "I'm so hungry but I can't afford any food!" };
    }

    if (needsFood) {
      const hours = Math.floor(hoursSinceFood);
      if (hours === 0) {
        return { moodlet: "hungry", reason: "I'm getting hungry, I should find some food!" };
      } else if (hours === 1) {
        return { moodlet: "hungry", reason: "I haven't eaten in an hour, I need food!" };
      } else {
        return { moodlet: "hungry", reason: `I haven't eaten in ${hours} hours, I really need to find food!` };
      }
    }

    if (hasHome && ateToday && entertainedToday) {
      if (Math.random() < 0.01) {
        return { moodlet: "happy", reason: "Thinking about bangin nerds mom" };
      }
      return { moodlet: "happy", reason: "I have a home, I'm well fed, and I'm having fun!" };
    }

    if (!ateToday || !entertainedToday) {
      const reasons: string[] = [];
      if (!ateToday) reasons.push("I haven't eaten today");
      if (!entertainedToday) reasons.push("I need some entertainment");
      return { moodlet: "sad", reason: `I'm feeling down... ${reasons.join(" and ")}` };
    }

    return { moodlet: "sad", reason: "I'm feeling a bit down" };
  }

  // ============================================
  // CORE AI STATE MACHINE
  // ============================================

  updateSingleCharacter(char: CharacterWithResidence, ctx: CitizenAIContext): CharacterWithResidence {
    this.pathfinding.debugLogCounter++;

    // Citizens resting at home don't move
    if (char.state === "resting_at_home") {
      return char;
    }

    // Citizens leaving the city - check if they've reached the edge
    if (char.state === "leaving_city") {
      if (this.pathfinding.checkCitizenReachedEdge(char)) {
        return char;
      }
    }

    const { x, y, direction, speed } = char;
    const moodSpeedMultiplier = MOOD_SPEED_MULTIPLIERS[String(char.moodlet ?? "null")] ?? 1.0;
    const effectiveSpeed = speed * moodSpeedMultiplier * (ctx.gameSpeed === GameSpeed.Paused ? 0 : ctx.gameSpeed);
    const vec = directionVectors[direction];
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);

    // Update interaction cooldown
    let newInteractionCooldown = char.interactionCooldown;
    if (newInteractionCooldown !== undefined && newInteractionCooldown > 0) {
      newInteractionCooldown = Math.max(0, newInteractionCooldown - (16 * ctx.gameSpeed));
    }

    // Check for building interactions
    let interactionUpdatedChar: CharacterWithResidence = {
      ...char,
      interactionCooldown: newInteractionCooldown,
    };
    interactionUpdatedChar = this.checkBuildingInteraction(interactionUpdatedChar, ctx);

    char = interactionUpdatedChar;
    newInteractionCooldown = char.interactionCooldown;

    // Track needs
    let framesSinceLastFood = (char as any).framesSinceLastFood || 0;
    if (char.ateToday) {
      framesSinceLastFood = 0;
    } else {
      framesSinceLastFood += ctx.gameSpeed === GameSpeed.Paused ? 0 : 1;
    }

    // Calculate moodlet
    const previousMoodlet = char.moodlet || null;
    const moodletResult = this.calculateMoodlet({ ...char, framesSinceLastFood });
    const newMoodlet = moodletResult.moodlet;
    const moodletReason = moodletResult.reason;
    const moodletChanged = previousMoodlet !== newMoodlet;

    const currentPos = { x: tileX, y: tileY };

    let state = char.state || "wandering";
    let currentDestination = char.currentDestination;
    const allowGrassForState = state === "leaving_city";

    // Check if destination building still exists
    if (currentDestination && currentDestination.buildingOriginX !== undefined && currentDestination.buildingOriginY !== undefined) {
      const destCell = ctx.grid[currentDestination.buildingOriginY]?.[currentDestination.buildingOriginX];
      if (!destCell || destCell.type !== TileType.Building || !destCell.buildingId) {
        currentDestination = undefined;
        state = "wandering";
      }
    }

    if (currentDestination && !this.pathfinding.isWalkable(currentDestination.x, currentDestination.y, allowGrassForState)) {
      if (state !== "leaving_city") {
        currentDestination = undefined;
        state = "wandering";
      }
    }

    // If citizen has no residence and is wandering, look for a home
    if (state === "wandering" && !char.residenceX) {
      const citizenMoney = char.money ?? 0;
      const dailyBudget = char.dailyBudget ?? MIN_DAILY_BUDGET;
      const nearbyBuildings = this.pathfinding.findNearbyBuildings(x, y, 20);

      const { minFoodCost, minEntertainmentCost } = this.findCheapestOptions(x, y, ctx.grid);
      const minNeededForNeeds = minFoodCost + minEntertainmentCost;

      let residentialBuildings = nearbyBuildings
        .filter((b) => {
          const building = getBuilding(b.buildingId);
          if (!building || building.category !== "residential") return false;
          const economics = getBuildingEconomics(building);
          const rent = economics.rentPerResident ?? 0;
          return citizenMoney >= rent && (citizenMoney - rent) >= minNeededForNeeds * 0.5;
        })
        .map((b) => {
          const building = getBuilding(b.buildingId);
          const economics = getBuildingEconomics(building!);
          const rent = economics.rentPerResident ?? 0;
          return { ...b, rent };
        });

      residentialBuildings.sort((a, b) => {
        const rentDiff = b.rent - a.rent;
        if (Math.abs(rentDiff) > 10) return rentDiff;
        return a.distance - b.distance;
      });

      if (residentialBuildings.length > 0 && Math.random() < 0.02) {
        for (const target of residentialBuildings) {
          const buildingKey = `${target.originX},${target.originY}`;
          if (char.lastFailedBuildingKey === buildingKey) continue;

          const adjacentTiles = this.pathfinding.getBuildingAdjacentTiles(
            target.originX, target.originY, target.buildingId
          );
          const sidewalkTiles = adjacentTiles.filter(t => this.pathfinding.isSidewalk(t.x, t.y));
          if (sidewalkTiles.length === 0) continue;

          const reachable = this.pathfinding.canReachAnyTarget(tileX, tileY, sidewalkTiles);
          if (reachable) {
            state = "heading_to_building";
            currentDestination = {
              x: reachable.x, y: reachable.y,
              buildingId: target.buildingId,
              buildingOriginX: target.originX,
              buildingOriginY: target.originY,
            };
            char = { ...char, cachedPath: undefined, pathIndex: undefined, lastPathTile: undefined };
            break;
          }
        }
      }
    }

    // If citizen is broke, either go home to rest or just wander
    const citizenMoney = char.money ?? 0;
    const isBroke = char.brokeUntilNextDay || citizenMoney <= 0;

    if (isBroke && state === "wandering" && !currentDestination) {
      if (char.residenceX !== undefined && char.residenceY !== undefined) {
        const homeCell = ctx.grid[char.residenceY]?.[char.residenceX];
        if (homeCell?.buildingId) {
          const adjacentTiles = this.pathfinding.getBuildingAdjacentTiles(
            char.residenceX, char.residenceY, homeCell.buildingId
          );
          const reachable = this.pathfinding.canReachAnyTarget(tileX, tileY, adjacentTiles);
          if (reachable && Math.random() < 0.05) {
            state = "heading_home";
            currentDestination = {
              x: reachable.x, y: reachable.y,
              buildingId: homeCell.buildingId,
              buildingOriginX: char.residenceX,
              buildingOriginY: char.residenceY,
            };
            char = { ...char, cachedPath: undefined, pathIndex: undefined, lastPathTile: undefined };
          }
        }
      }
    }
    // If citizen has money and is wandering, prioritize needs
    else if (state === "wandering" && !currentDestination && !isBroke) {
      const framesSinceFood = ((char as any).framesSinceLastFood || 0);
      const needsFood = !char.ateToday || framesSinceFood >= 1200;
      const needsEntertainment = !char.entertainedToday;

      // Mood-based business visit skipping
      let skipBusinessVisit = false;
      if (char.moodlet === "depressed" && Math.random() > 0.2) {
        skipBusinessVisit = true; // 80% skip
      } else if (char.moodlet === "angry" && Math.random() > 0.5) {
        skipBusinessVisit = true; // 50% skip
      } else if (char.moodlet === "sad" && !needsFood && Math.random() > 0.8) {
        skipBusinessVisit = true; // 20% skip (entertainment only, still seeks food)
      }

      if (skipBusinessVisit) {
        // Skip business visits based on mood
      } else {

      let priorityBuildings: Array<{ buildingId: string; originX: number; originY: number; distance: number }> = [];

      if (needsFood) {
        const nearbyBuildings = this.pathfinding.findNearbyBuildings(x, y, 20);
        const reservedMoney = this.calculateReservedMoney(char, "food", ctx.grid);
        const foodBuildings = nearbyBuildings
          .filter((b) => {
            const building = getBuilding(b.buildingId);
            if (!building || building.category === "residential") return false;
            const economics = getBuildingEconomics(building);
            const cost = economics.incomePerInteraction ?? 0;

            const buildingName = building.name.toLowerCase();
            const isFoodBusiness =
              buildingName.includes("dunkin") ||
              buildingName.includes("popeyes") ||
              buildingName.includes("checkers") ||
              buildingName.includes("martini") ||
              buildingName.includes("bar") ||
              buildingName.includes("restaurant") ||
              buildingName.includes("cafe") ||
              buildingName.includes("food");

            return (
              isFoodBusiness &&
              economics.incomePerInteraction !== undefined &&
              citizenMoney >= cost + reservedMoney
            );
          })
          .map((b) => {
            const building = getBuilding(b.buildingId);
            const economics = getBuildingEconomics(building!);
            return { ...b, cost: economics.incomePerInteraction ?? 0 };
          });

        foodBuildings.sort((a, b) => {
          const costDiff = b.cost - a.cost;
          if (Math.abs(costDiff) > 5) return costDiff;
          return a.distance - b.distance;
        });
        priorityBuildings = foodBuildings;
      }

      if (priorityBuildings.length === 0 && needsEntertainment) {
        const nearbyBuildings = this.pathfinding.findNearbyBuildings(x, y, 20);
        const reservedMoney = this.calculateReservedMoney(char, "entertainment", ctx.grid);
        const entertainmentBuildings = nearbyBuildings
          .filter((b) => {
            const building = getBuilding(b.buildingId);
            if (!building || building.category === "residential") return false;
            const economics = getBuildingEconomics(building);
            const cost = economics.incomePerInteraction ?? 0;

            const buildingName = building.name.toLowerCase();
            const isFoodBusiness =
              buildingName.includes("dunkin") ||
              buildingName.includes("popeyes") ||
              buildingName.includes("checkers") ||
              buildingName.includes("martini") ||
              buildingName.includes("bar") ||
              buildingName.includes("restaurant") ||
              buildingName.includes("cafe") ||
              buildingName.includes("food");

            return (
              !isFoodBusiness &&
              (building.category === "commercial" ||
                building.category === "civic" ||
                building.category === "landmark") &&
              economics.incomePerInteraction !== undefined &&
              citizenMoney >= cost + reservedMoney
            );
          })
          .map((b) => {
            const building = getBuilding(b.buildingId);
            const economics = getBuildingEconomics(building!);
            return { ...b, cost: economics.incomePerInteraction ?? 0 };
          });

        entertainmentBuildings.sort((a, b) => {
          const costDiff = b.cost - a.cost;
          if (Math.abs(costDiff) > 5) return costDiff;
          return a.distance - b.distance;
        });
        priorityBuildings = entertainmentBuildings;
      }

      if (priorityBuildings.length === 0 && char.ateToday && !needsEntertainment) {
        const extraMoneyThreshold = 60;
        if (citizenMoney >= extraMoneyThreshold) {
          const nearbyBuildings = this.pathfinding.findNearbyBuildings(x, y, 15);
          const reservedMoney = this.calculateReservedMoney(char, "food", ctx.grid);
          priorityBuildings = nearbyBuildings.filter((b) => {
            const building = getBuilding(b.buildingId);
            if (!building || building.category === "residential") return false;
            const economics = getBuildingEconomics(building);
            const cost = economics.incomePerInteraction ?? 0;

            const buildingName = building.name.toLowerCase();
            const isFoodBusiness = buildingName.includes("dunkin") ||
                                     buildingName.includes("popeyes") ||
                                     buildingName.includes("checkers") ||
                                     buildingName.includes("martini") ||
                                     buildingName.includes("bar") ||
                                     buildingName.includes("restaurant") ||
                                     buildingName.includes("cafe") ||
                                     buildingName.includes("food");

            return (
              isFoodBusiness &&
              economics.incomePerInteraction !== undefined &&
              citizenMoney >= cost + reservedMoney
            );
          });
          priorityBuildings.sort((a, b) => a.distance - b.distance);
        }
      }

      if (priorityBuildings.length > 0) {
        for (const target of priorityBuildings) {
          const adjacentTiles = this.pathfinding.getBuildingAdjacentTiles(
            target.originX, target.originY, target.buildingId
          );
          const sidewalkTiles = adjacentTiles.filter(t => this.pathfinding.isSidewalk(t.x, t.y));
          if (sidewalkTiles.length === 0) continue;

          const reachable = this.pathfinding.canReachAnyTarget(tileX, tileY, sidewalkTiles);
          if (reachable) {
            state = "heading_to_building";
            currentDestination = {
              x: reachable.x, y: reachable.y,
              buildingId: target.buildingId,
              buildingOriginX: target.originX,
              buildingOriginY: target.originY,
            };
            char = { ...char, cachedPath: undefined, pathIndex: undefined, lastPathTile: undefined };
            break;
          }
        }
      }
      } // End else block for depressed check
    }

    // If heading to a building, check if we've arrived
    if (state === "heading_to_building" && currentDestination) {
      const buildingOriginX = currentDestination.buildingOriginX;
      const buildingOriginY = currentDestination.buildingOriginY;

      const INTERACTION_DISTANCE = 3;
      let canInteractWithBuilding = false;

      if (buildingOriginX !== undefined && buildingOriginY !== undefined) {
        const building = currentDestination.buildingId ? getBuilding(currentDestination.buildingId) : null;
        if (building) {
          const footprint = getBuildingFootprint(building);
          for (let dy = 0; dy < footprint.height && !canInteractWithBuilding; dy++) {
            for (let dx = 0; dx < footprint.width && !canInteractWithBuilding; dx++) {
              const buildingTileX = buildingOriginX + dx;
              const buildingTileY = buildingOriginY + dy;
              const distToTile = Math.abs(tileX - buildingTileX) + Math.abs(tileY - buildingTileY);
              if (distToTile <= INTERACTION_DISTANCE) {
                canInteractWithBuilding = true;
              }
            }
          }
        } else {
          const buildingDistance = Math.abs(tileX - buildingOriginX) + Math.abs(tileY - buildingOriginY);
          canInteractWithBuilding = buildingDistance <= INTERACTION_DISTANCE;
        }
      }

      if (canInteractWithBuilding) {
        state = "at_building";
        newInteractionCooldown = 500 + Math.random() * 1000;
        currentDestination = undefined;
      }
    }

    // If at building, check if we should leave
    if (state === "at_building") {
      let canInteract = false;
      const directions = [
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 },
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
      ];
      for (const dir of directions) {
        const checkX = tileX + dir.dx;
        const checkY = tileY + dir.dy;
        if (checkX >= 0 && checkX < GRID_WIDTH && checkY >= 0 && checkY < GRID_HEIGHT) {
          const cell = ctx.grid[checkY][checkX];
          if (cell.type === TileType.Building && cell.buildingId && cell.isOrigin) {
            canInteract = true;
            break;
          }
        }
      }

      if (!canInteract && currentDestination) {
        state = "heading_to_building";
      } else if (!newInteractionCooldown || newInteractionCooldown === 0) {
        // Happy citizens have a 10% chance to keep wandering for bonus visits
        if (char.moodlet === "happy" && Math.random() < 0.1) {
          state = "wandering";
          currentDestination = undefined;
        } else if (char.residenceX !== undefined && char.residenceY !== undefined) {
          const residenceCell = ctx.grid[char.residenceY]?.[char.residenceX];
          if (residenceCell && residenceCell.buildingId) {
            const adjacentTiles = this.pathfinding.getBuildingAdjacentTiles(
              char.residenceX, char.residenceY, residenceCell.buildingId
            );
            const reachable = this.pathfinding.canReachAnyTarget(tileX, tileY, adjacentTiles);
            if (reachable) {
              state = "heading_home";
              currentDestination = { x: reachable.x, y: reachable.y };
            } else {
              state = "wandering";
              currentDestination = undefined;
            }
          } else {
            state = "wandering";
            currentDestination = undefined;
          }
        } else {
          state = "wandering";
          currentDestination = undefined;
        }
      }
    }

    // If heading home, check if we've arrived
    if (state === "heading_home" && currentDestination && char.residenceX) {
      const distance =
        Math.abs(tileX - currentDestination.x) + Math.abs(tileY - currentDestination.y);
      if (distance <= 1) {
        state = "wandering";
        currentDestination = undefined;
      }
    }

    // Check if current tile is still walkable
    if (!this.pathfinding.isWalkable(tileX, tileY, allowGrassForState)) {
      const walkableTiles: { x: number; y: number }[] = [];
      for (let gy = 0; gy < GRID_HEIGHT; gy++) {
        for (let gx = 0; gx < GRID_WIDTH; gx++) {
          const tileType = ctx.grid[gy][gx].type;
          if (
            tileType === TileType.Road ||
            tileType === TileType.Tile ||
            tileType === TileType.Asphalt ||
            (allowGrassForState && tileType === TileType.Grass)
          ) {
            walkableTiles.push({ x: gx, y: gy });
          }
        }
      }
      if (walkableTiles.length > 0) {
        const newTile = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
        return {
          ...char,
          x: newTile.x + 0.5,
          y: newTile.y + 0.5,
          direction: allDirections[Math.floor(Math.random() * allDirections.length)],
          state: "wandering",
          currentDestination: undefined,
          interactionCooldown: newInteractionCooldown,
          stuckCounter: 0,
          lastPosition: { x: newTile.x, y: newTile.y },
        };
      }
      return {
        ...char,
        interactionCooldown: newInteractionCooldown,
        stuckCounter: 0,
        lastPosition: currentPos,
      };
    }

    const inTileX = x - tileX;
    const inTileY = y - tileY;
    const threshold = 0.15;
    const nearCenter =
      Math.abs(inTileX - 0.5) < threshold &&
      Math.abs(inTileY - 0.5) < threshold;

    // Detect if stuck or oscillating
    let stuckCounter = char.stuckCounter || 0;
    let oscillationCounter = (char as any).oscillationCounter || 0;
    const lastPos = char.lastPosition;
    const secondLastPos = (char as any).secondLastPosition;

    if (lastPos && secondLastPos) {
      const isOscillating =
        (lastPos.x === secondLastPos.x && lastPos.y === secondLastPos.y) ||
        (tileX === secondLastPos.x && tileY === secondLastPos.y && lastPos.x === tileX && lastPos.y === tileY);

      if (isOscillating) {
        oscillationCounter += 1;
        if (oscillationCounter > 120 && state !== "leaving_city") {
          console.log(`[Citizen ${char.id.slice(0,4)}] Oscillating between tiles, giving up on destination`);
          state = "wandering";
          currentDestination = undefined;
          stuckCounter = 0;
          oscillationCounter = 0;
        }
      } else {
        oscillationCounter = 0;
      }
    }

    if (lastPos && lastPos.x === tileX && lastPos.y === tileY) {
      stuckCounter += 1;
      if (stuckCounter === 180) {
        console.log(`[Citizen ${char.id.slice(0,4)}] Stuck for 3s at (${tileX}, ${tileY}), state: ${state}, dest: ${currentDestination ? `(${currentDestination.x},${currentDestination.y})` : 'none'}`);
      }
      if (stuckCounter > 300 && state !== "leaving_city") {
        console.log(`[Citizen ${char.id.slice(0,4)}] Giving up on destination after 5s stuck`);
        state = "wandering";
        currentDestination = undefined;
        stuckCounter = 0;
        oscillationCounter = 0;
      }
    } else {
      stuckCounter = 0;
    }

    let newDirection = direction;
    let nextX = x;
    let nextY = y;

    // If leaving the city, pathfind to edge (allow grass)
    if (state === "leaving_city" && currentDestination) {
      this.pathfinding.debugLog(char.id, `Leaving city: heading to edge (${currentDestination.x}, ${currentDestination.y}), pos: (${tileX}, ${tileY})`);

      const currentDirVec = directionVectors[direction];
      const aheadTileX = tileX + currentDirVec.dx;
      const aheadTileY = tileY + currentDirVec.dy;
      const isCurrentDirBlocked = !this.pathfinding.isWalkable(aheadTileX, aheadTileY, true);

      if (nearCenter) {
        const targetDir = this.pathfinding.moveTowardsTarget(char, currentDestination.x, currentDestination.y, true);
        this.pathfinding.debugLog(char.id, `Pathfinding (leaving) returned: ${targetDir}`);

        if (targetDir) {
          const targetVec = directionVectors[targetDir];
          const nextTileX = tileX + targetVec.dx;
          const nextTileY = tileY + targetVec.dy;
          const isNextWalkable = this.pathfinding.isWalkable(nextTileX, nextTileY, true);

          if (isNextWalkable) {
            newDirection = targetDir;
          } else {
            const greedyDir = this.pathfinding.moveTowardsTargetGreedyWithGrass(tileX, tileY, currentDestination.x, currentDestination.y);
            if (greedyDir) {
              newDirection = greedyDir;
            } else {
              const validDirs = this.pathfinding.getValidDirections(tileX, tileY, true, true);
              if (validDirs.length > 0) {
                newDirection = validDirs[0];
              }
            }
          }
        } else {
          const greedyDir = this.pathfinding.moveTowardsTargetGreedyWithGrass(tileX, tileY, currentDestination.x, currentDestination.y);
          if (greedyDir) {
            newDirection = greedyDir;
          } else {
            const validDirs = this.pathfinding.getValidDirections(tileX, tileY, true, true);
            if (validDirs.length > 0) {
              newDirection = validDirs[0];
            }
          }
        }
      } else if (isCurrentDirBlocked) {
        const greedyDir = this.pathfinding.moveTowardsTargetGreedyWithGrass(tileX, tileY, currentDestination.x, currentDestination.y);
        if (greedyDir) {
          newDirection = greedyDir;
        } else {
          const validDirs = this.pathfinding.getValidDirections(tileX, tileY, true, true);
          const opposite = oppositeDirection[direction];
          const preferredDirs = validDirs.filter(d => d !== opposite);
          if (preferredDirs.length > 0) {
            newDirection = preferredDirs[0];
          } else if (validDirs.length > 0) {
            newDirection = validDirs[0];
          }
        }
      }
    }
    // If we have a destination, use cached path for smooth movement
    else if (currentDestination && (state === "heading_to_building" || state === "heading_home")) {
      this.pathfinding.debugLog(char.id, `Has destination: (${currentDestination.x}, ${currentDestination.y}), state: ${state}, nearCenter: ${nearCenter}, pos: (${tileX}, ${tileY})`);

      const currentDirVec = directionVectors[direction];
      const aheadTileX = tileX + currentDirVec.dx;
      const aheadTileY = tileY + currentDirVec.dy;
      const isCurrentDirBlocked = !this.pathfinding.isWalkable(aheadTileX, aheadTileY);

      const lastPathTile = char.lastPathTile;
      const hasCachedPath = char.cachedPath &&
        char.cachedPath.length > 0 &&
        char.pathIndex !== undefined &&
        char.pathIndex < char.cachedPath.length;

      if (hasCachedPath && nearCenter) {
        // Advance path index if we've moved to a new tile since last path step
        let pathIdx = char.pathIndex!;
        if (lastPathTile && (lastPathTile.x !== tileX || lastPathTile.y !== tileY)) {
          pathIdx = Math.min(pathIdx + 1, char.cachedPath!.length);
        }

        if (pathIdx < char.cachedPath!.length) {
          const nextDir = char.cachedPath![pathIdx];
          const nextVec = directionVectors[nextDir];
          const nextTileX = tileX + nextVec.dx;
          const nextTileY = tileY + nextVec.dy;

          if (this.pathfinding.isWalkable(nextTileX, nextTileY)) {
            newDirection = nextDir;
            char = { ...char, pathIndex: pathIdx, lastPathTile: { x: tileX, y: tileY } };
            this.pathfinding.debugLog(char.id, `Following path step ${pathIdx}/${char.cachedPath!.length}, dir: ${nextDir}`);
          } else {
            // Path blocked — clear and recompute next frame
            char = { ...char, cachedPath: undefined, pathIndex: undefined, lastPathTile: undefined };
            this.pathfinding.debugLog(char.id, `Path blocked at step ${pathIdx}, will recompute`);
          }
        } else {
          // Path exhausted
          char = { ...char, cachedPath: undefined, pathIndex: undefined, lastPathTile: undefined };
        }
      } else if (nearCenter && !hasCachedPath) {
        // Compute fresh A* path
        const fullPath = this.pathfinding.computeFullPath(tileX, tileY, currentDestination.x, currentDestination.y, 200, false);
        if (fullPath && fullPath.length > 0) {
          // Follow first step immediately — don't wait for next frame
          newDirection = fullPath[0];
          char = { ...char, cachedPath: fullPath, pathIndex: 0, lastPathTile: { x: tileX, y: tileY } };
          this.pathfinding.debugLog(char.id, `Computed new path with ${fullPath.length} steps, first dir: ${fullPath[0]}`);
        } else {
          // A* failed — fall back to greedy movement
          const greedyDir = this.pathfinding.moveTowardsTargetGreedy(tileX, tileY, currentDestination.x, currentDestination.y);
          if (greedyDir && this.pathfinding.isWalkable(tileX + directionVectors[greedyDir].dx, tileY + directionVectors[greedyDir].dy)) {
            newDirection = greedyDir;
          }
        }
      } else if (!nearCenter && hasCachedPath) {
        // Between tile centers with a cached path — keep moving in current direction
        // (no direction change needed, citizen continues toward next tile center)
      } else if (isCurrentDirBlocked) {
        // No cached path, current direction blocked — try greedy or pick new direction
        char = { ...char, cachedPath: undefined, pathIndex: undefined, lastPathTile: undefined };
        const greedyDir = this.pathfinding.moveTowardsTargetGreedy(tileX, tileY, currentDestination.x, currentDestination.y);
        if (greedyDir && this.pathfinding.isWalkable(tileX + directionVectors[greedyDir].dx, tileY + directionVectors[greedyDir].dy)) {
          newDirection = greedyDir;
        } else {
          const validDirs = this.pathfinding.getValidDirections(tileX, tileY);
          const opposite = oppositeDirection[direction];
          const preferredDirs = validDirs.filter(d => d !== opposite);
          if (preferredDirs.length > 0) {
            newDirection = preferredDirs[0];
          } else if (validDirs.length > 0) {
            newDirection = validDirs[0];
          }
        }
      }
    } else if (nearCenter) {
      // Normal wandering behavior
      const nextTileX = tileX + vec.dx;
      const nextTileY = tileY + vec.dy;

      if (!this.pathfinding.isWalkable(nextTileX, nextTileY, allowGrassForState)) {
        const newDir = this.pathfinding.pickNewDirection(tileX, tileY, direction);
        if (newDir) {
          newDirection = newDir;
        }
      } else {
        const validDirs = this.pathfinding.getValidDirections(tileX, tileY, true, allowGrassForState);
        if (validDirs.length > 2 && Math.random() < 0.1) {
          const newDir = this.pathfinding.pickNewDirection(tileX, tileY, direction);
          if (newDir) {
            newDirection = newDir;
          }
        }
      }
    }

    // Emergency check: if we have no valid directions, we're trapped
    const validDirs = this.pathfinding.getValidDirections(tileX, tileY, true, allowGrassForState);
    if (validDirs.length === 0) {
      for (let gy = 0; gy < GRID_HEIGHT; gy++) {
        for (let gx = 0; gx < GRID_WIDTH; gx++) {
          if (this.pathfinding.isWalkable(gx, gy, allowGrassForState)) {
            const newState = state === "leaving_city" ? "leaving_city" : "wandering";
            return {
              ...char,
              x: gx + 0.5,
              y: gy + 0.5,
              direction: allDirections[Math.floor(Math.random() * allDirections.length)],
              state: newState,
              currentDestination: state === "leaving_city" ? currentDestination : undefined,
              interactionCooldown: newInteractionCooldown,
              stuckCounter: 0,
              lastPosition: { x: gx, y: gy },
            };
          }
        }
      }
    }

    const moveVec = directionVectors[newDirection];
    nextX += moveVec.dx * effectiveSpeed;
    nextY += moveVec.dy * effectiveSpeed;

    const finalTileX = Math.floor(nextX);
    const finalTileY = Math.floor(nextY);

    if (!this.pathfinding.isWalkable(finalTileX, finalTileY, allowGrassForState)) {
      if (this.pathfinding.debugLogCounter % 60 === 0) {
        console.log(`[Citizen ${char.id.slice(0,4)}] BLOCKED - final tile (${finalTileX},${finalTileY}) not walkable, staying at (${tileX},${tileY})`);
      }
      return {
        ...char,
        x: tileX + 0.5,
        y: tileY + 0.5,
        direction: newDirection,
        state,
        currentDestination,
        interactionCooldown: newInteractionCooldown,
        stuckCounter,
        lastPosition: { x: tileX, y: tileY },
      };
    }

    const finalStuckCounter = (finalTileX !== tileX || finalTileY !== tileY) ? 0 : stuckCounter;

    if (this.pathfinding.debugPathfinding && this.pathfinding.debugLogCounter % 60 === 0 && currentDestination) {
      console.log(`[Citizen ${char.id.slice(0,4)}] Moving: (${tileX},${tileY})->(${finalTileX},${finalTileY}), dir: ${newDirection}, dest: (${currentDestination.x},${currentDestination.y})`);
    }

    const clearFailedBuilding = !char.lastFailedBuildingKey ||
      (newInteractionCooldown === 0 && finalStuckCounter === 0);

    const updatedChar = {
      ...char,
      x: nextX,
      y: nextY,
      direction: newDirection,
      state,
      currentDestination,
      interactionCooldown: newInteractionCooldown,
      stuckCounter: finalStuckCounter,
      lastPosition: { x: finalTileX, y: finalTileY },
      lastFailedBuildingKey: clearFailedBuilding ? undefined : char.lastFailedBuildingKey,
      oscillationCounter: oscillationCounter,
      secondLastPosition: lastPos ? { x: lastPos.x, y: lastPos.y } : undefined,
      framesSinceLastFood: framesSinceLastFood,
      moodlet: newMoodlet,
      moodletReason: moodletReason,
      previousMoodlet: previousMoodlet,
      willLeaveAtMonthEnd: char.residenceX ? false : (char.isTourist ? false : true),
      homelessSince: char.residenceX ? undefined : (char.homelessSince ?? undefined),
    } as CharacterWithResidence & {
      oscillationCounter?: number;
      secondLastPosition?: { x: number; y: number };
      framesSinceLastFood?: number;
    };

    return updatedChar;
  }
}
