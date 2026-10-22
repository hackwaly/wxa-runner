/**
 * 开发服务器
 *
 *   /                          宿主页面
 *   /__wxa__/app-info.json     构建信息（__wxConfig、页面列表、设备参数、setup）
 *   /__wxa__/setup.js          编译后的 setup 文件
 *   /__wxa__/appservice.html   逻辑层
 *   /__wxa__/webview/<page>.html  渲染层（路径与页面一致，wxml 里的相对资源路径因此能正确解析）
 *   /__wxa__/module/<file>.js  单个业务 JS 模块（含 workers 目录下的）
 *   /__wxa__/worker.js?id=     Worker 的入口
 *   /__wxa__/service-templates.js、page-templates.js  两层的模板（热更新时重新下发）
 *   /__wxa__/page-styles.js    渲染层的样式（热更新时重新下发）
 *   /__baselib__/*             官方基础库
 *   /__wxa__/proxy?url=        网络代理
 *   /__wxa__/tmp               临时文件：POST ?type=png 保存，返回可直接访问的地址（GET 支持分段请求）；对该地址 HEAD 查大小、DELETE 删除
 *   /__wxa__/region/<kind>     地区选择器用的行政区划数据（districts / streets），取自本机开发者工具
 *   /__wxa__/api/*             真实登录（--real-login）：wx.login 的 code、手机号，服务市场转发，只允许本机访问
 *   /__wxa__/ws                文件变化通知：热更新（hot）或整页刷新（reload）
 *   其余路径                    小程序目录下的静态资源
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import express, { Express, NextFunction, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { readRegionData, resolveBaseLib, ResolvedBaseLib, usesIsolatedContext } from '@open-wxa/wxa-runner-extractor';
import { AppBuilder, BuildResult } from '../project/AppBuilder';
import { MiniProgram } from '../project/MiniProgram';
import type { AppInfo, DeviceProfile } from '../runtime/types';
import { appserviceHtml, hostHtml, subcontextHtml, webviewHtml, workerScript } from './html';
import { ignoreListSourceMap } from './ignoreList';
import { handleProxy } from './proxy';
import { planHotUpdate } from './hmr';
import { developerTicketSource, TicketSource } from './developerTicket';
import { realLoginRouter, requireUsableTicket } from './realLogin';
import { bundleSetup, collectSetupEnv, findSetupFile } from './setup';
import { ProjectWatcher, watchProject } from './watcher';

export interface DevServerOptions {
  projectPath: string;
  /** 默认 3000，传 0 使用随机端口 */
  port?: number;
  host?: string;
  /** 指定基础库版本，默认使用本机已安装的最新兼容版本 */
  baseLibVersion?: string;
  baseLibCacheDir?: string;
  watch?: boolean;
  device?: Partial<DeviceProfile>;
  /**
   * 小程序启动前执行的 setup 文件；默认使用项目目录下的 wxa.setup.ts / .js / .mjs，传 false 不使用
   * 环境变量在构造时读取，只暴露 WXA_ 前缀的变量
   */
  setup?: string | false;
  /** 浏览器端运行时（host.js / frame.js）所在目录，默认取构建产物 */
  runtimeDir?: string;
  /** 使用本机微信开发者工具登录态获取真实 code 和手机号 */
  realLogin?: boolean;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export const DEFAULT_DEVICE: DeviceProfile = {
  model: 'iPhone X',
  screenWidth: 375,
  screenHeight: 812,
  pixelRatio: 3,
  statusBarHeight: 44,
  safeAreaBottom: 34,
  system: 'iOS 16.0',
  platform: 'devtools'
};

export class DevServer {
  readonly project: MiniProgram;
  readonly builder: AppBuilder;
  readonly baseLib: ResolvedBaseLib;
  /** 生效的 setup 文件绝对路径，没有时为 null */
  readonly setupFile: string | null;
  private readonly setupEnv: Record<string, string>;
  private readonly device: DeviceProfile;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly app: Express;
  private server: http.Server | null = null;
  private sockets: WebSocketServer | null = null;
  private watcher: ProjectWatcher | null = null;
  private address = '';
  /** 运行时生成的临时文件（canvas 导出、拍照等），随服务器进程存在 */
  private readonly tempFiles = new Map<string, Buffer>();
  /** 开启 --real-login 时才有 */
  private readonly ticketSource: TicketSource | null;

