import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const proxy = { '/api': 'http://127.0.0.1:8000' };

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { proxy },
  preview: { proxy },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tabbed: fileURLToPath(new URL('./tabbed.html', import.meta.url)),
      },
    },
  },
});
