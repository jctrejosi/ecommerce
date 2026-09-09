import { defineConfig } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  optimizeDeps: {
    include: ["react", "react-dom", "lucide-react"],
    force: true,
  },

  assetsInclude: ["**/*.svg", "**/*.csv"],

  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // OpenFreeMap (tiles vectoriales, mismo proveedor del delivery admin)
      // servido same-origin para evitar bloqueos de red/adblock.
      "/ofm": {
        target: "https://tiles.openfreemap.org",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ofm/, ""),
      },
    },
  },
});
