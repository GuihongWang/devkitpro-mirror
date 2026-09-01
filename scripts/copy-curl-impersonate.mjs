/**
 * copy-curl-impersonate.mjs — 构建后把 curl-impersonate 静态二进制放进 Vercel 函数输出
 *
 * 为什么需要
 * ---------
 * `@vercel/nft` 只静态追踪 JS 可达依赖，**不会**自动把仓库里的 `bin/curl-impersonate`
 * 静态二进制带进 `_render.func`。运行时 `curlImpersonateFetch` 向上查找
 * `<func>/bin/curl-impersonate`，因此在 `astro build` 之后必须把它复制到
 * `.vercel/output/functions/_render.func/bin/`，并确保可执行权限。
 *
 * Vercel 上运行 `npm run build`（见 vercel.json buildCommand），本脚本在 build 尾部执行。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BIN_FILENAME = "curl-impersonate";
const source = path.join(root, "bin", BIN_FILENAME);

const functionDirCandidates = [
  path.join(root, ".vercel", "output", "functions", "_render.func"),
];

// 找到实际存在的函数输出目录
const functionDir = functionDirCandidates.find((d) => fs.existsSync(d));
if (!fs.existsSync(source)) {
  console.warn(`[copy-curl-impersonate] 未找到源二进制 ${path.relative(root, source)}；跳过。`);
  process.exit(0);
}
if (!functionDir) {
  console.warn("[copy-curl-impersonate] 未找到 Vercel 函数输出目录；跳过。");
  process.exit(0);
}

const destDir = path.join(functionDir, "bin");
const dest = path.join(destDir, BIN_FILENAME);

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(source, dest);

// 确保可执行权限（Linux/macOS；Windows 上 chmod 无关紧要但不报错）
try {
  fs.chmodSync(dest, 0o755);
} catch {
  /* ignore */
}

const sizeMB = (fs.statSync(dest).size / (1024 * 1024)).toFixed(2);
console.log(
  `[copy-curl-impersonate] 已复制 ${BIN_FILENAME} (${sizeMB} MB) → ${path.relative(root, dest)}`,
);
