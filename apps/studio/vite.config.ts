import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The studio is the library's first consumer, and imports it as a package
 * rather than reaching into its source. In this workspace that resolves to the
 * built output next door; published, it is the same specifier. A demo that
 * imports `../src` proves the source works and says nothing about what
 * `npm install` hands over.
 */
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
