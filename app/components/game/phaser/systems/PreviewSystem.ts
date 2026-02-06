import Phaser from "phaser";
import {
  GridCell,
  TileType,
  Direction,
  ToolType,
  GRID_WIDTH,
  GRID_HEIGHT,
  TILE_HEIGHT,
} from "../../types";
import {
  ROAD_SEGMENT_SIZE,
  getRoadSegmentOrigin,
  getRoadConnections,
  getSegmentType,
  generateRoadPattern,
  canPlaceRoadSegment,
} from "../../roadUtils";
import {
  getBuilding,
  getBuildingFootprint,
  BuildingDefinition,
} from "@/app/data/buildings";
import { getSnowTextureKey } from "../utils/constants";

/**
 * Interface for the scene methods/state the preview system needs.
 * Keeps PreviewSystem decoupled from the concrete MainScene class.
 */
export interface PreviewSceneAccess {
  grid: GridCell[][];
  hoverTile: { x: number; y: number } | null;
  selectedTool: ToolType;
  selectedBuildingId: string | null;
  buildingOrientation: Direction;
  isDragging: boolean;
  dragTiles: Set<string>;
  add: Phaser.GameObjects.GameObjectFactory;
  textures: Phaser.Textures.TextureManager;
  gridToScreen(gridX: number, gridY: number): { x: number; y: number };
  depthFromSortPoint(screenX: number, screenY: number, offset: number): number;
  getBuildingTextureKey(building: BuildingDefinition, orientation: Direction): string;
}

/**
 * PreviewSystem manages all preview/ghost sprite rendering for tool placement.
 * Handles road, tile, asphalt, snow, building, and eraser previews.
 */
export class PreviewSystem {
  private previewSprites: Phaser.GameObjects.Image[] = [];
  private lotPreviewSprites: Phaser.GameObjects.Image[] = [];

  clear(): void {
    this.previewSprites.forEach((s) => s.destroy());
    this.previewSprites = [];
    this.lotPreviewSprites.forEach((s) => s.destroy());
    this.lotPreviewSprites = [];
  }

  update(scene: PreviewSceneAccess): void {
    this.clear();

    if (!scene.hoverTile) return;
    if (scene.selectedTool === ToolType.None) return;

    const { x, y } = scene.hoverTile;

    switch (scene.selectedTool) {
      case ToolType.RoadNetwork:
        this.renderRoadPreview(scene, x, y);
        break;
      case ToolType.Tile:
        this.renderTilePreview(scene, x, y, "road", [TileType.Grass, TileType.Snow]);
        break;
      case ToolType.Asphalt:
        this.renderTilePreview(scene, x, y, "asphalt", [TileType.Grass, TileType.Snow, TileType.Tile]);
        break;
      case ToolType.Snow:
        this.renderSnowPreview(scene, x, y);
        break;
      case ToolType.Building:
        this.renderBuildingPreview(scene, x, y);
        break;
      case ToolType.Eraser:
        this.renderEraserPreview(scene, x, y);
        break;
    }
  }

  // ============================================
  // ROAD PREVIEW
  // ============================================

  private renderRoadPreview(scene: PreviewSceneAccess, x: number, y: number): void {
    const segmentsToPreview: Array<{ x: number; y: number }> = [];
    if (scene.isDragging && scene.dragTiles.size > 0) {
      scene.dragTiles.forEach((key) => {
        const [segX, segY] = key.split(",").map(Number);
        segmentsToPreview.push({ x: segX, y: segY });
      });
    } else if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
      const segmentOrigin = getRoadSegmentOrigin(x, y);
      segmentsToPreview.push({ x: segmentOrigin.x, y: segmentOrigin.y });
    }

