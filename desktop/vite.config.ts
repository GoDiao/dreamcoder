import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const host = process.env.TAURI_DEV_HOST
const mcpCatalogPath = path.resolve(__dirname, '../mcp-registry.json')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: ['es2021', 'safari15'],
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT') return
        warn(warning)
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  clearScreen: false,
  server: {
    fs: {
      // Vite 8 checks both the file and raw module ID outside the desktop root.
      allow: [searchForWorkspaceRoot(__dirname), mcpCatalogPath, `${mcpCatalogPath}?raw`],
    },
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
