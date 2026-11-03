/** Local key-file paths: env var first, then a gitignored `*.local` file — no machine-specific
 * paths (usernames) in the public repo. Defaults assume key files alongside the repo in `keys/`. */
import { readFileSync } from 'node:fs';

export type LocalPaths = { basetenKeyRtf: string; metaKeyTxt: string; metaKeyRtf: string };

const DEFAULTS: LocalPaths = {
  basetenKeyRtf: 'keys/baseten.rtf',
  metaKeyTxt: 'keys/meta-api-key.txt',
  metaKeyRtf: 'keys/meta-api-key.rtf',
};

export function resolveLocalPaths(): LocalPaths {
  const file = process.env.ANTINOISE_PATHS_FILE ?? 'keypaths.local.json';
  try {
    return { ...DEFAULTS, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<LocalPaths>) };
  } catch {
    return DEFAULTS; // no local file / no CI keys → env vars must carry the keys
  }
}