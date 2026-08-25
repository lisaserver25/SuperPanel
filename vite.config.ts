import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE_PATH se usa cuando el hub se publica en un GitHub Pages de
// proyecto (p. ej. /superpaneles/). Con dominio propio o usuario.github.io
// dejar "/".
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: {
    port: 5133,
    strictPort: true,
  },
})
