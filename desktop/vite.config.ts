import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const host = process.env.TAURI_DEV_HOST
const shellIndex = path.resolve(__dirname, 'src/lib/shell/index.ts')
const electronShell = path.resolve(__dirname, 'src/lib/shell/electron.ts')

export function electronShellPlugin(): Plugin {
  return {
    name: 'dreamcoder-electron-shell',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved?.id === shellIndex ? electronShell : resolved
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.DREAMCODER_SHELL === 'electron' ? [electronShellPlugin()] : [])],
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
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
