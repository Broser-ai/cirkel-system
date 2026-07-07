import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class SecurityModule extends BaseModule {
  name = "security";
  layer = "foundation";
  private hits = new Map<string, { n: number; t: number }>();

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Input-validering, simpel rate-limit og redaktion af hemmeligheder.
    const { userId = "anon", text = "" } = input || {};
    const now = Date.now();
    const h = this.hits.get(userId) || { n: 0, t: now };
    if (now - h.t > 60000) { h.n = 0; h.t = now; }
    h.n++; this.hits.set(userId, h);
    const limited = h.n > 60; // max 60/min
    const redacted = String(text).replace(/(AIza[\w-]{10,}|sb_secret_[\w-]+|eyJ[\w-]{20,})/g, "***REDACTED***");
    return { module: this.name, ok: !limited, data: { redacted }, note: limited ? "rate-limit" : "ok" };
  }
}
