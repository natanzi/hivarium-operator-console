/**
 * Cloudflare Access JWT verification (D-03, D-04).
 *
 * Every `/api/*` request must carry a valid `Cf-Access-Jwt-Assertion` header.
 * This module verifies the RS256 signature against the Access team's public
 * JWKS and checks `iss`, `aud`, `exp`, and `nbf` before any route logic runs.
 *
 * The pure check (`verifyAccessJwt`) takes every input explicitly — including
 * the current time — so it is deterministic and table-testable. The JWKS
 * fetch is cached with a short TTL and falls back to the stale cache when a
 * refresh fails.
 *
 * No React imports, no session state: operator identity is derived per
 * request from the verified claims and the API stays stateless.
 */

/** Operator identity derived from verified JWT claims (D-04). */
export interface OperatorIdentity {
  email: string;
  sub: string;
  name: string;
}

/** Stable machine-readable rejection reasons for the 401 envelope. */
export type JwtRejectionReason =
  | "missing-header"
  | "malformed-token"
  | "invalid-signature"
  | "expired"
  | "not-yet-valid"
  | "wrong-audience"
  | "wrong-issuer"
  | "unauthorized-email";

export type JwtVerificationResult =
  | { ok: true; identity: OperatorIdentity }
  | { ok: false; reason: JwtRejectionReason };

/** A JSON Web Key Set as published by Cloudflare Access. */
export interface JsonWebKeySet {
  keys: AccessJwk[];
}

/**
 * The RSA public key fields the Access JWKS publishes. A dedicated interface
 * (rather than the platform `JsonWebKey`) keeps `kid` available for key
 * matching while remaining structurally assignable to `JsonWebKey` for
 * `crypto.subtle.importKey`.
 */
export interface AccessJwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

/** Options for the pure {@link verifyAccessJwt} check. */
export interface VerifyAccessJwtOptions {
  jwks: JsonWebKeySet;
  /** Expected `iss` claim, e.g. `https://<team>.cloudflareaccess.com`. */
  issuer: string;
  /** Expected `aud` claim: the Access application AUD. */
  audience: string;
  /** Current time in milliseconds since the epoch (passed in for tests). */
  now: number;
  /**
   * Optional allowlist of operator emails. When provided (and non-empty), a
   * verified token whose `email` claim is not listed is rejected with
   * `unauthorized-email`. When omitted, every verified Access identity is
   * accepted (Cloudflare Access remains the perimeter).
   */
  authorizedEmails?: readonly string[];
}

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode a base64url string into bytes without relying on `atob`. */
function base64UrlDecode(input: string): Uint8Array {
  const cleaned = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = cleaned + "=".repeat((4 - (cleaned.length % 4)) % 4);
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of padded) {
    if (char === "=") break;
    const value = B64_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error("Invalid base64url character.");
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function decodeJson<T>(input: string): T | null {
  try {
    const bytes = base64UrlDecode(input);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  email?: string;
  sub?: string;
  name?: string;
}

/**
 * Pure Cloudflare Access JWT verification (D-03).
 *
 * Verifies the RS256 signature with `crypto.subtle.verify` against the JWKS
 * key matching the token's `kid`, then checks `iss`, `aud`, `exp`, and `nbf`.
 * Returns `{ ok: true, identity }` or `{ ok: false, reason }` with a stable
 * reason. Never throws for a malformed token — it reports `malformed-token`.
 */
export async function verifyAccessJwt(
  token: string,
  options: VerifyAccessJwtOptions
): Promise<JwtVerificationResult> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed-token" };
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeJson<JwtHeader>(headerB64);
  const payload = decodeJson<JwtClaims>(payloadB64);
  if (!header || !payload) {
    return { ok: false, reason: "malformed-token" };
  }
  if (header.alg !== "RS256") {
    return { ok: false, reason: "invalid-signature" };
  }

  const key = options.jwks.keys.find(
    (candidate) => candidate.kid === header.kid && candidate.kty === "RSA"
  );
  if (!key) {
    return { ok: false, reason: "invalid-signature" };
  }

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      key as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    return { ok: false, reason: "invalid-signature" };
  }

  const signature = base64UrlDecode(signatureB64);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signature,
      data
    );
  } catch {
    return { ok: false, reason: "invalid-signature" };
  }
  if (!valid) {
    return { ok: false, reason: "invalid-signature" };
  }

  if (payload.iss !== options.issuer) {
    return { ok: false, reason: "wrong-issuer" };
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(options.audience)) {
    return { ok: false, reason: "wrong-audience" };
  }
  const nowSeconds = Math.floor(options.now / 1000);
  if (typeof payload.exp === "number" && payload.exp <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nbf === "number" && payload.nbf > nowSeconds) {
    return { ok: false, reason: "not-yet-valid" };
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { ok: false, reason: "malformed-token" };
  }
  if (
    options.authorizedEmails !== undefined &&
    options.authorizedEmails.length > 0 &&
    (typeof payload.email !== "string" ||
      !options.authorizedEmails.includes(payload.email))
  ) {
    return { ok: false, reason: "unauthorized-email" };
  }

  return {
    ok: true,
    identity: {
      email: typeof payload.email === "string" ? payload.email : "",
      sub: payload.sub,
      name:
        typeof payload.name === "string" && payload.name.length > 0
          ? payload.name
          : (typeof payload.email === "string" ? payload.email : ""),
    },
  };
}

