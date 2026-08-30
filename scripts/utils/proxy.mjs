/**
 * proxy.mjs — 代理支持工具
 *
 * 读取 HTTPS_PROXY / HTTP_PROXY 环境变量，并通过 undici 的
 * ProxyAgent 设置全局 dispatcher，使全局 fetch 流量走代理。
 *
 * 本地抓取时需走代理 (http://127.0.0.1:7890) 才能访问 devkitpro 站点，
 * 由调用方设置环境变量即可；本模块负责探测并应用。
 */

let setupDone = false;

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'];

/**
 * 环境变量中是否声明了代理。
 * 纯粹读取，不发起任何连接。
 * @returns {boolean}
 */
export function hasProxyEnv() {
  return PROXY_ENV_KEYS.some((k) => process.env[k]);
}

/**
 * 返回环境变量中配置的代理 URL（未配置则返回 null）
 * 注意：cmd 的 `set HTTPS_PROXY=... && cmd` 会把 && 前的空格带入值，
 * 因此统一 trim 兜底。
 * @returns {string|null}
 */
export function getProxyEnvUrl() {
  for (const k of PROXY_ENV_KEYS) {
    if (process.env[k]) return process.env[k].trim();
  }
  return null;
}

/**
 * 根据环境变量设置全局代理 dispatcher。
 * 幂等：多次调用不会重复设置。
 * @returns {boolean} 是否成功设置了代理
 */
export async function setupProxy() {
  if (setupDone) return true;

  const proxyUrl = getProxyEnvUrl();

  if (!proxyUrl) {
    return false;
  }

  try {
    // 动态导入 undici（避免没有 undici 时直接报错）
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    const agent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(agent);
    setupDone = true;
    console.log(`\x1b[90m[proxy]\x1b[0m 已启用代理: ${proxyUrl}`);
    return true;
  } catch (err) {
    console.log(`\x1b[33m[proxy]\x1b[0m 检测到 HTTPS_PROXY 但无法启用（${err.message}），使用直连`);
    return false;
  }
}
