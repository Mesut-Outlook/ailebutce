import { defineConfig } from 'vite'

import fs from 'fs'
import path from 'path'
import os from 'os'

const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
};

// https://vite.dev/config/
// https://vite.dev/config/
export default defineConfig({
  plugins: [{
    name: 'local-db-plugin',
    configureServer(server) {
      const ip = getLocalIP();
      console.log(`\n  📱 MOBİL ERİŞİM İÇİN: http://${ip}:5173\n`);

      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/db')) {
          const dbPath = path.resolve(process.cwd(), 'db.json')

          if (req.method === 'GET') {
            if (fs.existsSync(dbPath)) {
              const data = fs.readFileSync(dbPath, 'utf-8')
              res.setHeader('Content-Type', 'application/json')
              res.end(data)
            } else {
              res.end('[]')
            }
          } else if (req.method === 'POST') {
            let body = ''
            req.on('data', chunk => {
              body += chunk.toString()
            })
            req.on('end', () => {
              fs.writeFileSync(dbPath, body)
              res.end('OK')
            })
          } else {
            res.end('Method not allowed')
          }
        } else {
          next()
        }
      })
    }
  }],
  server: {
    host: '0.0.0.0',
  },
  build: {
    // Split heavy deps so the main bundle stays below the 500 kB warning threshold
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          d3: ['d3'],
        },
      },
    },
    chunkSizeWarningLimit: 650,
  },
})
