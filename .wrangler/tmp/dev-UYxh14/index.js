var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-mq08Tc/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// worker/src/auth.ts
var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64UrlDecode(input) {
  const cleaned = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = cleaned + "=".repeat((4 - cleaned.length % 4) % 4);
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const char of padded) {
    if (char === "=") break;
    const value = B64_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error("Invalid base64url character.");
    }
    buffer = buffer << 6 | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(buffer >> bits & 255);
    }
  }
  return new Uint8Array(bytes);
}
__name(base64UrlDecode, "base64UrlDecode");
function decodeJson(input) {
  try {
    const bytes = base64UrlDecode(input);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
__name(decodeJson, "decodeJson");
async function verifyAccessJwt(token, options) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed-token" };
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeJson(headerB64);
  const payload = decodeJson(payloadB64);
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
  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      key,
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
  const nowSeconds = Math.floor(options.now / 1e3);
  if (typeof payload.exp === "number" && payload.exp <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nbf === "number" && payload.nbf > nowSeconds) {
    return { ok: false, reason: "not-yet-valid" };
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { ok: false, reason: "malformed-token" };
  }
  if (!options.authorizedEmails || options.authorizedEmails.length === 0) {
    return { ok: false, reason: "unauthorized-email" };
  }
  if (typeof payload.email !== "string" || !options.authorizedEmails.includes(payload.email)) {
    return { ok: false, reason: "unauthorized-email" };
  }
  return {
    ok: true,
    identity: {
      email: typeof payload.email === "string" ? payload.email : "",
      sub: payload.sub,
      name: typeof payload.name === "string" && payload.name.length > 0 ? payload.name : typeof payload.email === "string" ? payload.email : ""
    }
  };
}
__name(verifyAccessJwt, "verifyAccessJwt");
function createJwksCache(fetchImpl, ttlMs = 5 * 60 * 1e3) {
  let cached = null;
  return {
    async get(teamDomain) {
      const now = Date.now();
      if (cached !== null && cached.teamDomain === teamDomain && now - cached.fetchedAt < ttlMs) {
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
      const jwks = await response.json();
      cached = { teamDomain, jwks, fetchedAt: now };
      return jwks;
    }
  };
}
__name(createJwksCache, "createJwksCache");
var sharedJwksCache = createJwksCache();
async function authenticateRequest(request, config, jwksCache = sharedJwksCache) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (token === null || token.trim().length === 0) {
    return { ok: false, reason: "missing-header" };
  }
  const now = config.now ?? Date.now();
  const issuer = `https://${config.teamDomain}`;
  let jwks;
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
    authorizedEmails: config.authorizedEmails
  });
}
__name(authenticateRequest, "authenticateRequest");

// src/domain/types.ts
var STORE_SCHEMA_VERSION = 4;
var LEGACY_STATUS_ALIASES = {
  trial: "evaluation",
  evaluation: "evaluation",
  active: "active",
  paused: "paused",
  churned: "churned",
  archived: "archived"
};
function normalizeCustomerStatus(value) {
  if (typeof value !== "string") return "evaluation";
  return LEGACY_STATUS_ALIASES[value] ?? "evaluation";
}
__name(normalizeCustomerStatus, "normalizeCustomerStatus");

// src/domain/commercial-rules.ts
function parseInstant(value) {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}
__name(parseInstant, "parseInstant");
var ARRANGEMENT_MODELS = [
  "monthly",
  "prepaid",
  "annual"
];
var ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
function isIso(value) {
  return typeof value === "string" && value.length > 0 && ISO_DATE_REGEX.test(value) && !Number.isNaN(Date.parse(value));
}
__name(isIso, "isIso");
function isNonNegInt(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}
__name(isNonNegInt, "isNonNegInt");
var RENEWAL_STATUSES = [
  "renewing",
  "review",
  "non-renewing",
  "unknown"
];
var ALLOWANCE_UNITS = [
  "tokens",
  "seats",
  "requests",
  "usd",
  "other"
];
function fail(...problems) {
  return { ok: false, problems };
}
__name(fail, "fail");
function validateCore(input) {
  const problems = [];
  if (!ARRANGEMENT_MODELS.includes(input.model)) {
    problems.push("model must be 'monthly', 'prepaid', or 'annual'.");
    return null;
  }
  if (typeof input.id !== "string" || input.id.trim().length === 0) {
    problems.push("id is required.");
  }
  if (typeof input.customerId !== "string" || input.customerId.trim().length === 0) {
    problems.push("customerId is required.");
  }
  if (!isIso(input.effectiveFrom)) {
    problems.push("effectiveFrom must be a valid ISO-8601 timestamp.");
  }
  if (input.effectiveTo !== null && input.effectiveTo !== void 0 && !isIso(input.effectiveTo)) {
    problems.push("effectiveTo must be a valid ISO-8601 timestamp or null.");
  }
  if (isIso(input.effectiveFrom) && input.effectiveTo !== null && input.effectiveTo !== void 0 && isIso(input.effectiveTo) && parseInstant(input.effectiveTo) < parseInstant(input.effectiveFrom)) {
    problems.push(
      "effectiveTo must not be earlier than effectiveFrom."
    );
  }
  if (typeof input.createdAt !== "string" || !isIso(input.createdAt)) {
    problems.push("createdAt must be a valid ISO-8601 timestamp.");
  }
  if (typeof input.status !== "string" || !["active", "scheduled", "ended", "terminated"].includes(
    input.status
  )) {
    problems.push("status must be active, scheduled, ended, or terminated.");
  }
  if (input.replacedByArrangementId !== null && input.replacedByArrangementId !== void 0 && (typeof input.replacedByArrangementId !== "string" || input.replacedByArrangementId.trim().length === 0)) {
    problems.push(
      "replacedByArrangementId must be a non-empty string or null."
    );
  }
  const effectiveFrom = (typeof input.effectiveFrom === "string" ? input.effectiveFrom : "").trim();
  const effectiveTo = input.effectiveTo === null || input.effectiveTo === void 0 ? null : input.effectiveTo.trim();
  const customerId = typeof input.customerId === "string" ? input.customerId.trim() : "";
  return {
    problems,
    customerId,
    effectiveFrom,
    effectiveTo
  };
}
__name(validateCore, "validateCore");
function validateMonthly(input) {
  const problems = [];
  if (input.currency !== "USD") problems.push("currency must be 'USD'.");
  if (input.billingCadence !== "monthly") {
    problems.push("billingCadence must be 'monthly'.");
  }
  if (!isNonNegInt(input.monthlyAmountCents)) {
    problems.push(
      "monthlyAmountCents must be a non-negative integer number of cents."
    );
  }
  if (!isIso(input.renewsAt)) {
    problems.push("renewsAt must be a valid ISO-8601 timestamp.");
  }
  return { ok: problems.length === 0, problems };
}
__name(validateMonthly, "validateMonthly");
function validatePrepaid(input) {
  const problems = [];
  if (input.warningThresholdTokens !== void 0 && input.warningThresholdTokens !== null && !isNonNegInt(input.warningThresholdTokens)) {
    problems.push(
      "warningThresholdTokens must be a non-negative integer number of tokens."
    );
  }
  if (input.expiresAt !== null && input.expiresAt !== void 0 && !isIso(input.expiresAt)) {
    problems.push("expiresAt must be a valid ISO-8601 timestamp or null.");
  }
  if (input.notes !== void 0 && input.notes !== null && typeof input.notes !== "string") {
    problems.push("notes must be a string when provided.");
  }
  return { ok: problems.length === 0, problems };
}
__name(validatePrepaid, "validatePrepaid");
function validateAnnual(input) {
  const problems = [];
  if (input.currency !== "USD") problems.push("currency must be 'USD'.");
  if (!isNonNegInt(input.contractValueCents)) {
    problems.push(
      "contractValueCents must be a non-negative integer number of cents."
    );
  }
  if (!isIso(input.startsAt)) {
    problems.push("startsAt must be a valid ISO-8601 timestamp.");
  }
  if (!isIso(input.endsAt)) {
    problems.push("endsAt must be a valid ISO-8601 timestamp.");
  }
  if (isIso(input.startsAt) && isIso(input.endsAt) && parseInstant(input.endsAt) < parseInstant(input.startsAt)) {
    problems.push("endsAt must not be earlier than startsAt.");
  }
  if (!isNonNegInt(input.includedAllowance)) {
    problems.push("includedAllowance must be a non-negative integer.");
  }
  if (typeof input.allowanceUnit !== "string" || !ALLOWANCE_UNITS.includes(input.allowanceUnit)) {
    problems.push(
      "allowanceUnit must be 'tokens', 'seats', 'requests', 'usd', or 'other'."
    );
  }
  if (!isNonNegInt(input.overageRateCentsPerUnit)) {
    problems.push(
      "overageRateCentsPerUnit must be a non-negative integer number of cents."
    );
  }
  if (input.renewalStatus !== void 0 && input.renewalStatus !== null && !RENEWAL_STATUSES.includes(input.renewalStatus)) {
    problems.push(
      "renewalStatus must be 'renewing', 'review', 'non-renewing', or 'unknown'."
    );
  }
  if (input.notes !== void 0 && input.notes !== null && typeof input.notes !== "string") {
    problems.push("notes must be a string when provided.");
  }
  return { ok: problems.length === 0, problems };
}
__name(validateAnnual, "validateAnnual");
function validateCommercialArrangement(input) {
  const core = validateCore(input);
  if (core === null) {
    return fail("model must be 'monthly', 'prepaid', or 'annual'.");
  }
  const problems = [...core.problems];
  const model = input.model;
  if (model === "monthly") {
    const m = validateMonthly(input);
    problems.push(...m.problems);
  } else if (model === "prepaid") {
    const m = validatePrepaid(input);
    problems.push(...m.problems);
  } else if (model === "annual") {
    const m = validateAnnual(input);
    problems.push(...m.problems);
  }
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    problems.push("reason is required.");
  }
  return { ok: problems.length === 0, problems };
}
__name(validateCommercialArrangement, "validateCommercialArrangement");
function resolveArrangementAsOf(arrangement, at) {
  const atMs = typeof at === "number" ? at : parseInstant(at);
  if (arrangement.status === "terminated") return "terminated";
  if (arrangement.status === "ended") return "ended";
  const fromMs = parseInstant(arrangement.effectiveFrom);
  if (atMs < fromMs) return "scheduled";
  if (arrangement.model === "annual" && parseInstant(arrangement.endsAt) < atMs) {
    return "ended";
  }
  if (arrangement.effectiveTo !== null && arrangement.effectiveTo !== void 0 && parseInstant(arrangement.effectiveTo) < atMs) {
    return "ended";
  }
  return "active";
}
__name(resolveArrangementAsOf, "resolveArrangementAsOf");
function planTierMonthlyAmountCents(plan) {
  switch (plan) {
    case "starter":
      return 4900;
    case "growth":
      return 14900;
    case "scale":
      return 49e3;
    case "enterprise":
      return 199e3;
    default:
      return 4900;
  }
}
__name(planTierMonthlyAmountCents, "planTierMonthlyAmountCents");
function subscriptionToMonthlyArrangement(input, options) {
  const fromMs = parseInstant(input.startedAt);
  const nowMs = parseInstant(options.now);
  const renewedMs = parseInstant(input.renewsAt);
  const status = input.status === "cancelled" ? "terminated" : fromMs > nowMs ? "scheduled" : renewedMs < nowMs ? renewedMs > fromMs ? "active" : "ended" : "active";
  if (status === "active" && renewedMs < nowMs) {
  }
  return {
    id: input.id,
    customerId: input.customerId,
    status,
    model: "monthly",
    currency: "USD",
    billingCadence: "monthly",
    monthlyAmountCents: planTierMonthlyAmountCents(input.plan),
    effectiveFrom: input.startedAt,
    effectiveTo: null,
    replacedByArrangementId: null,
    renewsAt: input.renewsAt,
    createdAt: options.now,
    reason: `Migrated from legacy ${input.plan} subscription.`
  };
}
__name(subscriptionToMonthlyArrangement, "subscriptionToMonthlyArrangement");
function validateAgentAccessGrant(input) {
  const problems = [];
  if (typeof input.customerId !== "string" || input.customerId.trim().length === 0) {
    problems.push("customerId is required.");
  }
  if (typeof input.agentProductId !== "string" || input.agentProductId.trim().length === 0) {
    problems.push("agentProductId is required.");
  }
  if (!isIso(input.startsAt)) {
    problems.push("startsAt must be a valid ISO-8601 timestamp.");
  }
  if (input.endsAt !== null && input.endsAt !== void 0 && !isIso(input.endsAt)) {
    problems.push("endsAt must be a valid ISO-8601 timestamp or null.");
  }
  if (isIso(input.startsAt) && input.endsAt !== null && input.endsAt !== void 0 && isIso(input.endsAt) && parseInstant(input.endsAt) < parseInstant(input.startsAt)) {
    problems.push("endsAt must not be earlier than startsAt.");
  }
  if (typeof input.reasonForChange !== "string" || input.reasonForChange.trim().length === 0) {
    problems.push("reasonForChange is required.");
  }
  return { ok: problems.length === 0, problems };
}
__name(validateAgentAccessGrant, "validateAgentAccessGrant");
function resolveAgentAccessStatus(grant, at) {
  const atMs = typeof at === "number" ? at : parseInstant(at);
  if (grant.revokedAt !== null && parseInstant(grant.revokedAt) <= atMs) {
    return "revoked";
  }
  if (grant.scheduledRevokeAt !== null && parseInstant(grant.scheduledRevokeAt) <= atMs) {
    return "revoked";
  }
  if (atMs < parseInstant(grant.startsAt)) {
    return "scheduled";
  }
  if (grant.endsAt !== null && parseInstant(grant.endsAt) < atMs) {
    return "expired";
  }
  return "active";
}
__name(resolveAgentAccessStatus, "resolveAgentAccessStatus");
function findConflictingAccessGrant(grants, input, at) {
  return grants.find(
    (grant) => grant.customerId === input.customerId && grant.agentProductId === input.agentProductId && (resolveAgentAccessStatus(grant, at) === "active" || resolveAgentAccessStatus(grant, at) === "scheduled")
  );
}
__name(findConflictingAccessGrant, "findConflictingAccessGrant");
function commercialCreatedEventId(arrangementId) {
  return `evt_${arrangementId}`;
}
__name(commercialCreatedEventId, "commercialCreatedEventId");
function commercialTerminatedEventId(arrangementId) {
  return `evt_${arrangementId}_terminated`;
}
__name(commercialTerminatedEventId, "commercialTerminatedEventId");
function accessRevokedEventId(grantId) {
  return `evt_${grantId}_revoked`;
}
__name(accessRevokedEventId, "accessRevokedEventId");
function accessRevokeScheduledEventId(grantId) {
  return `evt_${grantId}_revoke_scheduled`;
}
__name(accessRevokeScheduledEventId, "accessRevokeScheduledEventId");
function buildArrangementFromInput(input, occurredAt) {
  const base = {
    id: input.id,
    customerId: input.customerId,
    status: input.status,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
    createdAt: input.createdAt ?? occurredAt,
    reason: input.reason,
    replacedByArrangementId: input.replacedByArrangementId ?? null
  };
  const model = input.model;
  if (model === "monthly") {
    return {
      ...base,
      model,
      currency: "USD",
      billingCadence: "monthly",
      monthlyAmountCents: input.monthlyAmountCents,
      renewsAt: input.renewsAt
    };
  }
  if (model === "prepaid") {
    return {
      ...base,
      model,
      warningThresholdTokens: input.warningThresholdTokens ?? 100,
      expiresAt: input.expiresAt ?? null,
      notes: input.notes
    };
  }
  return {
    ...base,
    model: "annual",
    currency: "USD",
    contractValueCents: input.contractValueCents,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    renewalStatus: input.renewalStatus ?? "unknown",
    notes: input.notes,
    includedAllowance: input.includedAllowance,
    allowanceUnit: input.allowanceUnit,
    overageRateCentsPerUnit: input.overageRateCentsPerUnit
  };
}
__name(buildArrangementFromInput, "buildArrangementFromInput");
function projectCommercialState(records, asOf) {
  const active = records.find(
    (arrangement) => resolveArrangementAsOf(arrangement, asOf) === "active"
  ) ?? null;
  const scheduled = records.filter(
    (arrangement) => resolveArrangementAsOf(arrangement, asOf) === "scheduled"
  ).sort(
    (a, b) => parseInstant(a.effectiveFrom) - parseInstant(b.effectiveFrom)
  )[0] ?? null;
  const history = [...records].sort(
    (a, b) => parseInstant(b.effectiveFrom) - parseInstant(a.effectiveFrom)
  );
  return { active, scheduled, history };
}
__name(projectCommercialState, "projectCommercialState");
function applyCommercialTransition(store, input, occurredAt) {
  const normalizedInput = {
    ...input,
    createdAt: input.createdAt ?? occurredAt
  };
  const validation = validateCommercialArrangement(normalizedInput);
  if (!validation.ok) {
    throw new Error(validation.problems.join(" "));
  }
  const customerId = normalizedInput.customerId;
  const effectiveFrom = normalizedInput.effectiveFrom;
  const isImmediate = parseInstant(effectiveFrom) <= parseInstant(occurredAt);
  const arrangement = buildArrangementFromInput(normalizedInput, occurredAt);
  const status = isImmediate ? "active" : "scheduled";
  const finalArrangement = { ...arrangement, status };
  if (store.commercialArrangements.some((a) => a.id === finalArrangement.id)) {
    throw new Error(
      `Commercial arrangement with id "${finalArrangement.id}" already exists.`
    );
  }
  let arrangements = store.commercialArrangements;
  const active = arrangements.find(
    (a) => a.customerId === customerId && resolveArrangementAsOf(a, occurredAt) === "active"
  );
  if (active) {
    if (isImmediate) {
      const boundary = parseInstant(effectiveFrom) > parseInstant(active.effectiveFrom) ? effectiveFrom : occurredAt;
      arrangements = arrangements.map(
        (a) => a.id === active.id ? {
          ...a,
          status: "ended",
          effectiveTo: boundary,
          replacedByArrangementId: finalArrangement.id
        } : a
      );
    }
  }
  const event = {
    id: commercialCreatedEventId(finalArrangement.id),
    occurredAt,
    source: "operator",
    type: "commercial.created",
    customerId,
    label: `Created ${finalArrangement.model} commercial arrangement.`,
    subjectId: finalArrangement.id,
    resultingState: finalArrangement.status
  };
  return {
    store: {
      ...store,
      commercialArrangements: [...arrangements, finalArrangement],
      activityEvents: [...store.activityEvents, event]
    },
    arrangement: finalArrangement,
    event
  };
}
__name(applyCommercialTransition, "applyCommercialTransition");
function applyAccessRevocation(store, input) {
  const grant = store.agentAccessGrants.find(
    (g) => g.id === input.grantId && g.customerId === input.customerId
  );
  if (!grant) {
    throw new Error(
      `Agent access grant with id "${input.grantId}" does not exist.`
    );
  }
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new Error("reason is required.");
  }
  if (grant.revokedAt !== null) {
    throw new Error(`Agent access grant "${input.grantId}" is already revoked.`);
  }
  const immediate = parseInstant(input.effectiveAt) <= parseInstant(input.occurredAt);
  if (grant.scheduledRevokeAt !== null && !immediate) {
    throw new Error(
      `Agent access grant "${input.grantId}" is already scheduled for revocation.`
    );
  }
  const updatedGrant = immediate ? { ...grant, revokedAt: input.effectiveAt, scheduledRevokeAt: null } : { ...grant, scheduledRevokeAt: input.effectiveAt };
  const event = {
    id: immediate ? accessRevokedEventId(grant.id) : accessRevokeScheduledEventId(grant.id),
    occurredAt: input.occurredAt,
    source: input.source ?? "operator",
    type: "access.revoked",
    customerId: input.customerId,
    label: `Revoked access to agent product "${grant.agentProductId}".`,
    subjectId: grant.id,
    subjectId2: grant.agentProductId,
    resultingState: immediate ? "revoked" : "scheduled",
    causationId: input.causationId
  };
  return {
    store: {
      ...store,
      agentAccessGrants: store.agentAccessGrants.map(
        (g) => g.id === grant.id ? updatedGrant : g
      ),
      activityEvents: [...store.activityEvents, event]
    },
    grant: updatedGrant,
    event
  };
}
__name(applyAccessRevocation, "applyAccessRevocation");

