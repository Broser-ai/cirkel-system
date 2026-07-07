import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class MemoryManager extends BaseModule {
  name = "memory";
  layer = "foundation";
  private store = new Map<string, any[]>();

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Episodisk hukommelse: gem og hent seneste hændelser pr. bruger.
    const { userId = "anon", event } = input || {};
    if (!this.store.has(userId)) this.store.set(userId, []);
    const log = this.store.get(userId)!;
    if (event) { log.push({ ...event, at: Date.now() }); if (log.length > 100) log.shift(); }
    const recent = log.slice(-5);
    ctx.state.memory = recent;
    return { module: this.name, ok: true, data: { count: log.length, recent } };
  }
}
