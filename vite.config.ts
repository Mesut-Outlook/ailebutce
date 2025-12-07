import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0',
  },
  build: {
    // Split heavy deps so the main bundle stays below the 500 kB warning threshold
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          d3: ['d3'],
        },
      },
    },
    chunkSizeWarningLimit: 650,
  },
})
