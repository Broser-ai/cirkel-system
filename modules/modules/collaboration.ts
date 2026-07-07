import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class CollaborationModule extends BaseModule {
  name = "collaboration";
  layer = "integration";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Samler output fra flere moduler til ét svar-objekt.
    const merged = {
      observation: ctx.state.observation, knowledge: ctx.state.knowledge,
      reasoning: ctx.state.reasoning, reward: ctx.state.execution, message: ctx.state.message,
    };
    return { module: this.name, ok: true, data: merged };
  }
}
