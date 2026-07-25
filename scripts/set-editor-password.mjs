#!/usr/bin/env node
/**
 * Set (or change) the editor password.
 *
 * Generates a per-install salt, an scrypt digest of your password and a session
 * signing secret, then writes them to .env — which is gitignored. The password
 * itself is never stored anywhere, and nothing here ends up in the client bundle.
 *
 * Usage:
 *   npm run set-editor-password          then type the password when prompted
 *   echo "hunter2" | npm run set-editor-password   (for scripted installs)
 *
 * Restart the server afterwards for the change to take effect.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { deriveHash, generateSalt, generateSecret } from '../server/auth.mjs';

const ENV_PATH = resolve('.env');
const MIN_LENGTH = 12;

async function readPassword() {
  if (!process.stdin.isTTY) {
    const piped = await new Promise((res) => {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => (buf += d));
      process.stdin.on('end', () => res(buf));
    });
    return piped.split('\n')[0].trim();
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    // Note: the terminal echoes this. Nothing is written to shell history, but
    // do not run it while screen sharing.
    return (await rl.question(`New editor password (min ${MIN_LENGTH} chars): `)).trim();
  } finally {
    rl.close();
  }
}

/** Replace the given keys in an .env body, appending any that are not present. */
function upsertEnv(body, values) {
  let out = body;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    out = pattern.test(out) ? out.replace(pattern, line) : `${out.replace(/\n*$/, '\n')}${line}\n`;
  }
  return out;
}

async function main() {
  const password = await readPassword();

  if (password.length < MIN_LENGTH) {
    console.error(`\nPassword must be at least ${MIN_LENGTH} characters. Nothing was changed.`);
    process.exit(1);
  }

  const existing = await readFile(ENV_PATH, 'utf8').catch(() => '');
  const salt = generateSalt();

  const values = {
    EDITOR_PASSWORD_SALT: salt,
    EDITOR_PASSWORD_HASH: deriveHash(password, salt),
  };
  // Keep an existing session secret if there is one, so setting a new password
  // does not silently log out every other browser you are signed in on.
  if (!/^SESSION_SECRET=.+$/m.test(existing)) values.SESSION_SECRET = generateSecret();

  await writeFile(ENV_PATH, upsertEnv(existing, values), { mode: 0o600 });

  console.log(`\nWrote ${ENV_PATH}`);
  console.log('Editor password updated. Restart the server to apply it.');
  if (values.SESSION_SECRET) console.log('Generated a new session signing secret.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
