import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: resolve(__dirname, '../assets/js'),
    emptyOutDir: false,
    sourcemap: true,
    target: 'es2020',
    rollupOptions: {
      input: resolve(__dirname, 'src/main.ts'),
      output: {
        format: 'es',
        entryFileNames: 'app.bundle.js',
        chunkFileNames: 'app.[name].js',
        assetFileNames: 'app.[name][extname]',
        inlineDynamicImports: true,
      },
    },
  },
});
