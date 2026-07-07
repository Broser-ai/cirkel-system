import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class MonitoringModule extends BaseModule {
  name = "monitoring";
  layer = "integration";
  private metrics: Record<string, number> = {};

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Tæller hændelser og leverer health/metrics.
    const key = input?.metric || "process";
    this.metrics[key] = (this.metrics[key] || 0) + 1;
    return { module: this.name, ok: true, data: { metrics: { ...this.metrics } } };
  }
}
