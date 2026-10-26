import * as THREE from "three";
import {
  getWoodFloorTexture,
  getConcreteTexture,
  getBrickTexture,
  getWindowGridTexture,
} from "./textureGenerator.ts";

export interface BuildingStyle {
  buildingType: string;
  source: "osm_tags" | "procedural_fallback";
  facadeMaterial: THREE.MeshStandardMaterial;
  roofMaterial: THREE.MeshStandardMaterial;
  floorSlabMaterial: THREE.MeshStandardMaterial;
  interiorWallMaterial: THREE.MeshStandardMaterial;
  interiorFloorMaterial: THREE.MeshStandardMaterial;
  glassMaterial: THREE.MeshPhysicalMaterial;
}

// Global material cache
const materialCache = new Map<string, THREE.Material>();

function getOrCreateStandardMaterial(
  key: string,
  parameters: THREE.MeshStandardMaterialParameters
): THREE.MeshStandardMaterial {
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshStandardMaterial(parameters));
  }
  return materialCache.get(key) as THREE.MeshStandardMaterial;
}

function getOrCreatePhysicalMaterial(
  key: string,
  parameters: THREE.MeshPhysicalMaterialParameters
): THREE.MeshPhysicalMaterial {
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshPhysicalMaterial(parameters));
  }
  return materialCache.get(key) as THREE.MeshPhysicalMaterial;
}

/**
 * Common architectural materials
 */
export const ArchitecturalMaterials = {
  // Polished architectural concrete (dark/medium gray, subtle roughness)
  Concrete: () =>
    getOrCreateStandardMaterial("arch_concrete", {
      color: "#8a94a0",
      roughness: 0.82,
      metalness: 0.05,
      map: getConcreteTexture(),
    }),

  // Warm wood plank flooring
  WoodFlooring: () =>
    getOrCreateStandardMaterial("arch_wood_floor", {
      color: "#c49a6c",
      roughness: 0.45,
      metalness: 0.02,
      map: getWoodFloorTexture(),
    }),

  // Warm brick facade
  Brick: () =>
    getOrCreateStandardMaterial("arch_brick", {
      color: "#b4533c",
      roughness: 0.88,
      metalness: 0.02,
      map: getBrickTexture(),
    }),

  // Architectural glass (translucent, tinted, slight reflection)
  Glass: () =>
    getOrCreatePhysicalMaterial("arch_glass", {
      color: "#60a5fa",
      metalness: 0.1,
      roughness: 0.12,
      transmission: 0.85,
      thickness: 0.5,
      transparent: true,
      opacity: 0.65,
    }),

  // Modern curtain wall (dark mullions with glass panes)
  CurtainWall: () =>
    getOrCreateStandardMaterial("arch_curtain_wall", {
      color: "#e2e8f0",
      roughness: 0.35,
      metalness: 0.25,
      map: getWindowGridTexture("#93c5fd"),
    }),

  // Interior Drywall / Plaster (soft white/beige matte)
  Plaster: () =>
    getOrCreateStandardMaterial("arch_plaster", {
      color: "#f1f5f9",
      roughness: 0.92,
      metalness: 0.0,
    }),

  // Dark Structural Steel / Aluminum framing
  DarkSteel: () =>
    getOrCreateStandardMaterial("arch_dark_steel", {
      color: "#1e293b",
      roughness: 0.4,
      metalness: 0.6,
    }),

  // Roof gravel / waterproofing membrane
  RoofMembrane: () =>
    getOrCreateStandardMaterial("arch_roof_membrane", {
      color: "#334155",
      roughness: 0.95,
      metalness: 0.05,
    }),

  // Selected Building Highlight Material
  Highlight: () =>
    getOrCreateStandardMaterial("arch_selected_highlight", {
      color: "#38bdf8",
      roughness: 0.4,
      metalness: 0.1,
      emissive: "#0369a1",
      emissiveIntensity: 0.22,
    }),
};

/**
 * Resolve building appearance based on OSM tags with intelligent procedural fallbacks
 */
