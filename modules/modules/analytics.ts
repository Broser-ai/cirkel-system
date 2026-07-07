import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class AnalyticsModule extends BaseModule {
  name = "analytics";
  layer = "processing";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Aggregerer KPI'er fra en liste af scans (eller den aktuelle).
    const scans = (input?.scans || (ctx.state.execution ? [ctx.state.execution] : [])) as any[];
    const sum = (f: (s: any) => number) => scans.reduce((a, s) => a + (f(s) || 0), 0);
    const kpi = {
      scans: scans.length,
      totalPoints: sum((s) => s.points),
      totalKroner: Number(sum((s) => s.kroner).toFixed(2)),
      totalCo2Kg: Number(sum((s) => s.co2Kg).toFixed(2)),
    };
    ctx.state.kpi = kpi;
    return { module: this.name, ok: true, data: kpi };
  }
}
