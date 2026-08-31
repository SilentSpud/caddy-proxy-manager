import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSE_ARGS } from './helpers/compose';

const moduleDir = dirname(fileURLToPath(import.meta.url));

export default async function globalTeardown() {
  console.log('[global-teardown-no-ch] Stopping Docker Compose test stack (no ClickHouse)...');
  try {
    execFileSync('docker', [...COMPOSE_ARGS, 'down', '-v', '--remove-orphans'], {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env },
    });
  } catch (err) {
    console.warn('[global-teardown-no-ch] docker compose down failed:', err);
  }

  const authDir = resolve(moduleDir, '.auth');
  if (existsSync(authDir)) {
    rmSync(authDir, { recursive: true, force: true });
    console.log('[global-teardown-no-ch] Removed', authDir);
  }

  console.log('[global-teardown-no-ch] Done.');
}
