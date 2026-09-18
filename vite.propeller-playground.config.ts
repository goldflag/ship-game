import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { devPort } from './scripts/build/dev-port';

export default defineConfig({
  plugins: [devPort(fileURLToPath(new URL('./', import.meta.url))), react()],
  resolve: { dedupe: ['three'] },
  optimizeDeps: { entries: ['src/ui/shipbuilding/propeller-playground/PropellerPlayground.tsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
  server: { host: '127.0.0.1', port: 5284 },
});
