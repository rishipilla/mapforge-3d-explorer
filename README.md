# MapForge — Interactive 3D City & Building Explorer

Explore real-world places as interactive 3D scenes. **MapForge** transforms geographic data into 3D city geometry and adds tools for inspecting buildings, separating floors, exploring rooms, and exporting models.

Built with React, TypeScript, Vite, Three.js, and React Three Fiber, MapForge combines OpenStreetMap data with procedural architectural materials and optional map imagery.

> **Data honesty:** Building footprints and mapped indoor features come from source data when available. Procedural/demo interiors are simulations—not verified architectural plans. Coverage and detail vary by location.

---

## ✨ Highlights

- **Search and select a location** using city-name geocoding and a draggable map selection area.
- **Generate 3D city scenes** from available OpenStreetMap building and geographic features.
- **Inspect buildings** and use building tags to choose sensible visual styles where available.
- **Explore exploded floors** with animated separation and aligned collapse positioning.
- **Explore rooms** using mapped indoor data where available, or a clearly labeled demo interior when not.
- **Walk through demo interiors** with first-person movement and doorway-aware collision handling.
- **Use procedural PBR-style materials** for wood, concrete, brick, glass, and building-specific appearances.
- **View map imagery** from supported tile providers with geographic alignment and attribution.
- **Export supported scene geometry to GLB** for use in compatible 3D tools.

## 🏙️ Project Vision

MapForge aims to make a city more than a flat map or a collection of building shapes. The long-term experience is an architectural digital exploration tool:

1. Search an area and generate the city scene.
2. Select a building and inspect its available information.
3. Switch to cutaway or exploded-floor mode.
4. Select an individual floor and inspect rooms.
5. Enter a supported interior and navigate through rooms.
6. Export supported geometry for further work in a 3D application.

The available detail depends on the source data. MapForge can generate demonstration layouts for testing, but those layouts must not be mistaken for real building interiors.

## 🧱 Features

### Map selection and geographic data

- City/place search via Nominatim geocoding.
- Resizable selection area with size presets and drag positioning.
- Map rotation controls where supported by the current map UI.
- OpenStreetMap/Overpass queries for supported buildings, roads, paths, and other mapped features.
- Geographic projection and bounding-box filtering for scene geometry.
- Loading, empty-result, and request-error handling should be preserved as the project evolves.

### 3D city and architecture

- Extruded building footprints, using reported height or level tags when available.
- Road and pedestrian-path geometry styled by feature type.
- Procedural material choices based on mapped building and roof tags when possible.
- Distinct palettes for residential, commercial, healthcare, and industrial structures.
- Isometric, exterior, and cutaway presentation as supported by the current scene.
- Shared resources and on-demand detail to help control draw calls and memory use.

### Floors and rooms

- Animated exploded-floor view with consistent floor positioning and slab thickness.
- Floor selection, highlighting, isolation, collapse, and camera focus where implemented.
- Selectable rooms and room metadata panels.
- Interior geometry for rooms, partitions, doorways, corridors, and furniture in generated demo layouts.
- First-person navigation for supported generated interiors, with footprint boundaries and doorway-aware collision checks.
- Explicit provenance labels to distinguish real mapped indoor data from demo simulation.

### Materials, textures, and imagery

- Canvas-generated procedural textures, including wood planks, concrete, brick, and glass-mullion patterns.
- Reusable Three.js materials for exterior and interior surfaces.
- Building-type visual classification and OSM material/colour tag support.
- Raster tile imagery provider abstraction for supported public map tile services.
- Attribution and provider terms must be respected. Map tiles are not necessarily live imagery, and tile imagery does not provide interior floor plans.

### GLB export

- Export supported scene meshes to GLB.
- Mark exportable objects explicitly to help exclude UI helpers and unwanted scene objects.
- Keep geometry, transformations, and supported materials intact.
- Re-open exported files in a compatible viewer to verify the output; exporter coverage may vary by object/material type.

---

## 🎨 Visual direction

MapForge targets a polished architectural cutaway look:

- **Exterior:** concrete, brick, plaster, tinted glass, metal frames, roof surfaces, and facade details.
- **Interior:** warm wood, stone or tile flooring, painted walls, doors, stairs, railings, furniture, and planters.
- **Environment:** roads, sidewalks, greenery, sky lighting, and grounded shadows.
- **UI:** readable labels, clear active states, consistent spacing, and a docked inspector that keeps the 3D scene visible.

Generated materials improve appearance, but they do not prove the real-world material or architectural design of an individual building.

## 🧰 Tech stack

- **React + TypeScript + Vite** — application and development tooling.
- **Three.js** — 3D geometry, materials, and GLB export.
- **React Three Fiber + Drei** — React-based 3D scene composition.
- **Leaflet + leaflet-rotate** — 2D map selection and map rotation.
- **OpenStreetMap + Overpass API** — geographic features and mapped building/indoor data.
- **Nominatim** — place-name geocoding.
- **Canvas API** — procedural texture generation.
- **Vitest** — automated tests, where configured.

---

## 🚀 Getting started

### Prerequisites