// src/domain/ledger-rules.ts
function parseInstant2(value) {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}
__name(parseInstant2, "parseInstant");
var ISO_DATE_REGEX2 = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
function isIso2(value) {
  return typeof value === "string" && value.length > 0 && ISO_DATE_REGEX2.test(value) && !Number.isNaN(Date.parse(value));
}
__name(isIso2, "isIso");
function isWholeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}
__name(isWholeNumber, "isWholeNumber");
function deriveTokenBalance(transactions, customerId) {
  return transactions.filter((transaction) => transaction.customerId === customerId).reduce((sum, transaction) => sum + transaction.amountTokens, 0);
}
__name(deriveTokenBalance, "deriveTokenBalance");
var LEDGER_KINDS = [
  "credit_grant",
  "usage_debit",
  "manual_adjustment",
  "reversal"
];
function validateLedgerTransaction(input, context = {}) {
  const problems = [];
  if (typeof input.id !== "string" || input.id.trim().length === 0) {
    problems.push("id is required.");
  }
  if (typeof input.customerId !== "string" || input.customerId.trim().length === 0) {
    problems.push("customerId is required.");
  }
  if (!isIso2(input.occurredAt)) {
    problems.push("occurredAt must be a valid ISO-8601 timestamp.");
  }
  if (typeof input.kind !== "string" || !LEDGER_KINDS.includes(input.kind)) {
    problems.push(
      "kind must be 'credit_grant', 'usage_debit', 'manual_adjustment', or 'reversal'."
    );
  }
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    problems.push("reason is required.");
  }
  if (typeof input.reference !== "string" || input.reference.trim().length === 0) {
    problems.push("reference is required.");
  }
  const kind = input.kind;
  const amount = input.amountTokens;
  if (!isWholeNumber(amount)) {
    problems.push("amountTokens must be a whole number of tokens.");
  } else if (kind === "credit_grant") {
    if (amount <= 0) {
      problems.push("credit_grant amountTokens must be positive whole tokens.");
    }
  } else if (kind === "usage_debit") {
    if (amount >= 0) {
      problems.push("usage_debit amountTokens must be negative whole tokens.");
    } else if (context.usage !== void 0 && amount !== -context.usage.tokenQuantity) {
      problems.push(
        "usage_debit amountTokens must equal the negative of the linked usage tokenQuantity."
      );
    }
  } else if (kind === "manual_adjustment") {
    if (amount === 0) {
      problems.push("manual_adjustment amountTokens must be non-zero.");
    }
  } else if (kind === "reversal") {
    if (amount === 0) {
      problems.push("reversal amountTokens must be non-zero.");
    } else if (context.target !== void 0 && amount !== -context.target.amountTokens) {
      problems.push(
        "reversal amountTokens must equal the negative of the target transaction amountTokens."
      );
    }
  }
  if (kind === "usage_debit") {
    if (typeof input.usageRecordId !== "string" || input.usageRecordId.trim().length === 0) {
      problems.push("usageRecordId is required for usage_debit.");
    }
    if (typeof input.agentProductId !== "string" || input.agentProductId.trim().length === 0) {
      problems.push("agentProductId is required for usage_debit.");
    }
  }
  if (kind === "reversal") {
    if (typeof input.reversesTransactionId !== "string" || input.reversesTransactionId.trim().length === 0) {
      problems.push("reversesTransactionId is required for reversal.");
    }
  }
  return { ok: problems.length === 0, problems };
}
__name(validateLedgerTransaction, "validateLedgerTransaction");
function assertNoNegativeBalance(transactions, customerId, candidateAmountTokens) {
  const resultingBalance = deriveTokenBalance(transactions, customerId) + candidateAmountTokens;
  if (resultingBalance < 0) {
    throw new Error(
      `Insufficient token balance: the resulting balance would be ${resultingBalance} tokens.`
    );
  }
}
__name(assertNoNegativeBalance, "assertNoNegativeBalance");
function validateReversalTarget(transactions, targetId) {
  const target = transactions.find((transaction) => transaction.id === targetId);
  if (!target) {
    throw new Error(`Ledger transaction with id "${targetId}" does not exist.`);
  }
  if (target.kind === "reversal") {
    throw new Error(
      `Ledger transaction "${targetId}" is a reversal and cannot be reversed.`
    );
  }
  if (transactions.some(
    (transaction) => transaction.kind === "reversal" && transaction.reversesTransactionId === targetId
  )) {
    throw new Error(
      `Ledger transaction "${targetId}" has already been reversed.`
    );
  }
}
__name(validateReversalTarget, "validateReversalTarget");
function validateReversal(transactions, targetId, customerId, amountTokens) {
  validateReversalTarget(transactions, targetId);
  const target = transactions.find((transaction) => transaction.id === targetId);
  if (!target) {
    throw new Error(`Ledger transaction with id "${targetId}" does not exist.`);
  }
  if (target.customerId !== customerId) {
    throw new Error(
      `Ledger transaction "${targetId}" belongs to a different customer.`
    );
  }
  if (amountTokens !== -target.amountTokens) {
    throw new Error(
      "reversal amountTokens must equal the negative of the target transaction amountTokens."
    );
  }
}
__name(validateReversal, "validateReversal");
function openingCreditTransactionId(arrangementId) {
  return `txn_opening_${arrangementId}`;
}
__name(openingCreditTransactionId, "openingCreditTransactionId");
function openingCreditReference(arrangementId) {
  return `opening_${arrangementId}`;
}
__name(openingCreditReference, "openingCreditReference");
function creditGrantTransactionId(customerId, occurredAt) {
  return `txn_${customerId}_credit_${occurredAt}`;
}
__name(creditGrantTransactionId, "creditGrantTransactionId");
function reversalTransactionId(targetTransactionId) {
  return `txn_reversal_${targetTransactionId}`;
}
__name(reversalTransactionId, "reversalTransactionId");
function usageRecordId(sourceReference) {
  return `usage_${sourceReference}`;
}
__name(usageRecordId, "usageRecordId");
function usageDebitTransactionId(sourceReference) {
  return `txn_usage_${sourceReference}`;
}
__name(usageDebitTransactionId, "usageDebitTransactionId");
function manualAdjustmentTransactionId(customerId, occurredAt) {
  return `txn_${customerId}_adjustment_${occurredAt}`;
}
__name(manualAdjustmentTransactionId, "manualAdjustmentTransactionId");
function normalizeUsageFingerprint(input) {
  const customerId = typeof input.customerId === "string" ? input.customerId.trim() : "";
  const agentProductId = typeof input.agentProductId === "string" ? input.agentProductId.trim() : "";
  const sourceReference = typeof input.sourceReference === "string" ? input.sourceReference.trim() : "";
  if (customerId.length === 0 || agentProductId.length === 0 || sourceReference.length === 0 || !isIso2(input.occurredAt) || !isWholeNumber(input.tokenQuantity) || input.tokenQuantity <= 0) {
    return null;
  }
  return {
    customerId,
    agentProductId,
    sourceReference,
    occurredAt: input.occurredAt,
    tokenQuantity: input.tokenQuantity
  };
}
__name(normalizeUsageFingerprint, "normalizeUsageFingerprint");
function validateUsageIdempotency(existing, fingerprint) {
  if (!existing) return false;
  const isExactReplay = existing.customerId === fingerprint.customerId && existing.agentProductId === fingerprint.agentProductId && existing.sourceReference === fingerprint.sourceReference && existing.occurredAt === fingerprint.occurredAt && existing.tokenQuantity === fingerprint.tokenQuantity;
  if (isExactReplay) return true;
  throw new Error(
    `Source reference "${fingerprint.sourceReference}" is already assigned to different usage.`
  );
}
__name(validateUsageIdempotency, "validateUsageIdempotency");
function projectAccountStatement(transactions, customerId) {
  const customerTransactions = transactions.filter((transaction) => transaction.customerId === customerId).map((transaction, index) => ({ transaction, index })).sort(
    (a, b) => parseInstant2(a.transaction.occurredAt) - parseInstant2(b.transaction.occurredAt) || a.index - b.index
  );
  let runningBalance = 0;
  const rows = customerTransactions.map(({ transaction }) => {
    runningBalance += transaction.amountTokens;
    return { transaction, resultingBalanceTokens: runningBalance };
  });
  return rows.reverse();
}
__name(projectAccountStatement, "projectAccountStatement");
var DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
function normalizeDateBoundary(value, endOfDay) {
  if (value === void 0 || value.trim() === "") return null;
  const trimmed = value.trim();
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    throw new Error("Date filter must be a valid ISO-8601 date or timestamp.");
  }
  if (DATE_ONLY_REGEX.test(trimmed)) {
    return endOfDay ? ms + 864e5 - 1 : ms;
  }
  return ms;
}
__name(normalizeDateBoundary, "normalizeDateBoundary");
function normalizePeriod(period) {
  const fromMs = normalizeDateBoundary(period.from, false);
  const toMs = normalizeDateBoundary(period.to, true);
  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    throw new Error("From date must be on or before To date.");
  }
  return { fromMs, toMs };
}
__name(normalizePeriod, "normalizePeriod");
function filterStatement(rows, filter) {
  const { fromMs, toMs } = normalizePeriod({
    from: filter.from,
    to: filter.to
  });
  const agentProductId = filter.agentProductId?.trim() || void 0;
  const type = filter.type;
  return rows.filter((row) => {
    const occurredMs = parseInstant2(row.transaction.occurredAt);
    if (fromMs !== null && occurredMs < fromMs) return false;
    if (toMs !== null && occurredMs > toMs) return false;
    if (agentProductId !== void 0) {
      if (row.transaction.kind !== "usage_debit") return false;
      if (row.transaction.agentProductId !== agentProductId) return false;
    }
    if (type !== void 0 && row.transaction.kind !== type) return false;
    return true;
  });
}
__name(filterStatement, "filterStatement");
function usageEffectsByAgent(transactions, customerId, period, filter) {
  const byId = new Map(
    transactions.map((transaction) => [transaction.id, transaction])
  );
  const totals = /* @__PURE__ */ new Map();
  const agentProductId = filter.agentProductId?.trim() || void 0;
  const type = filter.type;
  for (const transaction of transactions) {
    if (transaction.customerId !== customerId) continue;
    const occurredMs = parseInstant2(transaction.occurredAt);
    if (period.fromMs !== null && occurredMs < period.fromMs) continue;
    if (period.toMs !== null && occurredMs > period.toMs) continue;
    if (transaction.kind === "usage_debit") {
      if (agentProductId !== void 0 && transaction.agentProductId !== agentProductId) {
        continue;
      }
      if (type !== void 0 && type !== "usage_debit") continue;
      totals.set(
        transaction.agentProductId,
        (totals.get(transaction.agentProductId) ?? 0) + transaction.amountTokens
      );
    } else if (transaction.kind === "reversal") {
      if (type !== void 0 && type !== "reversal") continue;
      const target = byId.get(transaction.reversesTransactionId);
      if (!target || target.customerId !== customerId || target.kind !== "usage_debit") {
        continue;
      }
      if (agentProductId !== void 0 && target.agentProductId !== agentProductId) {
        continue;
      }
      totals.set(
        target.agentProductId,
        (totals.get(target.agentProductId) ?? 0) + transaction.amountTokens
      );
    }
  }
  return totals;
}
__name(usageEffectsByAgent, "usageEffectsByAgent");
function sumPeriodUsage(transactions, customerId, period, filter = {}) {
  const normalized = normalizePeriod(period);
  const totals = usageEffectsByAgent(
    transactions,
    customerId,
    normalized,
    filter
  );
  let sum = 0;
  for (const value of totals.values()) sum += value;
  return sum;
}
__name(sumPeriodUsage, "sumPeriodUsage");
function groupUsageByAgent(transactions, customerId, period, agentNames, filter = {}) {
  const normalized = normalizePeriod(period);
  const totals = usageEffectsByAgent(
    transactions,
    customerId,
    normalized,
    filter
  );
  const rows = [...totals.entries()].map(
    ([agentProductId, netTokensConsumed]) => ({
      agentProductId,
      netTokensConsumed
    })
  );
  rows.sort((a, b) => {
    if (a.netTokensConsumed !== b.netTokensConsumed) {
      return a.netTokensConsumed - b.netTokensConsumed;
    }
    const nameA = agentNames?.get(a.agentProductId) ?? a.agentProductId;
    const nameB = agentNames?.get(b.agentProductId) ?? b.agentProductId;
    return nameA.localeCompare(nameB);
  });
  return rows;
}
__name(groupUsageByAgent, "groupUsageByAgent");
function recordUsage(store, input, occurredAt) {
  const fingerprint = normalizeUsageFingerprint({
    customerId: input.customerId,
    agentProductId: input.agentProductId,
    sourceReference: input.sourceReference,
    occurredAt,
    tokenQuantity: input.tokenQuantity
  });
  if (!fingerprint) {
    throw new Error(
      "Usage requires a customer, agent product, positive whole token quantity, canonical ISO occurredAt, and a source reference."
    );
  }
  const usage = {
    id: usageRecordId(fingerprint.sourceReference),
    customerId: fingerprint.customerId,
    agentProductId: fingerprint.agentProductId,
    occurredAt: fingerprint.occurredAt,
    tokenQuantity: fingerprint.tokenQuantity,
    sourceReference: fingerprint.sourceReference,
    ledgerTransactionId: usageDebitTransactionId(fingerprint.sourceReference)
  };
  const transaction = {
    id: usageDebitTransactionId(fingerprint.sourceReference),
    customerId: fingerprint.customerId,
    occurredAt: fingerprint.occurredAt,
    kind: "usage_debit",
    amountTokens: -fingerprint.tokenQuantity,
    reason: input.reason?.trim() || "Agent usage.",
    reference: fingerprint.sourceReference,
    usageRecordId: usage.id,
    agentProductId: fingerprint.agentProductId
  };
  const validation = validateLedgerTransaction(transaction, { usage });
  if (!validation.ok) {
    throw new Error(validation.problems.join(" "));
  }
  assertNoNegativeBalance(
    store.ledgerTransactions,
    fingerprint.customerId,
    transaction.amountTokens
  );
  return {
    store: {
      ...store,
      ledgerTransactions: [...store.ledgerTransactions, transaction],
      usageRecords: [...store.usageRecords, usage]
    },
    usage,
    transaction
  };
}
__name(recordUsage, "recordUsage");
function applyManualAdjustment(store, input, occurredAt) {
  const customerId = input.customerId.trim();
  const transaction = {
    id: manualAdjustmentTransactionId(customerId, occurredAt),
    customerId,
    occurredAt,
    kind: "manual_adjustment",
    amountTokens: input.amountTokens,
    reason: input.reason.trim(),
    reference: input.reference.trim()
  };
  const validation = validateLedgerTransaction(transaction);
  if (!validation.ok) {
    throw new Error(validation.problems.join(" "));
  }
  assertNoNegativeBalance(
    store.ledgerTransactions,
    customerId,
    transaction.amountTokens
  );
  return {
    store: {
      ...store,
      ledgerTransactions: [...store.ledgerTransactions, transaction]
    },
    transaction
  };
}
__name(applyManualAdjustment, "applyManualAdjustment");
function reverseTransaction(store, input, occurredAt) {
  const customerId = input.customerId.trim();
  const targetId = input.transactionId.trim();
  const target = store.ledgerTransactions.find(
    (transaction2) => transaction2.id === targetId
  );
  if (!target) {
    throw new Error(`Ledger transaction with id "${targetId}" does not exist.`);
  }
  const transaction = {
    id: reversalTransactionId(targetId),
    customerId,
    occurredAt,
    kind: "reversal",
    amountTokens: -target.amountTokens,
    reason: input.reason.trim(),
    reference: input.reference.trim(),
    reversesTransactionId: targetId
  };
  validateReversal(
    store.ledgerTransactions,
    targetId,
    customerId,
    transaction.amountTokens
  );
  const validation = validateLedgerTransaction(transaction, { target });
  if (!validation.ok) {
    throw new Error(validation.problems.join(" "));
  }
  assertNoNegativeBalance(
    store.ledgerTransactions,
    customerId,
    transaction.amountTokens
  );
  return {
    store: {
      ...store,
      ledgerTransactions: [...store.ledgerTransactions, transaction]
    },
    transaction
  };
}
__name(reverseTransaction, "reverseTransaction");

