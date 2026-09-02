#!/usr/bin/env node
/**
 * mirror-indexes.mjs — 探测式抓取上游 pacman / apt 索引文件，落入 public/repo 与 public/apt
 *
 * 用途
 * ----
 * devkitPro 镜像站需要把 pacman（pkg.devkitpro.org/packages/*）与 apt（apt.devkitpro.org/*）
 * 的**索引文件**（.db / .files / Packages / InRelease 等）定期固化进仓库，由 Vercel 静态托管，
 * 从而在 Cloudflare 拦截生产环境动态反代（403）时仍能出文件（Vercel 对 public/ 静态优先）。
 *
 * 本脚本：
 *   1. 内置一份**候选清单**（对 devkitPro 常见结构的合理猜测，可扩展）。
 *   2. 对每个候选做探测抓取：HTTP 404 跳过并记录，5xx/超时重试 2 次，403 记录但不崩。
 *   3. 原子写（先写临时文件再 rename），避免把半截文件提交进仓库。
 *   4. gzip 完整性校验（node:zlib gunzip），校验失败删文件并记为 error。
 *   5. 增量缓存（scripts/.mirror-cache.json，提交进仓库实现 CI 内增量）：非 force 时用
 *      HEAD 对比 etag / last-modified / size，未变更则跳过。
 *
 * CLI 参数
 * --------
 *   --scope repo|apt|all   默认 all
 *   --force                忽略缓存，强制重下
 *   --dry-run              只打印计划，不下载不写文件
 *
 * 退出码语义
 * ----------
 *   0  = 全部核心文件成功（允许部分候选 404/可选文件失败）
 *   1  = 至少一个核心文件下载失败（需人工关注）
 *   2  = 用法错误（未知参数等）
 *
 * 运行示例
 * --------
 *   node scripts/mirror-indexes.mjs
 *   node scripts/mirror-indexes.mjs --scope apt --force
 *   node scripts/mirror-indexes.mjs --scope repo --dry-run
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const CACHE_FILE = path.join(__dirname, ".mirror-cache.json");
const IMPERSONATE = "chrome142";
const TIMEOUT_S = 30;
const RETRIES = 2; // 5xx / 超时最多额外重试 2 次
const UA_PACMAN = "pacman/6.1.0 (Arch Linux)";
const UA_APT = "apt/2.7.14 (x86_64-pc-linux-gnu)";

// ---------------------------------------------------------------------------
// 候选清单
//
// 说明：这是对 devkitPro 已知常见结构的**合理猜测**，脚本会对每个候选做探测
// （GET）——404 跳过，2xx 才落盘。跑一次 workflow 看日志即可知道真实结构，
// 再按需增补。key 是“人类可读名”，url 是抓取源，rel 是落盘相对路径（public/<rel>）。
// core=true 表示该文件是“必须有”的（缺失会让脚本返回非零）；探测式架构目录
// （switch/wii/…）即便不存在也只是记为 skip，不算失败。
// ---------------------------------------------------------------------------
const pacmanFileSet = [
  ".db", ".db.sig", ".files", ".files.sig",
  ".db.tar.gz", ".db.tar.xz", ".db.tar.zst",
];

function pacmanCandidates(scopeRel, repoName) {
  // scopeRel: ""（顶层 dkp-libs）或 "linux/x86_64" 等架构目录
  return pacmanFileSet.map((ext) => {
    const fileName = `${repoName}${ext}`;
    const rel = scopeRel ? `${scopeRel}/${fileName}` : fileName;
    return {
      kind: "repo",
      name: rel,
      url: `https://pkg.devkitpro.org/packages/${rel}`,
      rel,
      ua: UA_PACMAN,
      core: false,
    };
  });
}

const PACMAN_TOP_LEVEL_REPO = "dkp-libs";
const PACMAN_ARCH_DIRS = [
  "",                       // 顶层 dkp-libs.*
  "linux/x86_64",           // dkp-linux.db 系列
  "switch",
  "wii",
  "wiiu",
  "3ds",
  "nx",
  "linux/arm",
  "linux/armv7h",
  "linux/armv6h",
  "linux/aarch64",
];
// 每个目录下探测的仓库名（dkp-*）
const PACMAN_REPO_NAMES_BY_DIR = {
  "": [PACMAN_TOP_LEVEL_REPO],
  "linux/x86_64": ["dkp-linux"],
  switch: ["dkp-switch"],
  wii: ["dkp-wii"],
  wiiu: ["dkp-wiiu"],
  "3ds": ["dkp-3ds"],
  nx: ["dkp-nx"],
  "linux/arm": ["dkp-linux"],
  "linux/armv7h": ["dkp-linux"],
  "linux/armv6h": ["dkp-linux"],
  "linux/aarch64": ["dkp-linux"],
};

function aptCandidates() {
  const out = [];
  const base = "dists/stable";
  const mandatoryMeta = [
    { name: `${base}/InRelease`, core: true },
    { name: `${base}/Release`, core: false },
    { name: `${base}/Release.gpg`, core: false },
  ];
  for (const m of mandatoryMeta) {
    out.push({
      kind: "apt",
      name: m.name,
      url: `https://apt.devkitpro.org/${m.name}`,
      rel: m.name,
      ua: UA_APT,
      core: m.core,
    });
  }
  const comp = "main";
  // binary<i386|amd64|arm64|armhf> Packages{,.gz,.xz}（探测，非核心）
  for (const arch of ["i386", "amd64", "arm64", "armhf"]) {
    for (const ext of ["", ".gz", ".xz"]) {
      const name = `${base}/${comp}/binary-${arch}/Packages${ext}`;
      out.push({
        kind: "apt",
        name,
        url: `https://apt.devkitpro.org/${name}`,
        rel: name,
        ua: UA_APT,
        core: false,
      });
    }
  }
  // Contents-*（探测，非核心）
  for (const arch of ["amd64", "arm64", "i386"]) {
    for (const ext of ["", ".gz"]) {
      const name = `${base}/${comp}/Contents-${arch}${ext}`;
      out.push({
        kind: "apt",
        name,
        url: `https://apt.devkitpro.org/${name}`,
        rel: name,
        ua: UA_APT,
        core: false,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { scope: "all", force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") opts.force = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--scope") {
      const v = argv[++i];
      if (v !== "repo" && v !== "apt" && v !== "all") {
        console.error(`[usage] --scope 必须是 repo|apt|all，收到 ${v}`);
        process.exit(2);
      }
      opts.scope = v;
    } else if (a.startsWith("--scope=")) {
      const v = a.slice("--scope=".length);
      if (v !== "repo" && v !== "apt" && v !== "all") {
        console.error(`[usage] --scope= 必须是 repo|apt|all，收到 ${v}`);
        process.exit(2);
      }
      opts.scope = v;
    } else if (a === "-h" || a === "--help") {
      console.log(
        "用法: node scripts/mirror-indexes.mjs [--scope repo|apt|all] [--force] [--dry-run]",
      );
      process.exit(0);
    } else {
      console.error(`[usage] 未知参数: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// curl 二进制解析
// ---------------------------------------------------------------------------
function resolveCurl() {
  // 1. 环境变量覆盖
  if (process.env.CURL_IMPERSONATE_BIN) {
    const p = process.env.CURL_IMPERSONATE_BIN;
    if (fs.existsSync(p)) return { bin: p, impersonate: true };
    console.warn(`[curl] CURL_IMPERSONATE_BIN=${p} 不存在，回退到内置二进制`);
  }
  // 2. 仓库自带静态 curl-impersonate
  const bundled = path.join(ROOT, "bin", "curl-impersonate");
  if (fs.existsSync(bundled)) return { bin: bundled, impersonate: true };
  // 3. 系统 curl
  return { bin: "curl", impersonate: false };
}

// ---------------------------------------------------------------------------
// 单次 curl 调用：返回 { code, size, etag, lastModified, bodyPath? , error? }
// 直接写入 bodyPath（原子写在调用方做）。
// ---------------------------------------------------------------------------
function runCurl(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: (TIMEOUT_S + 5) * 1000, windowsHide: true }, (err, stdout) => {
      if (err) {
        const code = typeof err.code === "number" ? err.code : String(err.code ?? "?");
        const cause = (err.stderr || "").toString().trim();
        resolve({ error: `curl exit ${code}${cause ? ` :: ${cause}` : ""}` });
        return;
      }
      resolve({ stdout: stdout.toString() });
    });
  });
}

/**
 * 下载单个候选。返回 { status: 'ok'|'skip'|'unchanged'|'error', detail }
 *   ok        → 已写盘
 *   unchanged → 缓存命中，跳过
 *   skip      → 404（候选不存在，不算失败）
 *   error     → 下载/校验失败（核心文件会令退出码非零）
 */
