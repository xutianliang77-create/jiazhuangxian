/**
 * `/stuck` · 查看空转 / 卡住诊断信息
 */

import { defineCommand, reply } from "../registry";

interface StuckHolder {
  buildStuckReply(): string;
}

function isHolder(x: unknown): x is StuckHolder {
  return !!x && typeof (x as StuckHolder).buildStuckReply === "function";
}

export default defineCommand({
  name: "/stuck",
  category: "session",
  risk: "low",
  summary: "Show runtime guard diagnostics for stuck or looping model turns.",
  summaryZh: "显示模型卡住 / 空转的运行时诊断",
  handler(ctx) {
    if (!isHolder(ctx.queryEngine)) {
      return reply("stuck command unavailable: runtime missing buildStuckReply");
    }
    return reply(ctx.queryEngine.buildStuckReply());
  },
});
