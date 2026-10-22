import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          owner: path.resolve(__dirname, 'owner.html'),
        },
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    plugins: [
      {
        name: 'owner-auth-api',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.method === 'POST' && (req.url === '/api/owner/login' || req.url === '/api/owner/login/')) {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', () => {
                try {
                  const { password } = JSON.parse(body || '{}');
                  const targetPassword = process.env.OWNER_PASSWORD || 'Dark_Host.02';
                  if (typeof password === 'string' && password === targetPassword) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: true,
                      user: { uid: 'owner_master_uid', email: 'mbidark.owner@darkchat.internal', role: 'owner' }
                    }));
                  } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Access denied.' }));
                  }
                } catch (e) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ success: false, error: 'Invalid payload' }));
                }
              });
              return;
            }
            next();
          });
        },
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.method === 'POST' && (req.url === '/api/owner/login' || req.url === '/api/owner/login/')) {
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end', () => {
                try {
                  const { password } = JSON.parse(body || '{}');
                  const targetPassword = process.env.OWNER_PASSWORD || 'Dark_Host.02';
                  if (typeof password === 'string' && password === targetPassword) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      success: true,
                      user: { uid: 'owner_master_uid', email: 'mbidark.owner@darkchat.internal', role: 'owner' }
                    }));
                  } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Access denied.' }));
                  }
                } catch (e) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ success: false, error: 'Invalid payload' }));
                }
              });
              return;
            }
            next();
          });
        }
      }
    ],
  };
});
