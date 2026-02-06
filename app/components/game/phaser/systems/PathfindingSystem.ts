import {
  GridCell,
  TileType,
  Direction,
  GRID_WIDTH,
  GRID_HEIGHT,
  CharacterWithResidence,
} from "../../types";
import { directionVectors, oppositeDirection, allDirections } from "../utils/directions";
import {
  getBuilding,
  getBuildingFootprint,
} from "@/app/data/buildings";

/**
 * PathfindingSystem handles all grid-based pathfinding and walkability checks.
 *
 * It operates on a grid reference (set externally) and provides:
 * - Walkability/drivability checks
 * - BFS and A* pathfinding
 * - Reachability checks
 * - Direction picking for wandering/greedy movement
 * - Building adjacency/access tile calculation
 */
export class PathfindingSystem {
  private grid: GridCell[][] = [];

  // Debug flags
  debugPathfinding = false;
  debugLogCounter = 0;

  setGrid(grid: GridCell[][]): void {
    this.grid = grid;
  }

  getGrid(): GridCell[][] {
    return this.grid;
  }

  // ============================================
  // WALKABILITY CHECKS
  // ============================================

  isWalkable(x: number, y: number, allowGrass: boolean = false): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return false;
    const tileType = this.grid[gy][gx].type;
    if (allowGrass && tileType === TileType.Grass) {
      return true;
    }
    return tileType === TileType.Road || tileType === TileType.Tile || tileType === TileType.Asphalt;
  }

  isSidewalk(x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return false;
    const tileType = this.grid[gy][gx].type;
    return tileType === TileType.Road || tileType === TileType.Tile;
  }

  getWalkCost(x: number, y: number): number {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return Infinity;
    const tileType = this.grid[gy][gx].type;
    if (tileType === TileType.Road || tileType === TileType.Tile) return 1;
    if (tileType === TileType.Asphalt) return 5;
    return Infinity;
  }

  isDrivable(x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (gx < 0 || gx >= GRID_WIDTH || gy < 0 || gy >= GRID_HEIGHT) return false;
    return this.grid[gy][gx].type === TileType.Asphalt;
  }

  // ============================================
  // DIRECTION HELPERS
  // ============================================

  getValidDirections(tileX: number, tileY: number, preferSidewalks: boolean = true, allowGrass: boolean = false): Direction[] {
    const sidewalkDirs: Direction[] = [];
    const asphaltDirs: Direction[] = [];
    const grassDirs: Direction[] = [];

    for (const dir of allDirections) {
      const vec = directionVectors[dir];
      const nextX = tileX + vec.dx;
      const nextY = tileY + vec.dy;

      if (this.isSidewalk(nextX, nextY)) {
        sidewalkDirs.push(dir);
      } else if (this.isWalkable(nextX, nextY, allowGrass)) {
        if (allowGrass && this.grid[nextY]?.[nextX]?.type === TileType.Grass) {
          grassDirs.push(dir);
        } else {
          asphaltDirs.push(dir);
        }
      }
    }

    if (preferSidewalks) {
      return [...sidewalkDirs, ...asphaltDirs, ...grassDirs];
    }
    return [...sidewalkDirs, ...asphaltDirs, ...grassDirs];
  }

  getValidCarDirections(tileX: number, tileY: number): Direction[] {
    const valid: Direction[] = [];
    for (const dir of allDirections) {
      const vec = directionVectors[dir];
      if (this.isDrivable(tileX + vec.dx, tileY + vec.dy)) {
        valid.push(dir);
      }
    }
    return valid;
  }

  pickNewDirection(tileX: number, tileY: number, currentDir: Direction): Direction | null {
    const validDirs = this.getValidDirections(tileX, tileY, true);
    if (validDirs.length === 0) return null;

    const opposite = oppositeDirection[currentDir];
    const preferredDirs = validDirs.filter((d) => d !== opposite);

    const sidewalkChoices = preferredDirs.filter(d => {
      const vec = directionVectors[d];
      return this.isSidewalk(tileX + vec.dx, tileY + vec.dy);
    });

    const currentIsSidewalk = this.isSidewalk(tileX + directionVectors[currentDir].dx, tileY + directionVectors[currentDir].dy);
    if (preferredDirs.includes(currentDir) && currentIsSidewalk && Math.random() < 0.6) {
      return currentDir;
    }

    if (sidewalkChoices.length > 0 && Math.random() < 0.9) {
      return sidewalkChoices[Math.floor(Math.random() * sidewalkChoices.length)];
    }

    const choices = preferredDirs.length > 0 ? preferredDirs : validDirs;
    return choices[Math.floor(Math.random() * choices.length)];
  }

  // ============================================
  // PATHFINDING ALGORITHMS
  // ============================================

  canReachTarget(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    maxSteps: number = 150
  ): boolean {
    if (startX === targetX && startY === targetY) return true;

    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    let iterations = 0;
    while (queue.length > 0 && iterations < maxSteps * 4) {
      iterations++;
      const current = queue.shift()!;

      for (const dir of allDirections) {
        const vec = directionVectors[dir];
        const nextX = current.x + vec.dx;
        const nextY = current.y + vec.dy;
        const key = `${nextX},${nextY}`;

        if (visited.has(key)) continue;
        if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;
        if (!this.isWalkable(nextX, nextY)) continue;

        visited.add(key);

        if (nextX === targetX && nextY === targetY) {
          return true;
        }

        queue.push({ x: nextX, y: nextY });
      }
    }

    return false;
  }

  canReachAnyTarget(
    startX: number,
    startY: number,
    targets: Array<{ x: number; y: number }>,
    maxSteps: number = 150
  ): { x: number; y: number } | null {
    if (targets.length === 0) {
      console.log(`[canReachAnyTarget] No targets provided`);
      return null;
    }

    const targetSet = new Set(targets.map(t => `${t.x},${t.y}`));

    if (targetSet.has(`${startX},${startY}`)) {
      return { x: startX, y: startY };
    }

    if (!this.isWalkable(startX, startY)) {
      console.log(`[canReachAnyTarget] Start (${startX},${startY}) is NOT walkable!`);
      return null;
    }

    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    let iterations = 0;
    while (queue.length > 0 && iterations < maxSteps * 4) {
      iterations++;
      const current = queue.shift()!;

      for (const dir of allDirections) {
        const vec = directionVectors[dir];
        const nextX = current.x + vec.dx;
        const nextY = current.y + vec.dy;
        const key = `${nextX},${nextY}`;

        if (visited.has(key)) continue;
        if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;
        if (!this.isWalkable(nextX, nextY)) continue;

        visited.add(key);

        if (targetSet.has(key)) {
          console.log(`[canReachAnyTarget] Found path from (${startX},${startY}) to (${nextX},${nextY}) in ${iterations} iterations`);
          return { x: nextX, y: nextY };
        }

        queue.push({ x: nextX, y: nextY });
      }
    }

    console.log(`[canReachAnyTarget] No path from (${startX},${startY}) to any of ${targets.length} targets after ${iterations} iterations`);
    return null;
  }

  // Compute the FULL path from start to target using A* with weighted costs
  computeFullPath(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    maxSteps: number = 200,
    allowGrass: boolean = false
  ): Direction[] | null {
    if (startX === targetX && startY === targetY) return [];

    const queue: Array<[number, number, number, number]> = [];
    const visited = new Set<string>();
    const cameFrom = new Map<string, { x: number; y: number; dir: Direction }>();

    const heuristic = (x: number, y: number) => Math.abs(x - targetX) + Math.abs(y - targetY);

    const startKey = `${startX},${startY}`;
    visited.add(startKey);
    queue.push([heuristic(startX, startY), startX, startY, 0]);

    while (queue.length > 0 && visited.size < maxSteps) {
      queue.sort((a, b) => a[0] - b[0]);
      const [, currentX, currentY, currentCost] = queue.shift()!;

      if (currentX === targetX && currentY === targetY) {
        const path: Direction[] = [];
        let cx = currentX;
        let cy = currentY;

        while (cx !== startX || cy !== startY) {
          const key = `${cx},${cy}`;
          const from = cameFrom.get(key);
          if (!from) break;
          path.unshift(from.dir);
          cx = from.x;
          cy = from.y;
        }

        return path;
      }

      for (const dir of allDirections) {
        const vec = directionVectors[dir];
        const nextX = currentX + vec.dx;
        const nextY = currentY + vec.dy;
        const nextKey = `${nextX},${nextY}`;

        if (visited.has(nextKey)) continue;
        if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;
        if (!this.isWalkable(nextX, nextY, allowGrass)) continue;

        const isSidewalk = this.isSidewalk(nextX, nextY);
        const isGrass = allowGrass && this.grid[nextY]?.[nextX]?.type === TileType.Grass;
        const stepCost = isSidewalk ? 1 : (isGrass ? 10 : 5);
        const newCost = currentCost + stepCost;
        const newPriority = newCost + heuristic(nextX, nextY);

        visited.add(nextKey);
        cameFrom.set(nextKey, { x: currentX, y: currentY, dir });
        queue.push([newPriority, nextX, nextY, newCost]);
      }
    }

    return null;
  }

  // Simple BFS pathfinding
  findPathBFS(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    maxSteps: number,
    sidewalksOnly: boolean
  ): Direction | null {
    if (this.debugPathfinding && this.debugLogCounter % 60 === 0) {
      const adjInfo = allDirections.map(d => {
        const v = directionVectors[d];
        const nx = startX + v.dx;
        const ny = startY + v.dy;
        const canWalk = sidewalksOnly ? this.isSidewalk(nx, ny) : this.isWalkable(nx, ny);
        return `${d}(${nx},${ny})=${canWalk}`;
      }).join(', ');
      console.log(`[BFS] From (${startX},${startY}) to (${targetX},${targetY}), sidewalksOnly: ${sidewalksOnly}. Adjacent: ${adjInfo}`);
    }

    const queue: Array<{ x: number; y: number; firstDir: Direction }> = [];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    for (const dir of allDirections) {
      const vec = directionVectors[dir];
      const nextX = startX + vec.dx;
      const nextY = startY + vec.dy;

      if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;

      const canWalk = sidewalksOnly ? this.isSidewalk(nextX, nextY) : this.isWalkable(nextX, nextY);
      if (!canWalk) continue;

      const key = `${nextX},${nextY}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (nextX === targetX && nextY === targetY) {
        return dir;
      }

      queue.push({ x: nextX, y: nextY, firstDir: dir });
    }

    let iterations = 0;
    while (queue.length > 0 && iterations < maxSteps * 4) {
      iterations++;
      const current = queue.shift()!;

      for (const dir of allDirections) {
        const vec = directionVectors[dir];
        const nextX = current.x + vec.dx;
        const nextY = current.y + vec.dy;
        const key = `${nextX},${nextY}`;

        if (visited.has(key)) continue;
        if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;

        const canWalk = sidewalksOnly ? this.isSidewalk(nextX, nextY) : this.isWalkable(nextX, nextY);
        if (!canWalk) continue;

        visited.add(key);

        if (nextX === targetX && nextY === targetY) {
          return current.firstDir;
        }

        queue.push({ x: nextX, y: nextY, firstDir: current.firstDir });
      }
    }

    return null;
  }

  // Find path to any of the target tiles
  findPathToAnyTarget(
    startX: number,
    startY: number,
    targets: Array<{ x: number; y: number }>,
    maxSteps: number = 150
  ): { direction: Direction; target: { x: number; y: number } } | null {
    if (targets.length === 0) return null;

    const targetSet = new Set(targets.map(t => `${t.x},${t.y}`));

    if (targetSet.has(`${startX},${startY}`)) {
      return null; // Already there
    }

    // First try sidewalks only
    const sidewalkResult = this.findPathToAnyTargetBFS(startX, startY, targetSet, maxSteps, true);
    if (sidewalkResult) return sidewalkResult;

    // Then allow asphalt
    return this.findPathToAnyTargetBFS(startX, startY, targetSet, maxSteps, false);
  }

  private findPathToAnyTargetBFS(
    startX: number,
    startY: number,
    targetSet: Set<string>,
    maxSteps: number,
    sidewalksOnly: boolean
  ): { direction: Direction; target: { x: number; y: number } } | null {
    const queue: Array<{ x: number; y: number; firstDir: Direction }> = [];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);

    for (const dir of allDirections) {
      const vec = directionVectors[dir];
      const nextX = startX + vec.dx;
      const nextY = startY + vec.dy;
      const key = `${nextX},${nextY}`;

      if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;

      const canWalk = sidewalksOnly ? this.isSidewalk(nextX, nextY) : this.isWalkable(nextX, nextY);
      if (!canWalk) continue;

      if (visited.has(key)) continue;
      visited.add(key);

      if (targetSet.has(key)) {
        return { direction: dir, target: { x: nextX, y: nextY } };
      }

      queue.push({ x: nextX, y: nextY, firstDir: dir });
    }

    let iterations = 0;
    while (queue.length > 0 && iterations < maxSteps * 4) {
      iterations++;
      const current = queue.shift()!;

      for (const dir of allDirections) {
        const vec = directionVectors[dir];
        const nextX = current.x + vec.dx;
        const nextY = current.y + vec.dy;
        const key = `${nextX},${nextY}`;

        if (visited.has(key)) continue;
        if (nextX < 0 || nextX >= GRID_WIDTH || nextY < 0 || nextY >= GRID_HEIGHT) continue;

        const canWalk = sidewalksOnly ? this.isSidewalk(nextX, nextY) : this.isWalkable(nextX, nextY);
        if (!canWalk) continue;

        visited.add(key);

        if (targetSet.has(key)) {
          return { direction: current.firstDir, target: { x: nextX, y: nextY } };
        }

        queue.push({ x: nextX, y: nextY, firstDir: current.firstDir });
      }
    }

    return null;
  }

  // ============================================
  // GREEDY MOVEMENT FALLBACKS
  // ============================================

  // Weighted pathfinding - returns just the first direction
  findPathToTarget(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    maxSteps: number = 200,
    allowGrass: boolean = false
  ): Direction | null {
    if (startX === targetX && startY === targetY) return null;
    return this.findPathWeighted(startX, startY, targetX, targetY, maxSteps, allowGrass);
  }

  private findPathWeighted(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    maxSteps: number,
    allowGrass: boolean = false
  ): Direction | null {
    const fullPath = this.computeFullPath(startX, startY, targetX, targetY, maxSteps, allowGrass);
    if (fullPath && fullPath.length > 0) {
      return fullPath[0];
    }
    if (allowGrass) {
      return this.moveTowardsTargetGreedyWithGrass(startX, startY, targetX, targetY);
    }
    return this.moveTowardsTargetGreedy(startX, startY, targetX, targetY);
  }

  moveTowardsTarget(
    char: CharacterWithResidence,
    targetX: number,
    targetY: number,
    allowGrass: boolean = false
  ): Direction | null {
    const charTileX = Math.floor(char.x);
    const charTileY = Math.floor(char.y);
    return this.findPathToTarget(charTileX, charTileY, targetX, targetY, 200, allowGrass);
  }

  moveTowardsTargetGreedy(
    charTileX: number,
    charTileY: number,
    targetX: number,
    targetY: number
  ): Direction | null {
    const dx = targetX - charTileX;
    const dy = targetY - charTileY;

    if (dx === 0 && dy === 0) return null;

    const validDirs = this.getValidDirections(charTileX, charTileY, true);
    if (validDirs.length === 0) return null;

    let primaryDir: Direction | null = null;
    let secondaryDir: Direction | null = null;

    if (Math.abs(dx) >= Math.abs(dy)) {
      primaryDir = dx > 0 ? Direction.Right : Direction.Left;
      secondaryDir = dy > 0 ? Direction.Down : dy < 0 ? Direction.Up : null;
    } else {
      primaryDir = dy > 0 ? Direction.Down : Direction.Up;
      secondaryDir = dx > 0 ? Direction.Right : dx < 0 ? Direction.Left : null;
    }

    const primaryIsSidewalk = primaryDir && this.isSidewalk(charTileX + directionVectors[primaryDir].dx, charTileY + directionVectors[primaryDir].dy);
    const secondaryIsSidewalk = secondaryDir && this.isSidewalk(charTileX + directionVectors[secondaryDir].dx, charTileY + directionVectors[secondaryDir].dy);

    if (primaryDir && validDirs.includes(primaryDir)) {
      if (primaryIsSidewalk) {
        return primaryDir;
      }
      if (secondaryDir && secondaryIsSidewalk && validDirs.includes(secondaryDir)) {
        return secondaryDir;
      }
      return primaryDir;
    }

    if (secondaryDir && validDirs.includes(secondaryDir)) {
      return secondaryDir;
    }

    const currentDistance = Math.abs(dx) + Math.abs(dy);

    for (const dir of validDirs) {
      const vec = directionVectors[dir];
      const nextX = charTileX + vec.dx;
      const nextY = charTileY + vec.dy;

      if (!this.isSidewalk(nextX, nextY)) continue;

      const newDistance = Math.abs(targetX - nextX) + Math.abs(targetY - nextY);
      if (newDistance < currentDistance) {
        return dir;
      }
    }

    for (const dir of validDirs) {
      const vec = directionVectors[dir];
      const nextX = charTileX + vec.dx;
      const nextY = charTileY + vec.dy;

      const newDistance = Math.abs(targetX - nextX) + Math.abs(targetY - nextY);
      if (newDistance < currentDistance) {
        return dir;
      }
    }

    if (validDirs.length > 0) {
      return validDirs[0];
    }

    return null;
  }

  moveTowardsTargetGreedyWithGrass(
    charTileX: number,
    charTileY: number,
    targetX: number,
    targetY: number
  ): Direction | null {
    const dx = targetX - charTileX;
    const dy = targetY - charTileY;

    if (dx === 0 && dy === 0) return null;

    const validDirs = this.getValidDirections(charTileX, charTileY, true, true);
    if (validDirs.length === 0) return null;

    if (Math.abs(dx) >= Math.abs(dy)) {
      const primaryDir = dx > 0 ? Direction.Right : Direction.Left;
      const secondaryDir = dy > 0 ? Direction.Down : dy < 0 ? Direction.Up : null;
      if (validDirs.includes(primaryDir)) return primaryDir;
      if (secondaryDir && validDirs.includes(secondaryDir)) return secondaryDir;
    } else {
      const primaryDir = dy > 0 ? Direction.Down : Direction.Up;
      const secondaryDir = dx > 0 ? Direction.Right : dx < 0 ? Direction.Left : null;
      if (validDirs.includes(primaryDir)) return primaryDir;
      if (secondaryDir && validDirs.includes(secondaryDir)) return secondaryDir;
    }

    const currentDistance = Math.abs(dx) + Math.abs(dy);
    for (const dir of validDirs) {
      const vec = directionVectors[dir];
      const nextX = charTileX + vec.dx;
      const nextY = charTileY + vec.dy;
      const newDistance = Math.abs(targetX - nextX) + Math.abs(targetY - nextY);
      if (newDistance < currentDistance) {
        return dir;
      }
    }

    return validDirs[0] || null;
  }

  // ============================================
  // BUILDING ACCESS HELPERS
  // ============================================

  findNearbyBuildings(
    charX: number,
    charY: number,
    maxDistance: number = 10
  ): Array<{ buildingId: string; originX: number; originY: number; distance: number }> {
    const buildings: Array<{ buildingId: string; originX: number; originY: number; distance: number }> = [];
    const charTileX = Math.floor(charX);
    const charTileY = Math.floor(charY);

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y][x];
        if (cell.type === TileType.Building && cell.buildingId && cell.isOrigin) {
          const distance = Math.abs(x - charTileX) + Math.abs(y - charTileY);
          if (distance <= maxDistance && distance > 0) {
            buildings.push({
              buildingId: cell.buildingId,
              originX: x,
              originY: y,
              distance,
            });
          }
        }
      }
    }

    return buildings.sort((a, b) => a.distance - b.distance);
  }

  getBuildingAdjacentTiles(
    buildingOriginX: number,
    buildingOriginY: number,
    buildingId: string
  ): Array<{ x: number; y: number }> {
    const building = getBuilding(buildingId);
    if (!building) return [];

    const footprint = getBuildingFootprint(building);
    const sidewalkTiles: Array<{ x: number; y: number }> = [];
    const asphaltTiles: Array<{ x: number; y: number }> = [];
    const seen = new Set<string>();

    for (let dy = -1; dy <= footprint.height; dy++) {
      for (let dx = -1; dx <= footprint.width; dx++) {
        const checkX = buildingOriginX + dx;
        const checkY = buildingOriginY + dy;
        const key = `${checkX},${checkY}`;

        if (seen.has(key)) continue;
        seen.add(key);

        if (dx >= 0 && dx < footprint.width && dy >= 0 && dy < footprint.height) continue;

        if (
          checkX >= 0 &&
          checkX < GRID_WIDTH &&
          checkY >= 0 &&
          checkY < GRID_HEIGHT
        ) {
          if (this.isSidewalk(checkX, checkY)) {
            sidewalkTiles.push({ x: checkX, y: checkY });
          } else if (this.isWalkable(checkX, checkY)) {
            asphaltTiles.push({ x: checkX, y: checkY });
          }
        }
      }
    }

    return [...sidewalkTiles, ...asphaltTiles];
  }

  getBuildingAccessTile(
    buildingOriginX: number,
    buildingOriginY: number,
    buildingId: string,
    fromX?: number,
    fromY?: number
  ): { x: number; y: number } | null {
    const adjacentTiles = this.getBuildingAdjacentTiles(buildingOriginX, buildingOriginY, buildingId);
    if (adjacentTiles.length === 0) return null;

    if (fromX === undefined || fromY === undefined) {
      return adjacentTiles[0];
    }

    adjacentTiles.sort((a, b) => {
      const distA = Math.abs(a.x - fromX) + Math.abs(a.y - fromY);
      const distB = Math.abs(b.x - fromX) + Math.abs(b.y - fromY);
      const costA = this.isSidewalk(a.x, a.y) ? 0 : 1;
      const costB = this.isSidewalk(b.x, b.y) ? 0 : 1;
      if (costA !== costB) return costA - costB;
      return distA - distB;
    });

    return adjacentTiles[0];
  }

  // Find closest walkable tile on map edge (for citizens leaving)
  findClosestMapEdge(charX: number, charY: number): { x: number; y: number } | null {
    const tileX = Math.floor(charX);
    const tileY = Math.floor(charY);

    type EdgeCandidate = { x: number; y: number; distance: number };
    let closestRoad: EdgeCandidate | null = null;
    let closestWalkable: EdgeCandidate | null = null;

    const checkEdgeTile = (x: number, y: number) => {
      if (this.isWalkable(x, y) || this.grid[y]?.[x]?.type === TileType.Grass) {
        const distance = Math.abs(x - tileX) + Math.abs(y - tileY);
        if (this.isWalkable(x, y)) {
          if (!closestRoad || distance < closestRoad.distance) {
            closestRoad = { x, y, distance };
          }
        }
        if (!closestWalkable || distance < closestWalkable.distance) {
          closestWalkable = { x, y, distance };
        }
      }
    };

    // Check all four edges
    for (let x = 0; x < GRID_WIDTH; x++) {
      checkEdgeTile(x, 0);
      checkEdgeTile(x, GRID_HEIGHT - 1);
    }
    for (let y = 0; y < GRID_HEIGHT; y++) {
      checkEdgeTile(0, y);
      checkEdgeTile(GRID_WIDTH - 1, y);
    }

    if (closestRoad) {
      return { x: (closestRoad as EdgeCandidate).x, y: (closestRoad as EdgeCandidate).y };
    }
    if (closestWalkable) {
      return { x: (closestWalkable as EdgeCandidate).x, y: (closestWalkable as EdgeCandidate).y };
    }

    return null;
  }

  // Check if citizen has reached map edge
  checkCitizenReachedEdge(char: CharacterWithResidence): boolean {
    const tileX = Math.floor(char.x);
    const tileY = Math.floor(char.y);
    return tileX <= 0 || tileX >= GRID_WIDTH - 1 || tileY <= 0 || tileY >= GRID_HEIGHT - 1;
  }

  // Debug logging helper
  debugLog(charId: string, ...args: unknown[]): void {
    if (!this.debugPathfinding) return;
    if (this.debugLogCounter % 60 === 0) {
      console.log(`[Citizen ${charId.slice(0, 4)}]`, ...args);
    }
  }
}
