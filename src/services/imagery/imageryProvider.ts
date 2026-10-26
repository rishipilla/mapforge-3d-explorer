import * as THREE from "three";
import type { Projection } from "@/state/areaStore";

export interface ImageryProvider {
  id: string;
  name: string;
  attribution: string;
  getUrl: (x: number, y: number, z: number) => string;
  maxZoom: number;
}

export const IMAGERY_PROVIDERS: Record<string, ImageryProvider> = {
  carto_positron: {
    id: "carto_positron",
    name: "CartoDB Positron (Light Minimal)",
    attribution: "© OpenStreetMap contributors, © CARTO",
    getUrl: (x, y, z) => `https://a.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`,
    maxZoom: 19,
  },
  carto_dark: {
    id: "carto_dark",
    name: "CartoDB Dark Matter",
    attribution: "© OpenStreetMap contributors, © CARTO",
    getUrl: (x, y, z) => `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`,
    maxZoom: 19,
  },
  osm_standard: {
    id: "osm_standard",
    name: "OpenStreetMap Standard",
    attribution: "© OpenStreetMap contributors",
    getUrl: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    maxZoom: 19,
  },
};

/**
 * Convert latitude and longitude to Slippy Map tile numbers at given zoom level
 */
export function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const rad = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

/**
 * Convert tile coordinates back to lat/lon bounds
 */
export function tileToBBox(x: number, y: number, zoom: number): {
  north: number;
  south: number;
  west: number;
  east: number;
} {
  const n = Math.pow(2, zoom);
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;

  const latRadNorth = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const latRadSouth = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));

  const north = (latRadNorth * 180) / Math.PI;
  const south = (latRadSouth * 180) / Math.PI;

  return { north, south, west, east };
}

/**
 * Creates a combined canvas texture from aerial/map raster tiles aligned with the 3D scene bbox
 */
export async function createStitchedGroundTexture(
  projection: Projection,
  providerKey = "carto_positron",
  targetResolution = 1024
): Promise<{ texture: THREE.CanvasTexture; attribution: string } | null> {
  const provider = IMAGERY_PROVIDERS[providerKey];
  if (!provider) return null;

  const { bbox } = projection;
  const latSpan = bbox.maxLat - bbox.minLat;

  // Choose appropriate zoom level (e.g. 15-18 based on span)
  let zoom = 16;
  if (latSpan > 0.05) zoom = 14;
  else if (latSpan > 0.02) zoom = 15;
  else if (latSpan < 0.005) zoom = 17;

  zoom = Math.min(zoom, provider.maxZoom);

  const topLeftTile = latLngToTile(bbox.maxLat, bbox.minLng, zoom);
  const bottomRightTile = latLngToTile(bbox.minLat, bbox.maxLng, zoom);

  const minX = Math.min(topLeftTile.x, bottomRightTile.x);
  const maxX = Math.max(topLeftTile.x, bottomRightTile.x);
  const minY = Math.min(topLeftTile.y, bottomRightTile.y);
  const maxY = Math.max(topLeftTile.y, bottomRightTile.y);

  const tileCols = maxX - minX + 1;
  const tileRows = maxY - minY + 1;

  // Prevent downloading too many tiles
  if (tileCols * tileRows > 25) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetResolution;
  canvas.height = targetResolution;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Background fallback
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tileWidthPx = canvas.width / tileCols;
  const tileHeightPx = canvas.height / tileRows;

  const loadPromises: Array<Promise<void>> = [];

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const colIdx = tx - minX;
      const rowIdx = ty - minY;
      const url = provider.getUrl(tx, ty, zoom);

      const p = new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          ctx.drawImage(
            img,
            colIdx * tileWidthPx,
            rowIdx * tileHeightPx,
            tileWidthPx,
            tileHeightPx
          );
          resolve();
        };
        img.onerror = () => {
          // If tile fails to load, gracefully continue
          resolve();
        };
        img.src = url;
      });
      loadPromises.push(p);
    }
  }

  await Promise.all(loadPromises);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  return { texture, attribution: provider.attribution };
}
