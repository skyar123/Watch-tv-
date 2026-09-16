import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Content-hashed filenames are what make the service worker's cache-first
    // asset strategy safe: a cached copy can never be the wrong copy.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    // `netlify dev` normally does this; this keeps plain `vite dev` working too.
    proxy: { '/api': { target: 'http://localhost:8888', changeOrigin: true } },
  },
});
