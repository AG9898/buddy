import { builtinModules } from 'module'
import { defineConfig } from 'vite'

const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)]

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/cli/index.ts',
      formats: ['cjs'],
    },
    outDir: 'out/cli',
    rollupOptions: {
      external: nodeBuiltins,
      output: {
        entryFileNames: 'index.js',
      },
    },
    target: 'node22',
  },
})
