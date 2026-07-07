import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class OptimizationModule extends BaseModule {
  name = "optimization";
  layer = "evolution";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Vælger billigste/hurtigste vej: cache-nøgle + provider-valg.
    const rec = ctx.state.record || {};
    const cacheKey = `scan:${rec.barcode || rec.material || "x"}:${rec.municipality || ""}`;
    return { module: this.name, ok: true, data: { cacheKey, prefer: (ctx.state.providerOrder || ["gemini"])[0] } };
  }
}
