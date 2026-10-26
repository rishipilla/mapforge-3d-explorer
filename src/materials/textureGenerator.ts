import * as THREE from "three";

/**
 * Procedural canvas-based PBR texture generator.
 * Creates physically plausible textures without external asset downloads,
 * network delays, or licensing constraints.
 */

// Texture cache to prevent recreating textures
const textureCache = new Map<string, THREE.CanvasTexture>();

function createDataCanvas(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): THREE.CanvasTexture {
  if (typeof document === "undefined") {
    // Headless / SSR fallback
    return new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    draw(ctx, width, height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Architectural Wood Plank Texture (floors, conference tables, shelving)
 */
export function getWoodFloorTexture(): THREE.CanvasTexture {
  const key = "wood_floor";
  if (textureCache.has(key)) return textureCache.get(key)!;

  const texture = createDataCanvas(512, 512, (ctx, w, h) => {
    // Base warm wood tone
    ctx.fillStyle = "#a87b51";
    ctx.fillRect(0, 0, w, h);

    const plankCount = 16;
    const plankHeight = h / plankCount;

    for (let i = 0; i < plankCount; i++) {
      const y = i * plankHeight;
      // Slight plank tone variation
      const toneVariation = (Math.random() - 0.5) * 25;
      const r = Math.min(255, Math.max(0, 168 + toneVariation));
      const g = Math.min(255, Math.max(0, 123 + toneVariation * 0.9));
      const b = Math.min(255, Math.max(0, 81 + toneVariation * 0.7));
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, y, w, plankHeight - 1.5);

      // Wood grain lines
      ctx.strokeStyle = "rgba(75, 45, 20, 0.15)";
      ctx.lineWidth = 1;
      for (let gIdx = 0; gIdx < 6; gIdx++) {
        const gy = y + Math.random() * plankHeight;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(
          w * 0.3, gy + (Math.random() - 0.5) * 4,
          w * 0.7, gy + (Math.random() - 0.5) * 4,
          w, gy
        );
        ctx.stroke();
      }

      // Plank bevel / seam
      ctx.fillStyle = "rgba(40, 20, 10, 0.4)";
      ctx.fillRect(0, y + plankHeight - 1.5, w, 1.5);
    }
  });

  texture.repeat.set(2, 2);
  textureCache.set(key, texture);
  return texture;
}

/**
 * Concrete Texture with subtle roughness and stipple
 */
export function getConcreteTexture(): THREE.CanvasTexture {
  const key = "concrete";
  if (textureCache.has(key)) return textureCache.get(key)!;

  const texture = createDataCanvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#8c949d";
    ctx.fillRect(0, 0, w, h);

    // Subtle noise
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 28;
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);

    // Formwork tie holes & panel lines
    ctx.strokeStyle = "rgba(50, 55, 65, 0.15)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  });

  texture.repeat.set(4, 4);
  textureCache.set(key, texture);
  return texture;
}

/**
 * Brick Facade Texture with realistic mortar joints
 */
export function getBrickTexture(): THREE.CanvasTexture {
  const key = "brick";
  if (textureCache.has(key)) return textureCache.get(key)!;

  const texture = createDataCanvas(512, 512, (ctx, w, h) => {
    // Mortar background
    ctx.fillStyle = "#d0cdc7";
    ctx.fillRect(0, 0, w, h);

    const rows = 32;
    const cols = 16;
    const rowH = h / rows;
    const colW = w / cols;
    const mortar = 2;

    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const offset = (r % 2) * (colW / 2);
      for (let c = -1; c < cols + 1; c++) {
        const x = c * colW + offset;
        const toneVar = (Math.random() - 0.5) * 35;
        const red = Math.min(255, Math.max(0, 185 + toneVar));
        const green = Math.min(255, Math.max(0, 80 + toneVar * 0.6));
        const blue = Math.min(255, Math.max(0, 60 + toneVar * 0.5));

        ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
        ctx.fillRect(x + mortar, y + mortar, colW - mortar * 2, rowH - mortar * 2);
      }
    }
  });

  texture.repeat.set(2, 2);
  textureCache.set(key, texture);
  return texture;
}

/**
 * Modern Window / Facade Grid Texture for commercial and office buildings
 */
export function getWindowGridTexture(windowTint = "#7dd3fc"): THREE.CanvasTexture {
  const key = `window_grid_${windowTint}`;
  if (textureCache.has(key)) return textureCache.get(key)!;

  const texture = createDataCanvas(256, 256, (ctx, w, h) => {
    // Dark mullion / wall frame
    ctx.fillStyle = "#27303f";
    ctx.fillRect(0, 0, w, h);

    const cols = 4;
    const rows = 4;
    const paneW = w / cols;
    const paneH = h / rows;
    const frame = 4;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = c * paneW + frame;
        const py = r * paneH + frame;
        const pw = paneW - frame * 2;
        const ph = paneH - frame * 2;

        // Gradient glass reflection
        const grad = ctx.createLinearGradient(px, py, px + pw, py + ph);
        grad.addColorStop(0, windowTint);
        grad.addColorStop(0.5, "#38bdf8");
        grad.addColorStop(1, "#0284c7");

        ctx.fillStyle = grad;
        ctx.fillRect(px, py, pw, ph);

        // Highlight line
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + 2, py + 2);
        ctx.lineTo(px + pw - 2, py + 2);
        ctx.stroke();
      }
    }
  });

  texture.repeat.set(3, 3);
  textureCache.set(key, texture);
  return texture;
}

/**
 * Clean disposal helper for memory management
 */
export function disposeGeneratedTextures(): void {
  for (const texture of textureCache.values()) {
    texture.dispose();
  }
  textureCache.clear();
}
