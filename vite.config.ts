import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import overpass from "./api/overpass";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    {
      name: "local-overpass-api",
      configureServer(server) {
        server.middlewares.use("/api/overpass", (req, res) => {
          if (req.method !== "POST") {
            void overpass({ method: req.method }, {
              status(code) { res.statusCode = code; return this; },
              setHeader(name, value) { res.setHeader(name, value); },
              send(body) { res.end(body); },
              end() { res.end(); },
            });
            return;
          }

          const chunks: Buffer[] = [];
          let size = 0;
          let oversized = false;
          req.on("data", (chunk: Buffer) => {
            if (oversized) return;
            size += chunk.length;
            if (size > 256 * 1024) {
              oversized = true;
              res.statusCode = 413;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "The Overpass query exceeds the 256 KB limit." }));
              return;
            }
            chunks.push(chunk);
          });
          req.on("end", () => {
            if (res.writableEnded) return;
            void overpass({ method: req.method, body: Buffer.concat(chunks).toString("utf8") }, {
              status(code) { res.statusCode = code; return this; },
              setHeader(name, value) { res.setHeader(name, value); },
              send(body) { res.end(body); },
              end() { res.end(); },
            });
          });
        });
      },
    },
    dts({
      insertTypesEntry: true,
    }),
    react({
      jsxImportSource: "@emotion/react",
      babel: {
        plugins: ["@emotion/babel-plugin"],
      },
    }),
  ],
  resolve: {
    alias: [{ find: "@", replacement: "/src" }],
  },
});
