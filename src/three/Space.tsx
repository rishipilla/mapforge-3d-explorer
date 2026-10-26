import { useEffect, useRef, useMemo, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useAreaStore } from "@/state/areaStore";
import { Edges, Html, Environment } from "@react-three/drei";
import * as THREE from "three";
import { useActionStore } from "@/state/exportStore";
import type { IndoorFeature } from "@/state/areaStore";
import { GLTFExporter } from "three/examples/jsm/Addons.js";
import Car from "./Car";
import instanceFleet from "@/api/axios";
import { getBuildingStyle, ArchitecturalMaterials } from "@/materials/buildingMaterials";
import { generateDemoInterior, type InteriorRoom } from "@/geometry/interiorGenerator";

const ROAD_MAT = new THREE.MeshStandardMaterial({ color: "#364253", roughness: 0.92 });
const PATH_MAT = new THREE.MeshStandardMaterial({ color: "#728096", roughness: 0.9 });
const BUILDING_MAT = new THREE.MeshStandardMaterial({ color: "#aeb9c5", roughness: 0.82 });
const BUILDING_ACTIVE_MAT = new THREE.MeshStandardMaterial({ color: "#60a5fa", roughness: 0.62 });
// Opaque ground material used in GLB export
const GROUND_MAT = new THREE.MeshStandardMaterial({ color: "#888888", roughness: 1, metalness: 0 });
// Ghost version shown in the browser preview — same colour, barely visible
const GROUND_PREVIEW_MAT = new THREE.MeshStandardMaterial({ color: "#64748b", roughness: 1, metalness: 0, transparent: true, opacity: 0.34, depthWrite: false });

// ── New feature materials ──────────────────────────────────────────────────
const PARK_MAT    = new THREE.MeshStandardMaterial({ color: "#4a7c59", roughness: 1, metalness: 0 });
const WATER_MAT   = new THREE.MeshStandardMaterial({ color: "#2c5f7a", roughness: 0.3, metalness: 0 });
const FOREST_MAT  = new THREE.MeshStandardMaterial({ color: "#2d5a27", roughness: 1, metalness: 0 });
const RAILWAY_MAT = new THREE.MeshStandardMaterial({ color: "#2a2a2a", roughness: 1, metalness: 0 });
const PILLAR_MAT  = new THREE.MeshStandardMaterial({ color: "#5a5a5a", roughness: 0.8, metalness: 0 });

// ── Y offsets (scene units) ────────────────────────────────────────────────
const BRIDGE_Y           =  3.0;
const PARK_Y             = -0.02;
const WATER_POLYGON_Y    = -0.05;
const WATER_RIBBON_Y     = -0.04;
const FOREST_Y           = -0.01;
const RAILWAY_Y          =  0.02;

// ── Polyline half-widths for new ribbon features ───────────────────────────
const RIVER_HALF_WIDTH   = 4.0;
const STREAM_HALF_WIDTH  = 1.0;
const RAILWAY_HALF_WIDTH = 0.8;

// ── Flat extrude settings (thin slab for ground-level polygons) ────────────
const FLAT_EXTRUDE = { steps: 1, depth: 0.05, bevelEnabled: false } as const;

