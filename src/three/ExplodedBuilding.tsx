
import * as THREE from "three";
import { useMemo, useRef, useLayoutEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Edges, Html, useCursor } from "@react-three/drei";

export interface ExplodedBuildingProps {
  shape: THREE.Shape;
  height: number;
  floorCount: number;
  exploded: boolean;
  selectedFloor?: number | null;
  onFloorSelect?: (floorIndex: number) => void;
  floorGapRatio?: number;
  isEstimated?: boolean;
  position?: [number, number, number];
}

export function getFloorDataFromTags(
  tags: Record<string, string>,
  fallbackHeight: number
) {
  const parsedHeight = Number.parseFloat(tags.height || "");
  const parsedLevels = Number.parseInt(tags["building:levels"] || "", 10);

  const height =
    Number.isFinite(parsedHeight) && parsedHeight > 0
      ? parsedHeight
      : fallbackHeight;

  if (Number.isFinite(parsedLevels) && parsedLevels > 0) {
    return {
      height,
      floorCount: Math.min(parsedLevels, 80),
      isEstimated: false,
    };
  }

  return {
    height,
    floorCount: Math.max(1, Math.min(80, Math.round(height / 3.5))),
    isEstimated: true,
  };
}

export default function ExplodedBuilding({
  shape,
  height,
  floorCount,
  exploded,
  selectedFloor = null,
  onFloorSelect,
  floorGapRatio = 0.18,
  isEstimated = false,
  position = [0, 0, 0],
}: ExplodedBuildingProps) {
  const floorRefs = useRef<(THREE.Group | null)[]>([]);
  const [hovered, setHovered] = useState(false);

  useCursor(hovered);

  const { floors, center } = useMemo(() => {
    const count = Math.max(1, Math.min(80, Math.floor(floorCount)));
    const floorHeight = height / count;
    const slabDepth = floorHeight * 0.85;
    const gap = floorHeight * Math.max(0, Math.min(0.8, floorGapRatio));

    const points = shape.getPoints();
    let cx = 0;
    let cy = 0;

    points.forEach((point) => {
      cx += point.x;
      cy += point.y;
    });

    if (points.length > 0) {
      cx /= points.length;
      cy /= points.length;
    }

    const result = Array.from({ length: count }, (_, index) => ({
      index,
      depth: slabDepth,
      collapsedZ: index * floorHeight,
      explodedZ: index * (floorHeight + gap),
      geometry: new THREE.ExtrudeGeometry(shape, {
        steps: 1,
        depth: slabDepth,
        bevelEnabled: false,
      }),
    }));

    result.forEach((floor) => floor.geometry.computeVertexNormals());

    return {
      floors: result,
      center: new THREE.Vector2(cx, cy),
    };
  }, [shape, height, floorCount, floorGapRatio]);

  useLayoutEffect(() => {
    return () => {
      floors.forEach((floor) => floor.geometry.dispose());
    };
  }, [floors]);

  useFrame((_, delta) => {
    const alpha = 1 - Math.exp(-7 * delta);

    floorRefs.current.forEach((group, index) => {
      const floor = floors[index];
      if (!group || !floor) return;

      const target = exploded ? floor.explodedZ : floor.collapsedZ;
      group.position.z += (target - group.position.z) * alpha;
    });
  });

  return (
    <group position={position} name="ExplodedBuilding_Root">
      {/* Extrusion is local Z; this rotation maps it to world vertical. */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {floors.map((floor) => {
          const selected = selectedFloor === floor.index;

          return (
            <group
              key={floor.index}
              ref={(element) => {
                floorRefs.current[floor.index] = element;
              }}
              position={[0, 0, floor.collapsedZ]}
              name={`Floor_${floor.index + 1}`}
            >
              <mesh
                geometry={floor.geometry}
                userData={{ exportToGLB: true }}
                onClick={(event) => {
                  event.stopPropagation();
                  onFloorSelect?.(floor.index);
                }}
                onPointerOver={(event) => {
                  event.stopPropagation();
                  setHovered(true);
                }}
                onPointerOut={() => setHovered(false)}
              >
                <meshStandardMaterial
                  color={selected ? "#3b82f6" : "#e5e7eb"}
                  roughness={0.65}
                  metalness={0.05}
                  emissive={selected ? "#2563eb" : "#000000"}
                  emissiveIntensity={selected ? 0.2 : 0}
                />
                <Edges threshold={15} color="#374151" />
              </mesh>

              {exploded && (
                <Html
                  position={[
                    center.x,
                    center.y,
                    floor.depth + 0.35,
                  ]}
                  center
                  distanceFactor={20}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  <div
                    style={{
                      background: selected ? "#2563eb" : "#ffffff",
                      color: selected ? "#ffffff" : "#111827",
                      border: "1px solid #2563eb",
                      borderRadius: "999px",
                      padding: "3px 9px",
                      fontSize: "11px",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      boxShadow: "0 3px 10px #0002",
                    }}
                  >
                    {isEstimated && floor.index === floors.length - 1
                      ? "~"
                      : ""}
                    F{floor.index + 1}
                  </div>
                </Html>
              )}
            </group>
          );
        })}
      </group>
    </group>
  );
}
