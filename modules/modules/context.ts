import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class ContextModule extends BaseModule {
  name = "context";
  layer = "foundation";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Samler request-kontekst (bruger, kommune, hukommelse).
    const c = {
      userId: input?.userId || "anon",
      municipality: ctx.state.record?.municipality || "Aarhus Kommune",
      history: ctx.state.memory || [],
      ts: new Date().toISOString(),
    };
    ctx.state.context = c;
    return { module: this.name, ok: true, data: c };
  }
}
