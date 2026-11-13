import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    // host:true permite abrir la app desde el celular usando la IP del computador (ej: https://192.168.1.5:5173)
    host: true,
    // https activado por basicSsl: la cámara del celular solo funciona en un sitio "seguro" (https)
    proxy: {
      // Todas las llamadas a /api se reenvían al backend (así el celular no necesita saber la IP del backend)
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
