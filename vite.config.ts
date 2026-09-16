import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Multi-page Vite build. `base: './'` keeps every asset URL relative so the
 * built site works from a GitHub Pages sub-path or any static host.
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@core': r('./src/core'),
      '@render': r('./src/render'),
      '@physics': r('./src/physics'),
      '@input': r('./src/input'),
      '@audio': r('./src/audio'),
      '@assets': r('./src/assets'),
      '@scripting': r('./src/scripting'),
      '@project': r('./src/project'),
      '@net': r('./src/net'),
      '@ui': r('./src/ui'),
      'forge-engine': r('./src/index.ts'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: r('./index.html'),
        editor: r('./editor.html'),
        play: r('./play.html'),
      },
    },
  },
  server: { port: 5173, open: false },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
