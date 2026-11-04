import { defineConfig } from 'vite';

// Forward local /api calls to FastAPI during Vite development.
export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
});
