import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Port 5173 is the origin to allow in the project settings ("Allowed origins")
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
})
