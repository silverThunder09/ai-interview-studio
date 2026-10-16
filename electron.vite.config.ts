import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {},
  // Bundle shared contracts into CJS: sandboxed preload cannot require local modules.
  preload: {},
  renderer: {
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  },
});
