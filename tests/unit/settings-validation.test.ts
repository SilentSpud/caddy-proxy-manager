import { describe, expect, it } from 'bun:test';
import { SettingsValidationError, validateSettingsGroup } from '@/src/lib/settings-validation';

const geoblock = {
  enabled: true,
  block_countries: ['CN'],
  block_continents: [],
  block_asns: [],
  block_cidrs: ['10.0.0.0/8'],
  block_ips: [],
  allow_countries: ['FI'],
  allow_continents: ['EU'],
  allow_asns: [64512],
  allow_cidrs: [],
  allow_ips: ['192.0.2.1'],
  trusted_proxies: ['private_ranges'],
  fail_closed: false,
  response_status: 403,
  response_body: 'Forbidden',
  response_headers: { 'Content-Type': 'text/plain' },
  redirect_url: '',
};

const validGroups: Record<string, Record<string, unknown>> = {
  general: { primaryDomain: 'example.com', acmeEmail: 'admin@example.com' },
  acme: { caUrl: 'https://ca.example.com/acme/directory' },
  cloudflare: { apiToken: 'secret', zoneId: 'zone' },
  authentik: { outpostDomain: 'auth.example.com', outpostUpstream: 'http://authentik:9000' },
  metrics: { enabled: true, port: 9090 },
  logging: { enabled: true, format: 'json' },
  dns: { enabled: true, resolvers: ['1.1.1.1'], fallbacks: [], timeout: '5s' },
  'dns-provider': {
    providers: { cloudflare: { api_token: 'secret' } },
    default: 'cloudflare',
  },
  'upstream-dns': { enabled: true, family: 'both' },
  geoblock,
  waf: {
    enabled: true,
    mode: 'On',
    load_owasp_crs: true,
    custom_directives: '',
    excluded_rule_ids: [920350],
  },
  'error-pages': {
    rules: [{ statuses: [502, 503], body: 'Unavailable', contentType: 'text/plain' }],
  },
  'default-response': { mode: 'respond', status: 404, body: 'Not found' },
  'trusted-proxies': {
    ranges: ['private_ranges', '192.0.2.0/24'],
    client_ip_headers: ['CF-Connecting-IP'],
    strict: true,
  },
};

describe('REST settings runtime validation', () => {
  for (const [group, input] of Object.entries(validGroups)) {
    it(`accepts the documented ${group} shape`, () => {
      expect(validateSettingsGroup(group, input)).toBe(input);
    });

    it(`rejects unknown fields for ${group}`, () => {
      expect(() => validateSettingsGroup(group, { ...input, unexpected: true })).toThrow(
        SettingsValidationError,
      );
    });
  }

  it('rejects type confusion and out-of-range values', () => {
    expect(() => validateSettingsGroup('metrics', { enabled: 'yes', port: 70000 })).toThrow(
      /boolean/,
    );
    expect(() =>
      validateSettingsGroup('waf', {
        ...validGroups.waf,
        mode: 'On\nSecRuleEngine Off',
      }),
    ).toThrow(/waf\.mode/);
    expect(() =>
      validateSettingsGroup('geoblock', {
        ...geoblock,
        trusted_proxies: ['not-a-network'],
      }),
    ).toThrow(/IP address or CIDR/);
  });

  // Coraza rejects a body limit above 1 GiB while Caddy loads the config, which
  // takes down the whole document — so it has to fail at save time, with a
  // message that says which value is wrong.
  it('rejects WAF body limits Coraza would refuse', () => {
    expect(() =>
      validateSettingsGroup('waf', {
        ...validGroups.waf,
        request_body_limit: 10737418240,
      }),
    ).toThrow(/waf\.request_body_limit must be an integer between/);
    expect(() =>
      validateSettingsGroup('waf', {
        ...validGroups.waf,
        request_body_limit: 1048576,
        request_body_in_memory_limit: 2097152,
      }),
    ).toThrow(/must not exceed/);
    expect(() =>
      validateSettingsGroup('waf', {
        ...validGroups.waf,
        request_body_limit_action: 'Drop',
      }),
    ).toThrow(/Reject or ProcessPartial/);
    expect(() =>
      validateSettingsGroup('waf', {
        ...validGroups.waf,
        custom_directives: 'SecRequestBodyLimit 10737418240',
      }),
    ).toThrow(/out-of-range body limit/);
  });

  it("accepts WAF body limits inside Coraza's range", () => {
    const input = {
      ...validGroups.waf,
      request_body_limit: 1073741824,
      request_body_in_memory_limit: 1048576,
      request_body_limit_action: 'ProcessPartial',
    };
    expect(validateSettingsGroup('waf', input)).toBe(input);
  });

  it('rejects unsupported DNS providers and credential keys', () => {
    expect(() =>
      validateSettingsGroup('dns-provider', {
        providers: { malicious: { command: 'run' } },
        default: 'malicious',
      }),
    ).toThrow(/Unsupported DNS provider/);
    expect(() =>
      validateSettingsGroup('dns-provider', {
        providers: { cloudflare: { api_token: 'secret', injected: 'value' } },
        default: 'cloudflare',
      }),
    ).toThrow(/unknown field/);
  });

  it('caps total payload size', () => {
    expect(() => validateSettingsGroup('acme', { caRootPem: 'x'.repeat(1024 * 1024 + 1) })).toThrow(
      /must not exceed/,
    );
  });

  it('accepts empty optional email and multiline ACME root PEM values', () => {
    expect(
      validateSettingsGroup('general', {
        primaryDomain: 'example.com',
        acmeEmail: '',
      }),
    ).toEqual({ primaryDomain: 'example.com', acmeEmail: '' });

    const caRootPem = '-----BEGIN CERTIFICATE-----\r\nMIIB\n-----END CERTIFICATE-----\n';
    expect(validateSettingsGroup('acme', { caRootPem })).toEqual({ caRootPem });
  });

  it('validates the shape of an ACME contact address', () => {
    const withEmail = (acmeEmail: string) =>
      validateSettingsGroup('general', { primaryDomain: 'example.com', acmeEmail });

    for (const good of ['admin@example.com', 'admin@mail.example.co.uk']) {
      expect(withEmail(good), good).toEqual({ primaryDomain: 'example.com', acmeEmail: good });
    }

    for (const bad of ['admin', 'admin@example', 'admin@.com', 'admin@example.', 'a b@x.com']) {
      expect(() => withEmail(bad), bad).toThrow(/valid email address/);
    }

    // An empty label is not a domain. The earlier pattern let both sides of the dot swallow one,
    // which is what made a non-matching address backtrack quadratically.
    expect(() => withEmail('admin@example..com')).toThrow(/valid email address/);
  });

  it('caps the address length before the pattern ever runs', () => {
    // '!@!.!.!.…' is the worst case for a pattern whose two sides can both eat the dot. The
    // length cap, not the pattern, is what keeps a hostile payload short enough to be harmless,
    // so it has to stay in front of the match rather than beside it.
    expect(() =>
      validateSettingsGroup('general', {
        primaryDomain: 'example.com',
        acmeEmail: `!@${'!.'.repeat(5000)}`,
      }),
    ).toThrow(/between 0 and 320 characters/);
  });

  it('rejects non-line-break control characters in ACME root PEM values', () => {
    expect(() =>
      validateSettingsGroup('acme', {
        caRootPem: '-----BEGIN CERTIFICATE-----\nsecret\u0000suffix\n-----END CERTIFICATE-----',
      }),
    ).toThrow(/control characters/);
  });
});
