import { defineConfig } from 'vite'

import fs from 'fs'
import path from 'path'
import os from 'os'

const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  if (interfaces) {
    for (const name of Object.keys(interfaces)) {
      const net = interfaces[name]
      if (net) {
        for (const iface of net) {
          if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
          }
        }
      }
    }
  }
  return 'localhost';
};

// https://vite.dev/config/
// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [{
    name: 'local-db-plugin',
    configureServer(server) {
      const ip = getLocalIP();
      console.log(`\n  📱 MOBİL ERİŞİM İÇİN: http://${ip}:3000\n`);

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
              // 1. Create a backup if existing data exists
              if (fs.existsSync(dbPath)) {
                const historyDir = path.resolve(process.cwd(), 'history')
                if (!fs.existsSync(historyDir)) {
                  fs.mkdirSync(historyDir)
                }
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
                const backupPath = path.resolve(historyDir, `db-${timestamp}.json`)
                fs.copyFileSync(dbPath, backupPath)

                // Optional: Keep only last 20 backups to save space
                const files = fs.readdirSync(historyDir)
                  .filter(f => f.startsWith('db-') && f.endsWith('.json'))
                  .map(f => ({ name: f, time: fs.statSync(path.join(historyDir, f)).mtime.getTime() }))
                  .sort((a, b) => b.time - a.time)

                if (files.length > 20) {
                  files.slice(20).forEach(f => fs.unlinkSync(path.join(historyDir, f.name)))
                }
              }

              // 2. Write new data
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
    host: '127.0.0.1',
    port: 8080,
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
