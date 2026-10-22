/**
 * 小程序插件的代码
 *
 * 插件代码不在项目里，同开发者工具：开发服务器带着开发者 ticket 向微信下载（wxa-dev/getplugincode），
 * 只放在内存里，同一个插件版本下载一次。下载要用开发者的登录态，所以只在开启 --real-login 时进行；
 * 小程序的 appid 要已在管理后台添加了这个插件，并经插件开发者通过。
 *
 * 下载到的是 .wxvpkg 格式的包，里面是编译好的产物：
 *   /plugin.json        插件页面表（pages）和每个页面的 window 配置（page）
 *   /appservice.js      逻辑层：definePlugin(...) 注册插件，自己 requirePlugin 完成初始化
 *   /pageframe.js       渲染层：插件的模板函数 $gwx_<插件 appid> 和样式
 *   /pages/x/x.html     插件页面：注入样式、取模板、派发 generateFuncReady
 *   /static/...         图片等资源
 * 插件页面的路径是 __plugin__/<插件 appid>/pages/x/x，基础库把 plugin://别名/页面名 解析成它再交给原生路由。
 */

import { readWxvpkgFile, readWxvpkgIndex } from '@open-wxa/wxa-runner-extractor';
import type { BuildResult } from '../project/AppBuilder';
import type { TicketSource } from './developerTicket';
import { CLIENT_VERSION, requireUsableTicket } from './realLogin';

const GET_PLUGIN_CODE = 'https://servicewechat.com/wxa-dev/getplugincode';
const DOWNLOAD_TIMEOUT = 30_000;
const PACKAGE_MAGIC = 0xbe;

export interface PluginCode {
  /** app.json 里的引用名，plugin://<alias>/页面名 */
  alias: string;
  /** 插件 appid */
  provider: string;
  version: string;
  /** 包内路径（/ 开头）→ 内容 */
  files: Map<string, Buffer>;
  /** 插件页面的路径，如 __plugin__/wx…/pages/index/index */
  pages: string[];
  /** 插件页面的配置，键同 __wxConfig.page（路径加 .html） */
  pageConfigs: Record<string, unknown>;
}

/** 构建结果加上用到的插件：插件页面并入 pages，配置并入 __wxConfig.page */
export interface AppBuild extends BuildResult {
  plugins: PluginCode[];
}

/** app.json 的 plugins：引用名 → { provider, version } */
type DeclaredPlugins = Record<string, { provider?: string; version?: string }>;

export class PluginStore {
  /** provider@version → 下载结果；失败的不留，下次打开小程序时重试 */
  private readonly downloads = new Map<string, Promise<PluginCode>>();
  private readonly warned = new Set<string>();

  /**
   * @param ticketSource 开启 --real-login 时才有，没有时不下载插件
   */
  constructor(
    private readonly appid: string,
    private readonly ticketSource: TicketSource | null,
    private readonly logger: Pick<Console, 'warn'>
  ) {}

  /** 并入 app.json 声明的插件；下载不了的跳过，在终端说明原因，小程序自己的页面照常可用 */
  async apply(build: BuildResult): Promise<AppBuild> {
    const declared: DeclaredPlugins = build.wxConfig.plugins || {};
    const results = await Promise.all(Object.entries(declared).map(([alias, { provider, version }]) =>
      provider && version ? this.load(alias, provider, version) : null
    ));
    const plugins = results.filter((plugin): plugin is PluginCode => !!plugin);
    if (!plugins.length) return { ...build, plugins };

    return {
      ...build,
      plugins,
      pages: [...build.pages, ...plugins.flatMap(plugin => plugin.pages)],
      wxConfig: {
        ...build.wxConfig,
        page: { ...build.wxConfig.page, ...Object.assign({}, ...plugins.map(plugin => plugin.pageConfigs)) }
      }
    };
  }

  private async load(alias: string, provider: string, version: string): Promise<PluginCode | null> {
    const label = `插件 ${alias}（${provider}@${version}）`;
    if (!this.ticketSource) {
      this.warnOnce(label, `[wxa-runner] ${label} 的代码要用开发者的登录态向微信下载，启动时加 --real-login`);
      return null;
    }

    const key = `${provider}@${version}`;
    let download = this.downloads.get(key);
    if (!download) {
      download = this.download(alias, provider, version);
      this.downloads.set(key, download);
      download.catch(() => this.downloads.delete(key));
    }
    try {
      return await download;
    } catch (error) {
      this.logger.warn(`[wxa-runner] ${label} 下载失败：${(error as Error).message}`);
      return null;
    }
  }

  /** @throws 没有登录态、微信拒绝或返回的不是插件代码包时，消息是原因 */
  private async download(alias: string, provider: string, version: string): Promise<PluginCode> {
    const ticket = requireUsableTicket(await this.ticketSource!());
    const query = new URLSearchParams({ appid: this.appid, newticket: ticket, clientversion: CLIENT_VERSION });
    const response = await fetch(`${GET_PLUGIN_CODE}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plugin_id: provider, plugin_version: version }),
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT)
    });
    if (!response.ok) throw new Error(`微信服务器返回 HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    // 出错时返回的是 JSON
    if (data[0] !== PACKAGE_MAGIC) {
      let error: { errcode?: number; errmsg?: string } = {};
      try {
        error = JSON.parse(data.toString('utf8')).baseresponse || {};
      } catch {
        // 不是 JSON，按没有结果码处理
      }
      throw new Error(error.errcode ? `${error.errcode}: ${error.errmsg || '未知错误'}` : '微信没有返回插件代码');
    }

    const files = new Map(readWxvpkgIndex(data).map(entry => [entry.name, Buffer.from(readWxvpkgFile(data, entry))]));
    const pluginJson = JSON.parse(files.get('/plugin.json')?.toString('utf8') || '{}');
    return {
      alias,
      provider,
      version,
      files,
      pages: Object.values<string>(pluginJson.pages || {}),
      pageConfigs: pluginJson.page || {}
    };
  }

  private warnOnce(key: string, message: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.warn(message);
  }
}

/** 插件页面所属的插件，以及页面在插件包里的路径（不带扩展名） */
export function findPluginPage(build: AppBuild, pagePath: string): { plugin: PluginCode; innerPath: string } | null {
  for (const plugin of build.plugins) {
    const prefix = `__plugin__/${plugin.provider}/`;
    if (plugin.pages.includes(pagePath)) return { plugin, innerPath: pagePath.slice(prefix.length) };
  }
  return null;
}

export function pluginScriptUrl(plugin: PluginCode, file: 'appservice.js' | 'pageframe.js'): string {
  return `/__wxa__/plugin/${encodeURIComponent(plugin.provider)}/${encodeURIComponent(plugin.version)}/${file}`;
}
