import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { devPort } from './scripts/build/dev-port';

// The in-memory study does not need the account service or native ship compiler.
export default defineConfig({
  plugins: [devPort(fileURLToPath(new URL('./', import.meta.url))), react()],
  resolve: { dedupe: ['three'] },
  optimizeDeps: { entries: ['src/ui/shipbuilding/hull-prototype/HullPrototype.tsx'], include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
  server: { host: '127.0.0.1', port: 5264, open: '/?hullPrototype=1' },
});
