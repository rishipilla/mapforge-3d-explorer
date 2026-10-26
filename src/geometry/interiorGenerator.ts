import * as THREE from "three";

export interface InteriorRoom {
  id: string | number;
  name: string;
  type: "office" | "meeting" | "lounge" | "studio" | "corridor" | "restroom" | "storage";
  source: "osm_surveyed" | "demo_generated";
  bounds: THREE.Box2;
  center: THREE.Vector2;
  shape: THREE.Shape;
  color: string;
  furniture: Array<{
    type: "table" | "chair" | "desk" | "sofa" | "shelf" | "plant" | "computer";
    position: [number, number, number];
    rotation?: number;
    scale?: [number, number, number];
  }>;
}

export interface WallSegmentWithDoor {
  start: THREE.Vector2;
  end: THREE.Vector2;
  hasDoor: boolean;
  doorStart?: THREE.Vector2;
  doorEnd?: THREE.Vector2;
}

/**
 * Check if a 2D point is inside a polygon
 */
export function isPointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (
      Math.abs(cross) < 1e-8 &&
      point.x >= Math.min(a.x, b.x) &&
      point.x <= Math.max(a.x, b.x) &&
      point.y >= Math.min(a.y, b.y) &&
      point.y <= Math.max(a.y, b.y)
    ) {
      return true;
    }
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Generates an architectural layout with rooms, corridors, furniture, and doorways
 * for buildings that don't have OSM indoor surveys.
 */
