declare module "openclaw/plugin-sdk" {
  export interface OpenClawPluginApi {
    id?: string;
    pluginConfig?: Record<string, unknown>;
    on(event: string, handler: (...args: any[]) => unknown): void;
    registerService(service: Record<string, unknown>): void;
    registerTool(tool: unknown, options?: Record<string, unknown>): void;
    registerCli(handler: unknown, options?: Record<string, unknown>): void;
    [key: string]: unknown;
  }
}