    for (const seg of segmentsToPreview) {
      const segmentOrigin = { x: seg.x, y: seg.y };
      const placementCheck = canPlaceRoadSegment(
        scene.grid,
        segmentOrigin.x,
        segmentOrigin.y
      );
      const segmentHasCollision = !placementCheck.valid;

      const tempGrid: GridCell[][] = scene.grid.map((row) =>
        row.map((cell) => ({ ...cell }))
      );

      for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
        for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
          const px = segmentOrigin.x + dx;
          const py = segmentOrigin.y + dy;
          if (px < GRID_WIDTH && py < GRID_HEIGHT) {
            tempGrid[py][px].isOrigin = dx === 0 && dy === 0;
            tempGrid[py][px].originX = segmentOrigin.x;
            tempGrid[py][px].originY = segmentOrigin.y;
            tempGrid[py][px].type = TileType.Road;
          }
        }
      }

      const connections = getRoadConnections(
        tempGrid,
        segmentOrigin.x,
        segmentOrigin.y
      );
      const segmentType = getSegmentType(connections);
      const pattern = generateRoadPattern(segmentType);

      for (const tile of pattern) {
        const px = segmentOrigin.x + tile.dx;
        const py = segmentOrigin.y + tile.dy;
        if (px < GRID_WIDTH && py < GRID_HEIGHT) {
          const screenPos = scene.gridToScreen(px, py);
          const textureKey =
            tile.type === TileType.Asphalt ? "asphalt" : "road";
          const preview = scene.add.image(
            screenPos.x,
            screenPos.y,
            textureKey
          );
          preview.setOrigin(0.5, 0);
          preview.setAlpha(segmentHasCollision ? 0.3 : 0.7);
          if (segmentHasCollision) preview.setTint(0xff0000);
          preview.setDepth(
            scene.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
          );
          this.previewSprites.push(preview);
        }
      }
    }
  }

  // ============================================
  // TILE / ASPHALT PREVIEW (shared logic)
  // ============================================

  private renderTilePreview(
    scene: PreviewSceneAccess,
    x: number,
    y: number,
    textureKey: string,
    allowedTileTypes: TileType[]
  ): void {
    const tilesToPreview = this.getTilesToPreview(scene, x, y);

    for (const tile of tilesToPreview) {
      const tx = tile.x;
      const ty = tile.y;
      if (tx >= 0 && tx < GRID_WIDTH && ty >= 0 && ty < GRID_HEIGHT) {
        const cell = scene.grid[ty]?.[tx];
        let hasCollision = false;
        if (cell) {
          if (cell.type === TileType.Building && cell.buildingId) {
            const existingBuilding = getBuilding(cell.buildingId);
            hasCollision =
              !existingBuilding ||
              (!existingBuilding.isDecoration &&
                existingBuilding.category !== "props");
          } else if (!allowedTileTypes.includes(cell.type)) {
            hasCollision = true;
          }
        }
        const screenPos = scene.gridToScreen(tx, ty);
        const preview = scene.add.image(screenPos.x, screenPos.y, textureKey);
        preview.setOrigin(0.5, 0);
        preview.setAlpha(hasCollision ? 0.3 : 0.7);
        if (hasCollision) preview.setTint(0xff0000);
        preview.setDepth(
          scene.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
        );
        this.previewSprites.push(preview);
      }
    }
  }

  // ============================================
  // SNOW PREVIEW
  // ============================================

  private renderSnowPreview(scene: PreviewSceneAccess, x: number, y: number): void {
    const tilesToPreview = this.getTilesToPreview(scene, x, y);

    for (const tile of tilesToPreview) {
      const tx = tile.x;
      const ty = tile.y;
      if (tx >= 0 && tx < GRID_WIDTH && ty >= 0 && ty < GRID_HEIGHT) {
        const cell = scene.grid[ty]?.[tx];
        let hasCollision = false;
        if (cell) {
          if (cell.type === TileType.Building && cell.buildingId) {
            const existingBuilding = getBuilding(cell.buildingId);
            hasCollision =
              !existingBuilding ||
              (!existingBuilding.isDecoration &&
                existingBuilding.category !== "props");
          } else if (
            cell.type !== TileType.Grass &&
            cell.type !== TileType.Tile
          ) {
            hasCollision = true;
          }
        }
        const screenPos = scene.gridToScreen(tx, ty);
        const preview = scene.add.image(
          screenPos.x,
          screenPos.y,
          getSnowTextureKey(tx, ty)
        );
        preview.setOrigin(0.5, 0);
        preview.setScale(0.5); // Snow tiles are 88x44, need to halve
        preview.setAlpha(hasCollision ? 0.3 : 0.7);
        if (hasCollision) preview.setTint(0xff0000);
        preview.setDepth(
          scene.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
        );
        this.previewSprites.push(preview);
      }
    }
  }

  // ============================================
  // BUILDING PREVIEW
  // ============================================

  private renderBuildingPreview(scene: PreviewSceneAccess, x: number, y: number): void {
    if (!scene.selectedBuildingId) return;
    const building = getBuilding(scene.selectedBuildingId);
    if (!building) return;

    const footprint = getBuildingFootprint(building, scene.buildingOrientation);
    const originX = x - footprint.width + 1;
    const originY = y - footprint.height + 1;

    const isDecoration =
      building.category === "props" || building.isDecoration;
    let footprintCollision = false;
    for (let dy = 0; dy < footprint.height; dy++) {
      for (let dx = 0; dx < footprint.width; dx++) {
        const tileX = originX + dx;
        const tileY = originY + dy;
        if (
          tileX < 0 ||
          tileY < 0 ||
          tileX >= GRID_WIDTH ||
          tileY >= GRID_HEIGHT
        ) {
          footprintCollision = true;
        } else {
          const cell = scene.grid[tileY]?.[tileX];
          if (cell) {
            const cellType = cell.type;
            if (isDecoration) {
              if (cellType === TileType.Building) {
                footprintCollision = true;
              } else if (
                cellType !== TileType.Grass &&
                cellType !== TileType.Tile &&
                cellType !== TileType.Snow
              ) {
                footprintCollision = true;
              }
            } else {
              if (cellType !== TileType.Grass) {
                footprintCollision = true;
              }
            }
          }
        }
      }
    }

    // Show lot tiles for non-decorative buildings
    if (!isDecoration) {
      for (let dy = 0; dy < footprint.height; dy++) {
        for (let dx = 0; dx < footprint.width; dx++) {
          const tileX = originX + dx;
          const tileY = originY + dy;
          if (
            tileX >= 0 &&
            tileY >= 0 &&
            tileX < GRID_WIDTH &&
            tileY < GRID_HEIGHT
          ) {
            const screenPos = scene.gridToScreen(tileX, tileY);
            const lotTile = scene.add.image(screenPos.x, screenPos.y, "road");
            lotTile.setOrigin(0.5, 0);
            lotTile.setAlpha(footprintCollision ? 0.3 : 0.5);
            if (footprintCollision) lotTile.setTint(0xff0000);
            lotTile.setDepth(
              scene.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
            );
            this.previewSprites.push(lotTile);
          }
        }
      }
    }

    // Show building preview sprite
    const textureKey = scene.getBuildingTextureKey(
      building,
      scene.buildingOrientation
    );
    if (scene.textures.exists(textureKey)) {
      const frontX = originX + footprint.width - 1;
      const frontY = originY + footprint.height - 1;
      const screenPos = scene.gridToScreen(frontX, frontY);
      const bottomY = screenPos.y + TILE_HEIGHT;
      const frontGroundY = screenPos.y + TILE_HEIGHT / 2;

      const buildingPreview = scene.add.image(
        screenPos.x,
        bottomY,
        textureKey
      );
      buildingPreview.setOrigin(0.5, 1);
      buildingPreview.setAlpha(0.7);

      if (footprintCollision) {
        buildingPreview.setTint(0xff0000);
      } else if (scene.selectedBuildingId === "flower-bush") {
        buildingPreview.setTint(0xbbddbb);
      }

      buildingPreview.setDepth(
        scene.depthFromSortPoint(screenPos.x, frontGroundY, 1_000_000)
      );
      this.previewSprites.push(buildingPreview);
    }
  }

  // ============================================
  // ERASER PREVIEW
  // ============================================

  private renderEraserPreview(scene: PreviewSceneAccess, x: number, y: number): void {
    const tilesToPreview: Array<{ x: number; y: number }> = [];
    if (scene.isDragging && scene.dragTiles.size > 0) {
      scene.dragTiles.forEach((key) => {
        const [tx, ty] = key.split(",").map(Number);
        tilesToPreview.push({ x: tx, y: ty });
      });
    } else {
      tilesToPreview.push({ x, y });
    }

    const previewedTiles = new Set<string>();

    for (const tile of tilesToPreview) {
      const tx = tile.x;
      const ty = tile.y;
      if (tx < 0 || tx >= GRID_WIDTH || ty < 0 || ty >= GRID_HEIGHT) continue;

      const cell = scene.grid[ty]?.[tx];

      if (!cell || cell.type === TileType.Grass) {
        // Show faded red grass for empty tiles
        if (!previewedTiles.has(`${tx},${ty}`)) {
          previewedTiles.add(`${tx},${ty}`);
          const screenPos = scene.gridToScreen(tx, ty);
          const preview = scene.add.image(screenPos.x, screenPos.y, "grass");
          preview.setOrigin(0.5, 0);
          preview.setAlpha(0.3);
          preview.setTint(0xff0000);
          preview.setDepth(
            scene.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
          );
          this.previewSprites.push(preview);
        }
      } else {
        const originX = cell.originX ?? tx;
        const originY = cell.originY ?? ty;
        const cellType = cell.type;

        const isRoadSegment =
          originX % ROAD_SEGMENT_SIZE === 0 &&
          originY % ROAD_SEGMENT_SIZE === 0 &&
          (cellType === TileType.Road || cellType === TileType.Asphalt);

        if (isRoadSegment) {
          this.renderEraserRoadSegment(scene, originX, originY, previewedTiles);
        } else if (cellType === TileType.Building && cell.buildingId) {
          this.renderEraserBuilding(scene, cell, originX, originY, previewedTiles);
        } else {
          this.renderEraserSingleTile(scene, tx, ty, cellType, previewedTiles);
        }
      }
    }
  }

  private renderEraserRoadSegment(
    scene: PreviewSceneAccess,
    originX: number,
    originY: number,
    previewedTiles: Set<string>
  ): void {
    for (let dy = 0; dy < ROAD_SEGMENT_SIZE; dy++) {
      for (let dx = 0; dx < ROAD_SEGMENT_SIZE; dx++) {
        const px = originX + dx;
        const py = originY + dy;
        if (
          px < GRID_WIDTH &&
          py < GRID_HEIGHT &&
          !previewedTiles.has(`${px},${py}`)
        ) {
          previewedTiles.add(`${px},${py}`);
          const tileCell = scene.grid[py]?.[px];
          if (tileCell && tileCell.type !== TileType.Grass) {
            const screenPos = scene.gridToScreen(px, py);
            const textureKey =
              tileCell.type === TileType.Asphalt ? "asphalt" : "road";
            const preview = scene.add.image(
              screenPos.x,
              screenPos.y,
              textureKey
            );
            preview.setOrigin(0.5, 0);
            preview.setAlpha(0.7);
            preview.setTint(0xff0000);
            preview.setDepth(
              scene.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
            );
            this.previewSprites.push(preview);
          }
        }
      }
    }
  }

  private renderEraserBuilding(
    scene: PreviewSceneAccess,
    cell: GridCell,
    originX: number,
    originY: number,
    previewedTiles: Set<string>
  ): void {
    const building = getBuilding(cell.buildingId!);
    if (!building) return;

    const orientation = cell.buildingOrientation ?? Direction.Down;
    const footprint = getBuildingFootprint(building, orientation);
    const buildingKey = `building_${originX},${originY}`;

    if (previewedTiles.has(buildingKey)) return;
    previewedTiles.add(buildingKey);

    for (let dy = 0; dy < footprint.height; dy++) {
      for (let dx = 0; dx < footprint.width; dx++) {
        const px = originX + dx;
        const py = originY + dy;
        if (px < GRID_WIDTH && py < GRID_HEIGHT) {
          previewedTiles.add(`${px},${py}`);
          const screenPos = scene.gridToScreen(px, py);
          const preview = scene.add.image(screenPos.x, screenPos.y, "road");
          preview.setOrigin(0.5, 0);
          preview.setAlpha(0.7);
          preview.setTint(0xff0000);
          preview.setDepth(
            scene.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
          );
          this.previewSprites.push(preview);
        }
      }
    }

    // Show building sprite in red
    const textureKey = scene.getBuildingTextureKey(
      building,
      orientation
    );
    if (scene.textures.exists(textureKey)) {
      const frontX = originX + footprint.width - 1;
      const frontY = originY + footprint.height - 1;
      const screenPos = scene.gridToScreen(frontX, frontY);
      const bottomY = screenPos.y + TILE_HEIGHT;
      const frontGroundY = screenPos.y + TILE_HEIGHT / 2;

      const buildingPreview = scene.add.image(
        screenPos.x,
        bottomY,
        textureKey
      );
      buildingPreview.setOrigin(0.5, 1);
      buildingPreview.setAlpha(0.7);
      buildingPreview.setTint(0xff0000);
      buildingPreview.setDepth(
        scene.depthFromSortPoint(screenPos.x, frontGroundY, 1_000_000)
      );
      this.previewSprites.push(buildingPreview);
    }
  }

  private renderEraserSingleTile(
    scene: PreviewSceneAccess,
    tx: number,
    ty: number,
    cellType: TileType,
    previewedTiles: Set<string>
  ): void {
    if (previewedTiles.has(`${tx},${ty}`)) return;
    previewedTiles.add(`${tx},${ty}`);

    const screenPos = scene.gridToScreen(tx, ty);
    let textureKey = "grass";
    if (cellType === TileType.Asphalt) textureKey = "asphalt";
    else if (cellType === TileType.Road || cellType === TileType.Tile)
      textureKey = "road";
    else if (cellType === TileType.Snow)
      textureKey = getSnowTextureKey(tx, ty);

    const preview = scene.add.image(screenPos.x, screenPos.y, textureKey);
    preview.setOrigin(0.5, 0);
    if (textureKey.startsWith("snow_")) preview.setScale(0.5);
    preview.setAlpha(0.7);
    preview.setTint(0xff0000);
    preview.setDepth(
      scene.depthFromSortPoint(screenPos.x, screenPos.y, 1_000_000)
    );
    this.previewSprites.push(preview);
  }

  // ============================================
  // HELPERS
  // ============================================

  private getTilesToPreview(
    scene: PreviewSceneAccess,
    x: number,
    y: number
  ): Array<{ x: number; y: number }> {
    const tiles: Array<{ x: number; y: number }> = [];
    if (scene.isDragging && scene.dragTiles.size > 0) {
      scene.dragTiles.forEach((key) => {
        const [tx, ty] = key.split(",").map(Number);
        tiles.push({ x: tx, y: ty });
      });
    } else if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
      tiles.push({ x, y });
    }
    return tiles;
  }
}