// src/data/seed-data.ts
var AGENT_PRODUCTS = [
  {
    id: "agent_sentinel",
    name: "Sentinel",
    description: "Autonomous security triage agent that monitors telemetry, triages alerts, and opens incidents with a proposed response plan.",
    category: "Security",
    version: "2.4.1",
    plans: ["growth", "scale", "enterprise"]
  },
  {
    id: "agent_courier",
    name: "Courier",
    description: "Order fulfilment agent that coordinates warehouse picking, carrier selection and delivery exceptions end-to-end.",
    category: "Operations",
    version: "3.1.0",
    plans: ["starter", "growth", "scale", "enterprise"]
  },
  {
    id: "agent_ledger",
    name: "Ledger",
    description: "Finance reconciliation agent that matches invoices, detects anomalies and posts corrections with an audit trail.",
    category: "Finance",
    version: "1.9.2",
    plans: ["scale", "enterprise"]
  },
  {
    id: "agent_atlas",
    name: "Atlas",
    description: "Data platform agent that monitors pipelines, auto-remediates schema drift and surfaces cost anomalies.",
    category: "Data",
    version: "4.0.0",
    plans: ["scale", "enterprise"]
  },
  {
    id: "agent_mercator",
    name: "Mercator",
    description: "Support triage agent that routes tickets, drafts first responses and escalates to human operators with full context.",
    category: "Customer Care",
    version: "2.2.8",
    plans: ["starter", "growth", "scale", "enterprise"]
  },
  {
    id: "agent_vanguard",
    name: "Vanguard",
    description: "SRE on-call agent that investigates production incidents, gathers evidence and recommends mitigation playbooks.",
    category: "Reliability",
    version: "1.4.0",
    plans: ["enterprise"]
  }
];
var SEED_NOW = "2026-09-09T00:00:00.000Z";
function monthlyFromSubscription(subscription) {
  return subscriptionToMonthlyArrangement(
    {
      id: `arr_${subscription.id}`,
      customerId: subscription.customerId,
      plan: subscription.plan,
      seats: subscription.seats,
      startedAt: subscription.startedAt,
      renewsAt: subscription.renewsAt,
      status: subscription.status
    },
    { now: SEED_NOW }
  );
}
__name(monthlyFromSubscription, "monthlyFromSubscription");
function grantFromLicense(license) {
  const revokedAt = license.status === "revoked" ? license.expiresAt ?? license.issuedAt : null;
  return {
    id: `grant_${license.id}`,
    customerId: license.customerId,
    agentProductId: license.agentProductId,
    startsAt: license.issuedAt,
    endsAt: license.expiresAt,
    createdAt: SEED_NOW,
    revokedAt,
    scheduledRevokeAt: null,
    activityEventId: `evt_migrate_${license.id}`,
    reasonForChange: `Migrated from legacy ${license.status} license.`
  };
}
__name(grantFromLicense, "grantFromLicense");
function migrationEventForSubscription(subscription, arrangement) {
  return {
    id: `evt_migrate_${subscription.id}`,
    occurredAt: SEED_NOW,
    source: "migration",
    type: "commercial.created",
    customerId: subscription.customerId,
    label: `Migrated ${subscription.plan} subscription to a monthly arrangement.`,
    subjectId: arrangement.id,
    resultingState: arrangement.status
  };
}
__name(migrationEventForSubscription, "migrationEventForSubscription");
function migrationEventForLicense(license, grant) {
  const revoked = license.status === "revoked";
  return {
    id: `evt_migrate_${license.id}`,
    occurredAt: SEED_NOW,
    source: "migration",
    type: revoked ? "access.revoked" : "access.granted",
    customerId: license.customerId,
    label: `Migrated ${license.status} license to an agent access grant.`,
    subjectId: grant.id,
    subjectId2: license.agentProductId,
    resultingState: revoked ? "revoked" : "active"
  };
}
__name(migrationEventForLicense, "migrationEventForLicense");
function seedCustomer(customer, featureEntitlements, subscriptions, agentLicenses, extraArrangements = [], extraEvents = [], extraGrants = [], extraLedgerTransactions = [], extraUsageRecords = []) {
  const commercialArrangements = subscriptions.map(monthlyFromSubscription);
  const agentAccessGrants = [
    ...agentLicenses.map(grantFromLicense),
    ...extraGrants
  ];
  const activityEvents = [
    ...subscriptions.map(
      (subscription, index) => migrationEventForSubscription(
        subscription,
        commercialArrangements[index]
      )
    ),
    ...agentLicenses.map(
      (license, index) => migrationEventForLicense(license, agentAccessGrants[index])
    ),
    ...extraEvents
  ];
  return {
    customer,
    featureEntitlements,
    commercialArrangements: [...commercialArrangements, ...extraArrangements],
    agentAccessGrants,
    activityEvents,
    ledgerTransactions: extraLedgerTransactions,
    usageRecords: extraUsageRecords
  };
}
__name(seedCustomer, "seedCustomer");
var SEED_CUSTOMERS = [
  seedCustomer(
    {
      id: "cust_northwind",
      name: "Northwind Trading",
      domain: "northwind.example",
      contact: "Ingrid Halvorsen",
      email: "ingrid.halvorsen@northwind.example",
      status: "active",
      notes: "Strategic retail account. Renewal negotiation scheduled for Q4. Careful about seat counts.",
      createdAt: "2023-03-14T09:30:00.000Z"
    },
    [
      {
        id: "fe_northwind_sso",
        customerId: "cust_northwind",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2023-03-14T09:30:00.000Z",
        expiresAt: null
      },
      {
        id: "fe_northwind_webhooks",
        customerId: "cust_northwind",
        feature: "webhooks",
        description: "Outbound webhooks for agent lifecycle events.",
        grantedAt: "2023-04-02T10:15:00.000Z",
        expiresAt: null
      }
    ],
    [
      {
        id: "sub_northwind_courier_growth",
        customerId: "cust_northwind",
        plan: "growth",
        agentProductId: "agent_courier",
        seats: 25,
        startedAt: "2023-03-14T09:30:00.000Z",
        renewsAt: "2026-03-14T09:30:00.000Z",
        status: "active"
      },
      {
        id: "sub_northwind_mercator_growth",
        customerId: "cust_northwind",
        plan: "growth",
        agentProductId: "agent_mercator",
        seats: 40,
        startedAt: "2023-06-01T12:00:00.000Z",
        renewsAt: "2026-06-01T12:00:00.000Z",
        status: "active"
      }
    ],
    [
      {
        id: "lic_northwind_courier",
        customerId: "cust_northwind",
        agentProductId: "agent_courier",
        seats: 25,
        issuedAt: "2023-03-14T09:30:00.000Z",
        expiresAt: "2027-03-14T09:30:00.000Z",
        status: "active"
      },
      {
        id: "lic_northwind_mercator",
        customerId: "cust_northwind",
        agentProductId: "agent_mercator",
        seats: 40,
        issuedAt: "2023-06-01T12:00:00.000Z",
        expiresAt: "2027-06-01T12:00:00.000Z",
        status: "active"
      }
    ]
  ),
  seedCustomer(
    {
      id: "cust_bluepeak",
      name: "Bluepeak Logistics",
      domain: "bluepeak.example",
      contact: "Marcus Oyelaran",
      email: "marcus.oyelaran@bluepeak.example",
      status: "active",
      notes: "High-volume logistics account. Runs Courier at scale across 12 regions; sensitive to latency SLAs.",
      createdAt: "2022-11-02T14:00:00.000Z"
    },
    [
      {
        id: "fe_bluepeak_sso",
        customerId: "cust_bluepeak",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2022-11-02T14:00:00.000Z",
        expiresAt: null
      },
      {
        id: "fe_bluepeak_audit_log",
        customerId: "cust_bluepeak",
        feature: "audit_log",
        description: "24-month immutable audit log export.",
        grantedAt: "2023-01-20T11:00:00.000Z",
        expiresAt: null
      },
      {
        id: "fe_bluepeak_priority",
        customerId: "cust_bluepeak",
        feature: "priority_support",
        description: "24x7 priority support channel with a named TAM.",
        grantedAt: "2024-02-15T08:00:00.000Z",
        expiresAt: "2026-02-15T08:00:00.000Z"
      }
    ],
    [
      {
        id: "sub_bluepeak_courier_enterprise",
        customerId: "cust_bluepeak",
        plan: "enterprise",
        agentProductId: "agent_courier",
        seats: 200,
        startedAt: "2022-11-02T14:00:00.000Z",
        renewsAt: "2026-11-02T14:00:00.000Z",
        status: "active"
      },
      {
        id: "sub_bluepeak_vanguard_enterprise",
        customerId: "cust_bluepeak",
        plan: "enterprise",
        agentProductId: "agent_vanguard",
        seats: 12,
        startedAt: "2024-02-15T08:00:00.000Z",
        renewsAt: "2026-02-15T08:00:00.000Z",
        status: "active"
      }
    ],
    [
      {
        id: "lic_bluepeak_courier",
        customerId: "cust_bluepeak",
        agentProductId: "agent_courier",
        seats: 200,
        issuedAt: "2022-11-02T14:00:00.000Z",
        expiresAt: "2026-11-02T14:00:00.000Z",
        status: "active"
      },
      {
        id: "lic_bluepeak_vanguard",
        customerId: "cust_bluepeak",
        agentProductId: "agent_vanguard",
        seats: 12,
        issuedAt: "2024-02-15T08:00:00.000Z",
        expiresAt: "2026-02-15T08:00:00.000Z",
        status: "expiring"
      }
    ]
  ),
  seedCustomer(
    {
      id: "cust_sablefin",
      name: "Sable & Finch",
      domain: "sablefinch.example",
      contact: "Priya Raman",
      email: "priya.raman@sablefinch.example",
      status: "evaluation",
      notes: "Fashion retailer evaluating Sentinel across two stores; alert-triage accuracy trial.",
      createdAt: "2026-07-28T16:20:00.000Z"
    },
    [
      {
        id: "fe_sablefin_sso",
        customerId: "cust_sablefin",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2026-07-28T16:20:00.000Z",
        expiresAt: "2026-08-27T16:20:00.000Z"
      }
    ],
    [
      {
        id: "sub_sablefin_sentinel_trial",
        customerId: "cust_sablefin",
        plan: "growth",
        agentProductId: "agent_sentinel",
        seats: 8,
        startedAt: "2026-07-28T16:20:00.000Z",
        renewsAt: "2026-08-27T16:20:00.000Z",
        status: "trialing"
      }
    ],
    [
      {
        id: "lic_sablefin_sentinel",
        customerId: "cust_sablefin",
        agentProductId: "agent_sentinel",
        seats: 8,
        issuedAt: "2026-07-28T16:20:00.000Z",
        expiresAt: "2026-08-27T16:20:00.000Z",
        status: "expiring"
      }
    ]
  ),
  seedCustomer(
    {
      id: "cust_orbitalworks",
      name: "Orbital Works",
      domain: "orbitalworks.example",
      contact: "Kenji Watanabe",
      email: "kenji.watanabe@orbitalworks.example",
      status: "active",
      notes: "Aerospace hardware manufacturer. Enterprise tier with Atlas for the data platform; expanding seat count in Q3.",
      createdAt: "2021-05-19T07:45:00.000Z"
    },
    [
      {
        id: "fe_orbitalworks_sso",
        customerId: "cust_orbitalworks",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2021-05-19T07:45:00.000Z",
        expiresAt: null
      },
      {
        id: "fe_orbitalworks_audit_log",
        customerId: "cust_orbitalworks",
        feature: "audit_log",
        description: "24-month immutable audit log export.",
        grantedAt: "2022-01-05T09:00:00.000Z",
        expiresAt: null
      },
      {
        id: "fe_orbitalworks_webhooks",
        customerId: "cust_orbitalworks",
        feature: "webhooks",
        description: "Outbound webhooks for agent lifecycle events.",
        grantedAt: "2022-01-05T09:00:00.000Z",
        expiresAt: null
      },
      {
        id: "fe_orbitalworks_priority",
        customerId: "cust_orbitalworks",
        feature: "priority_support",
        description: "24x7 priority support channel with a named TAM.",
        grantedAt: "2021-05-19T07:45:00.000Z",
        expiresAt: null
      }
    ],
    [
      {
        id: "sub_orbitalworks_atlas_enterprise",
        customerId: "cust_orbitalworks",
        plan: "enterprise",
        agentProductId: "agent_atlas",
        seats: 75,
        startedAt: "2021-05-19T07:45:00.000Z",
        renewsAt: "2026-05-19T07:45:00.000Z",
        status: "active"
      },
      {
        id: "sub_orbitalworks_ledger_scale",
        customerId: "cust_orbitalworks",
        plan: "scale",
        agentProductId: "agent_ledger",
        seats: 15,
        startedAt: "2023-09-10T10:00:00.000Z",
        renewsAt: "2026-09-10T10:00:00.000Z",
        status: "active"
      }
    ],
    [
      {
        id: "lic_orbitalworks_atlas",
        customerId: "cust_orbitalworks",
        agentProductId: "agent_atlas",
        seats: 75,
        issuedAt: "2021-05-19T07:45:00.000Z",
        expiresAt: "2026-05-19T07:45:00.000Z",
        status: "active"
      },
      {
        id: "lic_orbitalworks_ledger",
        customerId: "cust_orbitalworks",
        agentProductId: "agent_ledger",
        seats: 15,
        issuedAt: "2023-09-10T10:00:00.000Z",
        expiresAt: "2026-09-10T10:00:00.000Z",
        status: "active"
      }
    ]
  ),
  seedCustomer(
    {
      id: "cust_meridians",
      name: "Meridians Health",
      domain: "meridians.example",
      contact: "Dr. Amara Osei",
      email: "amara.osei@meridians.example",
      status: "paused",
      notes: "Healthcare network paused during a system consolidation. Contract is valid; expect reactivation in two quarters.",
      createdAt: "2022-04-11T13:00:00.000Z"
    },
    [
      {
        id: "fe_meridians_sso",
        customerId: "cust_meridians",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2022-04-11T13:00:00.000Z",
        expiresAt: null
      },
      {
        id: "fe_meridians_webhooks",
        customerId: "cust_meridians",
        feature: "webhooks",
        description: "Outbound webhooks for agent lifecycle events.",
        grantedAt: "2022-08-01T09:00:00.000Z",
        expiresAt: null
      }
    ],
    [
      {
        id: "sub_meridians_mercator_scale",
        customerId: "cust_meridians",
        plan: "scale",
        agentProductId: "agent_mercator",
        seats: 60,
        startedAt: "2022-04-11T13:00:00.000Z",
        renewsAt: "2026-04-11T13:00:00.000Z",
        status: "cancelled"
      }
    ],
    [
      {
        id: "lic_meridians_mercator",
        customerId: "cust_meridians",
        agentProductId: "agent_mercator",
        seats: 60,
        issuedAt: "2022-04-11T13:00:00.000Z",
        expiresAt: "2026-04-11T13:00:00.000Z",
        status: "expired"
      }
    ],
    [
      {
        id: "arr_meridians_prepaid",
        customerId: "cust_meridians",
        status: "active",
        model: "prepaid",
        warningThresholdTokens: 100,
        effectiveFrom: "2026-04-11T13:00:00.000Z",
        effectiveTo: null,
        replacedByArrangementId: null,
        expiresAt: null,
        createdAt: "2026-04-11T13:00:00.000Z",
        reason: "Prepaid balance loaded during the consolidation pause."
      },
      {
        id: "arr_meridians_monthly_scheduled",
        customerId: "cust_meridians",
        status: "scheduled",
        model: "monthly",
        currency: "USD",
        billingCadence: "monthly",
        monthlyAmountCents: 14900,
        effectiveFrom: "2026-12-01T00:00:00.000Z",
        effectiveTo: null,
        replacedByArrangementId: null,
        renewsAt: "2027-12-01T00:00:00.000Z",
        createdAt: "2026-09-01T09:00:00.000Z",
        reason: "Scheduled migration from prepaid balance to monthly subscription."
      }
    ],
    [
      {
        id: "evt_meridians_prepaid",
        occurredAt: "2026-04-11T13:00:00.000Z",
        source: "operator",
        type: "commercial.created",
        customerId: "cust_meridians",
        label: "Activated prepaid balance.",
        subjectId: "arr_meridians_prepaid",
        resultingState: "active"
      },
      {
        id: "evt_arr_meridians_monthly_scheduled",
        occurredAt: "2026-09-01T09:00:00.000Z",
        source: "operator",
        type: "commercial.created",
        customerId: "cust_meridians",
        label: "Scheduled monthly subscription after prepaid balance.",
        subjectId: "arr_meridians_monthly_scheduled",
        resultingState: "scheduled"
      },
      {
        id: "evt_grant_meridians_sentinel",
        occurredAt: "2026-08-01T00:00:00.000Z",
        source: "operator",
        type: "access.granted",
        customerId: "cust_meridians",
        label: 'Granted access to agent product "agent_sentinel".',
        subjectId: "grant_meridians_sentinel",
        subjectId2: "agent_sentinel",
        resultingState: "active"
      }
    ],
    [
      {
        id: "grant_meridians_sentinel",
        customerId: "cust_meridians",
        agentProductId: "agent_sentinel",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        revokedAt: null,
        scheduledRevokeAt: "2026-10-01T00:00:00.000Z",
        activityEventId: "evt_grant_meridians_sentinel",
        reasonForChange: "Scheduled revocation during consolidation review."
      }
    ],
    [
      {
        id: openingCreditTransactionId("arr_meridians_prepaid"),
        customerId: "cust_meridians",
        occurredAt: "2026-04-11T13:00:00.000Z",
        kind: "credit_grant",
        amountTokens: 25e4,
        reason: "Opening token credit from prototype migration",
        reference: openingCreditReference("arr_meridians_prepaid")
      },
      {
        id: usageDebitTransactionId("usage_meridians_may_001"),
        customerId: "cust_meridians",
        occurredAt: "2026-05-14T09:15:00.000Z",
        kind: "usage_debit",
        amountTokens: -1200,
        reason: "Agent usage.",
        reference: "usage_meridians_may_001",
        usageRecordId: usageRecordId("usage_meridians_may_001"),
        agentProductId: "agent_sentinel"
      },
      {
        id: usageDebitTransactionId("usage_meridians_jun_002"),
        customerId: "cust_meridians",
        occurredAt: "2026-06-02T14:30:00.000Z",
        kind: "usage_debit",
        amountTokens: -800,
        reason: "Agent usage.",
        reference: "usage_meridians_jun_002",
        usageRecordId: usageRecordId("usage_meridians_jun_002"),
        agentProductId: "agent_mercator"
      },
      {
        id: usageDebitTransactionId("usage_meridians_jun_003"),
        customerId: "cust_meridians",
        occurredAt: "2026-06-20T11:00:00.000Z",
        kind: "usage_debit",
        amountTokens: -1500,
        reason: "Agent usage.",
        reference: "usage_meridians_jun_003",
        usageRecordId: usageRecordId("usage_meridians_jun_003"),
        agentProductId: "agent_sentinel"
      },
      {
        id: reversalTransactionId(usageDebitTransactionId("usage_meridians_jun_003")),
        customerId: "cust_meridians",
        occurredAt: "2026-06-21T08:45:00.000Z",
        kind: "reversal",
        amountTokens: 1500,
        reason: "Reversing duplicate usage debit.",
        reference: "rev_usage_meridians_jun_003",
        reversesTransactionId: usageDebitTransactionId("usage_meridians_jun_003")
      },
      {
        id: creditGrantTransactionId("cust_meridians", "2026-07-01T09:00:00.000Z"),
        customerId: "cust_meridians",
        occurredAt: "2026-07-01T09:00:00.000Z",
        kind: "credit_grant",
        amountTokens: 2e3,
        reason: "Operator-confirmed token credit",
        reference: "credit_meridians_jul_001"
      }
    ],
    [
      {
        id: usageRecordId("usage_meridians_may_001"),
        customerId: "cust_meridians",
        agentProductId: "agent_sentinel",
        occurredAt: "2026-05-14T09:15:00.000Z",
        tokenQuantity: 1200,
        sourceReference: "usage_meridians_may_001",
        ledgerTransactionId: usageDebitTransactionId("usage_meridians_may_001")
      },
      {
        id: usageRecordId("usage_meridians_jun_002"),
        customerId: "cust_meridians",
        agentProductId: "agent_mercator",
        occurredAt: "2026-06-02T14:30:00.000Z",
        tokenQuantity: 800,
        sourceReference: "usage_meridians_jun_002",
        ledgerTransactionId: usageDebitTransactionId("usage_meridians_jun_002")
      },
      {
        id: usageRecordId("usage_meridians_jun_003"),
        customerId: "cust_meridians",
        agentProductId: "agent_sentinel",
        occurredAt: "2026-06-20T11:00:00.000Z",
        tokenQuantity: 1500,
        sourceReference: "usage_meridians_jun_003",
        ledgerTransactionId: usageDebitTransactionId("usage_meridians_jun_003")
      }
    ]
  ),
  seedCustomer(
    {
      id: "cust_greyharbor",
      name: "Grey Harbor Media",
      domain: "greyharbor.example",
      contact: "Sofia Delgado",
      email: "sofia.delgado@greyharbor.example",
      status: "churned",
      notes: "Content studio churned last quarter after consolidating vendors. Closeout documentation archived.",
      createdAt: "2021-10-05T15:30:00.000Z"
    },
    [
      {
        id: "fe_greyharbor_sso",
        customerId: "cust_greyharbor",
        feature: "sso",
        description: "SAML single sign-on for all agent consoles.",
        grantedAt: "2021-10-05T15:30:00.000Z",
        expiresAt: null
      }
    ],
    [
      {
        id: "sub_greyharbor_mercator_growth",
        customerId: "cust_greyharbor",
        plan: "growth",
        agentProductId: "agent_mercator",
        seats: 12,
        startedAt: "2021-10-05T15:30:00.000Z",
        renewsAt: "2025-10-05T15:30:00.000Z",
        status: "cancelled"
      }
    ],
    [
      {
        id: "lic_greyharbor_mercator",
        customerId: "cust_greyharbor",
        agentProductId: "agent_mercator",
        seats: 12,
        issuedAt: "2021-10-05T15:30:00.000Z",
        expiresAt: "2025-10-05T15:30:00.000Z",
        status: "revoked"
      }
    ],
    [
      {
        id: "arr_greyharbor_annual",
        customerId: "cust_greyharbor",
        status: "ended",
        model: "annual",
        currency: "USD",
        contractValueCents: 12e5,
        effectiveFrom: "2021-10-05T15:30:00.000Z",
        effectiveTo: "2024-10-05T15:30:00.000Z",
        replacedByArrangementId: null,
        startsAt: "2021-10-05T15:30:00.000Z",
        endsAt: "2024-10-05T15:30:00.000Z",
        renewalStatus: "non-renewing",
        includedAllowance: 5e5,
        allowanceUnit: "tokens",
        overageRateCentsPerUnit: 2,
        createdAt: "2021-10-05T15:30:00.000Z",
        reason: "Annual contract completed at closeout."
      },
      {
        id: "arr_greyharbor_monthly_terminated",
        customerId: "cust_greyharbor",
        status: "terminated",
        model: "monthly",
        currency: "USD",
        billingCadence: "monthly",
        monthlyAmountCents: 14900,
        effectiveFrom: "2024-10-05T15:30:00.000Z",
        effectiveTo: "2025-06-01T00:00:00.000Z",
        replacedByArrangementId: null,
        renewsAt: "2025-06-01T00:00:00.000Z",
        createdAt: "2024-10-05T15:30:00.000Z",
        reason: "Terminated during vendor consolidation."
      }
    ],
    [
      {
        id: "evt_greyharbor_annual",
        occurredAt: "2021-10-05T15:30:00.000Z",
        source: "operator",
        type: "commercial.created",
        customerId: "cust_greyharbor",
        label: "Started annual contract.",
        subjectId: "arr_greyharbor_annual",
        resultingState: "ended"
      },
      {
        id: "evt_arr_greyharbor_monthly_terminated",
        occurredAt: "2025-06-01T00:00:00.000Z",
        source: "operator",
        type: "commercial.terminated",
        customerId: "cust_greyharbor",
        label: "Terminated monthly commercial arrangement.",
        subjectId: "arr_greyharbor_monthly_terminated",
        resultingState: "terminated"
      },
      {
        id: "evt_grant_greyharbor_sentinel_revoked",
        occurredAt: "2025-06-01T00:00:00.000Z",
        source: "system",
        type: "access.revoked",
        customerId: "cust_greyharbor",
        label: "Access revoked automatically because no commercial arrangement is active.",
        subjectId: "grant_greyharbor_sentinel",
        subjectId2: "agent_sentinel",
        resultingState: "revoked",
        causationId: "evt_arr_greyharbor_monthly_terminated"
      }
    ],
    [
      {
        id: "grant_greyharbor_sentinel",
        customerId: "cust_greyharbor",
        agentProductId: "agent_sentinel",
        startsAt: "2024-10-05T15:30:00.000Z",
        endsAt: null,
        createdAt: "2024-10-05T15:30:00.000Z",
        revokedAt: "2025-06-01T00:00:00.000Z",
        scheduledRevokeAt: null,
        activityEventId: "evt_grant_greyharbor_sentinel",
        reasonForChange: "Revoked automatically after arrangement termination."
      }
    ]
  )
];
function buildSeedStore() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    customers: SEED_CUSTOMERS.map((s) => s.customer),
    featureEntitlements: SEED_CUSTOMERS.flatMap(
      (s) => s.featureEntitlements
    ),
    agentProducts: [...AGENT_PRODUCTS],
    commercialArrangements: SEED_CUSTOMERS.flatMap(
      (s) => s.commercialArrangements
    ),
    agentAccessGrants: SEED_CUSTOMERS.flatMap((s) => s.agentAccessGrants),
    activityEvents: SEED_CUSTOMERS.flatMap((s) => s.activityEvents),
    ledgerTransactions: SEED_CUSTOMERS.flatMap((s) => s.ledgerTransactions),
    usageRecords: SEED_CUSTOMERS.flatMap((s) => s.usageRecords)
  };
}
__name(buildSeedStore, "buildSeedStore");

