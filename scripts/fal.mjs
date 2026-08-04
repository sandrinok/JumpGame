/**
 * Minimal fal.ai client.
 *
 * The bundled asset-generation skills are wired to Tripo, Gemini and
 * ElevenLabs; this project has a fal account instead, so this is the adapter.
 * Deliberately tiny — fal's synchronous endpoint is just an authenticated POST
 * that blocks until the model is done, and everything else is downloading the
 * files it hands back.
 *
 * The key is read from .env (gitignored) or the environment and is never
 * logged. Errors print the response body, so avoid echoing request headers.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Read KEY=value pairs out of .env without pulling in a dependency. */
function loadDotenv(path = '.env') {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

export function falKey() {
  const key = process.env.FAL_KEY || loadDotenv().FAL_KEY;
  if (!key) {
    throw new Error(
      'FAL_KEY missing. Put `FAL_KEY=...` in .env (gitignored) or set it in the environment.',
    );
  }
  return key;
}

/**
 * Run a model and return its JSON result.
 *
 * Uses the synchronous endpoint, which holds the connection open until the
 * model finishes. Fine for images; a long video model would want the queue API.
 */
export async function run(model, input, { timeoutMs = 180_000 } = {}) {
  const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`fal ${model} -> ${res.status}\n${text.slice(0, 800)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`fal ${model}: response was not JSON\n${text.slice(0, 400)}`);
  }
}

export async function download(url, outPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, buf);
  return buf.length;
}

/** Pull image urls out of whatever shape the model returned. */
export function imageUrls(result) {
  if (Array.isArray(result?.images)) return result.images.map((i) => i.url ?? i).filter(Boolean);
  if (result?.image?.url) return [result.image.url];
  if (typeof result?.image === 'string') return [result.image];
  return [];
}
