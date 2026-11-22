// 让 Node 的 type-stripping 能解析源码中无扩展名的 .ts 相对导入，
// 并把 .vue 单文件组件桩为空模块（引擎测试只覆盖 TS 逻辑，不挂载界面）。
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[a-zA-Z0-9]+$/.test(specifier)
    ) {
      const fileCandidate = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(fileCandidate))) {
        return nextResolve(fileCandidate.href, context);
      }
      const indexCandidate = new URL(
        specifier.endsWith("/") ? specifier + "index.ts" : specifier + "/index.ts",
        context.parentURL,
      );
      if (existsSync(fileURLToPath(indexCandidate))) {
        return nextResolve(indexCandidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".vue")) {
      return {
        format: "module",
        source:
          "export default {}; " +
          readFileSync(fileURLToPath(url), "utf8").length,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
