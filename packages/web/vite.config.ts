import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // umumiy tiplar va tahlilchi to'g'ridan-to'g'ri manbadan olinadi
      '@testrace/shared': path.resolve(here, '../shared/src/index.ts'),
      '@': path.resolve(here, 'src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Tunnel (cloudflared/ngrok) orqali ochilganda Vite hostni bloklamasligi uchun
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io', '.loca.lt'],
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Kutubxonalar alohida faylda: ilova kodi o'zgarganda (har deploy) foydalanuvchi
        // ularni qayta yuklamaydi — brauzer keshidan oladi
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react';
          }
          if (id.includes('@radix-ui') || id.includes('lucide-react') || id.includes('sonner')) return 'ui';
          return 'vendor';
        },
      },
    },
  },
});
