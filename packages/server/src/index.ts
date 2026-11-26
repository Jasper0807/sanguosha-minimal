import { createSgsServer } from './server.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const webDistDir = process.env.WEB_DIST_DIR || undefined;

const server = createSgsServer({ webDistDir });

server
  .listen(port, host)
  .then(({ port: boundPort, host: boundHost }) => {
    console.log(
      `[sgs-server] Listening on http://${boundHost}:${boundPort} (WS: /ws, Health: /health)`
    );
  })
  .catch((err) => {
    console.error('[sgs-server] Failed to start:', err);
    process.exit(1);
  });

const shutdown = async () => {
  console.log('\n[sgs-server] Shutting down...');
  await server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
