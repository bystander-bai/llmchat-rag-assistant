import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ---------------------------------------------------------------------------
// 开发服：端口 3098；/tokenhub → TokenHub 国内站，供直连模式绕过浏览器 CORS
// ---------------------------------------------------------------------------
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3098,
    open: false,
    host: '0.0.0.0',
    proxy: {
      '/tokenhub': {
        target: 'https://tokenhub.tencentmaas.com',
        changeOrigin: true,
        secure: true,
        timeout: 180000,
        proxyTimeout: 180000,
        rewrite: (path) => path.replace(/^\/tokenhub/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