const MAX_BUILDING_FLOORS = 40;
const DEFAULT_BUILDING_HEIGHT = 10;
const DEFAULT_FLOOR_HEIGHT = 2.8;
const REPORTED_LEVEL_HEIGHT = 2.2;
const FLOOR_SLAB_THICKNESS = 0.3;
const DEFAULT_EXPLODED_FLOOR_GAP_RATIO = 0.5;
const BUILDING_FLOOR_HIGHLIGHT_MAT = new THREE.MeshStandardMaterial({
  color: "#38bdf8",
  roughness: 0.52,
  metalness: 0.04,
  emissive: "#075985",
  emissiveIntensity: 0.16,
});
const INDOOR_ROOM_MAT = new THREE.MeshBasicMaterial({
  color: "#38bdf8",
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const INDOOR_CORRIDOR_MAT = new THREE.MeshBasicMaterial({
  color: "#94a3b8",
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const INDOOR_SELECTED_MAT = new THREE.MeshBasicMaterial({
  color: "#f59e0b",
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  side: THREE.DoubleSide,
});

type ProjectedIndoorFeature = {
  id: number | string;
  tags: Record<string, string>;
  paths: Array<{ role: string; points: THREE.Vector2[] }>;
  center: THREE.Vector2;
};

function getIndoorFeatureLevels(tags: Record<string, string>): number[] | null {
  if (!tags.level) return null;
  const parsed = tags.level.split(";").flatMap((rawLevel) => {
    const level = rawLevel.trim();
    const range = level.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || Math.abs(end - start) > 40) {
        return [];
      }
      const step = start <= end ? 1 : -1;
      return Array.from(
        { length: Math.floor(Math.abs(end - start)) + 1 },
        (_, index) => Math.round(start + index * step)
      );
    }
    const value = Number(level);
    return Number.isFinite(value) ? [Math.round(value)] : [];
  });
  const unique = [...new Set(parsed)];
  return unique.length > 0 ? unique : null;
}

function makeClosedShape(points: THREE.Vector2[]): THREE.Shape | null {
  if (points.length < 4 || !points[0].equals(points[points.length - 1])) return null;
  const shape = new THREE.Shape();
  shape.moveTo(points[0].x, points[0].y);
  points.slice(1, -1).forEach((point) => shape.lineTo(point.x, point.y));
  shape.closePath();
  return shape;
}

function hasRenderableIndoorGeometry(feature: ProjectedIndoorFeature): boolean {
  const indoor = feature.tags.indoor;
  return feature.paths.some((path) => {
    if (
      (indoor === "room" || indoor === "corridor" || indoor === "ceiling") &&
      path.role === "outer" &&
      makeClosedShape(path.points)
    ) {
      return true;
    }
    if (
      (indoor === "wall" ||
        indoor === "door" ||
        indoor === "window" ||
        Boolean(feature.tags.door) ||
        Boolean(feature.tags.window) ||
        Boolean(feature.tags.entrance)) &&
      path.points.length >= 2
    ) {
      return true;
    }
    return (
      (indoor === "door" || Boolean(feature.tags.door) || Boolean(feature.tags.entrance)) &&
      path.role === "point"
    );
  });
}

function getProceduralPartitionSegments(
  shape: THREE.Shape
): Array<[THREE.Vector2, THREE.Vector2]> {
  const points = shape.getPoints();
  const polygon =
    points[0]?.equals(points[points.length - 1]) ? points.slice(0, -1) : points;
  const bounds = new THREE.Box2().setFromPoints(polygon);
  const segments: Array<[THREE.Vector2, THREE.Vector2]> = [];
  const addPartition = (vertical: boolean, value: number) => {
    const min = vertical ? bounds.min.y : bounds.min.x;
    const max = vertical ? bounds.max.y : bounds.max.x;
    const sampleCount = 128;
    let start: THREE.Vector2 | null = null;
    let lastInside: THREE.Vector2 | null = null;
    const save = () => {
      if (start && lastInside && start.distanceTo(lastInside) > 0.25) {
        segments.push([start, lastInside]);
      }
      start = null;
      lastInside = null;
    };
    for (let index = 0; index <= sampleCount; index += 1) {
      const along = min + ((max - min) * index) / sampleCount;
      const point = vertical
        ? new THREE.Vector2(value, along)
        : new THREE.Vector2(along, value);
      if (isPointInPolygon(point, polygon)) {
        start ??= point;
        lastInside = point;
      } else {
        save();
      }
    }
    save();
  };
  for (let division = 1; division <= 2; division += 1) {
    const fraction = division / 3;
    addPartition(true, bounds.min.x + (bounds.max.x - bounds.min.x) * fraction);
    addPartition(false, bounds.min.y + (bounds.max.y - bounds.min.y) * fraction);
  }
  return segments;
}

function isPointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const cross =
      (point.x - a.x) * (b.y - a.y) -
      (point.y - a.y) * (b.x - a.x);
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
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function MappedIndoorFeature({
  feature,
  floorLabel,
  selected,
  onSelect,
  floorSurfaceHeight,
}: {
  feature: ProjectedIndoorFeature;
  floorLabel: string;
  selected: boolean;
  onSelect: () => void;
  floorSurfaceHeight: number;
}) {
  const areaGeometry = useMemo(() => {
    if (
      feature.tags.indoor !== "room" &&
      feature.tags.indoor !== "corridor" &&
      feature.tags.indoor !== "ceiling"
    ) {
      return [];
    }
    return feature.paths.flatMap((path) => {
      if (path.role !== "outer") return [];
      const shape = makeClosedShape(path.points);
      return shape ? [new THREE.ShapeGeometry(shape)] : [];
    });
  }, [feature]);
  const lineGeometry = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (const path of feature.paths) {
      if (
        feature.tags.indoor === "wall" ||
        path.points.length < 2 ||
        (path.role === "outer" &&
          (feature.tags.indoor === "room" || feature.tags.indoor === "corridor") &&
          makeClosedShape(path.points))
      ) {
        continue;
      }
      for (let index = 1; index < path.points.length; index += 1) {
        const start = path.points[index - 1];
        const end = path.points[index];
        points.push(
          new THREE.Vector3(start.x, floorSurfaceHeight + 0.045, -start.y),
          new THREE.Vector3(end.x, floorSurfaceHeight + 0.045, -end.y)
        );
      }
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return geometry;
  }, [feature, floorSurfaceHeight]);

  useEffect(() => {
    return () => {
      areaGeometry.forEach((geometry) => geometry.dispose());
      lineGeometry.dispose();
    };
  }, [areaGeometry, lineGeometry]);

  const material = selected
    ? INDOOR_SELECTED_MAT
    : feature.tags.indoor === "corridor"
      ? INDOOR_CORRIDOR_MAT
      : INDOOR_ROOM_MAT;
  const point = feature.paths.find((path) => path.role === "point")?.points[0];
  const hasEntrance =
    Boolean(feature.tags.entrance) ||
    Boolean(feature.tags.door) ||
    feature.tags.indoor === "door";
  const label =
    feature.tags["room:name"] ||
    feature.tags.name ||
    feature.tags.ref ||
    (feature.tags.indoor === "room" ? `Room ${feature.id}` : feature.tags.indoor);

  return (
    <group>
      {areaGeometry.map((geometry, index) => (
        <mesh
          key={`area-${index}`}
          geometry={geometry}
          material={material}
          position={[
            0,
            floorSurfaceHeight +
              (feature.tags.indoor === "ceiling" ? 2.5 : 0.025),
            0,
          ]}
          rotation={[-Math.PI / 2, 0, 0]}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        />
      ))}
      {lineGeometry.getAttribute("position").count > 0 && (
        <lineSegments geometry={lineGeometry}>
          <lineBasicMaterial color="#0f5d86" />
        </lineSegments>
      )}
      {feature.tags.indoor === "wall" &&
        feature.paths.flatMap((path) =>
          path.points.slice(1).map((end, index) => {
            const start = path.points[index];
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.hypot(dx, dy);
            return length > 0 ? (
              <mesh
                key={`wall-${index}`}
                position={[
                  (start.x + end.x) / 2,
                  floorSurfaceHeight + 1.25,
                  -(start.y + end.y) / 2,
                ]}
                rotation={[0, Math.atan2(dy, dx), 0]}
              >
                <boxGeometry args={[length, 2.5, 0.12]} />
                <meshStandardMaterial color="#d1d5db" roughness={0.85} />
              </mesh>
            ) : null;
          })
        )}
      {hasEntrance && point && (
        <mesh position={[point.x, floorSurfaceHeight + 0.12, -point.y]}>
          <sphereGeometry args={[0.12, 8, 6]} />
          <meshBasicMaterial color="#fbbf24" />
        </mesh>
      )}
      {(feature.tags.indoor === "room" || feature.tags.indoor === "corridor") && (
        <Html
          position={[feature.center.x, floorSurfaceHeight + 0.11, -feature.center.y]}
          center
          distanceFactor={35}
          style={{ pointerEvents: "none" }}
        >
          <div
            style={{
              padding: "2px 5px",
              borderRadius: "3px",
              background: selected ? "#b45309" : "rgba(15, 23, 42, 0.8)",
              color: "#fff",
              font: "600 10px system-ui, sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            {label} · {floorLabel}
          </div>
        </Html>
      )}
    </group>
  );
}

function ProceduralInterior({
  shape,
  floorSurfaceHeight,
  floorLevel,
  selectedRoomId,
  onRoomSelect,
}: {
  shape: THREE.Shape;
  floorSurfaceHeight: number;
  floorLevel: number;
  selectedRoomId?: string | number | null;
  onRoomSelect?: (room: InteriorRoom) => void;
}) {
  const { rooms, wallSegments, furnitureItems } = useMemo(
    () => generateDemoInterior(shape, floorLevel),
    [shape, floorLevel]
  );

  return (
    <group userData={{ exportToGLB: true }}>
      {/* Selectable Room Floor Surfaces with warm wood/tinted finish */}
      {rooms.map((room) => {
        const isSelected = selectedRoomId === room.id;
        return (
          <group key={room.id}>
            <mesh
              position={[0, floorSurfaceHeight + 0.02, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(e) => {
                e.stopPropagation();
                onRoomSelect?.(room);
              }}
            >
              <shapeGeometry args={[room.shape]} />
              <meshStandardMaterial
                color={isSelected ? "#38bdf8" : room.color}
                roughness={0.65}
                transparent
                opacity={isSelected ? 0.65 : 0.28}
                depthWrite={false}
              />
            </mesh>
            {/* Interactive Room Label */}
            <Html
              position={[room.center.x, floorSurfaceHeight + 0.35, -room.center.y]}
              center
              distanceFactor={32}
              style={{ pointerEvents: "none" }}
            >
              <div
                style={{
                  padding: "3px 6px",
                  borderRadius: "4px",
                  background: isSelected ? "rgba(2, 132, 199, 0.95)" : "rgba(15, 23, 42, 0.85)",
                  color: "#fff",
                  font: "600 10px system-ui, sans-serif",
                  whiteSpace: "nowrap",
                  border: isSelected ? "1px solid #38bdf8" : "1px solid rgba(255,255,255,0.15)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "1px",
                }}
              >
                <span>{room.name}</span>
                <span style={{ fontSize: "8px", color: isSelected ? "#e0f2fe" : "#f59e0b", fontWeight: 700 }}>
                  DEMO INTERIOR
                </span>
              </div>
            </Html>
          </group>
        );
      })}

      {/* Architectural Partition Walls with Doorways */}
      {wallSegments.map(([start, end], index) => {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.1) return null;
        const wallHeight = 2.4;
        return (
          <mesh
            key={`wall-${index}`}
            position={[
              (start.x + end.x) / 2,
              floorSurfaceHeight + wallHeight / 2,
              -(start.y + end.y) / 2,
            ]}
            rotation={[0, Math.atan2(dy, dx), 0]}
            userData={{ exportToGLB: true }}
          >
            <boxGeometry args={[length, wallHeight, 0.12]} />
            <meshStandardMaterial
              color="#e2e8f0"
              roughness={0.88}
              metalness={0.02}
            />
          </mesh>
        );
      })}

      {/* Architectural Low-Poly Furniture (Tables, Chairs, Desks, Sofas, Plants) */}
      {furnitureItems.map((item) => (
        <mesh
          key={item.id}
          position={[
            item.position[0],
            floorSurfaceHeight + item.position[1],
            item.position[2],
          ]}
          rotation={[0, item.rotation, 0]}
          userData={{ exportToGLB: true }}
        >
          <boxGeometry args={item.size} />
          <meshStandardMaterial
            color={item.color}
            roughness={item.type === "plant" ? 0.9 : 0.6}
            metalness={item.type === "chair" ? 0.3 : 0.05}
          />
        </mesh>
      ))}
    </group>
  );
}

function distanceToSegment(point: THREE.Vector2, start: THREE.Vector2, end: THREE.Vector2) {
  const segment = end.clone().sub(start);
  const lengthSquared = segment.lengthSq();
  if (lengthSquared === 0) return point.distanceTo(start);
  const fraction = THREE.MathUtils.clamp(
    point.clone().sub(start).dot(segment) / lengthSquared,
    0,
    1
  );
  return point.distanceTo(start.clone().addScaledVector(segment, fraction));
}

function FirstPersonWalkthrough({
  shape,
  floorLevel,
  floorHeight,
  wallSegments,
  onExit,
}: {
  shape: THREE.Shape;
  floorLevel: number;
  floorHeight: number;
  wallSegments: Array<[THREE.Vector2, THREE.Vector2]>;
  onExit: () => void;
}) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const pitch = useRef(0);
  const position = useRef(new THREE.Vector3());
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const outline = useMemo(() => {
    const points = shape.getPoints();
    return points[0]?.equals(points[points.length - 1]) ? points.slice(0, -1) : points;
  }, [shape]);
  const centroid = useMemo(() => {
    const sum = outline.reduce((result, point) => result.add(point), new THREE.Vector2());
    return outline.length ? sum.multiplyScalar(1 / outline.length) : new THREE.Vector2();
  }, [outline]);

  useEffect(() => {
    const floorY = floorLevel * floorHeight;
    position.current.set(centroid.x, floorY + 1.65, -centroid.y);
    camera.position.copy(position.current);
    camera.rotation.order = "YXZ";
    camera.rotation.set(0, yaw.current, 0);

    const element = gl.domElement;
    const handleClick = () => {
      if (document.pointerLockElement !== element) {
        void element.requestPointerLock();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
        keys.current.add(key);
      }
      if (key === "escape") {
        if (document.pointerLockElement === element) document.exitPointerLock();
        onExitRef.current();
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    const handleMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== element) return;
      yaw.current -= event.movementX * 0.002;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - event.movementY * 0.002,
        -Math.PI / 2.4,
        Math.PI / 2.4
      );
    };
    element.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      element.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("mousemove", handleMouseMove);
      keys.current.clear();
      if (document.pointerLockElement === element) document.exitPointerLock();
    };
  }, [camera, centroid, floorHeight, floorLevel, gl]);

  useFrame((_, delta) => {
    const input = keys.current;
    const forwardInput = Number(input.has("w") || input.has("arrowup")) -
      Number(input.has("s") || input.has("arrowdown"));
    const sideInput = Number(input.has("d") || input.has("arrowright")) -
      Number(input.has("a") || input.has("arrowleft"));
    const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    const movement = forward.multiplyScalar(forwardInput).addScaledVector(right, sideInput);
    if (movement.lengthSq() > 0) {
      movement.normalize().multiplyScalar(3 * Math.min(delta, 0.05));
      const candidate = position.current.clone().add(movement);
      const localPoint = new THREE.Vector2(candidate.x, -candidate.z);
      const inside =
        isPointInPolygon(localPoint, outline) &&
        outline.every((point, index) => {
          const next = outline[(index + 1) % outline.length];
          return distanceToSegment(localPoint, point, next) >= 0.3;
        });
      const hitsWall = wallSegments.some(
        ([start, end]) => distanceToSegment(localPoint, start, end) < 0.28
      );
      if (inside && !hitsWall) position.current.copy(candidate);
    }
    camera.position.copy(position.current);
    camera.rotation.order = "YXZ";
    camera.rotation.set(pitch.current, yaw.current, 0);
  });

  return null;
}

