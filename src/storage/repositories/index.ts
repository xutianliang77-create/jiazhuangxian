/**
 * Storage Repositories 汇出
 *
 * 用法：`import { ObservationRepo, L1MemoryRepo, upsertActiveSession } from "../../../storage/repositories"`
 *
 * 规则：
 *   - 只汇出类 / 接口 / 常量 / 有命名空间的纯函数
 *   - 不汇出内部行类型（`*Row`）
 */

export { upsertActiveSession, getSession } from "./sessionRepo";
export type { SessionInsert, SessionRow } from "./sessionRepo";

export { insertTask } from "./taskRepo";
export type { TaskInsert } from "./taskRepo";

export { insertStep, updateStepStatus } from "./stepRepo";
export type { StepInsert, StepStatus } from "./stepRepo";

export {
  ObservationRepo,
  OBSERVATION_OVERFLOW_THRESHOLD,
} from "./observationRepo";
export type {
  ObservationInsert,
  ObservationRecord,
  ObservationStatus,
} from "./observationRepo";

export { L1MemoryRepo, readL1TranscriptFile } from "./l1MemoryRepo";
export type {
  L1MessageInsert,
  L1MessageMeta,
  L1TranscriptMessage,
  MessageRole,
  MessageSource,
} from "./l1MemoryRepo";
