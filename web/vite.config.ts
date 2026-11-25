import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the same build works at https://<user>.github.io/setbook/ and locally.
// Routing is hash-based, so GitHub Pages never needs to resolve deep links.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, fs: { allow: ['..'] } },
})
