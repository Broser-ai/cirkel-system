import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class EthicsModule extends BaseModule {
  name = "ethics";
  layer = "intelligence";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Guardrail: blokér uønsket indhold, sikr børnevenlighed.
    const text = String(input?.text || "").toLowerCase();
    const blocked = ["våben", "selvskade", "narko"].some((w) => text.includes(w));
    return { module: this.name, ok: !blocked, data: { allowed: !blocked }, note: blocked ? "blokeret" : "ok" };
  }
}
