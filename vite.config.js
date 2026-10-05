import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// npm run dev     — обычный режим на компьютере (http://localhost:5173)
// npm run dev:vr  — https в локальной сети, чтобы открыть с шлема Quest (WebXR работает только по https)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'vr' ? [basicSsl()] : [],
  server: mode === 'vr' ? { host: true } : {},
  build: { chunkSizeWarningLimit: 900 },
}));
