import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Vite 8 defaults to baseline-widely-available (safari16.4+), which
    // requires macOS 13+. Tauri on macOS 12 uses Safari 15 WebView.
    target: ['es2021', 'safari15'],
    // Lowered from 2200 in v2 Batch A — heavy deps now split into separate chunks.
    // Raise only after investigating; do not silently regress.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT') return
        warn(warning)
      },
      output: {
        // v2 Batch A — isolate heavy vendor deps into their own chunks.
        // Each vendor stays out of the main entry; lazy routes/components
        // (e.g. dynamic import('mermaid')) pull in just their slice.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('node_modules/mermaid')) return 'vendor-mermaid'
          if (id.includes('node_modules/katex')) return 'vendor-katex'
          if (id.includes('node_modules/shiki') || id.includes('node_modules/react-shiki')) return 'vendor-shiki'
          if (id.includes('node_modules/@xterm')) return 'vendor-xterm'
          if (id.includes('node_modules/react-diff-viewer-continued')) return 'vendor-diff'
          if (id.includes('node_modules/prism-react-renderer')) return 'vendor-prism'
          if (id.includes('node_modules/qrcode')) return 'vendor-qrcode'
          if (id.includes('node_modules/marked')) return 'vendor-marked'
          if (id.includes('node_modules/dompurify')) return 'vendor-dompurify'
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'vendor-react'
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
