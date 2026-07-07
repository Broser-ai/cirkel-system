import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class ReasoningEngine extends BaseModule {
  name = "reasoning_engine";
  layer = "processing";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Udleder karakter + sorteringsanbefaling ud fra viden (regelbaseret).
    const k = ctx.state.knowledge || { recyclable: 50, bin: "Restaffald" };
    const grade = k.recyclable >= 100 ? "A+" : k.recyclable >= 90 ? "A" : k.recyclable >= 70 ? "B" : k.recyclable >= 50 ? "C" : "D";
    const reasoning = {
      grade,
      bin: k.bin,
      circularScore: Math.round(k.recyclable * 0.95),
      sorting: `Sortér som ${k.bin}. Skyl kort og pres fladt for bedst genanvendelse.`,
    };
    ctx.state.reasoning = reasoning;
    return { module: this.name, ok: true, data: reasoning };
  }
}