export function getBuildingStyle(
  tags: Record<string, string> = {},
  isSelected = false
): BuildingStyle {
  if (isSelected) {
    return {
      buildingType: tags.building || "selected",
      source: "osm_tags",
      facadeMaterial: ArchitecturalMaterials.Highlight(),
      roofMaterial: ArchitecturalMaterials.RoofMembrane(),
      floorSlabMaterial: ArchitecturalMaterials.DarkSteel(),
      interiorWallMaterial: ArchitecturalMaterials.Plaster(),
      interiorFloorMaterial: ArchitecturalMaterials.WoodFlooring(),
      glassMaterial: ArchitecturalMaterials.Glass(),
    };
  }

  const rawBuilding = (tags.building || "").toLowerCase();
  const rawAmenity = (tags.amenity || "").toLowerCase();
  const rawColour = tags["building:colour"] || tags.colour;
  const rawMaterial = tags["building:material"] || tags.material;

  const hasExplicitColorOrMaterial = Boolean(rawColour || rawMaterial);

  // 1. Hospital / Healthcare
  if (
    rawBuilding === "hospital" ||
    rawAmenity === "hospital" ||
    rawAmenity === "clinic"
  ) {
    return {
      buildingType: "Hospital",
      source: hasExplicitColorOrMaterial ? "osm_tags" : "procedural_fallback",
      facadeMaterial: getOrCreateStandardMaterial("bld_hospital_facade", {
        color: rawColour || "#f8fafc",
        roughness: 0.7,
        metalness: 0.05,
      }),
      roofMaterial: ArchitecturalMaterials.RoofMembrane(),
      floorSlabMaterial: ArchitecturalMaterials.Concrete(),
      interiorWallMaterial: ArchitecturalMaterials.Plaster(),
      interiorFloorMaterial: getOrCreateStandardMaterial("hospital_floor", {
        color: "#e2e8f0",
        roughness: 0.3,
      }),
      glassMaterial: ArchitecturalMaterials.Glass(),
    };
  }

  // 2. Commercial / Office / High-rise
  if (
    rawBuilding === "commercial" ||
    rawBuilding === "office" ||
    rawBuilding === "hotel"
  ) {
    return {
      buildingType: "Commercial Office",
      source: hasExplicitColorOrMaterial ? "osm_tags" : "procedural_fallback",
      facadeMaterial: rawColour
        ? getOrCreateStandardMaterial(`bld_office_${rawColour}`, {
            color: rawColour,
            roughness: 0.45,
            metalness: 0.2,
          })
        : ArchitecturalMaterials.CurtainWall(),
      roofMaterial: ArchitecturalMaterials.RoofMembrane(),
      floorSlabMaterial: ArchitecturalMaterials.DarkSteel(),
      interiorWallMaterial: ArchitecturalMaterials.Plaster(),
      interiorFloorMaterial: ArchitecturalMaterials.WoodFlooring(),
      glassMaterial: ArchitecturalMaterials.Glass(),
    };
  }

  // 3. Residential / Apartments / House
  if (
    rawBuilding === "residential" ||
    rawBuilding === "apartments" ||
    rawBuilding === "house" ||
    rawBuilding === "terrace" ||
    rawBuilding === "detached"
  ) {
    return {
      buildingType: "Residential",
      source: hasExplicitColorOrMaterial ? "osm_tags" : "procedural_fallback",
      facadeMaterial: rawColour
        ? getOrCreateStandardMaterial(`bld_residential_${rawColour}`, {
            color: rawColour,
            roughness: 0.85,
          })
        : ArchitecturalMaterials.Brick(),
      roofMaterial: getOrCreateStandardMaterial("bld_roof_tile", {
        color: tags["roof:colour"] || "#991b1b",
        roughness: 0.9,
      }),
      floorSlabMaterial: ArchitecturalMaterials.Concrete(),
      interiorWallMaterial: ArchitecturalMaterials.Plaster(),
      interiorFloorMaterial: ArchitecturalMaterials.WoodFlooring(),
      glassMaterial: ArchitecturalMaterials.Glass(),
    };
  }

  // 4. Industrial / Warehouse
  if (rawBuilding === "industrial" || rawBuilding === "warehouse") {
    return {
      buildingType: "Industrial",
      source: hasExplicitColorOrMaterial ? "osm_tags" : "procedural_fallback",
      facadeMaterial: getOrCreateStandardMaterial("bld_industrial", {
        color: rawColour || "#64748b",
        roughness: 0.75,
        metalness: 0.35,
      }),
      roofMaterial: ArchitecturalMaterials.RoofMembrane(),
      floorSlabMaterial: ArchitecturalMaterials.Concrete(),
      interiorWallMaterial: ArchitecturalMaterials.Concrete(),
      interiorFloorMaterial: ArchitecturalMaterials.Concrete(),
      glassMaterial: ArchitecturalMaterials.Glass(),
    };
  }

  // 5. Default / General Building
  return {
    buildingType: tags.building ? tags.building.replace(/_/g, " ") : "Building",
    source: hasExplicitColorOrMaterial ? "osm_tags" : "procedural_fallback",
    facadeMaterial: getOrCreateStandardMaterial(`bld_generic_${rawColour || "default"}`, {
      color: rawColour || "#94a3b8",
      roughness: 0.75,
      metalness: 0.08,
      map: getConcreteTexture(),
    }),
    roofMaterial: ArchitecturalMaterials.RoofMembrane(),
    floorSlabMaterial: ArchitecturalMaterials.DarkSteel(),
    interiorWallMaterial: ArchitecturalMaterials.Plaster(),
    interiorFloorMaterial: ArchitecturalMaterials.WoodFlooring(),
    glassMaterial: ArchitecturalMaterials.Glass(),
  };
}
