import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSE_ARGS } from './helpers/compose';

const moduleDir = dirname(fileURLToPath(import.meta.url));

export default async function globalTeardown() {
  console.log('[global-teardown] Stopping Docker Compose test stack...');
  try {
    execFileSync('docker', [...COMPOSE_ARGS, 'down', '-v', '--remove-orphans'], {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLICKHOUSE_PASSWORD: 'test-clickhouse-password-2026',
        COMPOSE_PROFILES: 'clickhouse',
      },
    });
  } catch (err) {
    console.warn('[global-teardown] docker compose down failed:', err);
  }

  const authDir = resolve(moduleDir, '.auth');
  if (existsSync(authDir)) {
    rmSync(authDir, { recursive: true, force: true });
    console.log('[global-teardown] Removed', authDir);
  }

  console.log('[global-teardown] Done.');
}
