import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class ExecutionModule extends BaseModule {
  name = "execution";
  layer = "intelligence";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Beregner points, kroner og CO2 ud fra materiale + vægt (ægte formel).
    const rec = ctx.state.record || {};
    const k = ctx.state.knowledge || { co2PerKg: 0.3, recyclable: 50 };
    const kg = (rec.weight_grams || 0) / 1000;
    const points = Math.round(kg * 1000 * (k.recyclable / 100) * 2);
    const kroner = Number((points * 0.01).toFixed(2));
    const co2Kg = Number((kg * k.co2PerKg).toFixed(3));
    const result = { points, kroner, co2Kg, material: ctx.state.knowledge?.type };
    ctx.state.execution = result;
    return { module: this.name, ok: points >= 0, data: result };
  }
}