function parseOsmHeight(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(m|meter|meters|ft|feet|')?$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return match[2]?.toLowerCase().startsWith("f") || match[2] === "'"
    ? parsed * 0.3048
    : parsed;
}

function parseOsmLevels(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatMeters(value: number): string {
  return `${Number(value.toFixed(1))} m`;
}

function BuildingFloor({
  shape,
  floorIndex,
  floorLevel,
  floorLabel,
  floorHeight,
  exploded,
  floorGap,
  active,
  highlighted,
  indoorFeatures,
  showIndoorData,
  showProceduralInterior,
  selectedRoomId,
  onRoomSelect,
  onHover,
  onPointerMove,
  onPointerOut,
  onClick,
  labelPosition,
  labelDistanceFactor,
}: {
  shape: THREE.Shape;
  floorIndex: number;
  floorLevel: number;
  floorLabel: string;
  floorHeight: number;
  exploded: boolean;
  floorGap: number;
  active: boolean;
  highlighted: boolean;
  indoorFeatures: ProjectedIndoorFeature[];
  showIndoorData: boolean;
  showProceduralInterior: boolean;
  selectedRoomId: number | string | null;
  onRoomSelect: (feature: ProjectedIndoorFeature | InteriorRoom) => void;
  onHover: (event: any) => void;
  onPointerMove: (event: any) => void;
  onPointerOut: (event: any) => void;
  onClick: (event: any) => void;
  labelPosition: [number, number, number];
  labelDistanceFactor: number;
}) {
  const floorRef = useRef<THREE.Group>(null!);
  const floorSurfaceHeight = FLOOR_SLAB_THICKNESS;
  const extrudeSettings = useMemo(
    () => ({ steps: 1, depth: FLOOR_SLAB_THICKNESS, bevelEnabled: false }),
    []
  );

  useFrame((_, delta) => {
    if (!floorRef.current) return;
    const targetY = floorLevel * floorHeight +
      (exploded ? floorIndex * floorGap : 0);
    floorRef.current.position.y = THREE.MathUtils.damp(
      floorRef.current.position.y,
      targetY,
      6,
      delta
    );
  });

  return (
    <group ref={floorRef} position={[0, floorLevel * floorHeight, 0]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        material={
          highlighted
            ? BUILDING_FLOOR_HIGHLIGHT_MAT
            : active
              ? BUILDING_ACTIVE_MAT
              : ArchitecturalMaterials.Concrete()
        }
        onPointerOver={onHover}
        onPointerMove={onPointerMove}
        onPointerOut={onPointerOut}
        onClick={onClick}
      >
        <extrudeGeometry args={[shape, extrudeSettings]} />
        <Edges threshold={18} color={highlighted ? "#075985" : "#334155"} />
      </mesh>
      {showIndoorData &&
        indoorFeatures
          .filter((feature) => {
            const levels = getIndoorFeatureLevels(feature.tags);
            return levels === null ? floorLevel === 0 : levels.includes(floorLevel);
          })
          .map((feature) => (
            <MappedIndoorFeature
              key={`${feature.id}-${floorLevel}`}
              feature={feature}
              floorLabel={floorLabel}
              selected={selectedRoomId === feature.id}
              onSelect={() => onRoomSelect(feature)}
              floorSurfaceHeight={floorSurfaceHeight}
            />
          ))}
      {showProceduralInterior && (
        <ProceduralInterior
          shape={shape}
          floorSurfaceHeight={floorSurfaceHeight}
          floorLevel={floorLevel}
          selectedRoomId={selectedRoomId}
          onRoomSelect={onRoomSelect}
        />
      )}
      {exploded && (
        <Html
          position={labelPosition}
          center
          distanceFactor={labelDistanceFactor * 1.35}
          style={{ pointerEvents: "none" }}
        >
          <div
            style={{
              padding: "3px 7px",
              borderRadius: "5px",
              color: "#ffffff",
              background: "rgba(15, 23, 42, 0.88)",
              border: "1px solid rgba(56, 189, 248, 0.8)",
              font: "600 11px system-ui, sans-serif",
              whiteSpace: "nowrap",
              boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            }}
          >
            Floor {floorLabel}
          </div>
        </Html>
      )}
    </group>
  );
}

function Building({
  shape,
  height,
  floorCount,
  reportedFloorCount,
  heightIsEstimated,
  floorCountIsEstimated,
  indoorFeatures,
  indoorDataStatus,
  indoorDataError,
  onIndoorDataRetry,
  cameraView,
  onCameraViewChange,
  activeWalkthroughFloor,
  onWalkthroughFloorChange,
  buildingId,
  isSelected,
  inspectorOpen,
  onInspectorOpenChange,
  onSelect,
  tags,
}: {
  shape: THREE.Shape;
  height: number;
  floorCount: number;
  reportedFloorCount: number | null;
  heightIsEstimated: boolean;
  floorCountIsEstimated: boolean;
  indoorFeatures: ProjectedIndoorFeature[];
  indoorDataStatus: "idle" | "loading" | "loaded" | "error";
  indoorDataError: string;
  onIndoorDataRetry: () => void;
  cameraView: "orbit" | "topdown" | "walkthrough";
  onCameraViewChange: (view: "orbit" | "topdown" | "walkthrough") => void;
  activeWalkthroughFloor: number;
  onWalkthroughFloorChange: (level: number) => void;
  buildingId: string;
  isSelected: boolean;
  inspectorOpen: boolean;
  onInspectorOpenChange: (open: boolean) => void;
  onSelect: (id: string | null) => void;
  tags: any;
}) {
  const [hovered, setHovered] = useState(false);
  const [viewMode, setViewMode] = useState<"building" | "floor" | "exploded">("building");
  const [explorationActive, setExplorationActive] = useState(false);
  const [showFloorGeometry, setShowFloorGeometry] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<ProjectedIndoorFeature | InteriorRoom | null>(null);
  const [floorGapRatio, setFloorGapRatio] = useState(DEFAULT_EXPLODED_FLOOR_GAP_RATIO);
  const [showIndoorData, setShowIndoorData] = useState(false);
  const [showProceduralInterior, setShowProceduralInterior] = useState(false);
  const [hoverPos, setHoverPos] = useState<THREE.Vector3 | null>(null);
  const [showTranslations, setShowTranslations] = useState(false);
  const [showAdditionalInfo, setShowAdditionalInfo] = useState(false);
  const buildingStyle = useMemo(() => getBuildingStyle(tags, isSelected), [tags, isSelected]);
  const floorHeight = height / floorCount;
  const floorGap = floorHeight * floorGapRatio;
  const exploded = viewMode === "exploded";
  const floorLevels = useMemo(() => {
    const mappedLevels = indoorFeatures.flatMap(
      (feature) => getIndoorFeatureLevels(feature.tags) ?? []
    );
    const minLevel = Math.min(0, ...mappedLevels);
    const maxLevel = Math.max(floorCount - 1, ...mappedLevels);
    const count = Math.min(MAX_BUILDING_FLOORS, maxLevel - minLevel + 1);
    return Array.from({ length: count }, (_, index) => minLevel + index);
  }, [floorCount, indoorFeatures]);
  const mappedFeatureCount = indoorFeatures.filter((feature) => {
    return hasRenderableIndoorGeometry(feature);
  }).length;
  const roomCount = (level: number) =>
    indoorFeatures.filter((feature) => {
      if (feature.tags.indoor !== "room") return false;
      if (!hasRenderableIndoorGeometry(feature)) return false;
      const levels = getIndoorFeatureLevels(feature.tags);
      return levels === null ? level === 0 : levels.includes(level);
    }).length;
  const floorLabel = (level: number) =>
    level < 0 ? `B${Math.abs(level)}` : level === 0 ? "G" : String(level);
  const buildingExtrudeSettings = useMemo(
    () => ({ steps: 1, depth: height, bevelEnabled: false }),
    [height]
  );
  const labelPosition = useMemo<[number, number, number]>(() => {
    const points = shape.getPoints();
    const bounds = points.reduce(
      (result, point) => ({
        minX: Math.min(result.minX, point.x),
        maxX: Math.max(result.maxX, point.x),
        minY: Math.min(result.minY, point.y),
        maxY: Math.max(result.maxY, point.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    );
    return [
      bounds.maxX + 0.8,
      floorHeight + 0.15,
      -(bounds.minY + bounds.maxY) / 2,
    ];
  }, [shape, floorHeight]);

  useEffect(() => {
    if (!isSelected) {
      setViewMode("building");
      setExplorationActive(false);
      setSelectedRoom(null);
      setSelectedFloor(null);
      setShowIndoorData(false);
      setShowProceduralInterior(false);
    }
    if (
      showFloorGeometry &&
      viewMode === "building" &&
      !showIndoorData &&
      !showProceduralInterior
    ) {
      const collapseTimer = window.setTimeout(() => setShowFloorGeometry(false), 550);
      return () => window.clearTimeout(collapseTimer);
    }
  }, [isSelected, viewMode, showFloorGeometry, showIndoorData, showProceduralInterior]);

  const handleFloorClick = (floorIndex: number, event: any) => {
    event.stopPropagation();
    if (!isSelected) {
      onSelect(buildingId);
    }
    setExplorationActive(true);
    setSelectedFloor(floorIndex);
    onWalkthroughFloorChange(floorIndex);
    setViewMode("floor");
    setShowFloorGeometry(true);
  };

  return (
    <group userData={{ exportToGLB: true, buildingTags: tags }}>
      {showFloorGeometry ? (
        floorLevels.map((floorLevel, floorIndex) => (
          (viewMode !== "floor" || selectedFloor === floorLevel) && (
          <BuildingFloor
            key={floorLevel}
            shape={shape}
            floorIndex={floorIndex}
            floorLevel={floorLevel}
            floorLabel={floorLabel(floorLevel)}
            floorHeight={floorHeight}
            exploded={exploded}
            floorGap={floorGap}
            active={hovered || isSelected}
            highlighted={selectedFloor === floorLevel}
            indoorFeatures={indoorFeatures}
            showIndoorData={showIndoorData}
            showProceduralInterior={showProceduralInterior}
            selectedRoomId={selectedRoom?.id ?? null}
            onRoomSelect={(feature) => setSelectedRoom(feature)}
            onHover={(event) => {
              setHovered(true);
              event.stopPropagation();
            }}
            onPointerMove={(event) => {
              setHoverPos(event.point.clone());
              event.stopPropagation();
            }}
            onPointerOut={(event) => {
              setHovered(false);
              event.stopPropagation();
            }}
            onClick={(event) => handleFloorClick(floorLevel, event)}
            labelPosition={labelPosition}
            labelDistanceFactor={height * 2.8}
          />
          )
        ))
      ) : (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          material={hovered || isSelected ? ArchitecturalMaterials.Highlight() : buildingStyle.facadeMaterial}
          onPointerOver={(event) => {
            setHovered(true);
            event.stopPropagation();
          }}
          onPointerMove={(event) => {
            setHoverPos(event.point.clone());
            event.stopPropagation();
          }}
          onPointerOut={(event) => {
            setHovered(false);
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(isSelected ? null : buildingId);
          }}
        >
          <extrudeGeometry args={[shape, buildingExtrudeSettings]} />
        </mesh>
      )}
        {hovered && !isSelected && hoverPos && (
          <Html
            position={[hoverPos.x, height + 0.5, hoverPos.z]}
            center
            style={{ pointerEvents: "none" }}
          >
            <div
              style={{
                padding: "6px 9px",
                color: "#f8fafc",
                background: "#101b2b",
                border: "1px solid #334155",
                borderRadius: "6px",
                font: "600 12px system-ui, sans-serif",
                whiteSpace: "nowrap",
              }}
            >
              {tags.name || "Building"}
            </div>
          </Html>
        )}
        {isSelected && inspectorOpen && (
          <Html fullscreen style={{ pointerEvents: "none" }}>
            <div
              role="dialog"
              aria-label={tags.name || "Building Information"}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              className="building-inspector-panel"
              style={{
                pointerEvents: "auto",
                color: "#182334",
                backgroundColor: "#f8fafc",
                border: "1px solid #cbd5e1",
                padding: "18px",
                borderRadius: "12px",
                fontFamily: "system-ui, -apple-system, sans-serif",
                fontSize: "13px",
                boxSizing: "border-box",
                boxShadow: "0 16px 42px rgba(2, 8, 23, 0.28)",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "10px",
                  paddingBottom: "12px",
                  borderBottom: "1px solid #dbe2ea",
                }}
              >
                <div>
                  <div style={{ color: "#64748b", fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    Building inspector
                  </div>
                  <div style={{ marginTop: "4px", color: "#0f172a", fontWeight: 700, fontSize: "18px", lineHeight: 1.25 }}>
                    {tags.name || "Unnamed building"}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Collapse building inspector"
                  onClick={() => onInspectorOpenChange(false)}
                  style={{
                    flex: "0 0 auto",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    color: "#334155",
                    background: "#ffffff",
                    padding: "6px 9px",
                    cursor: "pointer",
                  }}
                >
                  Hide
                </button>
              </div>
            {isSelected && (
              <section
                aria-label="Exploded floor controls"
                style={{
                  margin: "10px 0 8px",
                  borderTop: "1px solid rgba(0, 0, 0, 0.1)",
                  paddingTop: "9px",
                }}
              >
                <div style={{ fontWeight: 700, color: "#111827", marginBottom: "6px" }}>
                Floor analysis
                </div>
                <div style={{ color: "#475569", fontSize: "12px", lineHeight: 1.5 }}>
                  <div>
                    {floorCountIsEstimated
                      ? `Estimated: ${floorCount} floor sections`
                      : `Reported: ${reportedFloorCount} levels · ${floorCount} floor sections`}
                    {reportedFloorCount !== null && reportedFloorCount > MAX_BUILDING_FLOORS
                      ? ` (display capped at ${MAX_BUILDING_FLOORS})`
                      : ""}
                  </div>
                  <div>
                    Height: {formatMeters(height)} ({heightIsEstimated ? "estimated" : "OSM"})
                  </div>
                  <div>Average section: {formatMeters(floorHeight)} (derived)</div>
                </div>
                <div
                  style={{
                    marginTop: "6px",
                    color: "#64748b",
                    fontSize: "11px",
                    lineHeight: 1.4,
                  }}
                >
                  Illustrative floor sections only; not architectural plans.
                </div>
                <div
                  aria-live="polite"
                  style={{
                    marginTop: "9px",
                    padding: "8px",
                    borderRadius: "6px",
                    background: "#eef4fa",
                    color: "#334155",
                    fontSize: "11px",
                    lineHeight: 1.45,
                  }}
                >
                  {indoorDataStatus === "loading" && "Loading mapped indoor data from OpenStreetMap..."}
                  {indoorDataStatus === "error" && (
                    <>
                      <div>{indoorDataError || "Indoor map data could not be loaded."}</div>
                      <button
                        type="button"
                        onClick={onIndoorDataRetry}
                        style={{
                          marginTop: "6px",
                          border: "1px solid #94a3b8",
                          borderRadius: "4px",
                          padding: "4px 8px",
                          background: "#ffffff",
                          color: "#1e293b",
                          cursor: "pointer",
                        }}
                      >
                        Retry map data
                      </button>
                    </>
                  )}
                  {indoorDataStatus === "loaded" && mappedFeatureCount > 0 && (
                    <>
                      <div>
                        {mappedFeatureCount} mapped interior feature{mappedFeatureCount === 1 ? "" : "s"} · OpenStreetMap
                      </div>
                      <div>Unlevelled features are shown on the ground floor; mapped level tags determine other floors.</div>
                      <button
                        type="button"
                        aria-pressed={showIndoorData}
                        onClick={() => {
                          const next = !showIndoorData;
                          setShowIndoorData(next);
                          setShowProceduralInterior(false);
                          if (next) {
                            setShowFloorGeometry(true);
                            setExplorationActive(true);
                            setViewMode("exploded");
                          }
                        }}
                        style={{
                          width: "100%",
                          marginTop: "7px",
                          border: "1px solid #0284c7",
                          borderRadius: "5px",
                          padding: "6px",
                          color: showIndoorData ? "#ffffff" : "#075985",
                          background: showIndoorData ? "#0284c7" : "#ffffff",
                          cursor: "pointer",
                        }}
                      >
                        {showIndoorData ? "Hide mapped interiors" : "Explode & show mapped interiors"}
                      </button>
                    </>
                  )}
                  {indoorDataStatus === "loaded" && mappedFeatureCount === 0 && (
                    <>
                      <div>No mapped room, corridor, wall, door, or entrance data found for this building.</div>
                      <div>Procedural partitions are illustrative only and are not real floor plans.</div>
                      <button
                        type="button"
                        aria-pressed={showProceduralInterior}
                        onClick={() => {
                          const next = !showProceduralInterior;
                          setShowProceduralInterior(next);
                          setShowIndoorData(false);
                          if (next) {
                            setShowFloorGeometry(true);
                            setExplorationActive(true);
                            setViewMode("exploded");
                          }
                        }}
                        style={{
                          width: "100%",
                          marginTop: "7px",
                          border: "1px solid #d97706",
                          borderRadius: "5px",
                          padding: "6px",
                          color: showProceduralInterior ? "#ffffff" : "#92400e",
                          background: showProceduralInterior ? "#d97706" : "#ffffff",
                          cursor: "pointer",
                        }}
                      >
                        {showProceduralInterior
                          ? "Hide procedural interior"
                          : "Show procedural interior · illustrative"}
                      </button>
                    </>
                  )}
                  {indoorDataStatus === "idle" && "Generate a map to check for available indoor data."}
                </div>
                {!explorationActive ? (
                  <button
                    type="button"
                    onClick={() => {
                      setExplorationActive(true);
                      setShowFloorGeometry(true);
                      setViewMode("floor");
                      setSelectedFloor(0);
                      onWalkthroughFloorChange(0);
                      if (mappedFeatureCount > 0) setShowIndoorData(true);
                    }}
                    style={{
                      width: "100%",
                      marginTop: "9px",
                      padding: "8px 10px",
                      border: "0",
                      borderRadius: "6px",
                      color: "#ffffff",
                      background: "#1268d3",
                      font: "600 13px system-ui, sans-serif",
                      cursor: "pointer",
                    }}
                  >
                    Enter exploration mode
                  </button>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: "4px", marginTop: "9px" }}>
                      {([
                        ["building", "Full building"],
                        ["floor", "Isolate floor"],
                        ["exploded", "Exploded"],
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={viewMode === mode}
                          onClick={() => {
                            setViewMode(mode);
                            setShowFloorGeometry(mode !== "building");
                            if (mode === "exploded" && selectedFloor === null) {
                              setSelectedFloor(0);
                            }
                          }}
                          style={{
                            flex: 1,
                            border: viewMode === mode ? "1px solid #0284c7" : "1px solid #cbd5e1",
                            borderRadius: "5px",
                            padding: "6px 3px",
                            color: viewMode === mode ? "#ffffff" : "#1e293b",
                            background: viewMode === mode ? "#0284c7" : "#ffffff",
                            fontSize: "10px",
                            cursor: "pointer",
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "4px", marginTop: "5px" }}>
                      {(["orbit", "topdown", "walkthrough"] as const).map((view) => (
                        <button
                          key={view}
                          type="button"
                          aria-pressed={cameraView === view}
                          onClick={() => {
                            if (view === "walkthrough") {
                              setExplorationActive(true);
                              setShowFloorGeometry(true);
                              setShowIndoorData(mappedFeatureCount > 0);
                              setShowProceduralInterior(mappedFeatureCount === 0);
                              if (viewMode === "building") setViewMode("floor");
                              if (selectedFloor === null) {
                                setSelectedFloor(0);
                                onWalkthroughFloorChange(0);
                              } else {
                                onWalkthroughFloorChange(selectedFloor);
                              }
                            }
                            onCameraViewChange(view);
                          }}
                          style={{
                            flex: 1,
                            border: cameraView === view ? "1px solid #0284c7" : "1px solid #cbd5e1",
                            borderRadius: "5px",
                            padding: "6px 3px",
                            color: cameraView === view ? "#ffffff" : "#1e293b",
                            background: cameraView === view ? "#0284c7" : "#ffffff",
                            fontSize: "10px",
                            cursor: "pointer",
                          }}
                        >
                          {view === "topdown" ? "Top-down" : view === "walkthrough" ? "Walkthrough" : "Orbit"}
                        </button>
                      ))}
                    </div>
                    {cameraView === "walkthrough" && (
                      <div
                        style={{
                          marginTop: "5px",
                          borderRadius: "5px",
                          background: "#0f172a",
                          color: "#e2e8f0",
                          padding: "7px",
                          fontSize: "10px",
                        }}
                      >
                        Click the 3D view, then use WASD and mouse-look · Esc to exit
                      </div>
                    )}
                    {cameraView === "walkthrough" && (
                      <button
                        type="button"
                        onClick={() => {
                          onCameraViewChange("orbit");
                          setExplorationActive(false);
                          setViewMode("building");
                          setShowFloorGeometry(false);
                        }}
                        style={{
                          width: "100%",
                          marginTop: "5px",
                          border: "1px solid #b91c1c",
                          borderRadius: "5px",
                          padding: "6px",
                          color: "#991b1b",
                          background: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        Exit walkthrough
                      </button>
                    )}
                    <div style={{ marginTop: "8px", color: "#475569", fontSize: "11px" }}>
                      Floors · mapped rooms
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                        gap: "4px",
                        maxHeight: "112px",
                        overflowY: "auto",
                      }}
                    >
                      {floorLevels.map((level) => (
                        <button
                          key={level}
                          type="button"
                          aria-pressed={selectedFloor === level}
                          onClick={() => {
                            setSelectedFloor(level);
                            onWalkthroughFloorChange(level);
                            setViewMode("floor");
                            setShowFloorGeometry(true);
                          }}
                          style={{
                            padding: "5px 2px",
                            border: selectedFloor === level ? "1px solid #0284c7" : "1px solid #cbd5e1",
                            borderRadius: "4px",
                            color: selectedFloor === level ? "#ffffff" : "#1e293b",
                            background: selectedFloor === level ? "#0284c7" : "#ffffff",
                            font: "500 10px system-ui, sans-serif",
                            cursor: "pointer",
                          }}
                        >
                          {floorLabel(level)} · {roomCount(level)}
                        </button>
                      ))}
                    </div>
                    {selectedRoom && (
                      <div
                        style={{
                          marginTop: "8px",
                          padding: "8px",
                          border: "1px solid #0284c7",
                          borderRadius: "6px",
                          background: "source" in selectedRoom && selectedRoom.source === "demo_generated" ? "#f0fdf4" : "#fffbeb",
                          color: "source" in selectedRoom && selectedRoom.source === "demo_generated" ? "#166534" : "#78350f",
                          fontSize: "11px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                          <strong>
                            {"tags" in selectedRoom
                              ? selectedRoom.tags["room:name"] || selectedRoom.tags.name || `Room ${selectedRoom.id}`
                              : selectedRoom.name}
                          </strong>
                          <span
                            style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              padding: "2px 5px",
                              borderRadius: "4px",
                              background: "source" in selectedRoom && selectedRoom.source === "demo_generated" ? "#bbf7d0" : "#fed7aa",
                              color: "source" in selectedRoom && selectedRoom.source === "demo_generated" ? "#14532d" : "#9a3412",
                            }}
                          >
                            {"source" in selectedRoom && selectedRoom.source === "demo_generated" ? "DEMO LAYOUT" : "REAL OSM DATA"}
                          </span>
                        </div>
                        <div>Floor: {selectedFloor !== null ? floorLabel(selectedFloor) : "N/A"}</div>
                        <div>
                          {"tags" in selectedRoom
                            ? `Source: OpenStreetMap · indoor=${selectedRoom.tags.indoor}`
                            : `Type: ${selectedRoom.type.toUpperCase()} · Architectural layout simulation`}
                        </div>
                        <div>
                          {"tags" in selectedRoom && (selectedRoom.tags.width || selectedRoom.tags.length)
                            ? `Dimensions: ${selectedRoom.tags.width || "unknown"} × ${selectedRoom.tags.length || "unknown"} m`
                            : "Dimensions: Proportional to floor footprint"}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {exploded && (
                  <label
                    style={{
                      display: "block",
                      marginTop: "9px",
                      color: "#475569",
                      fontSize: "11px",
                    }}
                  >
                    Floor separation: {Math.round(floorGapRatio * 100)}% of floor height
                    <input
                      aria-label="Floor separation"
                      type="range"
                      min="0.05"
                      max="0.8"
                      step="0.05"
                      value={floorGapRatio}
                      onChange={(event) => setFloorGapRatio(Number(event.target.value))}
                      style={{ width: "100%", display: "block", accentColor: "#0284c7" }}
                    />
                  </label>
                )}
                {exploded && (
                  <div style={{ marginTop: "9px" }}>
                    <div style={{ color: "#475569", fontSize: "12px", marginBottom: "5px" }}>
                      Highlight a floor
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                        gap: "4px",
                        maxHeight: "112px",
                        overflowY: "auto",
                      }}
                    >
                      {Array.from({ length: floorCount }, (_, floorIndex) => (
                        <button
                          key={floorIndex}
                          type="button"
                          aria-pressed={selectedFloor === floorIndex}
                          onClick={() =>
                            setSelectedFloor((current) =>
                              current === floorIndex ? null : floorIndex
                            )
                          }
                          style={{
                            padding: "5px 2px",
                            border: selectedFloor === floorIndex
                              ? "1px solid #0284c7"
                              : "1px solid #cbd5e1",
                            borderRadius: "4px",
                            color: selectedFloor === floorIndex ? "#ffffff" : "#1e293b",
                            background: selectedFloor === floorIndex ? "#0284c7" : "#ffffff",
                            font: "500 10px system-ui, sans-serif",
                            cursor: "pointer",
                          }}
                        >
                          {floorIndex + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
            {["building", "height", "building:levels", "amenity", "denomination"].map(
              (key) =>
                tags[key] &&
                (key !== "building" || tags[key] !== "yes") && (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      margin: "4px 0",
                    }}
                  >
                    <span style={{ fontWeight: "500", color: "#5f6368" }}>
                      {key === "building"
                        ? "Type"
                        : key === "height"
                        ? "Height"
                        : key === "building:levels"
                        ? "Levels"
                        : key === "amenity"
                        ? "Facility"
                        : key === "denomination"
                        ? "Denomination"
                        : key.replace(/_/g, " ")}
                      :
                    </span>
                    <span style={{ textTransform: "capitalize" }}>
                      {key === "height"
                        ? `${tags[key]}${/(?:m|meters?|ft|feet|')\s*$/i.test(String(tags[key]).trim()) ? "" : " m"}`
                        : tags[key]}
                    </span>
                  </div>
                )
            )}
            {[
              "addr:street",
              "addr:housenumber",
              "addr:district",
              "addr:city",
              "addr:postcode",
            ].some((key) => tags[key]) && (
              <div
                style={{
                  margin: "10px 0 8px",
                  borderTop: "1px solid rgba(0, 0, 0, 0.08)",
                  paddingTop: "8px",
                }}
              >
                <div style={{ fontWeight: "500", marginBottom: "4px", color: "#5f6368" }}>
                  Address
                </div>
                <div style={{ marginLeft: "4px", fontSize: "12px", color: "#5f6368" }}>
                  {[
                    [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
                    tags["addr:district"],
                    tags["addr:city"],
                    tags["addr:postcode"],
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </div>
              </div>
            )}
            {Object.entries(tags).filter(
              ([key]) =>
                ![
                  "building",
                  "name",
                  "height",
                  "building:levels",
                  "source",
                  "amenity",
                  "denomination",
                ].includes(key) &&
                !key.startsWith("addr:") &&
                !key.startsWith("name:") &&
                !key.startsWith("alt_name:")
            ).length > 0 && (
              <div
                style={{
                  margin: "10px 0 4px",
                  borderTop: "1px solid rgba(0, 0, 0, 0.08)",
                  paddingTop: "8px",
                }}
              >
                <div
                  style={{
                    fontWeight: "500",
                    marginBottom: "4px",
                    color: "#5f6368",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                  onClick={() => setShowAdditionalInfo(!showAdditionalInfo)}
                >
                  Additional Information
                  <span>{showAdditionalInfo ? "▲" : "▼"}</span>
                </div>
                {showAdditionalInfo && (
                  <div>
                    {Object.entries(tags)
                      .filter(
                        ([key]) =>
                          ![
                            "building",
                            "name",
                            "height",
                            "building:levels",
                            "source",
                            "amenity",
                            "denomination",
                          ].includes(key) &&
                          !key.startsWith("addr:") &&
                          !key.startsWith("name:") &&
                          !key.startsWith("alt_name:")
                      )
                      .map(([key, value]) => {
                        if (
                          key === "description" ||
                          (typeof value === "string" && value.length > 80)
                        ) {
                          return (
                            <div key={key} style={{ margin: "8px 0" }}>
                              <div
                                style={{ fontWeight: "500", color: "#5f6368", marginBottom: "4px" }}
                              >
                                {key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ")}
                              </div>
                              <div
                                style={{
                                  textAlign: "left",
                                  fontSize: "12px",
                                  color: "#5f6368",
                                  fontWeight: "400",
                                  textWrap: "wrap",
                                  whiteSpace: "pre-wrap",
                                  lineHeight: "1.4",
                                  backgroundColor: "rgba(0,0,0,0.02)",
                                  padding: "6px 8px",
                                  borderRadius: "4px",
                                }}
                              >
                                {String(value)}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={key}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              margin: "4px 0",
                            }}
                          >
                            <span
                              style={{
                                fontWeight: "700",
                                color: "#5f6368",
                                textAlign: "left",
                              }}
                            >
                              {key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ")}:
                            </span>
                            <span
                              style={{
                                textTransform: "capitalize",
                                fontWeight: "400",
                                textAlign: "right",
                              }}
                            >
                              {String(value)}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
            {Object.entries(tags).filter(([key]) => key.startsWith("name:")).length > 0 && (
              <div
                style={{
                  margin: "10px 0 4px",
                  borderTop: "1px solid rgba(0, 0, 0, 0.08)",
                  paddingTop: "8px",
                  textAlign: "right",
                }}
              >
                <div
                  style={{
                    fontWeight: "500",
                    marginBottom: "4px",
                    color: "#5f6368",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                  onClick={() => setShowTranslations(!showTranslations)}
                >
                  Name Translations
                  <span>{showTranslations ? "▲" : "▼"}</span>
                </div>
                {showTranslations && (
                  <div>
                    {Object.entries(tags)
                      .filter(([key]) => key.startsWith("name:"))
                      .map(([key, value]) => (
                        <div
                          key={key}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            margin: "4px 0",
                          }}
                        >
                          <span style={{ fontWeight: "500", color: "#5f6368" }}>
                            {key.replace("name:", "").toUpperCase()}:
                          </span>
                          <span style={{ textTransform: "capitalize" }}>{String(value)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

// Highway types rendered as pedestrian paths (lighter material, narrower).
const PEDESTRIAN_TYPES = new Set([
  "footway", "path", "steps", "pedestrian", "track", "cycleway",
]);

// Half-widths in scene units (1 unit ≈ 2 m at mid-latitudes).
// Keyed by OSM highway tag value.
const ROAD_HALF_WIDTH: Record<string, number> = {
  motorway: 4.5,
  motorway_link: 2.5,
  trunk: 3.5,
  trunk_link: 2.0,
  primary: 3.0,
  primary_link: 2.0,
  secondary: 2.5,
  secondary_link: 1.8,
  tertiary: 2.0,
  tertiary_link: 1.5,
  residential: 1.8,
  living_street: 1.6,
  unclassified: 1.8,
  service: 1.2,
  // Pedestrian / non-vehicle — narrow
  pedestrian: 0.5,
  footway: 0.4,
  cycleway: 0.4,
  path: 0.35,
  track: 0.45,
  steps: 0.3,
};
const DEFAULT_ROAD_HALF_WIDTH = 1.5;

// Build a flat ribbon THREE.Shape from a projected 2-D polyline.
// Returns null if the polyline is degenerate.
function buildRoadShape(pts: THREE.Vector2[], halfW: number): THREE.Shape | null {
  const left: THREE.Vector2[] = [];
  const right: THREE.Vector2[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // Perpendicular unit vector (90° CCW)
    const nx = (-dy / len) * halfW;
    const ny = (dx / len) * halfW;

    if (left.length === 0) {
      left.push(new THREE.Vector2(a.x + nx, a.y + ny));
      right.push(new THREE.Vector2(a.x - nx, a.y - ny));
    }
    left.push(new THREE.Vector2(b.x + nx, b.y + ny));
    right.push(new THREE.Vector2(b.x - nx, b.y - ny));
  }

  if (left.length < 2) return null;

  const shape = new THREE.Shape();
  shape.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) shape.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) shape.lineTo(right[i].x, right[i].y);
  shape.closePath();
  return shape;
}

const ROAD_EXTRUDE = { steps: 1, depth: 0.1, bevelEnabled: false } as const;

// ── Polygon ring → THREE.Shape ─────────────────────────────────────────────

import type { PolygonRing, PolylineElem } from "@/state/areaStore";

type BBox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

/**
 * Sutherland-Hodgman polygon clip against an axis-aligned lat/lon bbox.
 * Clips the ring against each of the 4 half-planes in turn.
 * Returns null if the clipped result has fewer than 3 vertices.
 */
function clipPolygonRingToBbox(
  ring: Array<{ lat: number; lon: number }>,
  minLat: number, maxLat: number,
  minLng: number, maxLng: number
): Array<{ lat: number; lon: number }> | null {
  const lerp = (
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
    t: number
  ) => ({ lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) });

  type Plane = {
    inside: (p: { lat: number; lon: number }) => boolean;
    intersect: (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => { lat: number; lon: number };
  };

  const planes: Plane[] = [
    // left: lon >= minLng
    { inside: (p) => p.lon >= minLng, intersect: (a, b) => lerp(a, b, (minLng - a.lon) / (b.lon - a.lon)) },
    // right: lon <= maxLng
    { inside: (p) => p.lon <= maxLng, intersect: (a, b) => lerp(a, b, (maxLng - a.lon) / (b.lon - a.lon)) },
    // bottom: lat >= minLat
    { inside: (p) => p.lat >= minLat, intersect: (a, b) => lerp(a, b, (minLat - a.lat) / (b.lat - a.lat)) },
    // top: lat <= maxLat
    { inside: (p) => p.lat <= maxLat, intersect: (a, b) => lerp(a, b, (maxLat - a.lat) / (b.lat - a.lat)) },
  ];

  // Remove closing duplicate point if present before processing.
  let poly = ring.slice();
  if (poly.length > 1) {
    const first = poly[0];
    const last = poly[poly.length - 1];
    if (Math.abs(first.lat - last.lat) < 1e-10 && Math.abs(first.lon - last.lon) < 1e-10) {
      poly = poly.slice(0, -1);
    }
  }

  for (const plane of planes) {
    if (poly.length === 0) return null;
    const input = poly;
    poly = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i];
      const b = input[(i + 1) % input.length];
      const aIn = plane.inside(a);
      const bIn = plane.inside(b);
      if (aIn) {
        poly.push(a);
        if (!bIn) poly.push(plane.intersect(a, b));
      } else if (bIn) {
        poly.push(plane.intersect(a, b));
      }
    }
  }

  return poly.length >= 3 ? poly : null;
}

/**
 * Signed area of a 2-D polygon using the shoelace formula.
 * Result > 0 → counter-clockwise (CCW).
 * Result < 0 → clockwise (CW).
 * The array must NOT contain a closing duplicate — wrap-around is handled via modulo.
 */
function signedArea2D(pts: THREE.Vector2[]): number {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

/**
 * Projects a polygon ring into a THREE.Shape, applying bbox clipping and
 * winding-order correction as needed.
 *
 * Strategy (AABB-based, no arbitrary thresholds):
 *  1. Compute the ring's AABB in lat/lon space.
 *  2. AABB doesn't intersect scene bbox → skip (completely outside).
 *  3. AABB fully inside scene bbox → project as-is (no clipping needed).
 *  4. AABB partially overlaps → clip with Sutherland-Hodgman, then project.
 *
 * After projection, the winding order is normalised to CCW using the shoelace
 * formula. THREE.ShapeGeometry requires CCW outer rings; a CW ring is treated
 * as a hole and triangulates to just edge slivers.
 *
 * Returns null to indicate "skip this ring".
 */
function buildPolygonShapeClipped(
  ring: PolygonRing["ring"],
  refLat: number,
  refLng: number,
  scaleX: number,
  scaleY: number,
  bbox: BBox
): THREE.Shape | null {
  if (ring.length < 3) return null;

  const { minLat, maxLat, minLng, maxLng } = bbox;

  // Compute the ring's AABB in lat/lon space.
  let rMinLat = Infinity, rMaxLat = -Infinity;
  let rMinLng = Infinity, rMaxLng = -Infinity;
  for (const pt of ring) {
    if (pt.lat < rMinLat) rMinLat = pt.lat;
    if (pt.lat > rMaxLat) rMaxLat = pt.lat;
    if (pt.lon < rMinLng) rMinLng = pt.lon;
    if (pt.lon > rMaxLng) rMaxLng = pt.lon;
  }

  // 2. No overlap at all → skip.
  const aabbOverlaps =
    rMaxLng >= minLng && rMinLng <= maxLng &&
    rMaxLat >= minLat && rMinLat <= maxLat;
  if (!aabbOverlaps) return null;

  // 3/4. Fully inside → project as-is; partially outside → clip first.
  const fullyInside =
    rMinLat >= minLat && rMaxLat <= maxLat &&
    rMinLng >= minLng && rMaxLng <= maxLng;

  let workingRing: typeof ring;
  if (fullyInside) {
    workingRing = ring;
  } else {
    const clipped = clipPolygonRingToBbox(ring, minLat, maxLat, minLng, maxLng);
    if (!clipped || clipped.length < 3) return null;
    workingRing = clipped;
  }

  // Project to scene coordinates.
  const pts = workingRing.map((pt) => new THREE.Vector2(
    (pt.lon - refLng) * scaleX,
    (pt.lat - refLat) * scaleY,
  ));

  // Strip any closing duplicate before the winding check so modulo wrap-around
  // is correct (the shoelace formula must not double-count the closing edge).
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) {
    pts.pop();
  }
  if (pts.length < 3) return null;

  // Normalise to CCW: THREE.ShapeGeometry triangulates CCW rings as filled
  // faces; a CW outer ring is treated as a hole and produces only edge slivers.
  if (signedArea2D(pts) < 0) pts.reverse();

  // Re-close the path for THREE.Shape.
  pts.push(pts[0].clone());
  return new THREE.Shape(pts);
}

// ── Polyline clipping ─────────────────────────────────────────────────────────

/**
 * Liang-Barsky parametric segment clip against an axis-aligned rectangle.
 * Works in any 2-D coordinate system (lat/lon here).
 * Returns [x0,y0, x1,y1] of the clipped segment, or null if fully outside.
 */
function clipSegment(
  x0: number, y0: number,
  x1: number, y1: number,
  xmin: number, ymin: number,
  xmax: number, ymax: number
): [number, number, number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;        // parallel edge — outside if q < 0
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else       { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };

  if (
    !clip(-dx, x0 - xmin) ||
    !clip( dx, xmax - x0) ||
    !clip(-dy, y0 - ymin) ||
    !clip( dy, ymax - y0)
  ) return null;

  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

type LatLon = { lat: number; lon: number };

/**
 * Clips a lat/lon polyline to the given bounding box.
 * Returns one or more contiguous sub-polylines (a road crossing a bbox corner
 * may produce two separate segments).
 */
function clipPolylineToBbox(
  pts: LatLon[],
  minLat: number, maxLat: number,
  minLng: number, maxLng: number
): LatLon[][] {
  const result: LatLon[][] = [];
  let current: LatLon[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const seg = clipSegment(
      p0.lon, p0.lat, p1.lon, p1.lat,
      minLng, minLat, maxLng, maxLat
    );
    if (!seg) {
      if (current.length >= 2) result.push(current);
      current = [];
      continue;
    }
    const [x0, y0, x1, y1] = seg;
    const cp0: LatLon = { lat: y0, lon: x0 };
    const cp1: LatLon = { lat: y1, lon: x1 };

    if (current.length === 0) {
      current.push(cp0, cp1);
    } else {
      const last = current[current.length - 1];
      // If the clipped start equals the last accumulated point, extend;
      // otherwise the segment was clipped at entry — start a new chain.
      if (Math.abs(last.lat - cp0.lat) < 1e-10 && Math.abs(last.lon - cp0.lon) < 1e-10) {
        current.push(cp1);
      } else {
        result.push(current);
        current = [cp0, cp1];
      }
    }
  }
  if (current.length >= 2) result.push(current);
  return result;
}

function RoadMesh({
  shape,
  material,
  yPos = 0,
}: {
  shape: THREE.Shape;
  material: THREE.MeshStandardMaterial;
  yPos?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  useEffect(() => {
    meshRef.current.userData.exportToGLB = true;
  }, []);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, yPos, 0]} material={material}>
      <extrudeGeometry args={[shape, ROAD_EXTRUDE]} />
    </mesh>
  );
}

// ── Bridge support pillar ──────────────────────────────────────────────────

function BridgePillar({ cx, cz }: { cx: number; cz: number }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  useEffect(() => {
    meshRef.current.userData.exportToGLB = true;
  }, []);
  // Pillar spans from y=0 to y=BRIDGE_Y; positioned at centroid of road ribbon.
  return (
    <mesh
      ref={meshRef}
      position={[cx, BRIDGE_Y / 2, cz]}
      material={PILLAR_MAT}
    >
      <boxGeometry args={[0.6, BRIDGE_Y, 0.6]} />
    </mesh>
  );
}

// ── Flat polygon mesh (parks, water, forests) ──────────────────────────────

function FlatPolygonMesh({
  shape,
  material,
  yPos,
}: {
  shape: THREE.Shape;
  material: THREE.MeshStandardMaterial;
  yPos: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  useEffect(() => {
    meshRef.current.userData.exportToGLB = true;
  }, []);
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, yPos, 0]} material={material}>
      <extrudeGeometry args={[shape, FLAT_EXTRUDE]} />
    </mesh>
  );
}

function RoadMeshes() {
  const roads = useAreaStore((state) => state.roads);
  const projection = useAreaStore((state) => state.projection);

  const roadItems = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;
    return roads.flatMap((road, i) => {
      if (!road.geometry || road.geometry.length < 2) return [];
      const highwayType: string = road.tags?.highway ?? "";
      const halfW = ROAD_HALF_WIDTH[highwayType] ?? DEFAULT_ROAD_HALF_WIDTH;
      const material = PEDESTRIAN_TYPES.has(highwayType) ? PATH_MAT : ROAD_MAT;
      const isBridge = road.tags?.bridge === "yes";
      const yPos = isBridge ? BRIDGE_Y : 0;

      const clippedChains = clipPolylineToBbox(
        road.geometry as LatLon[],
        bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng
      );

      return clippedChains.flatMap((chain, ci) => {
        const pts2d = chain.map((pt) => new THREE.Vector2(
          (pt.lon - refLng) * scaleX,
          (pt.lat - refLat) * scaleY,
        ));
        const shape = buildRoadShape(pts2d, halfW);
        if (!shape) return [];

        // Pillar centroid: average of 2-D ribbon points.
        // In the mesh's local frame (rotated -90° around X), the scene-space
        // X maps to pts2d.x and scene-space Z maps to -pts2d.y.
        const cx = pts2d.reduce((s, p) => s + p.x, 0) / pts2d.length;
        const cz = -(pts2d.reduce((s, p) => s + p.y, 0) / pts2d.length);

        return [{ shape, material, yPos, isBridge, cx, cz, key: `${road.id ?? i}-${ci}` }];
      });
    });
  }, [roads, projection]);

  return (
    <>
      {roadItems.map(({ shape, material, yPos, isBridge, cx, cz, key }) => (
        <group key={key}>
          <RoadMesh shape={shape} material={material} yPos={yPos} />
          {isBridge && <BridgePillar cx={cx} cz={cz} />}
        </group>
      ))}
    </>
  );
}

// ── Parks + grass ──────────────────────────────────────────────────────────

function GreenMeshes() {
  const parks = useAreaStore((state) => state.parks);
  const projection = useAreaStore((state) => state.projection);

  const shapes = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;
    return parks.flatMap(({ key, ring }) => {
      const shape = buildPolygonShapeClipped(ring, refLat, refLng, scaleX, scaleY, bbox);
      if (!shape) return [];
      return [{ shape, key }];
    });
  }, [parks, projection]);

  return (
    <>
      {shapes.map(({ shape, key }) => (
        <FlatPolygonMesh key={key} shape={shape} material={PARK_MAT} yPos={PARK_Y} />
      ))}
    </>
  );
}

// ── Water polygons ─────────────────────────────────────────────────────────

function WaterPolygonMeshes() {
  const waterPolygons = useAreaStore((state) => state.waterPolygons);
  const projection = useAreaStore((state) => state.projection);

  const shapes = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;
    return waterPolygons.flatMap(({ key, ring }) => {
      const shape = buildPolygonShapeClipped(ring, refLat, refLng, scaleX, scaleY, bbox);
      if (!shape) return [];
      return [{ shape, key }];
    });
  }, [waterPolygons, projection]);

  return (
    <>
      {shapes.map(({ shape, key }) => (
        <FlatPolygonMesh key={key} shape={shape} material={WATER_MAT} yPos={WATER_POLYGON_Y} />
      ))}
    </>
  );
}

// ── Rivers + streams (ribbon mesh) ────────────────────────────────────────

function WaterRibbonMeshes() {
  const rivers = useAreaStore((state) => state.rivers);
  const streams = useAreaStore((state) => state.streams);
  const projection = useAreaStore((state) => state.projection);

  const shapes = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;

    const process = (elems: PolylineElem[], halfW: number) =>
      elems.flatMap((el, i) => {
        const clipped = clipPolylineToBbox(
          el.geometry as LatLon[],
          bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng
        );
        return clipped.flatMap((chain, ci) => {
          const pts2d = chain.map((pt) => new THREE.Vector2(
            (pt.lon - refLng) * scaleX,
            (pt.lat - refLat) * scaleY,
          ));
          const shape = buildRoadShape(pts2d, halfW);
          if (!shape) return [];
          return [{ shape, key: `${el.id ?? i}-${ci}` }];
        });
      });

    return [
      ...process(rivers, RIVER_HALF_WIDTH),
      ...process(streams, STREAM_HALF_WIDTH),
    ];
  }, [rivers, streams, projection]);

  return (
    <>
      {shapes.map(({ shape, key }) => (
        <RoadMesh key={key} shape={shape} material={WATER_MAT} yPos={WATER_RIBBON_Y} />
      ))}
    </>
  );
}

// ── Forests ────────────────────────────────────────────────────────────────

function ForestMeshes() {
  const forests = useAreaStore((state) => state.forests);
  const projection = useAreaStore((state) => state.projection);

  const shapes = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;
    return forests.flatMap(({ key, ring }) => {
      const shape = buildPolygonShapeClipped(ring, refLat, refLng, scaleX, scaleY, bbox);
      if (!shape) return [];
      return [{ shape, key }];
    });
  }, [forests, projection]);

  return (
    <>
      {shapes.map(({ shape, key }) => (
        <FlatPolygonMesh key={key} shape={shape} material={FOREST_MAT} yPos={FOREST_Y} />
      ))}
    </>
  );
}

// ── Railways ───────────────────────────────────────────────────────────────

function RailwayMeshes() {
  const railways = useAreaStore((state) => state.railways);
  const projection = useAreaStore((state) => state.projection);

  const shapes = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY, bbox } = projection;
    return railways.flatMap((el, i) => {
      const clipped = clipPolylineToBbox(
        el.geometry as LatLon[],
        bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng
      );
      return clipped.flatMap((chain, ci) => {
        const pts2d = chain.map((pt) => new THREE.Vector2(
          (pt.lon - refLng) * scaleX,
          (pt.lat - refLat) * scaleY,
        ));
        const shape = buildRoadShape(pts2d, RAILWAY_HALF_WIDTH);
        if (!shape) return [];
        return [{ shape, key: `rail-${el.id ?? i}-${ci}` }];
      });
    });
  }, [railways, projection]);

  return (
    <>
      {shapes.map(({ shape, key }) => (
        <RoadMesh key={key} shape={shape} material={RAILWAY_MAT} yPos={RAILWAY_Y} />
      ))}
    </>
  );
}

// Stable position — module-level constant so R3F never sees a new array reference.
const GROUND_POSITION: [number, number, number] = [0, -0.25, 0];

// sceneWidth / sceneDepth are computed in Space via useMemo(…, [center]) so they
// only change when the user generates a new scene, never on canvas resize.
function GroundPlane({ sceneWidth, sceneDepth }: { sceneWidth: number; sceneDepth: number }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const includeGroundPlane = useActionStore((state) => state.includeGroundPlane);

  // Stable args tuple — only a new array when dimensions actually change.
  const boxArgs = useMemo<[number, number, number]>(
    () => [sceneWidth, 0.5, sceneDepth],
    [sceneWidth, sceneDepth]
  );

  useEffect(() => {
    if (!meshRef.current) return;
    meshRef.current.userData.exportToGLB = true;
    meshRef.current.userData.groundPlane = true;
  }, []);

  if (!includeGroundPlane) return null;

  // Top face sits at y = 0, flush with building bases.
  // X = longitudinal span, Z = latitudinal span (world Z after building rotation).
  return (
    <mesh ref={meshRef} position={GROUND_POSITION} material={GROUND_PREVIEW_MAT}>
      <boxGeometry args={boxArgs} />
    </mesh>
  );
}

export function Export() {
  const { scene } = useThree();
  const action = useActionStore((state) => state.action);
  const fleetSpaceId = useActionStore((state) => state.fleetSpaceId);

  const exportType = useActionStore((state) => state.exportType);

  const setAction = useActionStore((state) => state.setAction);

  useEffect(() => {
    if (action === true) {
      setAction(false);
      exportGLB();
    }
  }, [action, setAction, scene]);

  const uploadFleet = async (blob) => {
    const formData = new FormData();

    formData.append("object", blob, "box3d.glb");
    formData.append("title", "New Object");
    formData.append("description", "");
    formData.append("spaceId", fleetSpaceId);

    await instanceFleet.post("space/file/mesh", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  };

  const exportGLB = () => {
    const exportRoot = new THREE.Group();
    const cloneExportable = (source: THREE.Object3D): THREE.Object3D | null => {
      if (source.userData?.excludeFromGLB === true) return null;
      const clone = source.clone(false);
      source.children.forEach((child) => {
        const childClone = cloneExportable(child);
        if (childClone) clone.add(childClone);
      });
      return clone;
    };
    scene.traverse((child) => {
      if (child.userData?.exportToGLB === true) {
        let parent = child.parent;
        while (parent && parent !== scene) {
          if (parent.userData?.exportToGLB === true) return;
          parent = parent.parent;
        }
        const clone = cloneExportable(child);
        if (!clone) return;
        // Swap preview material → opaque export material on the ground plane
        if (child.userData?.groundPlane === true && clone instanceof THREE.Mesh) {
          clone.material = GROUND_MAT;
        }
        exportRoot.add(clone);
      }
    });
    const exporter = new GLTFExporter();
    const options = { binary: true, embedImages: true };
    exporter.parse(
      exportRoot,
      (result) => {
        if (result instanceof ArrayBuffer) {
          const blob = new Blob([result], { type: "model/gltf-binary" });

          if (exportType == "glb") {
            const link = document.createElement("a");
            link.style.display = "none";
            document.body.appendChild(link);
            link.href = URL.createObjectURL(blob);
            link.download = "scene.glb";
            link.click();
            document.body.removeChild(link);
          }

          if (exportType == "fleet") {
            uploadFleet(blob);
          }
        } else {
          console.error("GLB export failed: unexpected result", result);
        }
      },
      (error) => {
        console.error("An error occurred during export", error);
      },
      options
    );
  };
  return null;
}

export function Space({
  inspectorOpen,
  onInspectorOpenChange,
  indoorDataStatus,
  indoorDataError,
  onIndoorDataRetry,
  cameraView,
  onCameraViewChange,
}: {
  inspectorOpen: boolean;
  onInspectorOpenChange: (open: boolean) => void;
  indoorDataStatus: "idle" | "loading" | "loaded" | "error";
  indoorDataError: string;
  onIndoorDataRetry: () => void;
  cameraView: "orbit" | "topdown" | "walkthrough";
  onCameraViewChange: (view: "orbit" | "topdown" | "walkthrough") => void;
}) {
  const areas = useAreaStore((state) => state.areas);
  const indoorFeatures = useAreaStore((state) => state.indoorFeatures);
  const projection = useAreaStore((state) => state.projection);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [activeWalkthroughFloor, setActiveWalkthroughFloor] = useState(0);

  useEffect(() => {
    if (cameraView === "walkthrough" && !selectedBuildingId) {
      onCameraViewChange("orbit");
    }
  }, [cameraView, onCameraViewChange, selectedBuildingId]);

  useEffect(() => {
    setSelectedBuildingId(null);
    setActiveWalkthroughFloor(0);
  }, [areas, projection]);

  // Ground plane dimensions — frozen at generation time via projection store.
  // Never recalculates on canvas/viewport resize.
  const { groundSceneWidth, groundSceneDepth } = useMemo(() => {
    if (!projection) return { groundSceneWidth: 0, groundSceneDepth: 0 };
    const { bbox, scaleX, scaleY } = projection;
    return {
      groundSceneWidth: (bbox.maxLng - bbox.minLng) * scaleX * 1.2,
      groundSceneDepth: (bbox.maxLat - bbox.minLat) * scaleY * 1.2,
    };
  }, [projection]);
  const sceneSpan = Math.max(groundSceneWidth, groundSceneDepth, 40);
  const cameraDistance = sceneSpan * 1.7;

  const buildingsData = useMemo(() => {
    if (!projection) return [];
    const { refLat, refLng, scaleX, scaleY } = projection;
    const result: Array<{
      buildingId: string;
      shape: THREE.Shape;
      height: number;
      floorCount: number;
      reportedFloorCount: number | null;
      heightIsEstimated: boolean;
      floorCountIsEstimated: boolean;
      focusTarget: THREE.Vector3;
      focusDistance: number;
      tags: any;
      footprintArea: number;
      indoorOutline: THREE.Vector2[];
      indoorBounds: THREE.Box2;
      indoorFeatures: ProjectedIndoorFeature[];
    }> = [];
    areas.forEach((bld: any, index: number) => {
      if (!bld.geometry || bld.geometry.length < 3) return;
      const shapePoints = bld.geometry.map((pt: any) =>
        new THREE.Vector2((pt.lng - refLng) * scaleX, (pt.lat - refLat) * scaleY)
      );
      if (!shapePoints[0].equals(shapePoints[shapePoints.length - 1]))
        shapePoints.push(shapePoints[0]);
      const shape = new THREE.Shape(shapePoints);
      const bounds = new THREE.Box2().setFromPoints(shapePoints);
      const tags = bld.tags ?? {};
      const osmHeight = parseOsmHeight(tags.height);
      const osmLevels = parseOsmLevels(tags["building:levels"]);
      const requestedFloorCount = osmLevels !== null
        ? Math.max(1, Math.round(osmLevels))
        : Math.max(
            1,
            Math.round((osmHeight ?? DEFAULT_BUILDING_HEIGHT) / DEFAULT_FLOOR_HEIGHT)
          );
      const floorCount = Math.min(requestedFloorCount, MAX_BUILDING_FLOORS);
      const height = osmHeight ?? (
        osmLevels !== null
          ? Math.min(osmLevels, MAX_BUILDING_FLOORS) * REPORTED_LEVEL_HEIGHT
          : DEFAULT_BUILDING_HEIGHT
      );
      const focusTarget = new THREE.Vector3(
        (bounds.min.x + bounds.max.x) / 2,
        height / 2,
        -(bounds.min.y + bounds.max.y) / 2
      );
      const focusRadius = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, height, 8);
      result.push({
        buildingId: `${bld.id ?? "building"}-${index}`,
        shape,
        height,
        floorCount,
        reportedFloorCount: osmLevels,
        heightIsEstimated: osmHeight === null,
        floorCountIsEstimated: osmLevels === null,
        focusTarget,
        focusDistance: Math.max(16, focusRadius * 2.7),
        tags,
        footprintArea: Math.abs(THREE.ShapeUtils.area(shapePoints.slice(0, -1))),
        indoorOutline: shapePoints.slice(0, -1),
        indoorBounds: bounds,
        indoorFeatures: [],
      });
    });

    const projectedIndoorFeatures = indoorFeatures.flatMap((feature) => {
      const paths = feature.paths.map((path) => ({
        role: path.role,
        points: path.points.map(
          (point) =>
            new THREE.Vector2(
              (point.lon - refLng) * scaleX,
              (point.lat - refLat) * scaleY
            )
        ),
      }));
      const allPoints = paths.flatMap((path) => path.points);
      if (allPoints.length === 0) return [];
      const center = allPoints.reduce(
        (sum, point) => sum.add(point),
        new THREE.Vector2()
      ).multiplyScalar(1 / allPoints.length);
      return [{ id: feature.id, tags: feature.tags, paths, center }];
    });

    for (const feature of projectedIndoorFeatures) {
      const candidate = result
        .filter((building) => {
          if (!building.indoorBounds.containsPoint(feature.center)) return false;
          return (
            isPointInPolygon(feature.center, building.indoorOutline) ||
            building.indoorOutline.some(
              (point) => point.distanceTo(feature.center) < 0.25
            )
          );
        })
        .sort((a, b) => a.footprintArea - b.footprintArea)[0];
      candidate?.indoorFeatures.push(feature);
    }

    return result;
  }, [areas, indoorFeatures, projection]);
  const selectedBuilding = buildingsData.find(
    (item) => item.buildingId === selectedBuildingId
  );
  const walkthroughWalls = useMemo(() => {
    if (!selectedBuilding) return [];
    const mappedWalls = selectedBuilding.indoorFeatures
      .filter((feature) => feature.tags.indoor === "wall")
      .flatMap((feature) =>
        feature.paths.flatMap((path) =>
          path.points.slice(1).map((end, index) => [
            path.points[index],
            end,
          ] as [THREE.Vector2, THREE.Vector2])
        )
      );
    return mappedWalls.length > 0 ||
      selectedBuilding.indoorFeatures.some(hasRenderableIndoorGeometry)
      ? mappedWalls
      : generateDemoInterior(selectedBuilding.shape, activeWalkthroughFloor).wallSegments;
  }, [selectedBuilding, activeWalkthroughFloor]);

  return (
    <div className="mapforge-scene">
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        camera={{
          fov: 55,
          near: 0.1,
          far: Math.max(7000, sceneSpan * 8),
          position: [cameraDistance * 0.72, cameraDistance * 0.82, cameraDistance * 1.1],
        }}
      >
      <color attach="background" args={["#101a28"]} />
      <ambientLight intensity={0.72} />
      <hemisphereLight args={["#d7e4f2", "#182437", 0.78]} />
      <spotLight position={[10, 10, 10]} angle={0.28} penumbra={0.7} decay={0} intensity={1.45} />
      <GroundPlane sceneWidth={groundSceneWidth} sceneDepth={groundSceneDepth} />
      <GreenMeshes />
      <WaterPolygonMeshes />
      <ForestMeshes />
      <WaterRibbonMeshes />
      <RailwayMeshes />
      <RoadMeshes />
      {buildingsData.map((item) => (
        <Building
          key={item.buildingId}
          buildingId={item.buildingId}
          shape={item.shape}
          height={item.height}
          floorCount={item.floorCount}
          reportedFloorCount={item.reportedFloorCount}
          heightIsEstimated={item.heightIsEstimated}
          floorCountIsEstimated={item.floorCountIsEstimated}
          indoorFeatures={item.indoorFeatures}
          indoorDataStatus={indoorDataStatus}
          indoorDataError={indoorDataError}
          onIndoorDataRetry={onIndoorDataRetry}
          cameraView={cameraView}
          onCameraViewChange={onCameraViewChange}
          activeWalkthroughFloor={activeWalkthroughFloor}
          onWalkthroughFloorChange={setActiveWalkthroughFloor}
          isSelected={selectedBuildingId === item.buildingId}
          inspectorOpen={inspectorOpen}
          onInspectorOpenChange={onInspectorOpenChange}
          onSelect={(id) => {
            setSelectedBuildingId((current) => (current === id ? null : id));
            onCameraViewChange("orbit");
            if (id) onInspectorOpenChange(true);
          }}
          tags={item.tags}
        />
      ))}
      <pointLight position={[-10, -10, -10]} decay={0} intensity={0.55} />
      {cameraView === "walkthrough" && selectedBuilding ? (
        <FirstPersonWalkthrough
          key={`${selectedBuilding.buildingId}-${activeWalkthroughFloor}`}
          shape={selectedBuilding.shape}
          floorLevel={activeWalkthroughFloor}
          floorHeight={selectedBuilding.height / selectedBuilding.floorCount}
          wallSegments={walkthroughWalls}
          onExit={() => onCameraViewChange("orbit")}
        />
      ) : (
        <Car
          focusTarget={selectedBuilding?.focusTarget ?? null}
          focusDistance={selectedBuilding?.focusDistance ?? sceneSpan}
          topDown={cameraView === "topdown"}
        />
      )}
      <Export />
      <Environment preset="city" />
      </Canvas>
    </div>
  );
}
