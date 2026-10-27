import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5199, strictPort: true }, // booked: keelsure keeps 5173 (port discipline across parallel sessions)
  preview: { port: 5199, strictPort: true },
});