/** Cache for the Access public JWKS with a short TTL and stale fallback. */
export interface JwksCache {
  get(teamDomain: string): Promise<JsonWebKeySet>;
}

/**
 * Create a JWKS cache. The key set is fetched from
 * `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, cached for
 * `ttlMs` (default 5 minutes), and refreshed on failure by falling back to
 * the stale cached set when one exists.
 *
 * When `fetchImpl` is omitted the current `globalThis.fetch` is resolved per
 * request, so tests can stub the global fetch and the Worker picks the stub
 * up without any configuration change.
 */
export function createJwksCache(
  fetchImpl?: typeof fetch,
  ttlMs = 5 * 60 * 1000
): JwksCache {
  let cached: { teamDomain: string; jwks: JsonWebKeySet; fetchedAt: number } | null =
    null;

  return {
    async get(teamDomain: string): Promise<JsonWebKeySet> {
      const now = Date.now();
      if (
        cached !== null &&
        cached.teamDomain === teamDomain &&
        now - cached.fetchedAt < ttlMs
      ) {
        return cached.jwks;
      }
      const url = `https://${teamDomain}/cdn-cgi/access/certs`;
      const response = await (fetchImpl ?? globalThis.fetch)(url);
      if (!response.ok) {
        if (cached !== null && cached.teamDomain === teamDomain) {
          return cached.jwks;
        }
        throw new Error(`Failed to fetch Access JWKS: HTTP ${response.status}.`);
      }
      const jwks = (await response.json()) as JsonWebKeySet;
      cached = { teamDomain, jwks, fetchedAt: now };
      return jwks;
    },
  };
}

/** Shared module-level JWKS cache for the Worker instance. */
const sharedJwksCache = createJwksCache();

/** Configuration for {@link authenticateRequest}. */
export interface AccessJwtConfig {
  /** Access team domain, e.g. `example.cloudflareaccess.com`. */
  teamDomain: string;
  /** Access application AUD carried in the JWT `aud` claim. */
  audience: string;
  /** Optional explicit current time (ms) for deterministic tests. */
  now?: number;
  /**
   * Optional allowlist of operator emails. When provided (and non-empty), a
   * verified token whose `email` claim is not listed is rejected with
   * `unauthorized-email`.
   */
  authorizedEmails?: readonly string[];
}

/**
 * Authenticate a request: extract `Cf-Access-Jwt-Assertion`, fetch the cached
 * JWKS, and run the pure {@link verifyAccessJwt} check. Returns the verified
 * operator identity or a stable rejection reason. Missing header and JWKS
 * fetch failures both map to stable 401 reasons.
 */
export async function authenticateRequest(
  request: Request,
  config: AccessJwtConfig,
  jwksCache: JwksCache = sharedJwksCache
): Promise<JwtVerificationResult> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (token === null || token.trim().length === 0) {
    return { ok: false, reason: "missing-header" };
  }
  const now = config.now ?? Date.now();
  const issuer = `https://${config.teamDomain}`;
  let jwks: JsonWebKeySet;
  try {
    jwks = await jwksCache.get(config.teamDomain);
  } catch {
    return { ok: false, reason: "invalid-signature" };
  }
  return verifyAccessJwt(token, {
    jwks,
    issuer,
    audience: config.audience,
    now,
    authorizedEmails: config.authorizedEmails,
  });
}