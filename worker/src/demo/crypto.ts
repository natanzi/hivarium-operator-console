export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const left = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(a));
  const right = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(b));
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  if (x.length !== y.length) return false;
  let mismatch = 0;
  for (let i = 0; i < x.length; i++) mismatch |= x[i] ^ y[i];
  return mismatch === 0;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}
