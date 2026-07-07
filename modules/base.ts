// Fælles kontrakt for alle Cirkel-moduler.
export interface Ctx {
  state: Record<string, any>;
  log: (msg: string) => void;
}
export interface ModuleResult {
  module: string;
  ok: boolean;
  data?: any;
  note?: string;
}
export abstract class BaseModule {
  abstract name: string;
  abstract layer: string;
  state: "init" | "ready" | "error" = "init";
  async initialize(): Promise<void> { this.state = "ready"; }
  async health() { return { module: this.name, layer: this.layer, state: this.state }; }
  abstract process(input: any, ctx: Ctx): Promise<ModuleResult>;
}
