import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class LearningModule extends BaseModule {
  name = "learning";
  layer = "evolution";
  private stats: Record<string, { n: number; avg: number }> = {};

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Opdaterer løbende gennemsnit (fx konverteringsrate) fra udfald.
    const { metric = "points", value = 0 } = input || {};
    const s = this.stats[metric] || { n: 0, avg: 0 };
    s.avg = (s.avg * s.n + Number(value)) / (s.n + 1); s.n++;
    this.stats[metric] = s;
    return { module: this.name, ok: true, data: { metric, n: s.n, avg: Number(s.avg.toFixed(2)) } };
  }
}
