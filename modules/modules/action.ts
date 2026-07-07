import { BaseModule, Ctx, ModuleResult } from "../base.js";

export class ActionModule extends BaseModule {
  name = "action";
  layer = "intelligence";

  async process(input: any, ctx: Ctx): Promise<ModuleResult> {
    // Danner den konkrete handling: tildel reward + forbered ledger-blok.
    const ex = ctx.state.execution || { points: 0, kroner: 0 };
    const action = { type: "AWARD_REWARD", points: ex.points, kroner: ex.kroner, ledgerReady: true };
    ctx.state.action = action;
    return { module: this.name, ok: true, data: action };
  }
}
