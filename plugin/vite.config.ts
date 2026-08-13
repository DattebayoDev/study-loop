import { defineConfig } from 'vite';
import reactPlugin from '@vitejs/plugin-react';

// RemNote plugins are loaded via "develop from localhost" (port 8000 by default)
// and built as a single bundle for the RemNote plugin loader.
export default defineConfig({
  plugins: [reactPlugin()],
  build: {
    outDir: 'dist',
    lib: {
      entry: 'src/index.tsx',
      name: 'StudyLoopPlugin',
      formats: ['iife'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // RemNote provides React globally in the plugin sandbox
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
  },
  server: {
    port: 8000,
    strictPort: true,
    cors: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
});
