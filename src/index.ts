export const VERSION = "0.0.0";

export { scan } from "./scanner.ts";
export { initSage, createSageAPI } from "./api.ts";
export type { SageAPI } from "./api.ts";

export type {
  ActionResult,
  SageAttributes,
  SageConfig,
  SageNode,
  SageScanResult,
} from "./types.ts";
