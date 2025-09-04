import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages (project page) : base DOIT être '/<repo>/'
export default defineConfig({
  plugins: [react()],
  base: '/nw-quest-map/',
})