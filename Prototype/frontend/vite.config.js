import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Forward local /api calls to FastAPI during Vite development.
export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tabbed: fileURLToPath(new URL('./tabbed.html', import.meta.url)),
      },
    },
  },
});
