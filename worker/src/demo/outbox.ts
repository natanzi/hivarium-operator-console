import type { Env } from "../app";
import {
  listPendingEmails,
  markEmailFailed,
  markEmailSent,
} from "./store";
import type { EmailGateway, EmailMessage } from "./email";
import { DEFAULT_EMAIL_PROVIDER_URL, HttpEmailGateway, MemoryEmailGateway } from "./email";

const memoryGateways = new Map<string, MemoryEmailGateway>();

export function emailGatewayFor(env: Env): EmailGateway | null {
  if (env.EMAIL_PROVIDER_API_KEY === "test://memory") {
    const existing = memoryGateways.get("default");
    if (existing) return existing;
    const created = new MemoryEmailGateway();
    memoryGateways.set("default", created);
    return created;
  }
  if (!env.EMAIL_PROVIDER_API_KEY || !env.EMAIL_FROM_ADDRESS || !env.EMAIL_REPLY_TO) return null;
  return new HttpEmailGateway({
    apiKey: env.EMAIL_PROVIDER_API_KEY,
    from: env.EMAIL_FROM_ADDRESS,
    replyTo: env.EMAIL_REPLY_TO,
    endpoint: env.EMAIL_PROVIDER_URL || DEFAULT_EMAIL_PROVIDER_URL,
  });
}

export function memoryEmails(): EmailMessage[] {
  return memoryGateways.get("default")?.sent ?? [];
}

export function resetMemoryEmails(): void {
  memoryGateways.clear();
}

export async function drainEmailOutbox(
  env: Env,
  rendered: Partial<Record<string, EmailMessage | null>>,
): Promise<void> {
  const gateway = emailGatewayFor(env);
  const pending = await listPendingEmails(env.DB);
  const now = new Date().toISOString();
  for (const row of pending) {
    const message = rendered[row.template];
    if (!message) {
      if (row.template === "customer_welcome") {
        await markEmailFailed(env.DB, row.id, "portal_url_unconfigured", now);
      }
      continue;
    }
    if (!gateway) {
      await markEmailFailed(env.DB, row.id, "email_unconfigured", now);
      continue;
    }
    try {
      const sent = await gateway.send(message);
      await markEmailSent(env.DB, row.id, sent.id, now);
    } catch {
      await markEmailFailed(env.DB, row.id, "email_provider_error", now);
    }
  }
}