  constructor(private readonly options: DevServerOptions) {
    this.logger = options.logger || console;
    this.project = new MiniProgram(path.resolve(options.projectPath));
    this.baseLib = resolveBaseLib({ version: options.baseLibVersion, cacheDir: options.baseLibCacheDir });
    if (!this.baseLib.compatible) {
      this.logger.warn(`[wxa-runner] 基础库 ${this.baseLib.version} 高于已验证的版本范围，可能无法正常运行`);
    }
    this.ticketSource = options.realLogin ? developerTicketSource(this.project.projectPath, this.logger) : null;
    this.device = { ...DEFAULT_DEVICE, ...options.device };
    this.builder = new AppBuilder(this.project);
    this.setupFile = resolveSetupFile(options.setup, this.project.projectPath);
    this.setupEnv = collectSetupEnv(process.env);
    this.app = this.createApp();
  }

  get url(): string {
    return this.address;
  }

  async start(): Promise<string> {
    // 先构建一次：编译错误在终端里立即可见
    try {
      const build = await this.builder.build();
      this.logger.log(`[wxa-runner] 编译完成：${build.pages.length} 个页面，${build.components.length} 个组件，${build.durationMs}ms`);
    } catch (error) {
      this.logger.error(`[wxa-runner] 编译失败：\n${(error as Error).message}`);
    }

    const server = http.createServer(this.app);
    this.sockets = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      if (req.url?.startsWith('/__wxa__/ws')) {
        this.sockets!.handleUpgrade(req, socket, head, ws => this.sockets!.emit('connection', ws, req));
      } else {
        socket.destroy();
      }
    });

    const host = this.options.host || 'localhost';
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port ?? 3000, host, () => resolve());
    });
    this.server = server;

    const { port } = server.address() as { port: number };
    this.address = `http://${host}:${port}`;

    if (this.options.watch !== false) this.startWatching();
    // 启动时先取一次：新版开发者工具要先为项目开启自动化接口，第一次 wx.login 就不用等；不可用时在终端提示原因
    this.ticketSource?.()
      .then(requireUsableTicket)
      .catch(error => this.logger.warn(`[wxa-runner] 真实登录暂不可用：${error.message}`));
    return this.address;
  }

  async close() {
    await this.watcher?.close();
    this.sockets?.clients.forEach(client => client.terminate());
    this.sockets?.close();
    const server = this.server;
    this.server = null;
    if (server) {
      // 浏览器和 fetch 的 keep-alive 连接会让 close() 一直等到超时
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }

  private createApp(): Express {
    const app = express();
    const root = this.project.root;
    const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

    app.get('/', (_req, res) => {
      noStore(res);
      res.type('html').send(hostHtml());
    });

    app.get('/favicon.ico', (_req, res) => {
      res.status(204).end();
    });

    app.get('/__wxa__/app-info.json', async (_req, res) => {
      noStore(res);
      const base = { appid: this.project.appid, baseLibVersion: this.baseLib.version, device: this.device, realLogin: this.options.realLogin === true };
      try {
        const build = await this.builder.build();
        const info: AppInfo = { ...base, version: build.version, wxConfig: build.wxConfig, pages: build.pages };
        if (this.setupFile) info.setup = await this.setupInfo(this.setupFile);
        res.json(info);
      } catch (error) {
        res.json({ ...base, version: 0, wxConfig: {}, pages: [], buildError: (error as Error).message });
      }
    });

    app.get('/__wxa__/setup.js', async (_req, res) => {
      noStore(res);
      if (!this.setupFile) {
        res.status(404).type('text').send('没有 setup 文件');
        return;
      }
      try {
        res.type('js').send(await bundleSetup(this.setupFile));
      } catch (error) {
        res.status(500).type('text').send((error as Error).message);
      }
    });

    app.get('/__wxa__/appservice.html', this.withBuild((build, req, res) => {
      const launchPath = String(req.query.path || '').replace(/^\//, '');
      const launch = build.pages.includes(launchPath)
        ? { path: launchPath, query: Object.fromEntries(new URLSearchParams(String(req.query.query || ''))) }
        : { path: build.pages[0], query: {} };
      res.type('html').send(appserviceHtml(build, launch, { hot: this.hotEnabled, isolated: usesIsolatedContext(this.baseLib.version) }));
    }));

    app.get('/__wxa__/subcontext.html', (req, res) => {
      const id = Number(req.query.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).type('text').send('子上下文 id 无效');
        return;
      }
      res.type('html').send(subcontextHtml(id, req.query.empty === '1'));
    });

    app.get(/^\/__wxa__\/webview\/(.+)\.html$/, this.withBuild((build, req, res, next) => {
      const pagePath = decodeURIComponent(req.params[0]);
      if (!build.pages.includes(pagePath)) return next();
      res.type('html').send(webviewHtml(build, pagePath, Number(req.query.id), { hot: this.hotEnabled }));
    }));

    app.get(/^\/__wxa__\/module\/(.+\.js)$/, this.withBuild((build, req, res) => {
      const id = decodeURIComponent(req.params[0]);
      if (!build.modules.includes(id) && !build.workerModules.includes(id)) {
        res.status(404).type('js').send(`console.error(${JSON.stringify(`[wxa-runner] 模块 ${id} 不存在`)})`);
        return;
      }
      res.type('js').send(this.builder.getModuleScript(id));
    }));

    app.get('/__wxa__/worker.js', this.withBuild((build, _req, res) => {
      const hasWorker = fs.existsSync(path.join(this.baseLib.dir, 'WAWorker.js'));
      res.type('js').send(workerScript(build, { version: this.baseLib.version, hasWorker }));
    }));

    app.get('/__wxa__/service-bootstrap.js', this.withBuild((build, _req, res) => {
      res.type('js').send(build.serviceBootstrap);
    }));

    app.get('/__wxa__/service-templates.js', this.withBuild((build, _req, res) => {
      res.type('js').send(build.serviceTemplates);
    }));

    app.get('/__wxa__/page-templates.js', this.withBuild((build, _req, res) => {
      res.type('js').send(build.pageTemplates);
    }));

    app.get('/__wxa__/page-styles.js', this.withBuild((build, _req, res) => {
      res.type('js').send(build.pageStyles);
    }));

    app.get('/__wxa__/page-frame.js', this.withBuild((build, _req, res) => {
      res.type('js').send(build.pageFrame);
    }));

    app.use('/__wxa__/runtime', express.static(this.runtimeDir(), { cacheControl: false }));
    // 基础库脚本加入 DevTools 的忽略列表，原始代码就是脚本本身（换个地址，免得和脚本混为一个文件）
    const sourceMaps = new Map<string, string>();
    app.get(/^\/__baselib__\/(.+\.js)\.map$/, (req, res, next) => {
      const file = path.resolve(this.baseLib.dir, req.params[0]);
      if (!file.startsWith(this.baseLib.dir + path.sep) || !fs.existsSync(file)) return next();
      if (!sourceMaps.has(file)) sourceMaps.set(file, ignoreListSourceMap(fs.readFileSync(file, 'utf8'), `${path.basename(file)}?original`));
      res.type('json').send(sourceMaps.get(file));
    });
    app.use('/__baselib__', express.static(this.baseLib.dir, {
      maxAge: '1d',
      setHeaders: (res, file) => {
        if (file.endsWith('.js')) res.setHeader('SourceMap', `${path.basename(file)}.map`);
      }
    }));
    app.all('/__wxa__/proxy', express.raw({ type: () => true, limit: '100mb' }), handleProxy);

    // 返回完整的 http 地址：image、video 组件只原样使用 http(s) 地址，其余的会被当成页面相对路径
    app.post('/__wxa__/tmp', express.raw({ type: () => true, limit: '100mb' }), (req, res) => {
      const type = String(req.query.type || 'png');
      if (!/^[a-z0-9]+$/i.test(type)) {
        res.status(400).type('text').send(`非法的文件类型 ${type}`);
        return;
      }
      const name = `${randomUUID()}.${type}`;
      this.tempFiles.set(name, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
      res.json({ url: `${req.protocol}://${req.get('host')}/__wxa__/tmp/${name}` });
    });
    app.get('/__wxa__/region/:kind', (req, res) => {
      const kind = req.params.kind;
      const data = kind === 'districts' || kind === 'streets' ? readRegionData(kind) : null;
      if (!data) {
        res.status(404).end();
        return;
      }
      res.type('text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=86400').send(data);
    });

    app.get('/__wxa__/tmp/:name', (req, res) => {
      const data = this.tempFiles.get(req.params.name);
      if (!data) {
        res.status(404).end();
        return;
      }
      res.type(path.extname(req.params.name));
      // 临时文件保存后不会改写，文件名就能作 ETag，分段和完整响应一致，也不用每次对整个文件算摘要
      res.setHeader('ETag', `"${req.params.name}"`);
      // 支持分段请求，video 组件播放临时文件时才能跳转（不支持时浏览器认为视频不能跳转，seek 不起作用）
      res.setHeader('Accept-Ranges', 'bytes');
      const ranges = req.range(data.length);
      if (ranges === -1) {
        res.status(416).setHeader('Content-Range', `bytes */${data.length}`);
        res.end();
        return;
      }
      if (Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1) {
        const { start, end } = ranges[0];
        res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
        res.send(data.subarray(start, end + 1));
        return;
      }
      res.send(data);
    });
    app.delete('/__wxa__/tmp/:name', (req, res) => {
      res.status(this.tempFiles.delete(req.params.name) ? 204 : 404).end();
    });

    if (this.ticketSource) app.use('/__wxa__/api', realLoginRouter(this.project.appid, this.ticketSource));

    // 渲染层页面路径下的相对资源（如 ../../images/a.png）
    app.use('/__wxa__/webview', express.static(root));
    app.use(express.static(root));

    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
      this.logger.error('[wxa-runner]', error);
      res.status(500).type('text').send(error.message);
    });

    return app;
  }

  /** 先编译一遍 setup：编译错误随 app-info 交给宿主显示，而不是让浏览器 import 失败 */
  private async setupInfo(file: string): Promise<NonNullable<AppInfo['setup']>> {
    try {
      await bundleSetup(file);
      return { env: this.setupEnv };
    } catch (error) {
      return { env: this.setupEnv, error: (error as Error).message };
    }
  }

  /** 需要构建结果的路由；构建失败时返回错误文本 */
  private withBuild(handler: (build: BuildResult, req: Request, res: Response, next: NextFunction) => void) {
    return async (req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cache-Control', 'no-store');
      let build: BuildResult;
      try {
        build = await this.builder.build();
      } catch (error) {
        res.status(500).type('text').send((error as Error).message);
        return;
      }
      try {
        handler(build, req, res, next);
      } catch (error) {
        next(error);
      }
    };
  }

  private runtimeDir(): string {
    const candidates = [
      this.options.runtimeDir,
      path.join(__dirname, 'runtime'),
      path.join(__dirname, '../runtime'),
      path.join(__dirname, '../../dist/runtime')
    ].filter((dir): dir is string => !!dir);
    const found = candidates.find(dir => fs.existsSync(path.join(dir, 'host.js')));
    if (!found) {
      throw new Error('找不到浏览器端运行时（host.js），请先执行 pnpm build');
    }
    return found;
  }

  /** 只在监听文件变化时打开基础库的热更新开关，跑测试（watch: false）时运行环境与真机一致 */
  private get hotEnabled(): boolean {
    return this.options.watch !== false;
  }

  private startWatching() {
    // 上次编译失败时页面上显示着错误，修好后整页刷新才能清掉
    let lastBuildFailed = false;

    // 项目目录下的 setup 文件不一定在小程序根目录（miniprogramRoot）里
    const watched = [this.project.root];
    if (this.setupFile && path.relative(this.project.root, this.setupFile).startsWith('..')) watched.push(this.setupFile);

    this.watcher = watchProject(this.project.root, watched, async ({ files, structural }) => {
      const reloadOnly = structural || lastBuildFailed;
      this.builder.invalidate(files);
      const label = files.length > 3 ? `${files.slice(0, 3).join(', ')} 等 ${files.length} 个文件` : files.join(', ');

      try {
        const build = await this.builder.build();
        lastBuildFailed = false;
        const plan = reloadOnly ? null : planHotUpdate(files, build);
        this.logger.log(`[wxa-runner] ${label} 已更新，重新编译 ${build.durationMs}ms${plan ? '，热更新' : ''}`);
        this.broadcast(plan ? { type: 'hot', version: build.version, ...plan } : { type: 'reload' });
      } catch (error) {
        lastBuildFailed = true;
        const message = (error as Error).message;
        this.logger.error(`[wxa-runner] 编译失败：\n${message}`);
        this.broadcast({ type: 'error', message });
      }
    });
  }

  private broadcast(message: Record<string, unknown>) {
    const data = JSON.stringify(message);
    this.sockets?.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }
}

function resolveSetupFile(option: string | false | undefined, projectPath: string): string | null {
  if (option === false) return null;
  if (!option) return findSetupFile(projectPath);
  const file = path.resolve(option);
  if (!fs.existsSync(file)) throw new Error(`找不到 setup 文件：${file}`);
  return file;
}
