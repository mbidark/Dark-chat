import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const blockedIps = new Set<string>();
const visitorIps = new Map<string, string>(); // visitorId -> ip

async function startServer() {
  const app = express();
  app.use(express.json());

  function getClientIp(req: express.Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || '127.0.0.1';
  }

  app.post('/api/owner/login', (req, res) => {
    const { password } = req.body;
    if (password === 'Dark_Host.02' || password === 'DarkHost02') {
      return res.json({
        success: true,
        user: { uid: 'owner_master_uid', email: 'mbidark.owner@darkchat.internal', role: 'owner' }
      });
    }
    return res.status(401).json({ success: false, error: 'Access denied.' });
  });

  app.get('/api/ip/status', (req, res) => {
    const clientIp = getClientIp(req);
    const isBlocked = blockedIps.has(clientIp);
    return res.json({ ip: clientIp, blocked: isBlocked });
  });

  app.post('/api/ip/register', (req, res) => {
    const { visitorId } = req.body;
    const clientIp = getClientIp(req);
    if (visitorId) {
      visitorIps.set(visitorId, clientIp);
    }
    const isBlocked = blockedIps.has(clientIp);
    return res.json({ success: true, ip: clientIp, blocked: isBlocked });
  });

  app.get('/api/ip/visitor/:visitorId', (req, res) => {
    const { visitorId } = req.params;
    const ip = visitorIps.get(visitorId) || '127.0.0.1';
    return res.json({ success: true, ip, blocked: blockedIps.has(ip) });
  });

  app.post('/api/ip/block', (req, res) => {
    const { ip } = req.body;
    if (!ip) {
      return res.status(400).json({ success: false, error: 'IP address required.' });
    }
    blockedIps.add(ip);
    return res.json({ success: true, message: `IP ${ip} blocked successfully.` });
  });

  app.post('/api/ip/unblock', (req, res) => {
    const { ip } = req.body;
    if (!ip) {
      return res.status(400).json({ success: false, error: 'IP address required.' });
    }
    blockedIps.delete(ip);
    return res.json({ success: true, message: `IP ${ip} unblocked successfully.` });
  });

  app.get('/api/ip/list', (req, res) => {
    return res.json({ success: true, blockedIps: Array.from(blockedIps) });
  });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });

  app.use(vite.middlewares);

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[DARKCHAT] Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