async function fetchCandidate(curl, cand, cache, opts) {
  const dest = path.join(ROOT, "public", cand.kind, cand.rel);
  const tmpDir = path.join(ROOT, "public", ".mirror-tmp");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpBody = path.join(tmpDir, `${Buffer.from(cand.url).toString("base64url")}.body`);
  const tmpHeaders = path.join(tmpDir, `${Buffer.from(cand.url).toString("base64url")}.hdr`);

  const prev = cache[cand.url];

  // 增量：非 force 且曾成功下载过 → HEAD 对比
  if (!opts.force && prev && prev.ok) {
    const cmds = [
      "-sS",
      "--max-time", String(TIMEOUT_S),
      "--head",
      "-o", "/dev/null",
      "-D", tmpHeaders,
      "-A", cand.ua,
      cand.url,
    ];
    if (curl.impersonate) cmds.splice(1, 0, "--impersonate", IMPERSONATE, "-L", "--raw");
    const r = await runCurl(curl.bin, cmds);
    if (r.error) {
      // HEAD 失败（某些服务器不支持 HEAD）→ 回退到 GET 全量比对（见下方逻辑）
      console.log(`[info] HEAD 失败，回退 GET: ${cand.name} (${r.error})`);
    } else {
      const hdr = parseHeaderFile(tmpHeaders);
      const cur = {
        size: hdr.size,
        etag: hdr.etag,
        lastModified: hdr.lastModified,
      };
      if (hdr.code === 404) {
        return { status: "skip", detail: `${cand.name} → HEAD 404` };
      }
      if (sameEnough(cur, prev)) {
        return { status: "unchanged", detail: cand.name };
      }
    }
  }

  // 干跑：不下载
  if (opts.dryRun) {
    console.log(`[dry-run] 将下载 ${cand.kind}/${cand.rel}  ←  ${cand.url}`);
    return { status: "skipped?(dry-run)", detail: cand.name };
  }

  // GET 下载（含最大 2 次重试）
  let lastError = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const cmds = [
      "-sS",
      "--max-time", String(TIMEOUT_S),
      "-L",
      "--raw",
      "-o", tmpBody,
      "-D", tmpHeaders,
      "-w", "%{http_code}",
      "-A", cand.ua,
      cand.url,
    ];
    if (curl.impersonate) cmds.splice(1, 0, "--impersonate", IMPERSONATE);
    const r = await runCurl(curl.bin, cmds);

    if (r.error) {
      lastError = `curl 失败: ${r.error}`;
      // 超时/连接失败 → 重试
      if (attempt < RETRIES) {
        console.log(`[retry] (${attempt + 1}/${RETRIES}) ${cand.name} — ${lastError}`);
        continue;
      }
      break;
    }

    const code = parseInt(r.stdout || "0", 10) || 0;
    const hdr = parseHeaderFile(tmpHeaders);

    if (code === 404 || code === 410) {
      return { status: "skip", detail: `${cand.name} → 404` };
    }
    if (code === 403) {
      // 403 记录但不崩；放可选文件则不视为 error，核心文件仍视作 error
      lastError = `${cand.name} → 403 Forbidden`;
      break;
    }
    if (code >= 500 || code === 0) {
      lastError = `${cand.name} → HTTP ${code || "无响应"}`;
      if (attempt < RETRIES) {
        console.log(`[retry] (${attempt + 1}/${RETRIES}) ${cand.name} — ${lastError}`);
        continue;
      }
      break;
    }
    if (code !== 200) {
      lastError = `${cand.name} → unexpected HTTP ${code}`;
      break;
    }

    // 200：校验字节数 & gzip 完整性
    let size = 0;
    try {
      size = fs.statSync(tmpBody).size;
    } catch {
      /* ignore */
    }
    if (size === 0) {
      lastError = `${cand.name} → 200 但 0 字节`;
      if (attempt < RETRIES) {
        console.log(`[retry] (${attempt + 1}/${RETRIES}) ${cand.name} — ${lastError}`);
        continue;
      }
      break;
    }

    // gzip 校验（.db / .gz 等以 1f 8b 开头的）
    const gzipOk = await verifyGzip(tmpBody, cand.name);
    if (!gzipOk) {
      lastError = `${cand.name} → gzip 完整性校验失败`;
      break;
    }

    // 原子写：临时文件（同分区 tmp）→ rename
    const tmpDest = path.join(dirname(dest), `.${path.basename(dest)}.${process.pid}.tmp`);
    fs.copyFileSync(tmpBody, tmpDest);
    fs.renameSync(tmpDest, dest);
    fs.rmSync(tmpBody, { force: true });

    // 更新缓存
    cache[cand.url] = {
      ok: true,
      size,
      etag: hdr.etag,
      lastModified: hdr.lastModified,
      updatedAt: new Date().toISOString(),
    };

    console.log(`[ok] ${cand.kind}/${cand.rel}  (${size} bytes)`);
    if (hdr.etag) console.log(`     etag=${hdr.etag}`);
    if (hdr.lastModified) console.log(`     last-modified=${hdr.lastModified}`);
    return { status: "ok", detail: cand.name, size };
  }

  // 到这里 = 未成功
  // 403 且非核心 → 记 warning 但仍算 error 级日志；退出码取决于 core
  console.log(`[error] ${cand.name} — ${lastError}`);
  return { status: "error", detail: `${cand.name}: ${lastError}` };
}

