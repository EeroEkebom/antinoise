import { defineConfig, type ViteDevServer, type Plugin } from 'vite';
import { createBasetenRoute } from './src/brain/baseten.js';
import { segmentImage } from './src/brain/samApi.js';
import { extractKey } from './src/core/keyfile.js';

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
  const { readFileSync } = require('node:fs') as { readFileSync: (p: string, enc: string) => string };
  return extractKey(readFileSync(path, 'utf8'), 'b10_');
}

function readApiKeyLegacy(): string {
  // Meta Model API keys are long opaque tokens; anchor on any 40+ char run
  try {
    const { readFileSync } = require('node:fs') as { readFileSync: (p: string, enc: string) => string };
    const txt = readFileSync('/Users/eeroekebom/projects/additional_utilization/baseten/meta-api-key.txt', 'utf8');
    return extractKey(txt, '');
  } catch {
    return 'missing';
  }
}

export default defineConfig({
  server: { port: 5199, strictPort: true }, // booked: keelsure keeps 5173 (port discipline across parallel sessions)
  preview: { port: 5199, strictPort: true },
  plugins: [brainProxyPlugin(), samProxyPlugin()],
});

/** SAM 3.1 proxy — same key discipline as the brain route. */
function samProxyPlugin(): Plugin {
  return {
    name: 'antinoise-sam-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/sam', async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        let parsed: { imageUrl?: string; prompt?: string };
        try {
          parsed = JSON.parse(body);
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, reason: 'bad request' }));
          return;
        }
        if (!parsed.imageUrl || !parsed.prompt) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, reason: 'imageUrl and prompt required' }));
          return;
        }
        const r = await segmentImage(resolveApiKey(), parsed.imageUrl, parsed.prompt);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(r));
      });
    },
  };
}

function resolveApiKey(): string {
  const env = process.env.MODEL_API_KEY;
  if (env) return env;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as { readFileSync: (p: string, enc: string) => string };
    return extractKey(readFileSync('/Users/eeroekebom/projects/additional_utilization/baseten/meta-api-key.rtf', 'utf8'), 'sk-');
  } catch {
    return readApiKeyLegacy();
  }
}