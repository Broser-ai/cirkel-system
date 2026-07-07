import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class PlanningModule extends BaseModule {
  name = "planning";
  layer = "intelligence";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Lægger den ordnede plan for et scan-forløb.
    const plan = ["perception", "knowledge", "reasoning_engine", "execution", "action", "analytics", "communication"];
    ctx.state.plan = plan;
    return { module: this.name, ok: true, data: { steps: plan } };
  }
}
