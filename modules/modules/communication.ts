import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class CommunicationModule extends BaseModule {
  name = "communication";
  layer = "integration";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Formaterer en brugervendt dansk besked ud fra resultatet.
    const r = ctx.state.reasoning || {}; const e = ctx.state.execution || {}; const k = ctx.state.knowledge || {};
    const msg = `♻️ ${k.type || "Materiale"} (karakter ${r.grade || "-"}). Sortér som ${r.bin || "restaffald"}. ` +
      `Du tjente ${e.points || 0} point (${e.kroner || 0} kr) og sparede ${e.co2Kg || 0} kg CO₂. ${k.fact || ""}`;
    ctx.state.message = msg;
    return { module: this.name, ok: true, data: { message: msg } };
  }
}