// worker/src/db.ts
function auditEntryId(action, subjectId, occurredAt) {
  return `audit_${action}_${subjectId}_${occurredAt}`;
}
__name(auditEntryId, "auditEntryId");
function buildAuditEntry(input) {
  return {
    id: auditEntryId(input.action, input.subjectId, input.occurredAt),
    occurredAt: input.occurredAt,
    operatorEmail: input.identity.email,
    operatorSub: input.identity.sub,
    action: input.action,
    customerId: input.customerId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    summary: input.summary,
    beforeJson: input.before === void 0 ? null : JSON.stringify(input.before),
    afterJson: input.after === void 0 ? null : JSON.stringify(input.after)
  };
}
__name(buildAuditEntry, "buildAuditEntry");
function mapCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    contact: row.contact,
    email: row.email,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at
  };
}
__name(mapCustomer, "mapCustomer");
function mapCommercialArrangement(row) {
  const base = {
    id: row.id,
    customerId: row.customer_id,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    reason: row.reason,
    replacedByArrangementId: row.replaced_by_arrangement_id
  };
  if (row.model === "monthly") {
    return {
      ...base,
      model: "monthly",
      currency: "USD",
      billingCadence: "monthly",
      monthlyAmountCents: row.monthly_amount_cents ?? 0,
      renewsAt: row.renews_at ?? ""
    };
  }
  if (row.model === "prepaid") {
    return {
      ...base,
      model: "prepaid",
      warningThresholdTokens: row.warning_threshold_tokens ?? 100,
      expiresAt: row.expires_at,
      notes: row.notes ?? void 0
    };
  }
  return {
    ...base,
    model: "annual",
    currency: "USD",
    contractValueCents: row.contract_value_cents ?? 0,
    startsAt: row.starts_at ?? "",
    endsAt: row.ends_at ?? "",
    renewalStatus: row.renewal_status ?? "unknown",
    notes: row.notes ?? void 0,
    includedAllowance: row.included_allowance ?? 0,
    allowanceUnit: row.allowance_unit ?? "other",
    overageRateCentsPerUnit: row.overage_rate_cents_per_unit ?? 0
  };
}
__name(mapCommercialArrangement, "mapCommercialArrangement");
function mapAgentAccessGrant(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    agentProductId: row.agent_product_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    scheduledRevokeAt: row.scheduled_revoke_at,
    activityEventId: row.activity_event_id ?? "",
    reasonForChange: row.reason_for_change
  };
}
__name(mapAgentAccessGrant, "mapAgentAccessGrant");
function mapActivityEvent(row) {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    source: row.source,
    type: row.type,
    customerId: row.customer_id,
    label: row.label,
    subjectId: row.subject_id,
    subjectId2: row.subject_id2 ?? void 0,
    resultingState: row.resulting_state,
    causationId: row.causation_id ?? void 0
  };
}
__name(mapActivityEvent, "mapActivityEvent");
function mapLedgerTransaction(row) {
  const base = {
    id: row.id,
    customerId: row.customer_id,
    occurredAt: row.occurred_at,
    amountTokens: row.amount_tokens,
    reason: row.reason,
    reference: row.reference
  };
  if (row.kind === "credit_grant") {
    return { ...base, kind: "credit_grant" };
  }
  if (row.kind === "usage_debit") {
    return {
      ...base,
      kind: "usage_debit",
      usageRecordId: row.usage_record_id ?? "",
      agentProductId: row.agent_product_id ?? ""
    };
  }
  if (row.kind === "manual_adjustment") {
    return { ...base, kind: "manual_adjustment" };
  }
  return {
    ...base,
    kind: "reversal",
    reversesTransactionId: row.reverses_transaction_id ?? ""
  };
}
__name(mapLedgerTransaction, "mapLedgerTransaction");
function mapUsageRecord(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    agentProductId: row.agent_product_id,
    occurredAt: row.occurred_at,
    tokenQuantity: row.token_quantity,
    sourceReference: row.source_reference,
    ledgerTransactionId: row.ledger_transaction_id
  };
}
__name(mapUsageRecord, "mapUsageRecord");
function mapAuditEntry(row) {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    operatorEmail: row.operator_email,
    operatorSub: row.operator_sub,
    action: row.action,
    customerId: row.customer_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    summary: row.summary,
    beforeJson: row.before_json,
    afterJson: row.after_json
  };
}
__name(mapAuditEntry, "mapAuditEntry");
function mapFeatureEntitlement(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    feature: row.feature,
    description: row.description,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at
  };
}
__name(mapFeatureEntitlement, "mapFeatureEntitlement");
function mapAgentProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    version: row.version,
    plans: JSON.parse(row.plans_json)
  };
}
__name(mapAgentProduct, "mapAgentProduct");
async function listCustomers(db, status) {
  const result = status ? await db.prepare("SELECT * FROM customers WHERE status = ? ORDER BY name").bind(status).all() : await db.prepare("SELECT * FROM customers ORDER BY name").all();
  return result.results.map(mapCustomer);
}
__name(listCustomers, "listCustomers");
async function getCustomer(db, id) {
  const row = await db.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first();
  return row ? mapCustomer(row) : null;
}
__name(getCustomer, "getCustomer");
async function listAuditEntries(db, customerId) {
  const result = customerId ? await db.prepare(
    "SELECT * FROM audit_entries WHERE customer_id = ? ORDER BY occurred_at DESC, id DESC"
  ).bind(customerId).all() : await db.prepare("SELECT * FROM audit_entries ORDER BY occurred_at DESC, id DESC").all();
  return result.results.map(mapAuditEntry);
}
__name(listAuditEntries, "listAuditEntries");
async function listAgentProducts(db) {
  const result = await db.prepare("SELECT * FROM agent_products ORDER BY name").all();
  return result.results.map(mapAgentProduct);
}
__name(listAgentProducts, "listAgentProducts");
async function getAgentProduct(db, id) {
  const row = await db.prepare("SELECT * FROM agent_products WHERE id = ?").bind(id).first();
  return row ? mapAgentProduct(row) : null;
}
__name(getAgentProduct, "getAgentProduct");
async function loadCustomerStore(db, customerId) {
  const [customers, arrangements, grants, events, ledger, usage, entitlements, products] = await Promise.all([
    db.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).all(),
    db.prepare("SELECT * FROM commercial_arrangements WHERE customer_id = ?").bind(customerId).all(),
    db.prepare("SELECT * FROM agent_access_grants WHERE customer_id = ?").bind(customerId).all(),
    db.prepare("SELECT * FROM activity_events WHERE customer_id = ?").bind(customerId).all(),
    db.prepare("SELECT * FROM ledger_transactions WHERE customer_id = ?").bind(customerId).all(),
    db.prepare("SELECT * FROM usage_records WHERE customer_id = ?").bind(customerId).all(),
    db.prepare("SELECT * FROM feature_entitlements WHERE customer_id = ?").bind(customerId).all(),
    db.prepare("SELECT * FROM agent_products").all()
  ]);
  return {
    schemaVersion: 4,
    customers: customers.results.map(mapCustomer),
    commercialArrangements: arrangements.results.map(mapCommercialArrangement),
    agentAccessGrants: grants.results.map(mapAgentAccessGrant),
    activityEvents: events.results.map(mapActivityEvent),
    ledgerTransactions: ledger.results.map(mapLedgerTransaction),
    usageRecords: usage.results.map(mapUsageRecord),
    featureEntitlements: entitlements.results.map(mapFeatureEntitlement),
    agentProducts: products.results.map(mapAgentProduct)
  };
}
__name(loadCustomerStore, "loadCustomerStore");
function insertCustomerStatement(db, customer) {
  return db.prepare(
    "INSERT INTO customers (id, name, domain, contact, email, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    customer.id,
    customer.name,
    customer.domain,
    customer.contact,
    customer.email,
    customer.status,
    customer.notes,
    customer.createdAt
  );
}
__name(insertCustomerStatement, "insertCustomerStatement");
function updateCustomerStatement(db, customer) {
  return db.prepare(
    "UPDATE customers SET name = ?, domain = ?, contact = ?, email = ?, status = ?, notes = ?, created_at = ? WHERE id = ?"
  ).bind(
    customer.name,
    customer.domain,
    customer.contact,
    customer.email,
    customer.status,
    customer.notes,
    customer.createdAt,
    customer.id
  );
}
__name(updateCustomerStatement, "updateCustomerStatement");
function arrangementToRow(arrangement) {
  const base = {
    id: arrangement.id,
    customer_id: arrangement.customerId,
    model: arrangement.model,
    status: arrangement.status,
    effective_from: arrangement.effectiveFrom,
    effective_to: arrangement.effectiveTo,
    created_at: arrangement.createdAt,
    reason: arrangement.reason,
    replaced_by_arrangement_id: arrangement.replacedByArrangementId,
    currency: null,
    billing_cadence: null,
    monthly_amount_cents: null,
    renews_at: null,
    warning_threshold_tokens: null,
    expires_at: null,
    notes: null,
    contract_value_cents: null,
    starts_at: null,
    ends_at: null,
    renewal_status: null,
    included_allowance: null,
    allowance_unit: null,
    overage_rate_cents_per_unit: null
  };
  if (arrangement.model === "monthly") {
    return {
      ...base,
      currency: arrangement.currency,
      billing_cadence: arrangement.billingCadence,
      monthly_amount_cents: arrangement.monthlyAmountCents,
      renews_at: arrangement.renewsAt
    };
  }
  if (arrangement.model === "prepaid") {
    return {
      ...base,
      warning_threshold_tokens: arrangement.warningThresholdTokens,
      expires_at: arrangement.expiresAt,
      notes: arrangement.notes ?? null
    };
  }
  return {
    ...base,
    contract_value_cents: arrangement.contractValueCents,
    starts_at: arrangement.startsAt,
    ends_at: arrangement.endsAt,
    renewal_status: arrangement.renewalStatus,
    notes: arrangement.notes ?? null,
    included_allowance: arrangement.includedAllowance,
    allowance_unit: arrangement.allowanceUnit,
    overage_rate_cents_per_unit: arrangement.overageRateCentsPerUnit
  };
}
__name(arrangementToRow, "arrangementToRow");
var ARRANGEMENT_COLUMNS = "id, customer_id, model, status, effective_from, effective_to, created_at, reason, replaced_by_arrangement_id, currency, billing_cadence, monthly_amount_cents, renews_at, warning_threshold_tokens, expires_at, notes, contract_value_cents, starts_at, ends_at, renewal_status, included_allowance, allowance_unit, overage_rate_cents_per_unit";
function insertCommercialArrangementStatement(db, arrangement) {
  const row = arrangementToRow(arrangement);
  return db.prepare(
    `INSERT INTO commercial_arrangements (${ARRANGEMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    row.id,
    row.customer_id,
    row.model,
    row.status,
    row.effective_from,
    row.effective_to,
    row.created_at,
    row.reason,
    row.replaced_by_arrangement_id,
    row.currency,
    row.billing_cadence,
    row.monthly_amount_cents,
    row.renews_at,
    row.warning_threshold_tokens,
    row.expires_at,
    row.notes,
    row.contract_value_cents,
    row.starts_at,
    row.ends_at,
    row.renewal_status,
    row.included_allowance,
    row.allowance_unit,
    row.overage_rate_cents_per_unit
  );
}
__name(insertCommercialArrangementStatement, "insertCommercialArrangementStatement");
function updateCommercialArrangementStatement(db, arrangement) {
  const row = arrangementToRow(arrangement);
  return db.prepare(
    `UPDATE commercial_arrangements SET customer_id = ?, model = ?, status = ?, effective_from = ?, effective_to = ?, created_at = ?, reason = ?, replaced_by_arrangement_id = ?, currency = ?, billing_cadence = ?, monthly_amount_cents = ?, renews_at = ?, warning_threshold_tokens = ?, expires_at = ?, notes = ?, contract_value_cents = ?, starts_at = ?, ends_at = ?, renewal_status = ?, included_allowance = ?, allowance_unit = ?, overage_rate_cents_per_unit = ? WHERE id = ?`
  ).bind(
    row.customer_id,
    row.model,
    row.status,
    row.effective_from,
    row.effective_to,
    row.created_at,
    row.reason,
    row.replaced_by_arrangement_id,
    row.currency,
    row.billing_cadence,
    row.monthly_amount_cents,
    row.renews_at,
    row.warning_threshold_tokens,
    row.expires_at,
    row.notes,
    row.contract_value_cents,
    row.starts_at,
    row.ends_at,
    row.renewal_status,
    row.included_allowance,
    row.allowance_unit,
    row.overage_rate_cents_per_unit,
    row.id
  );
}
__name(updateCommercialArrangementStatement, "updateCommercialArrangementStatement");
function insertAgentAccessGrantStatement(db, grant) {
  return db.prepare(
    "INSERT INTO agent_access_grants (id, customer_id, agent_product_id, starts_at, ends_at, created_at, revoked_at, scheduled_revoke_at, activity_event_id, reason_for_change) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    grant.id,
    grant.customerId,
    grant.agentProductId,
    grant.startsAt,
    grant.endsAt,
    grant.createdAt,
    grant.revokedAt,
    grant.scheduledRevokeAt,
    grant.activityEventId,
    grant.reasonForChange
  );
}
__name(insertAgentAccessGrantStatement, "insertAgentAccessGrantStatement");
function updateAgentAccessGrantStatement(db, grant) {
  return db.prepare(
    "UPDATE agent_access_grants SET customer_id = ?, agent_product_id = ?, starts_at = ?, ends_at = ?, created_at = ?, revoked_at = ?, scheduled_revoke_at = ?, activity_event_id = ?, reason_for_change = ? WHERE id = ?"
  ).bind(
    grant.customerId,
    grant.agentProductId,
    grant.startsAt,
    grant.endsAt,
    grant.createdAt,
    grant.revokedAt,
    grant.scheduledRevokeAt,
    grant.activityEventId,
    grant.reasonForChange,
    grant.id
  );
}
__name(updateAgentAccessGrantStatement, "updateAgentAccessGrantStatement");
function insertActivityEventStatement(db, event) {
  return db.prepare(
    "INSERT INTO activity_events (id, occurred_at, source, type, customer_id, label, subject_id, subject_id2, resulting_state, causation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    event.id,
    event.occurredAt,
    event.source,
    event.type,
    event.customerId,
    event.label,
    event.subjectId,
    event.subjectId2 ?? null,
    event.resultingState,
    event.causationId ?? null
  );
}
__name(insertActivityEventStatement, "insertActivityEventStatement");
function insertLedgerTransactionStatement(db, transaction) {
  return db.prepare(
    "INSERT INTO ledger_transactions (id, customer_id, occurred_at, kind, amount_tokens, reason, reference, usage_record_id, agent_product_id, reverses_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    transaction.id,
    transaction.customerId,
    transaction.occurredAt,
    transaction.kind,
    transaction.amountTokens,
    transaction.reason,
    transaction.reference,
    transaction.kind === "usage_debit" ? transaction.usageRecordId : null,
    transaction.kind === "usage_debit" ? transaction.agentProductId : null,
    transaction.kind === "reversal" ? transaction.reversesTransactionId : null
  );
}
__name(insertLedgerTransactionStatement, "insertLedgerTransactionStatement");
function insertUsageRecordStatement(db, usage) {
  return db.prepare(
    "INSERT INTO usage_records (id, customer_id, agent_product_id, occurred_at, token_quantity, source_reference, ledger_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    usage.id,
    usage.customerId,
    usage.agentProductId,
    usage.occurredAt,
    usage.tokenQuantity,
    usage.sourceReference,
    usage.ledgerTransactionId
  );
}
__name(insertUsageRecordStatement, "insertUsageRecordStatement");
function insertAuditEntryStatement(db, audit) {
  return db.prepare(
    "INSERT INTO audit_entries (id, occurred_at, operator_email, operator_sub, action, customer_id, subject_type, subject_id, summary, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    audit.id,
    audit.occurredAt,
    audit.operatorEmail,
    audit.operatorSub,
    audit.action,
    audit.customerId,
    audit.subjectType,
    audit.subjectId,
    audit.summary,
    audit.beforeJson,
    audit.afterJson
  );
}
__name(insertAuditEntryStatement, "insertAuditEntryStatement");
function insertAgentProductStatement(db, product) {
  return db.prepare(
    "INSERT OR IGNORE INTO agent_products (id, name, description, category, version, plans_json) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(
    product.id,
    product.name,
    product.description,
    product.category,
    product.version,
    JSON.stringify(product.plans)
  );
}
__name(insertAgentProductStatement, "insertAgentProductStatement");
function recordsEqual(a, b) {
  const keys = /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
__name(recordsEqual, "recordsEqual");
function diffCollection(before, after) {
  const beforeById = new Map(before.map((record) => [record.id, record]));
  const inserted = [];
  const updated = [];
  for (const record of after) {
    const prior = beforeById.get(record.id);
    if (prior === void 0) {
      inserted.push(record);
    } else if (!recordsEqual(
      prior,
      record
    )) {
      updated.push(record);
    }
  }
  return { inserted, updated };
}
__name(diffCollection, "diffCollection");
function diffStores(before, after) {
  const beforeEventIds = new Set(before.activityEvents.map((event) => event.id));
  return {
    customers: diffCollection(before.customers, after.customers),
    commercialArrangements: diffCollection(
      before.commercialArrangements,
      after.commercialArrangements
    ),
    agentAccessGrants: diffCollection(
      before.agentAccessGrants,
      after.agentAccessGrants
    ),
    activityEvents: {
      inserted: after.activityEvents.filter(
        (event) => !beforeEventIds.has(event.id)
      )
    },
    ledgerTransactions: diffCollection(
      before.ledgerTransactions,
      after.ledgerTransactions
    ),
    usageRecords: diffCollection(before.usageRecords, after.usageRecords)
  };
}
__name(diffStores, "diffStores");
async function commitStoreDiff(db, diff, audit) {
  if (diff.ledgerTransactions.updated.length > 0) {
    throw new Error("Ledger transactions are append-only; updates are forbidden.");
  }
  if (diff.usageRecords.updated.length > 0) {
    throw new Error("Usage records are append-only; updates are forbidden.");
  }
  const statements = [];
  for (const customer of diff.customers.inserted) {
    statements.push(insertCustomerStatement(db, customer));
  }
  for (const customer of diff.customers.updated) {
    statements.push(updateCustomerStatement(db, customer));
  }
  for (const arrangement of diff.commercialArrangements.inserted) {
    statements.push(insertCommercialArrangementStatement(db, arrangement));
  }
  for (const arrangement of diff.commercialArrangements.updated) {
    statements.push(updateCommercialArrangementStatement(db, arrangement));
  }
  for (const grant of diff.agentAccessGrants.inserted) {
    statements.push(insertAgentAccessGrantStatement(db, grant));
  }
  for (const grant of diff.agentAccessGrants.updated) {
    statements.push(updateAgentAccessGrantStatement(db, grant));
  }
  for (const event of diff.activityEvents.inserted) {
    statements.push(insertActivityEventStatement(db, event));
  }
  for (const transaction of diff.ledgerTransactions.inserted) {
    statements.push(insertLedgerTransactionStatement(db, transaction));
  }
  for (const usage of diff.usageRecords.inserted) {
    statements.push(insertUsageRecordStatement(db, usage));
  }
  statements.push(insertAuditEntryStatement(db, audit));
  await db.batch(statements);
}
__name(commitStoreDiff, "commitStoreDiff");
async function seedCatalog(db) {
  const statements = AGENT_PRODUCTS.map(
    (product) => insertAgentProductStatement(db, product)
  );
  if (statements.length > 0) {
    await db.batch(statements);
  }
}
__name(seedCatalog, "seedCatalog");

// worker/src/index.ts
var ApiError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
  static {
    __name(this, "ApiError");
  }
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
__name(json, "json");
function errorResponse(status, code, message) {
  return json({ error: { code, message } }, status);
}
__name(errorResponse, "errorResponse");
async function readJson(request) {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("Body must be a JSON object.");
    }
    return body;
  } catch {
    throw new ApiError(
      400,
      "validation-error",
      "Request body must be a JSON object."
    );
  }
}
__name(readJson, "readJson");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function bodyTimestamp(body) {
  return typeof body.occurredAt === "string" && body.occurredAt.length > 0 ? body.occurredAt : nowIso();
}
__name(bodyTimestamp, "bodyTimestamp");
function requireString(body, key) {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, "validation-error", `${key} is required.`);
  }
  return value.trim();
}
__name(requireString, "requireString");
function guardConflict(fn) {
  try {
    return fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rule validation failed.";
    throw new ApiError(409, "conflict", message);
  }
}
__name(guardConflict, "guardConflict");
function requireCustomer(store, customerId) {
  const customer = store.customers.find((c) => c.id === customerId);
  if (!customer) {
    throw new ApiError(
      404,
      "not-found",
      `Customer "${customerId}" does not exist.`
    );
  }
  return customer;
}
__name(requireCustomer, "requireCustomer");
function requireNotArchived(customer) {
  if (customer.status === "archived") {
    throw new ApiError(
      409,
      "conflict",
      `Customer "${customer.id}" is archived; new usage, credit, and access changes are not allowed.`
    );
  }
  return customer;
}
__name(requireNotArchived, "requireNotArchived");
function requireActivePrepaid(store, customerId, occurredAt) {
  const active = projectCommercialState(
    store.commercialArrangements,
    occurredAt
  ).active;
  if (!active || active.model !== "prepaid") {
    throw new ApiError(
      409,
      "conflict",
      `Customer "${customerId}" does not have an active prepaid arrangement.`
    );
  }
  return active;
}
__name(requireActivePrepaid, "requireActivePrepaid");
var catalogSeedPromise = null;
function ensureCatalogSeeded(env) {
  if (catalogSeedPromise === null) {
    catalogSeedPromise = seedCatalog(env.DB).catch((error) => {
      catalogSeedPromise = null;
      throw error;
    });
  }
  return catalogSeedPromise;
}
__name(ensureCatalogSeeded, "ensureCatalogSeeded");
async function handleCreateCustomer(request, env, identity) {
  const body = await readJson(request);
  const id = requireString(body, "id");
  const name = requireString(body, "name");
  const domain = requireString(body, "domain");
  const contact = requireString(body, "contact");
  const email = requireString(body, "email");
  const status = normalizeCustomerStatus(body.status);
  const notes = typeof body.notes === "string" ? body.notes : "";
  const createdAt = bodyTimestamp(body);
  const existing = await getCustomer(env.DB, id);
  if (existing) {
    throw new ApiError(
      409,
      "conflict",
      `Customer with id "${id}" already exists.`
    );
  }
  const customer = {
    id,
    name,
    domain,
    contact,
    email,
    status,
    notes,
    createdAt
  };
  const before = await loadCustomerStore(env.DB, id);
  const after = {
    ...before,
    customers: [...before.customers, customer]
  };
  const diff = diffStores(before, after);
  const audit = buildAuditEntry({
    identity,
    action: "customer.created",
    customerId: id,
    subjectType: "customer",
    subjectId: id,
    summary: `Created customer "${name}".`,
    after: customer,
    occurredAt: createdAt
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ customer }, 201);
}
__name(handleCreateCustomer, "handleCreateCustomer");
async function handleArchiveCustomer(request, env, customerId, identity) {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const before = await loadCustomerStore(env.DB, customerId);
  const customer = requireCustomer(before, customerId);
  if (customer.status === "archived") {
    throw new ApiError(
      409,
      "conflict",
      `Customer "${customerId}" is already archived.`
    );
  }
  const archived = { ...customer, status: "archived" };
  const event = {
    id: `evt_${customerId}_archived`,
    occurredAt,
    source: "operator",
    type: "customer.archived",
    customerId,
    label: `Archived customer "${customer.name}".`,
    subjectId: customerId,
    resultingState: "archived"
  };
  const after = {
    ...before,
    customers: before.customers.map(
      (c) => c.id === customerId ? archived : c
    ),
    activityEvents: [...before.activityEvents, event]
  };
  const diff = diffStores(before, after);
  const audit = buildAuditEntry({
    identity,
    action: "customer.archived",
    customerId,
    subjectType: "customer",
    subjectId: customerId,
    summary: `Archived customer "${customer.name}".`,
    before: { status: customer.status },
    after: { status: "archived" },
    occurredAt
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ customer: archived });
}
__name(handleArchiveCustomer, "handleArchiveCustomer");
async function handleGetCommercial(env, customerId) {
  const store = await loadCustomerStore(env.DB, customerId);
  requireCustomer(store, customerId);
  const asOf = nowIso();
  const projection = projectCommercialState(store.commercialArrangements, asOf);
  return json({
    customerId,
    asOf,
    active: projection.active,
    scheduled: projection.scheduled,
    history: projection.history
  });
}
__name(handleGetCommercial, "handleGetCommercial");
async function handleSaveCommercial(request, env, customerId, identity) {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const input = {
    ...body,
    customerId,
    createdAt: body.createdAt ?? occurredAt
  };
  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));
  const result = guardConflict(
    () => applyCommercialTransition(before, input, occurredAt)
  );
  const diff = diffStores(before, result.store);
  const audit = buildAuditEntry({
    identity,
    action: "commercial.created",
    customerId,
    subjectType: "commercial_arrangement",
    subjectId: result.arrangement.id,
    summary: `Created ${result.arrangement.model} commercial arrangement.`,
    after: result.arrangement,
    occurredAt
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ arrangement: result.arrangement }, 201);
}
__name(handleSaveCommercial, "handleSaveCommercial");
async function handleTerminateCommercial(request, env, customerId, arrangementId, identity) {
  const body = await readJson(request);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length === 0) {
    throw new ApiError(400, "validation-error", "reason is required.");
  }
  const occurredAt = bodyTimestamp(body);
  const before = await loadCustomerStore(env.DB, customerId);
  const arrangement = before.commercialArrangements.find(
    (a) => a.id === arrangementId && a.customerId === customerId
  );
  if (!arrangement) {
    throw new ApiError(
      404,
      "not-found",
      `Commercial arrangement with id "${arrangementId}" does not exist.`
    );
  }
  if (arrangement.status === "terminated") {
    throw new ApiError(
      409,
      "conflict",
      `Commercial arrangement "${arrangementId}" is already terminated.`
    );
  }
  const triggerEventId = commercialTerminatedEventId(arrangement.id);
  const triggerEvent = {
    id: triggerEventId,
    occurredAt,
    source: "operator",
    type: "commercial.terminated",
    customerId,
    label: `Terminated ${arrangement.model} commercial arrangement.`,
    subjectId: arrangement.id,
    resultingState: "terminated"
  };
  let next = {
    ...before,
    commercialArrangements: before.commercialArrangements.map(
      (a) => a.id === arrangement.id ? { ...a, status: "terminated", effectiveTo: occurredAt, reason } : a
    ),
    activityEvents: [...before.activityEvents, triggerEvent]
  };
  const activeGrants = before.agentAccessGrants.filter(
    (g) => g.customerId === customerId && resolveAgentAccessStatus(g, occurredAt) === "active"
  );
  for (const grant of activeGrants) {
    const result = guardConflict(
      () => applyAccessRevocation(next, {
        grantId: grant.id,
        customerId,
        reason,
        effectiveAt: occurredAt,
        occurredAt,
        source: "system",
        causationId: triggerEventId
      })
    );
    next = result.store;
  }
  const diff = diffStores(before, next);
  const audit = buildAuditEntry({
    identity,
    action: "commercial.terminated",
    customerId,
    subjectType: "commercial_arrangement",
    subjectId: arrangement.id,
    summary: `Terminated ${arrangement.model} commercial arrangement.`,
    before: { status: arrangement.status },
    after: { status: "terminated" },
    occurredAt
  });
  await commitStoreDiff(env.DB, diff, audit);
  const terminated = next.commercialArrangements.find(
    (a) => a.id === arrangement.id
  );
  return json({ arrangement: terminated });
}
__name(handleTerminateCommercial, "handleTerminateCommercial");
async function handleGetAccess(env, customerId) {
  const store = await loadCustomerStore(env.DB, customerId);
  requireCustomer(store, customerId);
  const asOf = nowIso();
  const current = store.agentAccessGrants.filter(
    (grant) => resolveAgentAccessStatus(grant, asOf) === "active"
  );
  const scheduled = store.agentAccessGrants.filter(
    (grant) => resolveAgentAccessStatus(grant, asOf) === "scheduled"
  );
  const history = store.agentAccessGrants.filter((grant) => {
    const status = resolveAgentAccessStatus(grant, asOf);
    return status === "expired" || status === "revoked";
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return json({ customerId, asOf, current, scheduled, history });
}
__name(handleGetAccess, "handleGetAccess");
async function handleGrantAccess(request, env, customerId, identity) {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const input = {
    ...body,
    customerId,
    createdAt: body.createdAt ?? occurredAt
  };
  const validation = validateAgentAccessGrant(input);
  if (!validation.ok) {
    throw new ApiError(400, "validation-error", validation.problems.join(" "));
  }
  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));
  const agentProductId = input.agentProductId;
  if (!before.agentProducts.some((p) => p.id === agentProductId)) {
    throw new ApiError(
      404,
      "not-found",
      `Agent product with id "${agentProductId}" does not exist.`
    );
  }
  const conflict = findConflictingAccessGrant(
    before.agentAccessGrants,
    { customerId, agentProductId },
    occurredAt
  );
  if (conflict) {
    throw new ApiError(
      409,
      "conflict",
      `Customer "${customerId}" already has active or scheduled access to agent product "${agentProductId}".`
    );
  }
  const grantId = input.id ?? `grant_${customerId}_${agentProductId}_${occurredAt}`;
  const eventId = `evt_${grantId}`;
  const grant = {
    id: grantId,
    customerId,
    agentProductId,
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    createdAt: occurredAt,
    revokedAt: null,
    scheduledRevokeAt: null,
    activityEventId: eventId,
    reasonForChange: input.reasonForChange
  };
  const event = {
    id: eventId,
    occurredAt,
    source: "operator",
    type: "access.granted",
    customerId,
    label: `Granted access to agent product "${agentProductId}".`,
    subjectId: grant.id,
    subjectId2: agentProductId,
    resultingState: "active"
  };
  const after = {
    ...before,
    agentAccessGrants: [...before.agentAccessGrants, grant],
    activityEvents: [...before.activityEvents, event]
  };
  const diff = diffStores(before, after);
  const audit = buildAuditEntry({
    identity,
    action: "access.granted",
    customerId,
    subjectType: "agent_access_grant",
    subjectId: grant.id,
    summary: `Granted access to agent product "${agentProductId}".`,
    after: grant,
    occurredAt
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ grant }, 201);
}
__name(handleGrantAccess, "handleGrantAccess");
async function handleRevokeAccess(request, env, customerId, grantId, identity) {
  const body = await readJson(request);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length === 0) {
    throw new ApiError(400, "validation-error", "reason is required.");
  }
  const occurredAt = bodyTimestamp(body);
  const effectiveAt = typeof body.effectiveAt === "string" && body.effectiveAt.length > 0 ? body.effectiveAt : occurredAt;
  const before = await loadCustomerStore(env.DB, customerId);
  const grant = before.agentAccessGrants.find(
    (g) => g.id === grantId && g.customerId === customerId
  );
  if (!grant) {
    throw new ApiError(
      404,
      "not-found",
      `Agent access grant with id "${grantId}" does not exist.`
    );
  }
  const result = guardConflict(
    () => applyAccessRevocation(before, {
      grantId,
      customerId,
      reason,
      effectiveAt,
      occurredAt,
      source: "operator"
    })
  );
  const diff = diffStores(before, result.store);
  const audit = buildAuditEntry({
    identity,
    action: "access.revoked",
    customerId,
    subjectType: "agent_access_grant",
    subjectId: grant.id,
    summary: `Revoked access to agent product "${grant.agentProductId}".`,
    before: {
      revokedAt: grant.revokedAt,
      scheduledRevokeAt: grant.scheduledRevokeAt
    },
    after: {
      revokedAt: result.grant.revokedAt,
      scheduledRevokeAt: result.grant.scheduledRevokeAt
    },
    occurredAt
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ grant: result.grant });
}
__name(handleRevokeAccess, "handleRevokeAccess");
async function handleGetLedger(env, customerId) {
  const store = await loadCustomerStore(env.DB, customerId);
  requireCustomer(store, customerId);
  const rows = projectAccountStatement(store.ledgerTransactions, customerId);
  return json({ customerId, rows });
}
__name(handleGetLedger, "handleGetLedger");
async function handleAddCredit(request, env, customerId, identity) {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const amountTokens = body.amountTokens;
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));
  requireActivePrepaid(before, customerId, occurredAt);
  const transaction = {
    id: creditGrantTransactionId(customerId, occurredAt),
    customerId,
    occurredAt,
    kind: "credit_grant",
    amountTokens,
    reason: typeof body.reason === "string" && body.reason.trim().length > 0 ? body.reason.trim() : "Operator-confirmed token credit",
    reference
  };
  const validation = validateLedgerTransaction(transaction);
  if (!validation.ok) {
    throw new ApiError(400, "validation-error", validation.problems.join(" "));
  }
  guardConflict(
    () => assertNoNegativeBalance(
      before.ledgerTransactions,
      customerId,
      transaction.amountTokens
    )
  );
  const after = {
    ...before,
    ledgerTransactions: [...before.ledgerTransactions, transaction]
  };
  const diff = diffStores(before, after);
  const audit = buildAuditEntry({
    identity,
    action: "ledger.credit_grant",
    customerId,
    subjectType: "ledger_transaction",
    subjectId: transaction.id,
    summary: `Granted ${transaction.amountTokens} tokens.`,
    after: transaction,
    occurredAt
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ transaction }, 201);
}
__name(handleAddCredit, "handleAddCredit");
async function handleRecordUsage(request, env, customerId, identity) {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const trimmedCustomerId = customerId.trim();
  const before = await loadCustomerStore(env.DB, trimmedCustomerId);
  requireNotArchived(requireCustomer(before, trimmedCustomerId));
  requireActivePrepaid(before, trimmedCustomerId, occurredAt);
  const agentProductId = typeof body.agentProductId === "string" ? body.agentProductId.trim() : "";
  if (!before.agentProducts.some((p) => p.id === agentProductId)) {
    throw new ApiError(
      404,
      "not-found",
      `Agent product with id "${agentProductId}" does not exist.`
    );
  }
  const fingerprint = normalizeUsageFingerprint({
    customerId: trimmedCustomerId,
    agentProductId,
    sourceReference: body.sourceReference,
    occurredAt,
    tokenQuantity: body.tokenQuantity
  });
  if (!fingerprint) {
    throw new ApiError(
      400,
      "validation-error",
      "Usage requires a customer, agent product, positive whole token quantity, canonical ISO occurredAt, and a source reference."
    );
  }
  const existing = before.usageRecords.find(
    (usage) => usage.sourceReference === fingerprint.sourceReference
  );
  if (existing) {
    guardConflict(() => validateUsageIdempotency(existing, fingerprint));
    const existingTransaction = before.ledgerTransactions.find(
      (transaction) => transaction.id === existing.ledgerTransactionId
    );
    if (!existingTransaction) {
      throw new ApiError(
        500,
        "internal-error",
        `Usage record "${existing.id}" is missing its linked ledger transaction.`
      );
    }
    return json({
      usage: existing,
      transaction: existingTransaction,
      replay: true
    });
  }
  const result = guardConflict(
    () => recordUsage(
      before,
      {
        customerId: trimmedCustomerId,
        agentProductId,
        tokenQuantity: fingerprint.tokenQuantity,
        sourceReference: fingerprint.sourceReference,
        reason: typeof body.reason === "string" ? body.reason : void 0
      },
      occurredAt
    )
  );
  const diff = diffStores(before, result.store);
  const audit = buildAuditEntry({
    identity,
    action: "ledger.usage_debit",
    customerId: trimmedCustomerId,
    subjectType: "usage_record",
    subjectId: result.usage.id,
    summary: `Recorded ${fingerprint.tokenQuantity} tokens of usage for "${agentProductId}".`,
    after: { usage: result.usage, transaction: result.transaction },
    occurredAt
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json(
    { usage: result.usage, transaction: result.transaction, replay: false },
    201
  );
}
__name(handleRecordUsage, "handleRecordUsage");
async function handleAddAdjustment(request, env, customerId, identity) {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));
  requireActivePrepaid(before, customerId, occurredAt);
  const result = guardConflict(
    () => applyManualAdjustment(
      before,
      {
        customerId,
        amountTokens: body.amountTokens,
        reference: typeof body.reference === "string" ? body.reference : "",
        reason: typeof body.reason === "string" ? body.reason : ""
      },
      occurredAt
    )
  );
  const diff = diffStores(before, result.store);
  const audit = buildAuditEntry({
    identity,
    action: "ledger.manual_adjustment",
    customerId,
    subjectType: "ledger_transaction",
    subjectId: result.transaction.id,
    summary: `Applied manual adjustment of ${result.transaction.amountTokens} tokens.`,
    after: result.transaction,
    occurredAt
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ transaction: result.transaction }, 201);
}
__name(handleAddAdjustment, "handleAddAdjustment");
async function handleAddReversal(request, env, customerId, identity) {
  const body = await readJson(request);
  const occurredAt = bodyTimestamp(body);
  const transactionId = typeof body.transactionId === "string" ? body.transactionId.trim() : "";
  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));
  requireActivePrepaid(before, customerId, occurredAt);
  const result = guardConflict(
    () => reverseTransaction(
      before,
      {
        customerId,
        transactionId,
        reference: typeof body.reference === "string" ? body.reference : "",
        reason: typeof body.reason === "string" ? body.reason : ""
      },
      occurredAt
    )
  );
  const diff = diffStores(before, result.store);
  const audit = buildAuditEntry({
    identity,
    action: "ledger.reversal",
    customerId,
    subjectType: "ledger_transaction",
    subjectId: result.transaction.id,
    summary: `Reversed ledger transaction "${transactionId}".`,
    after: result.transaction,
    occurredAt
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ transaction: result.transaction }, 201);
}
__name(handleAddReversal, "handleAddReversal");
async function handleUpdateThreshold(request, env, customerId, identity) {
  const body = await readJson(request);
  const thresholdTokens = body.thresholdTokens;
  if (typeof thresholdTokens !== "number" || !Number.isFinite(thresholdTokens) || !Number.isInteger(thresholdTokens) || thresholdTokens < 0) {
    throw new ApiError(
      400,
      "validation-error",
      "thresholdTokens must be a non-negative whole number."
    );
  }
  const occurredAt = nowIso();
  const before = await loadCustomerStore(env.DB, customerId);
  requireNotArchived(requireCustomer(before, customerId));
  const active = requireActivePrepaid(before, customerId, occurredAt);
  const updated = {
    ...active,
    warningThresholdTokens: thresholdTokens
  };
  const after = {
    ...before,
    commercialArrangements: before.commercialArrangements.map(
      (a) => a.id === active.id ? updated : a
    )
  };
  const diff = diffStores(before, after);
  const audit = buildAuditEntry({
    identity,
    action: "ledger.threshold",
    customerId,
    subjectType: "commercial_arrangement",
    subjectId: active.id,
    summary: `Updated warning threshold to ${thresholdTokens} tokens.`,
    before: { warningThresholdTokens: active.warningThresholdTokens },
    after: { warningThresholdTokens: thresholdTokens },
    occurredAt
  });
  await commitStoreDiff(env.DB, diff, audit);
  return json({ arrangement: updated });
}
__name(handleUpdateThreshold, "handleUpdateThreshold");
async function handleGetUsageSummary(env, url, customerId) {
  const store = await loadCustomerStore(env.DB, customerId);
  requireCustomer(store, customerId);
  const period = {
    from: url.searchParams.get("from") ?? void 0,
    to: url.searchParams.get("to") ?? void 0
  };
  const agentProductId = url.searchParams.get("agentProductId") ?? void 0;
  const typeParam = url.searchParams.get("type");
  const type = typeParam === null ? void 0 : typeParam;
  const aggregationFilter = { agentProductId, type };
  const statement = projectAccountStatement(
    store.ledgerTransactions,
    customerId
  );
  const rows = filterStatement(statement, {
    from: period.from,
    to: period.to,
    agentProductId,
    type
  });
  const netTokensConsumed = sumPeriodUsage(
    store.ledgerTransactions,
    customerId,
    period,
    aggregationFilter
  );
  const agentNames = new Map(
    store.agentProducts.map((product) => [product.id, product.name])
  );
  const perAgent = groupUsageByAgent(
    store.ledgerTransactions,
    customerId,
    period,
    agentNames,
    aggregationFilter
  ).map((row) => ({
    ...row,
    agentName: agentNames.get(row.agentProductId) ?? row.agentProductId
  }));
  return json({ customerId, rows, netTokensConsumed, perAgent });
}
__name(handleGetUsageSummary, "handleGetUsageSummary");
async function handleCustomers(request, env, url, segments, identity) {
  const method = request.method;
  const rest = segments.slice(2);
  if (rest.length === 0) {
    if (method === "GET") {
      const status = url.searchParams.get("status") ?? void 0;
      return json({ customers: await listCustomers(env.DB, status) });
    }
    if (method === "POST") {
      return handleCreateCustomer(request, env, identity);
    }
    throw new ApiError(405, "method-not-allowed", "Method not allowed.");
  }
  const customerId = rest[0];
  if (rest.length === 1) {
    if (method === "GET") {
      const customer = await getCustomer(env.DB, customerId);
      if (!customer) {
        throw new ApiError(
          404,
          "not-found",
          `Customer "${customerId}" does not exist.`
        );
      }
      return json({ customer });
    }
    throw new ApiError(405, "method-not-allowed", "Method not allowed.");
  }
  if (rest[1] === "archive" && rest.length === 2 && method === "POST") {
    return handleArchiveCustomer(request, env, customerId, identity);
  }
  if (rest[1] === "commercial") {
    if (rest.length === 2) {
      if (method === "GET") return handleGetCommercial(env, customerId);
      if (method === "POST") {
        return handleSaveCommercial(request, env, customerId, identity);
      }
    }
    if (rest.length === 4 && rest[3] === "terminate" && method === "POST") {
      return handleTerminateCommercial(
        request,
        env,
        customerId,
        rest[2],
        identity
      );
    }
    throw new ApiError(404, "not-found", "Unknown API route.");
  }
  if (rest[1] === "access") {
    if (rest.length === 2) {
      if (method === "GET") return handleGetAccess(env, customerId);
      if (method === "POST") {
        return handleGrantAccess(request, env, customerId, identity);
      }
    }
    if (rest.length === 4 && rest[3] === "revoke" && method === "POST") {
      return handleRevokeAccess(request, env, customerId, rest[2], identity);
    }
    throw new ApiError(404, "not-found", "Unknown API route.");
  }
  if (rest[1] === "ledger") {
    if (rest.length === 2 && method === "GET") {
      return handleGetLedger(env, customerId);
    }
    if (rest.length === 3) {
      if (rest[2] === "threshold" && method === "PUT") {
        return handleUpdateThreshold(request, env, customerId, identity);
      }
      if (method === "POST") {
        if (rest[2] === "credit") {
          return handleAddCredit(request, env, customerId, identity);
        }
        if (rest[2] === "usage") {
          return handleRecordUsage(request, env, customerId, identity);
        }
        if (rest[2] === "adjustment") {
          return handleAddAdjustment(request, env, customerId, identity);
        }
        if (rest[2] === "reversal") {
          return handleAddReversal(request, env, customerId, identity);
        }
      }
    }
    throw new ApiError(404, "not-found", "Unknown API route.");
  }
  if (rest[1] === "usage-summary" && rest.length === 2 && method === "GET") {
    return handleGetUsageSummary(env, url, customerId);
  }
  if (rest[1] === "audit" && rest.length === 2 && method === "GET") {
    const entries = await listAuditEntries(env.DB, customerId);
    return json({ entries });
  }
  throw new ApiError(404, "not-found", "Unknown API route.");
}
__name(handleCustomers, "handleCustomers");
async function route(request, env, url, identity) {
  const method = request.method;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api") {
    throw new ApiError(404, "not-found", "Unknown API route.");
  }
  const resource = segments[1];
  if (resource === "me") {
    if (method !== "GET") {
      throw new ApiError(405, "method-not-allowed", "Method not allowed.");
    }
    return json({ identity });
  }
  if (resource === "audit") {
    if (method !== "GET") {
      throw new ApiError(405, "method-not-allowed", "Method not allowed.");
    }
    const entries = await listAuditEntries(env.DB);
    return json({ entries });
  }
  if (resource === "agents") {
    if (method !== "GET") {
      throw new ApiError(405, "method-not-allowed", "Method not allowed.");
    }
    if (segments.length === 2) {
      return json({ products: await listAgentProducts(env.DB) });
    }
    if (segments.length === 3) {
      const product = await getAgentProduct(env.DB, segments[2]);
      if (!product) {
        throw new ApiError(
          404,
          "not-found",
          `Agent product "${segments[2]}" does not exist.`
        );
      }
      return json({ product });
    }
    throw new ApiError(404, "not-found", "Unknown API route.");
  }
  if (resource === "customers") {
    return handleCustomers(request, env, url, segments, identity);
  }
  throw new ApiError(404, "not-found", "Unknown API route.");
}
__name(route, "route");
async function handleApi(request, env, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({ ok: true, service: "hivarium-operator-console" });
  }
  if (request.method === "POST" && url.pathname === "/api/e2e/reset") {
    if (env.E2E_TEST_AUTH === "true") {
      await ensureCatalogSeeded(env);
      await env.DB.exec(`DELETE FROM commercial_arrangements`);
      await env.DB.exec(`DELETE FROM agent_access_grants`);
      await env.DB.exec(`DELETE FROM ledger_transactions`);
      await env.DB.exec(`DELETE FROM activity_events`);
      await env.DB.exec(`DELETE FROM audit_entries`);
      await env.DB.exec(`DELETE FROM customers`);
      await env.DB.exec(`DELETE FROM usage_records`);
      const diff = diffStores(
        {
          schemaVersion: 4,
          customers: [],
          commercialArrangements: [],
          agentAccessGrants: [],
          activityEvents: [],
          ledgerTransactions: [],
          usageRecords: [],
          featureEntitlements: [],
          agentProducts: []
        },
        buildSeedStore()
      );
      await commitStoreDiff(env.DB, diff, buildAuditEntry({
        identity: { email: "e2e@hivarium.test", sub: "e2e", name: "E2E" },
        action: "reseed_for_e2e",
        customerId: "",
        subjectType: "system",
        subjectId: "e2e",
        summary: "E2E seed reset",
        occurredAt: (/* @__PURE__ */ new Date()).toISOString()
      }));
      return json({ ok: true });
    }
  }
  let auth = { ok: false, reason: "init" };
  if (env.E2E_TEST_AUTH === "true") {
    auth = {
      ok: true,
      identity: {
        email: env.AUTHORIZED_OPERATOR_EMAIL,
        sub: "e2e-sub",
        name: "E2E Operator"
      }
    };
  } else {
    auth = await authenticateRequest(request, {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
      authorizedEmails: [env.AUTHORIZED_OPERATOR_EMAIL]
    });
  }
  if (!auth.ok) {
    return errorResponse(401, "unauthorized", auth.reason);
  }
  try {
    await ensureCatalogSeeded(env);
    return await route(request, env, url, auth.identity);
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(error.status, error.code, error.message);
    }
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return errorResponse(500, "internal-error", message);
  }
}
__name(handleApi, "handleApi");
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    return env.ASSETS.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-mq08Tc/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-mq08Tc/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
