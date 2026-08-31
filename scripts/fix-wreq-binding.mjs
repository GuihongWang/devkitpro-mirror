/**
 * Post-build step: ensure wreq-js's native NAPI binding is copied into the
 * Vercel Serverless function output.
 *
 * WHY THIS IS NEEDED
 * -------------------
 * `@astrojs/vercel` bundles the server function using `@vercel/nft`, which
 * statically traces the dependencies reachable from the SSR entry. wreq-js
 * loads its platform-specific native addon via a **dynamic** requirement:
 *
 *     require("@wreq-js/binding-<target>")   // target is computed at runtime
 *
 * nft cannot resolve that computed string, so the `@wreq-js/binding-*`
 * package is NOT included in `_render.func/node_modules`, and the deployed
 * function would crash with "Failed to load native module for <target>".
 *
 * Because the dependency is installed by pnpm on the platform where the build
 * runs (win32 binding locally, linux-x64-gnu on Vercel), this script copies
 * the binding that is present for the CURRENT platform into the function
 * output, mirroring pnpm's virtual-store layout so the runtime `require`
 * resolves it.
 *
 * This only needs to run after `astro build`; Vercel runs `npm run build`.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Mirror wreq-js's own platform resolution so we copy the same binding it loads. */
function platformTarget() {
  const { platform, arch } = process;
  if (platform === "win32" && arch === "x64") return "win32-x64-msvc";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "linux" && arch === "x64") {
    const report = process.report?.getReport?.();
    return report?.header?.glibcVersionRuntime ? "linux-x64-gnu" : "linux-x64-musl";
  }
  if (platform === "linux" && arch === "arm64") {
    const report = process.report?.getReport?.();
    return report?.header?.glibcVersionRuntime ? "linux-arm64-gnu" : "linux-arm64-musl";
  }
  return null;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const target = platformTarget();
if (!target) {
  console.warn(`[fix-wreq-binding] Unsupported platform ${process.platform}-${process.arch}; skipping.`);
  process.exit(0);
}

let wreqEntry;
try {
  wreqEntry = require.resolve("wreq-js");
} catch {
  console.warn("[fix-wreq-binding] wreq-js is not installed; nothing to do.");
  process.exit(0);
}

// wreq-js dist -> package dir. Its binding is a virtual-store sibling.
const wreqPackageDir = path.dirname(path.dirname(wreqEntry));
const bindingSource = path.join(
  path.dirname(wreqPackageDir),
  "@wreq-js",
  `binding-${target}`,
);

if (!fs.existsSync(bindingSource)) {
  console.warn(
    `[fix-wreq-binding] Binding not found at ${bindingSource}; nothing to copy.`,
  );
  process.exit(0);
}

// Locate the Vercel function output (Astro's single server function).
const functionDir = path.join(root, ".vercel", "output", "functions", "_render.func", "node_modules");
if (!fs.existsSync(functionDir)) {
  console.warn("[fix-wreq-binding] Vercel function output not found; skipping.");
  process.exit(0);
}

// Mirror the pnpm virtual-store layout that the runtime resolves against:
//   <func>/node_modules/.pnpm/wreq-js@<ver>/node_modules/@wreq-js/binding-<target>
const pnpmStore = path.join(functionDir, ".pnpm");
const matchingStores = fs
  .readdirSync(pnpmStore)
  .filter((name) => name.startsWith("wreq-js@") && name.includes("@3."));
const placements = matchingStores.map((storeName) =>
  path.join(pnpmStore, storeName, "node_modules", "@wreq-js", `binding-${target}`),
);

if (placements.length === 0) {
  console.warn("[fix-wreq-binding] Could not find wreq-js in the function's .pnpm store; skipping.");
  process.exit(0);
}

for (const destination of placements) {
  if (fs.existsSync(destination)) continue;
  copyDir(bindingSource, destination);
  console.log(`[fix-wreq-binding] Copied ${target} binding to ${path.relative(root, destination)}`);
}

console.log(`[fix-wreq-binding] Done (target=${target}).`);
