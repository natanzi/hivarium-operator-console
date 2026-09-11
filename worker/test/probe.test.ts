import { env } from "cloudflare:test";
import { it } from "vitest";

it("probes exec behavior", async () => {
  const db = env.DB;
  // Single-line statement via exec
  try {
    await db.exec("CREATE TABLE IF NOT EXISTS probe_a (id TEXT PRIMARY KEY)");
    console.log("exec single-line: OK");
  } catch (e) {
    console.log("exec single-line FAILED:", (e as Error).message);
  }
  // Multi-line statement via exec
  try {
    await db.exec(
      "CREATE TABLE IF NOT EXISTS probe_b (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL\n)"
    );
    console.log("exec multi-line: OK");
  } catch (e) {
    console.log("exec multi-line FAILED:", (e as Error).message);
  }
  // Multi-line statement via prepare().run()
  try {
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS probe_c (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL\n)"
      )
      .run();
    console.log("prepare multi-line: OK");
  } catch (e) {
    console.log("prepare multi-line FAILED:", (e as Error).message);
  }
  // exec with trailing semicolon
  try {
    await db.exec("CREATE TABLE IF NOT EXISTS probe_d (id TEXT PRIMARY KEY);");
    console.log("exec trailing semicolon: OK");
  } catch (e) {
    console.log("exec trailing semicolon FAILED:", (e as Error).message);
  }
});