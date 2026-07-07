import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class OrchestrationModule extends BaseModule {
  name = "orchestration";
  layer = "integration";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Vælger AI-provider-rækkefølge (spejler api/_ai.ts).
    const p = (process.env.AI_PROVIDER || "gemini").toLowerCase();
    const order = p === "claude" ? ["claude"] : p === "auto" ? ["gemini", "claude"] : ["gemini"];
    ctx.state.providerOrder = order;
    return { module: this.name, ok: true, data: { order } };
  }
}