- Node.js (use a current LTS release)
- npm
- Git

### Install

Clone this repository:

```bash
git clone https://github.com/rishipilla/mapforge-3d-explorer.git
cd mapforge-3d-explorer
npm install
```

Start the development server:

```bash
npm run dev
```

<<<<<<< HEAD
`npm run dev` serves `/api/overpass` through a Vite development middleware that uses the same handler as the Vercel function. Production deployments use `api/overpass.ts` as a Vercel serverless function. Set `OVERPASS_API_URL` and optionally `OVERPASS_FALLBACK_URL` in `.env.local` to configure server-side Overpass endpoints. The API accepts a query body and never forwards arbitrary URLs. You can also run `npx vercel dev` to test Vercel's serverless runtime locally.

Open the local URL printed by Vite in your browser.
=======
Open the local URL printed by Vite, usually `http://localhost:5173`.

### Environment configuration

Review `.env.example` for the variables supported by this checkout. If the application needs a local environment file, create `.env` from that example and configure only variables the code actually reads.

Example variables used by the imagery/data configuration may include:

```dotenv
VITE_OVERPASS_API_URL=https://overpass-api.de/api/interpreter
VITE_OVERPASS_FALLBACK_URL=https://overpass.kumi.systems/api/interpreter
VITE_IMAGERY_PROVIDER=carto_positron
```

These are public endpoints/settings, not API secrets. Do not place private credentials in `VITE_*` variables: Vite exposes those values to browser code. Public Overpass and map tile services have usage limits and provider terms; be respectful and show required attribution. The variables in your actual `.env.example` are the authoritative configuration for the current source.
>>>>>>> personal/main

---

## 🕹️ Typical workflow

1. **Search** for a city or place.
2. **Choose an area** using the map selection controls.
3. **Generate** the scene from the available geographic data.
4. **Select a building** to inspect its tags and available details.
5. **Explode floors** to inspect the vertical layout and select a floor.
6. **Explore rooms** where mapped indoor data is available; use the explicitly labeled demo interior when available data is missing.
7. **Walk through** supported demo interiors using the on-screen navigation instructions.
8. **Export GLB** and verify the file in your preferred 3D application.

Controls and availability can change as the application evolves; follow the current in-app hints and inspector labels.

## 📦 Using exported GLB files

GLB is supported by many 3D tools and engines, including Blender, Unity, Unreal Engine, and Godot. Import options and axis/material handling can differ by tool and version.

After export, inspect the model for:
- Correct scale and orientation.
- Expected building/floor geometry without duplicates.
- Materials and texture appearance.
- Missing helper objects or unsupported features.

Large geographic scenes may need clipping, simplification, or additional optimization before use in a game engine.

---

## 🧪 Development checks

Run the checks configured in `package.json`:

```bash
npm test
npx tsc -b
npm run build
```

If a script is not configured in your current checkout, use `npm run` to list available scripts. Test key flows in the browser too: location search, scene generation, floor expand/collapse, room selection, walkthrough collisions, imagery loading/attribution, and GLB export.

## 🗂️ Project layout

Important areas in the current project include:

```text
src/
├── materials/
│   ├── textureGenerator.ts
│   └── buildingMaterials.ts
├── geometry/
│   └── interiorGenerator.ts
├── services/
│   └── imagery/
│       └── imageryProvider.ts
└── three/
    ├── Space.tsx
    └── ExplodedBuilding.tsx

tests/
└── floorCalculations.test.ts
```

The repository may contain additional files; treat the source tree as authoritative.

## 🗺️ Roadmap

- [ ] Improve architectural cutaway controls and camera framing.
- [ ] Expand mapped indoor-data parsing and floor/room association.
- [ ] Support importing IFC/BIM models when available.
- [ ] Improve first-person navigation, wall collisions, and vertical transitions.
- [ ] Add more facade/roof materials and higher-quality optional asset models.
- [ ] Add performance profiling and larger-scene stress tests.
- [ ] Add end-to-end browser tests for the full building exploration workflow.
- [ ] Publish a hosted demo with screenshots and a short walkthrough.

## ⚠️ Limitations

- OpenStreetMap indoor coverage is incomplete and varies by building and city.
- Building heights, levels, and material tags may be absent or approximate.
- Procedural interiors are simulated layouts and not actual architectural surveys.
- Public APIs and tile services can be rate-limited, unavailable, or subject to changing terms.
- Photographic or satellite imagery is not necessarily live and may have a different capture date.
- GLB export can only preserve objects and material features supported by the export pipeline.

## 🙌 Credits and attribution

- MapForge is developed by [Rishi Pilla](https://github.com/rishipilla).
- The project builds on the original [stonyp/mapforge](https://github.com/stonyp/mapforge) codebase.
- The original project references [cartesiancs/map3d](https://github.com/cartesiancs/map3d).
- Geographic data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
- Map tile imagery must be attributed according to the selected provider's terms.

Please preserve relevant upstream copyright and license notices when distributing derived code.

## 📄 License

This project includes an MIT License. See [LICENSE](LICENSE) for the complete text and applicable copyright notices.