export function generateDemoInterior(
  shape: THREE.Shape,
  floorLevel: number
): {
  rooms: InteriorRoom[];
  wallSegments: Array<[THREE.Vector2, THREE.Vector2]>;
  furnitureItems: Array<{
    id: string;
    type: "table" | "chair" | "desk" | "sofa" | "shelf" | "plant";
    position: [number, number, number];
    rotation: number;
    size: [number, number, number];
    color: string;
  }>;
} {
  const points = shape.getPoints();
  const polygon = points[0]?.equals(points[points.length - 1]) ? points.slice(0, -1) : points;
  const bbox = new THREE.Box2().setFromPoints(polygon);
  const width = bbox.max.x - bbox.min.x;
  const height = bbox.max.y - bbox.min.y;

  // If footprint is too small (< 4m x 4m), return single open studio space
  if (width < 4 || height < 4) {
    const center = new THREE.Vector2((bbox.min.x + bbox.max.x) / 2, (bbox.min.y + bbox.max.y) / 2);
    return {
      rooms: [
        {
          id: `demo-studio-${floorLevel}`,
          name: `Studio Space (Level ${floorLevel})`,
          type: "studio",
          source: "demo_generated",
          bounds: bbox,
          center,
          shape,
          color: "#38bdf8",
          furniture: [],
        },
      ],
      wallSegments: [],
      furnitureItems: [],
    };
  }

  const rooms: InteriorRoom[] = [];
  const wallSegments: Array<[THREE.Vector2, THREE.Vector2]> = [];
  const furnitureItems: Array<{
    id: string;
    type: "table" | "chair" | "desk" | "sofa" | "shelf" | "plant";
    position: [number, number, number];
    rotation: number;
    size: [number, number, number];
    color: string;
  }> = [];

  // Partition the bounding box into a 3x2 or 2x2 grid based on aspect ratio
  const cols = width > 20 ? 3 : 2;
  const rows = height > 20 ? 3 : 2;
  const colW = width / cols;
  const rowH = height / rows;

  const roomTemplates: Array<{
    name: string;
    type: InteriorRoom["type"];
    color: string;
  }> = [
    { name: "Executive Conference Room", type: "meeting", color: "#60a5fa" },
    { name: "Open Collaborative Workspace", type: "office", color: "#34d399" },
    { name: "Creative Design Lounge", type: "lounge", color: "#f59e0b" },
    { name: "Workshop & Prototype Lab", type: "studio", color: "#a78bfa" },
    { name: "Focus & Private Office", type: "office", color: "#38bdf8" },
    { name: "Kitchen & Break Area", type: "lounge", color: "#fb923c" },
  ];

  let roomIndex = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rx1 = bbox.min.x + c * colW;
      const rx2 = rx1 + colW;
      const ry1 = bbox.min.y + r * rowH;
      const ry2 = ry1 + rowH;

      const roomCenter = new THREE.Vector2((rx1 + rx2) / 2, (ry1 + ry2) / 2);

      // Verify room center is actually inside the building footprint
      if (!isPointInPolygon(roomCenter, polygon)) continue;

      const template = roomTemplates[roomIndex % roomTemplates.length];
      roomIndex++;

      const roomBox = new THREE.Box2(new THREE.Vector2(rx1, ry1), new THREE.Vector2(rx2, ry2));

      // Build room shape (inset slightly from outer footprint)
      const roomShape = new THREE.Shape();
      roomShape.moveTo(rx1 + 0.1, ry1 + 0.1);
      roomShape.lineTo(rx2 - 0.1, ry1 + 0.1);
      roomShape.lineTo(rx2 - 0.1, ry2 - 0.1);
      roomShape.lineTo(rx1 + 0.1, ry2 - 0.1);
      roomShape.closePath();

      rooms.push({
        id: `demo-room-${floorLevel}-${roomIndex}`,
        name: `${template.name} (Floor ${floorLevel >= 0 ? floorLevel + 1 : `B${Math.abs(floorLevel)}`})`,
        type: template.type,
        source: "demo_generated",
        bounds: roomBox,
        center: roomCenter,
        shape: roomShape,
        color: template.color,
        furniture: [],
      });

      // Generate furniture based on room type
      const fX = roomCenter.x;
      const fZ = -roomCenter.y; // World Z is -local Y

      if (template.type === "meeting") {
        // Large central conference table + chairs
        furnitureItems.push({
          id: `conf-table-${floorLevel}-${roomIndex}`,
          type: "table",
          position: [fX, 0.4, fZ],
          rotation: 0,
          size: [Math.min(colW * 0.5, 4.0), 0.75, Math.min(rowH * 0.4, 1.8)],
          color: "#92400e", // Warm teak / mahogany
        });
        // Chairs around table
        furnitureItems.push(
          {
            id: `chair-1-${floorLevel}-${roomIndex}`,
            type: "chair",
            position: [fX - 1.2, 0.25, fZ + 1.2],
            rotation: 0,
            size: [0.55, 0.8, 0.55],
            color: "#1e293b",
          },
          {
            id: `chair-2-${floorLevel}-${roomIndex}`,
            type: "chair",
            position: [fX + 1.2, 0.25, fZ + 1.2],
            rotation: 0,
            size: [0.55, 0.8, 0.55],
            color: "#1e293b",
          },
          {
            id: `chair-3-${floorLevel}-${roomIndex}`,
            type: "chair",
            position: [fX - 1.2, 0.25, fZ - 1.2],
            rotation: Math.PI,
            size: [0.55, 0.8, 0.55],
            color: "#1e293b",
          },
          {
            id: `chair-4-${floorLevel}-${roomIndex}`,
            type: "chair",
            position: [fX + 1.2, 0.25, fZ - 1.2],
            rotation: Math.PI,
            size: [0.55, 0.8, 0.55],
            color: "#1e293b",
          }
        );
      } else if (template.type === "office") {
        // Workstation desks with monitors
        furnitureItems.push(
          {
            id: `desk-1-${floorLevel}-${roomIndex}`,
            type: "desk",
            position: [fX - 1.4, 0.38, fZ],
            rotation: 0,
            size: [1.8, 0.75, 0.9],
            color: "#d97706",
          },
          {
            id: `desk-2-${floorLevel}-${roomIndex}`,
            type: "desk",
            position: [fX + 1.4, 0.38, fZ],
            rotation: 0,
            size: [1.8, 0.75, 0.9],
            color: "#d97706",
          },
          {
            id: `plant-${floorLevel}-${roomIndex}`,
            type: "plant",
            position: [fX, 0.3, fZ - Math.min(rowH * 0.35, 1.5)],
            rotation: 0,
            size: [0.6, 1.2, 0.6],
            color: "#15803d",
          }
        );
      } else if (template.type === "lounge") {
        // Sofa + coffee table
        furnitureItems.push(
          {
            id: `sofa-${floorLevel}-${roomIndex}`,
            type: "sofa",
            position: [fX, 0.35, fZ - 0.6],
            rotation: 0,
            size: [2.6, 0.7, 0.9],
            color: "#047857", // Deep green velvet
          },
          {
            id: `coffeetable-${floorLevel}-${roomIndex}`,
            type: "table",
            position: [fX, 0.2, fZ + 0.4],
            rotation: 0,
            size: [1.4, 0.4, 0.7],
            color: "#78350f",
          },
          {
            id: `shelf-${floorLevel}-${roomIndex}`,
            type: "shelf",
            position: [fX - Math.min(colW * 0.4, 1.8), 0.9, fZ],
            rotation: Math.PI / 2,
            size: [0.45, 1.8, 1.6],
            color: "#451a03",
          }
        );
      }
    }
  }

  // Create partition wall segments WITH DOORWAYS
  // Horizontal wall divisions with a 1.1m door opening in the center
  for (let r = 1; r < rows; r++) {
    const yVal = bbox.min.y + r * rowH;
    for (let c = 0; c < cols; c++) {
      const xStart = bbox.min.x + c * colW;
      const xEnd = xStart + colW;
      const xMid = (xStart + xEnd) / 2;
      const doorHalfW = 0.55; // 1.1m wide doorway

      const seg1Start = new THREE.Vector2(xStart, yVal);
      const seg1End = new THREE.Vector2(xMid - doorHalfW, yVal);
      const seg2Start = new THREE.Vector2(xMid + doorHalfW, yVal);
      const seg2End = new THREE.Vector2(xEnd, yVal);

      if (isPointInPolygon(new THREE.Vector2(xStart + 0.5, yVal), polygon)) {
        wallSegments.push([seg1Start, seg1End]);
        wallSegments.push([seg2Start, seg2End]);
      }
    }
  }

  // Vertical wall divisions with a 1.1m door opening in the center
  for (let c = 1; c < cols; c++) {
    const xVal = bbox.min.x + c * colW;
    for (let r = 0; r < rows; r++) {
      const yStart = bbox.min.y + r * rowH;
      const yEnd = yStart + rowH;
      const yMid = (yStart + yEnd) / 2;
      const doorHalfH = 0.55;

      const seg1Start = new THREE.Vector2(xVal, yStart);
      const seg1End = new THREE.Vector2(xVal, yMid - doorHalfH);
      const seg2Start = new THREE.Vector2(xVal, yMid + doorHalfH);
      const seg2End = new THREE.Vector2(xVal, yEnd);

      if (isPointInPolygon(new THREE.Vector2(xVal, yStart + 0.5), polygon)) {
        wallSegments.push([seg1Start, seg1End]);
        wallSegments.push([seg2Start, seg2End]);
      }
    }
  }

  return { rooms, wallSegments, furnitureItems };
}
