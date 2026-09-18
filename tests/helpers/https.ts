import https from 'node:https';
import tls from 'node:tls';
import crypto from 'node:crypto';

export interface HttpsResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface ClientTlsIdentity {
  cert?: string;
  key?: string;
}

export interface HttpsOutcome {
  response?: HttpsResponse;
  error?: Error;
}

export function httpsGet(
  domain: string,
  path = '/',
  tlsIdentity: ClientTlsIdentity = {},
  extraHeaders: Record<string, string> = {}
): Promise<HttpsResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port: 443,
        path,
        method: 'GET',
        headers: { Host: domain, ...extraHeaders },
        servername: domain,
        rejectUnauthorized: false,
        cert: tlsIdentity.cert,
        key: tlsIdentity.key,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as HttpsResponse['headers'],
            body,
          })
        );
      }
    );

    req.setTimeout(10_000, () => {
      req.destroy(new Error(`HTTPS request to "${domain}" timed out`));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function httpsGetOutcome(
  domain: string,
  path = '/',
  tlsIdentity: ClientTlsIdentity = {},
  extraHeaders: Record<string, string> = {}
): Promise<HttpsOutcome> {
  try {
    const response = await httpsGet(domain, path, tlsIdentity, extraHeaders);
    return { response };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export async function waitForHttpsRoute(
  domain: string,
  tlsIdentity: ClientTlsIdentity = {},
  timeoutMs = 20_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const res = await httpsGet(domain, '/', tlsIdentity);
      lastStatus = res.status;
      if (res.status !== 502 && res.status !== 503 && res.status !== 504) {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `HTTPS route for "${domain}" not ready after ${timeoutMs}ms (last status: ${lastStatus}, last error: ${lastError || 'none'})`
  );
}

export interface WssHandshakeResult {
  /** First line of the HTTP response, e.g. "HTTP/1.1 101 Switching Protocols". */
  statusLine: string;
  /** Parsed numeric status code, or 0 if the response had no parseable HTTP status line. */
  statusCode: number;
  /** Lower-cased response headers. */
  headers: Record<string, string>;
}

/**
 * Perform a raw WebSocket upgrade handshake against Caddy over TLS (port 443)
 * with SNI set to the test domain. Complements the plain-HTTP wsHandshake in
 * http.ts for hosts that enforce HTTPS.
 */
export function wssHandshakeTls(
  domain: string,
  path = '/echo',
  extraHeaders: Record<string, string> = {}
): Promise<WssHandshakeResult> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = tls.connect({
      host: '127.0.0.1',
      port: 443,
      servername: domain,
      rejectUnauthorized: false,
    });
    let buf = Buffer.alloc(0);

    const finish = () => {
      const idx = buf.indexOf('\r\n\r\n');
      const head = idx === -1 ? buf.toString('latin1') : buf.subarray(0, idx).toString('latin1');
      const lines = head.split('\r\n');
      const statusLine = lines[0] ?? '';
      const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const ci = line.indexOf(':');
        if (ci > 0) headers[line.slice(0, ci).trim().toLowerCase()] = line.slice(ci + 1).trim();
      }
      socket.destroy();
      resolve({ statusLine, statusCode: match ? parseInt(match[1], 10) : 0, headers });
    };

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TLS WebSocket handshake to "${domain}${path}" timed out`));
    }, 10_000);

    socket.on('secureConnect', () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: ${domain}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`),
          '',
          '',
        ].join('\r\n')
      );
    });

    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.indexOf('\r\n\r\n') !== -1) {
        clearTimeout(timer);
        finish();
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
