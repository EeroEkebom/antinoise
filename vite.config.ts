import { defineConfig, type ViteDevServer, type Plugin } from 'vite';
import { createBasetenRoute } from './src/brain/baseten.js';

/** Dev-side brain proxy: the browser posts the agent state, the server holds the Baseten key —
 * the key never enters client code or the public repo. Falls back to a key file outside the repo. */
function brainProxyPlugin(): Plugin {
  return {
    name: 'antinoise-brain-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/brain', async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        let state: unknown;
        try {
          state = JSON.parse(body);
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ kind: 'unavailable', reason: 'bad state JSON' }));
          return;
        }
        const route = createBasetenRoute(resolveKey());
        const decision = await route.propose(state as never);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(decision));
      });
    },
  };
}

function resolveKey(): string {
  const env = process.env.BASETEN_API_KEY;
  if (env) return env;
  try {
    return readKeyFromFile('/Users/eeroekebom/projects/additional_utilization/baseten/baseten.rtf');
  } catch {
    return 'missing'; // route will return HTTP-error-shaped unavailable
  }
}

function readKeyFromFile(path: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const txt = require('node:fs').readFileSync(path, 'utf8') as string;
  return txt
    .replace(/\\[a-z0-9]+[ ]?/gi, '')
    .replace(/[{}\\]/g, '')
    .trim();
}

export default defineConfig({
  server: { port: 5199, strictPort: true }, // booked: keelsure keeps 5173 (port discipline across parallel sessions)
  preview: { port: 5199, strictPort: true },
  plugins: [brainProxyPlugin()],
});