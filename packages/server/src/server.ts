import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@sgs/engine';
import { RoomManager, type RoomManagerOptions } from './roomManager.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

export interface SgsServerOptions extends RoomManagerOptions {
  webDistDir?: string;
}

export interface SgsServerHandle {
  httpServer: http.Server;
  wss: WebSocketServer;
  roomManager: RoomManager;
  listen: (port?: number, host?: string) => Promise<{ port: number; host: string }>;
  close: () => Promise<void>;
}

function defaultWebDistDir(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  // Works both from packages/server/src and packages/server/dist
  const candidate = path.resolve(thisDir, '../../web/dist');
  return candidate;
}

function serveStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  webDistDir: string
): void {
  const urlObj = new URL(req.url ?? '/', 'http://localhost');
  const rawPathname = decodeURIComponent(urlObj.pathname);
  const normalized = path.posix.normalize(rawPathname);
  const relative = normalized.startsWith('/') ? normalized.slice(1) : normalized;

  if (!fs.existsSync(webDistDir)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Minimal Sanguosha Server is running. Build @sgs/web to serve the web UI.');
    return;
  }

  let targetPath = path.resolve(webDistDir, relative || 'index.html');
  // Path traversal guard
  const resolvedRoot = path.resolve(webDistDir);
  if (!targetPath.startsWith(resolvedRoot)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  // SPA fallback to index.html for unknown routes (e.g. /?room=XXXXXX)
  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
    targetPath = path.join(resolvedRoot, 'index.html');
  }

  if (!fs.existsSync(targetPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(targetPath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const cacheControl =
    ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': cacheControl
  });
  fs.createReadStream(targetPath).pipe(res);
}

export function createSgsServer(options?: SgsServerOptions): SgsServerHandle {
  const webDistDir = options?.webDistDir ?? defaultWebDistDir();
  const roomManager = new RoomManager(options);
  const startedAt = Date.now();

  const httpServer = http.createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    if (urlPath === '/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(
        JSON.stringify({
          ok: true,
          rooms: roomManager.getRoomCount(),
          connections: roomManager.getConnectionCount(),
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000)
        })
      );
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    serveStaticFile(req, res, webDistDir);
  });

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws'
  });

  wss.on('connection', (ws: WebSocket) => {
    const connId = crypto.randomUUID();
    const send = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    roomManager.registerConnection({
      id: connId,
      send,
      close: () => ws.close()
    });

    ws.on('message', (data) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf-8');
        const parsed = JSON.parse(text) as ClientMessage;
        if (!parsed || typeof parsed.type !== 'string') {
          send({ type: 'error', code: 'BAD_MESSAGE', message: '无效的消息格式' });
          return;
        }
        roomManager.handleMessage(connId, parsed);
      } catch {
        send({ type: 'error', code: 'PARSE_ERROR', message: '消息 JSON 解析失败' });
      }
    });

    ws.on('close', () => {
      roomManager.handleDisconnect(connId);
    });

    ws.on('error', () => {
      roomManager.handleDisconnect(connId);
    });
  });

  return {
    httpServer,
    wss,
    roomManager,
    listen: (port = 3000, host = '0.0.0.0') =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          const addr = httpServer.address();
          const actualPort = typeof addr === 'object' && addr ? addr.port : port;
          resolve({ port: actualPort, host });
        });
      }),
    close: async () => {
      roomManager.dispose();
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };
}
