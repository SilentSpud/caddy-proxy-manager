/**
 * In-memory adapter for the Caddy admin seam (src/lib/caddy-admin.ts).
 *
 * Stands in for a real Caddy container: it accepts config loads, remembers the
 * last document it was given, and serves it back on GET /config/. That lets the
 * whole builder-and-apply path — buildCaddyDocument, applyCaddyConfig, the
 * health monitor's restart detection — run end to end in unit tests with no
 * server listening anywhere.
 *
 * Tests that only need the guard get one of these installed globally by
 * tests/setup.vitest.ts. Tests that want to assert on what was sent, or to
 * simulate Caddy misbehaving, should create their own via `installFakeCaddy()`.
 */
import type {
  CaddyAdminRequest,
  CaddyAdminResponse,
  CaddyAdminTransport,
} from '../../src/lib/caddy-admin';
import { setCaddyAdminTransport } from '../../src/lib/caddy-admin';

export type RecordedRequest = {
  path: string;
  method: string;
  body?: string;
};

export type FakeCaddy = {
  transport: CaddyAdminTransport;
  /** Every request the app made, oldest first. */
  requests: RecordedRequest[];
  /** Requests that loaded a config document. */
  loads: RecordedRequest[];
  /** The most recently loaded config, parsed. Null until something is loaded. */
  lastConfig: () => Record<string, unknown> | null;
  /** Make the next N responses (or all subsequent ones) fail with this status. */
  failWith: (status: number, text?: string) => void;
  /** Make subsequent requests reject as if the socket could not be opened. */
  failWithNetworkError: (code: 'ECONNREFUSED' | 'ENOTFOUND') => void;
  /** Serve the given ETag on GET /config/, so restart detection can be driven. */
  setConfigEtag: (etag: string | null) => void;
  /** Drop the recorded history and return to healthy behaviour. */
  reset: () => void;
};

function createFakeCaddy(): FakeCaddy {
  let loadedConfig: Record<string, unknown> | null = null;
  let failure: { status: number; text: string } | null = null;
  let networkError: 'ECONNREFUSED' | 'ENOTFOUND' | null = null;
  let configEtag: string | null = null;
  const requests: RecordedRequest[] = [];
  const loads: RecordedRequest[] = [];

  const transport: CaddyAdminTransport = async (
    request: CaddyAdminRequest,
  ): Promise<CaddyAdminResponse> => {
    const record: RecordedRequest = {
      path: request.path,
      method: request.method,
      body: request.body,
    };
    requests.push(record);

    if (networkError) {
      // Shape mirrors what node:http surfaces, so the error-mapping branch in
      // applyCaddyConfig sees what it would see in production.
      const error = new Error(`connect ${networkError}`) as Error & {
        cause?: NodeJS.ErrnoException;
      };
      error.cause = Object.assign(new Error(networkError), {
        code: networkError,
      }) as NodeJS.ErrnoException;
      throw error;
    }

    if (failure) {
      return { status: failure.status, text: failure.text, headers: {} };
    }

    if (request.method === 'POST' && request.path === '/load') {
      loads.push(record);
      loadedConfig = request.body ? (JSON.parse(request.body) as Record<string, unknown>) : null;
      return { status: 200, text: '', headers: {} };
    }

    if (request.method === 'GET' && request.path === '/config/') {
      return {
        status: 200,
        text: JSON.stringify(loadedConfig ?? {}),
        headers: configEtag ? { etag: configEtag } : {},
      };
    }

    return { status: 404, text: 'not found', headers: {} };
  };

  return {
    transport,
    requests,
    loads,
    lastConfig: () => loadedConfig,
    failWith: (status, text = '') => {
      failure = { status, text };
    },
    failWithNetworkError: (code) => {
      networkError = code;
    },
    setConfigEtag: (etag) => {
      configEtag = etag;
    },
    reset: () => {
      requests.length = 0;
      loads.length = 0;
      loadedConfig = null;
      failure = null;
      networkError = null;
      configEtag = null;
    },
  };
}

/** Create a fake Caddy and install it at the seam. */
export function installFakeCaddy(): FakeCaddy {
  const fake = createFakeCaddy();
  setCaddyAdminTransport(fake.transport);
  return fake;
}
