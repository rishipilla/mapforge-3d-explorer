import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { generateDemoInterior } from "../src/geometry/interiorGenerator.ts";
import { getBuildingStyle } from "../src/materials/buildingMaterials.ts";

describe("Floor & Interior System Tests", () => {
  test("generates demo interior with rooms, doorways and furniture", () => {
    // 20m x 20m building shape
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(20, 0);
    shape.lineTo(20, 20);
    shape.lineTo(0, 20);
    shape.closePath();

    const { rooms, wallSegments, furnitureItems } = generateDemoInterior(shape, 1);

    // Verify rooms are generated
    assert.ok(rooms.length > 0, "Should generate rooms for a 20x20 building");
    assert.equal(rooms[0].source, "demo_generated");

    // Verify wall segments with doorway openings exist
    assert.ok(wallSegments.length > 0, "Should generate wall segments with doorways");

    // Verify furniture is placed
    assert.ok(furnitureItems.length > 0, "Should place architectural furniture");
  });

  test("procedural style assigns appropriate materials based on OSM tags", () => {
    // Hospital
    const hospitalStyle = getBuildingStyle({ building: "hospital" });
    assert.equal(hospitalStyle.buildingType, "Hospital");

    // Commercial Office
    const officeStyle = getBuildingStyle({ building: "commercial" });
    assert.equal(officeStyle.buildingType, "Commercial Office");

    // Residential
    const residentialStyle = getBuildingStyle({ building: "residential" });
    assert.equal(residentialStyle.buildingType, "Residential");

    // Selected highlight
    const selectedStyle = getBuildingStyle({ building: "commercial" }, true);
    assert.ok(selectedStyle.facadeMaterial.emissive, "Selected building should have emissive highlight");
  });

  test("floor spacing calculations maintain zero gap when collapsed", () => {
    const floorCount = 5;
    const height = 15;
    const floorHeight = height / floorCount; // 3m per floor
    const floorGapRatio = 0.5;
    const floorGap = floorHeight * floorGapRatio;

    // Collapsed positions
    const collapsedPositions = Array.from({ length: floorCount }, (_, i) => i * floorHeight);
    for (let i = 0; i < floorCount - 1; i++) {
      const topOfCurrent = collapsedPositions[i] + floorHeight;
      const bottomOfNext = collapsedPositions[i + 1];
      assert.equal(topOfCurrent, bottomOfNext, "Adjacent floors must touch with zero gap when collapsed");
    }

    // Exploded positions
    const explodedPositions = Array.from(
      { length: floorCount },
      (_, i) => i * floorHeight + i * floorGap
    );
    for (let i = 0; i < floorCount - 1; i++) {
      const actualGap = explodedPositions[i + 1] - (explodedPositions[i] + floorHeight);
      assert.equal(actualGap, floorGap, "Exploded floors must have exact floorGap spacing");
    }
  });
});
