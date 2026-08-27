import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The playground is the library's first consumer, so it imports the built
    // package rather than the source. A demo that reaches into src/ proves the
    // source works and says nothing about what npm install gives you.
    alias: { chipvoice: resolve(import.meta.dirname, "../dist/index.js") },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
