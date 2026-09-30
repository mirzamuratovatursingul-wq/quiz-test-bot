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
        // ularni qayta yuklamaydi — brauzer keshidan oladi.
        // DIQQAT: hammasi BITTA chunk'da bo'lishi shart. React / UI / boshqalarga bo'linganda
        // chunk'lar bir-biriga aylanma bog'lanib qoldi va radix React yuklanmasdan uni
        // chaqirdi ("reading 'useLayoutEffect'") — Mini App bo'sh sahifa ko'rsatdi.
        manualChunks(id) {
          return id.includes('node_modules') ? 'vendor' : undefined;
        },
      },
    },
  },
});
