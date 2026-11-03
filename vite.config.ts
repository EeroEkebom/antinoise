import { defineConfig, type ViteDevServer, type Plugin } from 'vite';
import { createBasetenRoute } from './src/brain/baseten.js';
import { segmentImage } from './src/brain/samApi.js';
import { extractKey } from './src/core/keyfile.js';
import { resolveLocalPaths } from './src/core/paths.js';

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
        try {
          const route = createBasetenRoute(resolveKey());
          const decision = await route.propose(state as never);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(decision));
        } catch (e) {
          // a crashed request must never end without a reply — the client button would hang
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 502;
          res.end(JSON.stringify({ kind: 'unavailable', reason: `proxy crashed: ${e instanceof Error ? e.message : String(e)}` }));
        }
      });
    },
  };
}

function resolveKey(): string {
  const env = process.env.BASETEN_API_KEY;
  if (env) return env;
  try {
    return readKeyFromFile(resolveLocalPaths().basetenKeyRtf);
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
    const txt = readFileSync(resolveLocalPaths().metaKeyTxt, 'utf8');
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
        const url = guardSamUrl(parsed.imageUrl);
        if (!url) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, reason: 'only public https image URLs are supported (no localhost/intranet)' }));
          return;
        }
        try {
          const r = await segmentImage(resolveApiKey(), url, parsed.prompt);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(r));
        } catch (e) {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 502;
          res.end(JSON.stringify({ ok: false, reason: `proxy crashed: ${e instanceof Error ? e.message : String(e)}` }));
        }
      });
    },
  };
}

/** Dev-only SSRF guard: the SAM API fetches the given URL — refuse localhost/intranet targets. */
function guardSamUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host)) return null;
  return u.toString();
}

function resolveApiKey(): string {
  const env = process.env.MODEL_API_KEY;
  if (env) return env;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as { readFileSync: (p: string, enc: string) => string };
    return extractKey(readFileSync(resolveLocalPaths().metaKeyRtf, 'utf8'), 'sk-');
  } catch {
    return readApiKeyLegacy();
  }
}