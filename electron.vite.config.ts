import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: 'src/main/main.ts'
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: 'src/preload/preload.ts'
      }
    }
  },
  renderer: {
    plugins: [svelte()],
    build: {
      rollupOptions: {
        input: 'src/renderer/index.html'
      }
    }
  }
})