function dirname(p) {
  return path.dirname(p);
}

/** 读取 curl -D 头文件，归一化小写键，返回 code/size/etag/lastModified */
function parseHeaderFile(file) {
  const out = { code: 0, size: null, etag: null, lastModified: null };
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  raw = raw.replace(/\r/g, "");
  const headers = {};
  let status = 0;
  for (const line of raw.split("\n")) {
    if (/^HTTP\/\d(\.\d+)?\s+\d{3}/.test(line)) {
      const m = line.match(/^HTTP\/\d(?:\.\d+)?\s+(\d{3})/);
      if (m) status = parseInt(m[1], 10);
      Object.keys(headers).forEach((k) => delete headers[k]); // 跟随重定向取最终响应
      continue;
    }
    const colon = line.indexOf(":");
    if (colon > 0) {
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (!(key in headers)) headers[key] = value;
    }
  }
  out.code = status;
  if (headers["content-length"]) out.size = parseInt(headers["content-length"], 10);
  if (headers["etag"]) out.etag = headers["etag"];
  if (headers["last-modified"]) out.lastModified = headers["last-modified"];
  return out;
}

/** 判断当前 HEAD 元数据与缓存是否“足够相同”（都缺失时视为不同，走 GET 全量核对） */
function sameEnough(cur, prev) {
  if (!prev || !cur) return false;
  // 若两者都有 size 且相等，或都有 etag 且相等 → 视为未变更
  if (cur.size != null && prev.size === cur.size) return true;
  if (cur.etag && prev.etag && cur.etag === prev.etag) return true;
  if (cur.lastModified && prev.lastModified && cur.lastModified === prev.lastModified) return true;
  // 智能：content-length 的 HEAD 与先前一致但元数据缺失 → 保守返回 false，走 GET
  return false;
}

