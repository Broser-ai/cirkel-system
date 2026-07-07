import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class AdaptationModule extends BaseModule {
  name = "adaptation";
  layer = "evolution";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Justerer en parameter ud fra seneste performance (ægte tærskel-logik).
    const rate = Number(input?.recentConversion ?? 0.5);
    const nudgeFrequency = rate < 0.3 ? 5 : rate < 0.6 ? 3 : 2;
    return { module: this.name, ok: true, data: { nudgeFrequency } };
  }
}
