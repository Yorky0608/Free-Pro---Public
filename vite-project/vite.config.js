import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = (env.VITE_API_BASE_URL || '').trim() || 'https://1wos40ydh1.execute-api.us-east-2.amazonaws.com'

  return {
    // GitHub Pages often serves your site from a subpath (e.g., /<repo>/).
    // Using a relative base keeps asset URLs working regardless of the subpath.
    base: './',

    // Local dev convenience: call /api/... from the browser and Vite proxies
    // it to the real API (avoids CORS during npm run dev).
    server: {
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
  }
})
