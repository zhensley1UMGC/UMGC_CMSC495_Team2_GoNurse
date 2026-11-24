import { defineConfig } from 'vite';

const proxy = { '/api': 'http://127.0.0.1:8000' };

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { proxy },
  preview: { proxy },
});