/** gzip 完整性：若以 1f 8b 开头则 gunzip 校验，失败返回 false */
async function verifyGzip(file, name) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return false;
  }
  if (buf.length < 2 || buf[0] !== 0x1f || buf[1] !== 0x8b) {
    return true; // 非 gzip（如 .xz/.zst/Packages 纯文本），不校验
  }
  try {
    await new Promise((resolve, reject) => {
      zlib.gunzip(buf, (err, out) => (err ? reject(err) : resolve(out)));
    });
    return true;
  } catch (e) {
    console.log(`[gzip-fail] ${name}: ${e.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`[mirror] scope=${opts.scope} force=${opts.force} dryRun=${opts.dryRun}`);

  const curl = resolveCurl();
  console.log(`[curl] 使用 ${curl.impersonate ? `curl-impersonate (${curl.bin})` : `系统 curl (${curl.bin})`}`);

  if (curl.impersonate) {
    // 校验二进制可执行（--version 失败 → 回退系统 curl）
    const v = await runCurl(curl.bin, ["--version"]);
    if (v.error) {
      console.warn(`[curl] curl-impersonate --version 失败 (${v.error})，回退系统 curl`);
      curl.impersonate = false;
      curl.bin = "curl";
    } else {
      console.log(`[curl] ${v.stdout.split("\n")[0] || "curl-impersonate"}`);
    }
  }

  // 载入缓存
  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    } catch {
      cache = {};
    }
  }

  // 组装候选
  const candidates = [];
  if (opts.scope === "repo" || opts.scope === "all") {
    for (const dir of PACMAN_ARCH_DIRS) {
      const names = PACMAN_REPO_NAMES_BY_DIR[dir] || ["dkp-linux"];
      for (const repoName of names) {
        candidates.push(...pacmanCandidates(dir, repoName));
      }
    }
  }
  if (opts.scope === "apt" || opts.scope === "all") {
    candidates.push(...aptCandidates());
  }
  console.log(`[mirror] 候选数 ${candidates.length}`);

  const stats = { downloaded: 0, unchanged: 0, skipped404: 0, errors: 0, coreErrors: [] };

  for (const cand of candidates) {
    const res = await fetchCandidate(curl, cand, cache, opts);
    if (res.status === "ok") stats.downloaded++;
    else if (res.status === "unchanged") stats.unchanged++;
    else if (res.status === "skip") {
      stats.skipped404++;
      console.log(`[skip] 404 ${cand.kind}/${cand.rel}`);
    } else if (res.status === "error") {
      stats.errors++;
      if (cand.core) stats.coreErrors.push(res.detail);
    }
  }

  // 保存缓存（已下载的文件会更新其行；404/skip 也保留上次 ok 记录以便 HEAD 复用）
  if (!opts.dryRun) {
    fs.mkdirSync(__dirname, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  }

  // 清理临时目录
  try {
    fs.rmSync(path.join(ROOT, "public", ".mirror-tmp"), { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  console.log("");
  console.log("===== 抓取汇总 =====");
  console.log(`  downloaded : ${stats.downloaded}`);
  console.log(`  unchanged  : ${stats.unchanged}`);
  console.log(`  skipped404 : ${stats.skipped404}`);
  console.log(`  errors     : ${stats.errors}`);
  if (stats.coreErrors.length) {
    console.log("  [核心失败]");
    for (const e of stats.coreErrors) console.log(`    - ${e}`);
  }
  console.log("====================");

  if (stats.coreErrors.length > 0) {
    console.error(`\n[FAIL] ${stats.coreErrors.length} 个核心文件下载失败，退出码 1`);
    process.exit(1);
  }
  console.log("\n[OK] 无核心文件失败");
  process.exit(0);
}

main().catch((e) => {
  console.error(`[fatal] ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
