import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { findBundledBaseLibRoot } from '../../packages/extractor/src/baselib';
import { readRegionData } from '../../packages/extractor/src/devtools';
import { DevServer } from '../../packages/core/src/server/DevServer';
import { createFakeVendorDir, FAKE_BASELIBS } from '../fakeBaseLib';
import { createProject, EXAMPLES, hasToolchain, REPO_ROOT } from '../helpers';

const RUNTIME_DIR = path.join(REPO_ROOT, 'packages/core/dist/runtime');
const ready = hasToolchain() && fs.existsSync(path.join(RUNTIME_DIR, 'host.js'));

describe.skipIf(!ready)('DevServer', () => {
  let server: DevServer;
  let base = '';
  const get = (url: string) => fetch(base + url);

  beforeAll(async () => {
    // 这里测的是默认选中的（单上下文）基础库，不受 WXA_BASELIB 影响
    vi.stubEnv('WXA_BASELIB', '');
    server = new DevServer({
      projectPath: path.join(EXAMPLES, 'showcase'),
      port: 0,
      watch: false,
      runtimeDir: RUNTIME_DIR,
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined }
    });
    base = await server.start();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server.close();
  });

  it('宿主页面加载浏览器端运行时', async () => {
    const html = await (await get('/')).text();
    expect(html).toContain('<script src="/__wxa__/runtime/host.js"></script>');
    expect((await get('/__wxa__/runtime/host.js')).status).toBe(200);
  });

  it('app-info 返回页面、基础库版本和 __wxConfig', async () => {
    const appJson = JSON.parse(fs.readFileSync(path.join(EXAMPLES, 'showcase/app.json'), 'utf8'));
    const info = await (await get('/__wxa__/app-info.json')).json();
    expect(info.pages).toEqual(appJson.pages);
    expect(info.baseLibVersion).toBe(server.baseLib.version);
    expect(info.wxConfig.tabBar.list.map((item: any) => item.pagePath))
      .toEqual(appJson.tabBar.list.map((item: any) => `${item.pagePath}.html`));
  });

  it('逻辑层按顺序加载桥、基础库、业务模块和 bootstrap，并注入启动页面', async () => {
    const html = await (await get('/__wxa__/appservice.html?path=pages/detail/detail&query=id%3D9')).text();
    const order = ['frame.js', '/__baselib__/WAService.js', '/__wxa__/module/app.js', '/__wxa__/service-bootstrap.js'];
    const positions = order.map(marker => html.indexOf(marker));
    expect(positions.every(p => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('"appLaunchInfo":{"scene":1001,"path":"pages/detail/detail","query":{"id":"9"}}');
  });

  it('基础库脚本加入 DevTools 的忽略列表：响应头带 source map，映射覆盖整个文件，原始代码与脚本相同', async () => {
    const script = await get('/__baselib__/WAWebview.js');
    const code = await script.text();
    const mapUrl = new URL(script.headers.get('sourcemap')!, script.url);
    const map = await (await fetch(mapUrl)).json();

    expect(map.x_google_ignoreList).toEqual([0]);
    expect(map.mappings.split(';')).toHaveLength(code.split('\n').length);
    expect(await (await fetch(new URL(map.sources[0], mapUrl))).text()).toBe(code);
  });

  it('渲染层页面带上该页的 window 配置和 webviewId', async () => {
    const html = await (await get('/__wxa__/webview/pages/detail/detail.html?id=3')).text();
    expect(html).toContain('data-webview-id="3"');
    expect(html).toContain('"window":{');
    expect(html).toContain('"navigationBarTitleText":"详情"');
  });

  it('不存在的页面和模块返回 404', async () => {
    expect((await get('/__wxa__/webview/pages/nope/nope.html')).status).toBe(404);
    expect((await get('/__wxa__/module/nope.js')).status).toBe(404);
  });

  it('单个模块以 define 包装返回', async () => {
    const res = await get('/__wxa__/module/utils/store.js');
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toMatch(/^define\("utils\/store\.js", function\(require, module, exports/);
  });

  it('临时文件保存后返回可直接访问的地址，按文件类型返回 Content-Type', async () => {
    const saved = await fetch(base + '/__wxa__/tmp?type=jpg', { method: 'POST', body: Buffer.from('jpeg-bytes') });
    const { url } = await saved.json();
    expect(url).toMatch(new RegExp(`^${base}/__wxa__/tmp/[\\w-]+\\.jpg$`));

    const file = await fetch(url);
    expect(file.headers.get('content-type')).toContain('image/jpeg');
    expect(await file.text()).toBe('jpeg-bytes');
    expect((await get('/__wxa__/tmp/missing.jpg')).status).toBe(404);
  });

  it('临时文件支持分段请求（video 组件播放时要能跳转），分段和完整响应的 ETag 相同，超出范围时返回 416', async () => {
    const saved = await fetch(base + '/__wxa__/tmp?type=mp4', { method: 'POST', body: Buffer.from('0123456789') });
    const { url } = await saved.json();

    const part = await fetch(url, { headers: { range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part.text()).toBe('2345');
    expect(part.headers.get('etag')).toBe((await fetch(url)).headers.get('etag'));

    const tail = await fetch(url, { headers: { range: 'bytes=7-' } });
    expect(await tail.text()).toBe('789');
    const last = await fetch(url, { headers: { range: 'bytes=-3' } });
    expect(await last.text()).toBe('789');

    const outside = await fetch(url, { headers: { range: 'bytes=20-' } });
    expect(outside.status).toBe(416);
    expect(outside.headers.get('content-range')).toBe('bytes */10');
  });

  it('临时文件可以只查大小，删除后访问不到', async () => {
    const saved = await fetch(base + '/__wxa__/tmp?type=txt', { method: 'POST', body: Buffer.from('hello') });
    const { url } = await saved.json();

    const head = await fetch(url, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe('5');

    expect((await fetch(url, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(url)).status).toBe(404);
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(404);
  });

  it.skipIf(!readRegionData('districts'))('地区选择器用的行政区划数据取自本机开发者工具', async () => {
    const districts = await get('/__wxa__/region/districts');
    expect(districts.headers.get('content-type')).toContain('text/plain');
    expect(await districts.text()).toContain('海珠区');
    expect(await (await get('/__wxa__/region/streets')).text()).toContain('赤岗街道');
    expect((await get('/__wxa__/region/other')).status).toBe(404);
  });

  it('基础库与小程序静态资源都能访问，渲染层路径下的相对资源也能解析', async () => {
    expect((await get('/__baselib__/WAWebview.js')).status).toBe(200);
    expect((await get('/app.wxss')).status).toBe(200);
    expect((await get('/__wxa__/webview/app.wxss')).status).toBe(200);
  });
});

describe.skipIf(!ready)('DevServer：没装开发者工具的机器', () => {
  let server: DevServer;

  beforeAll(async () => {
    vi.stubEnv('WXA_VENDOR_DIR', createProject({}));
    vi.stubEnv('WXA_BASELIB', '');
    server = new DevServer({
      projectPath: path.join(EXAMPLES, 'showcase'),
      port: 0,
      watch: false,
      runtimeDir: RUNTIME_DIR,
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined }
    });
    await server.start();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server.close();
  });

  it('用内置基础库提供逻辑层和渲染层的基础库文件', async () => {
    const bundledDir = path.join(findBundledBaseLibRoot()!, '3.7.0');
    for (const file of ['WAService.js', 'WAWebview.js']) {
      const res = await fetch(`${server.url}/__baselib__/${file}`);
      expect(await res.text()).toBe(fs.readFileSync(path.join(bundledDir, file), 'utf8'));
    }
  });
});

describe.skipIf(!ready)('DevServer：新版基础库（隔离上下文）', () => {
  let server: DevServer;
  const get = (url: string) => fetch(server.url + url);

  beforeAll(async () => {
    vi.stubEnv('WXA_VENDOR_DIR', createFakeVendorDir());
    server = new DevServer({
      projectPath: path.join(EXAMPLES, 'showcase'),
      port: 0,
      watch: false,
      baseLibVersion: FAKE_BASELIBS.evaluateScriptFile.version,
      baseLibCacheDir: createProject({}),
      runtimeDir: RUNTIME_DIR,
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined }
    });
    await server.start();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server.close();
  });

  it('逻辑层只加载桥和主上下文基础库，业务模块和 bootstrap 按顺序交给子上下文执行', async () => {
    const html = await (await get('/__wxa__/appservice.html')).text();
    expect(html).toContain('<script src="/__baselib__/WAServiceMainContext.js"></script>');
    expect(html).not.toContain('/__baselib__/WAService.js');
    expect(html).toContain('"isIsolateContext":true');

    const attribute = /data-app-service="([^"]*)"/.exec(html)![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const scripts: string[] = JSON.parse(attribute);
    expect(scripts[0]).toMatch(/^\/__wxa__\/module\/app\.js\?/);
    expect(scripts[scripts.length - 1]).toMatch(/^\/__wxa__\/service-bootstrap\.js\?/);
  });

  it('子上下文页面先加载桥再加载子上下文基础库，allocEmpty 创建的空上下文不加载基础库', async () => {
    const full = await (await get('/__wxa__/subcontext.html?id=2')).text();
    expect(full.indexOf('data-context-id="2"')).toBeGreaterThan(0);
    expect(full.indexOf('/__baselib__/WASubContext.js')).toBeGreaterThan(full.indexOf('data-context-id="2"'));
    expect(await (await get('/__wxa__/subcontext.html?id=3&empty=1')).text()).not.toContain('WASubContext.js');
  });

  it('基础库里没有 WAWorker.js 时，Worker 入口不去加载它，报告基础库缺少这个文件', async () => {
    const code = await (await get('/__wxa__/worker.js?id=1')).text();
    expect(code).not.toContain('/__baselib__/WAWorker.js');
    expect(code).toContain('/__wxa__/runtime/worker.js');
    expect(code).toMatch(new RegExp(`throw new Error\\(.*基础库 ${FAKE_BASELIBS.evaluateScriptFile.version.replace(/\./g, '\\.')} 里没有 WAWorker\\.js`));
  });

  it('子上下文页面缺少合法的 id 时返回 400', async () => {
    expect((await get('/__wxa__/subcontext.html')).status).toBe(400);
    expect((await get('/__wxa__/subcontext.html?id=abc')).status).toBe(400);
  });
});

describe.skipIf(!ready)('DevServer：Worker', () => {
  let server: DevServer;
  const get = (url: string) => fetch(server.url + url);

  beforeAll(async () => {
    vi.stubEnv('WXA_BASELIB', '');
    server = new DevServer({
      projectPath: path.join(EXAMPLES, 'worker'),
      port: 0,
      watch: false,
      runtimeDir: RUNTIME_DIR,
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined }
    });
    await server.start();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server.close();
  });

  it('Worker 入口依次加载 __wxConfig、Worker 端运行时、Worker 基础库和 workers 目录下的每个模块', async () => {
    const res = await get('/__wxa__/worker.js?id=1');
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    const code = await res.text();
    const order = [
      'var __wxConfig = ',
      '/__wxa__/runtime/worker.js',
      '/__baselib__/WAWorker.js',
      '/__wxa__/module/workers/index.js?v=',
      '/__wxa__/module/workers/utils/math.js?v='
    ].map(part => code.indexOf(part));
    expect(order.every(index => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect((await get('/__wxa__/runtime/worker.js')).status).toBe(200);
  });

  it('Worker 的模块以 define 包装返回，逻辑层不加载它们', async () => {
    const script = await (await get('/__wxa__/module/workers/utils/math.js')).text();
    expect(script).toMatch(/^define\("workers\/utils\/math\.js", function\(/);
    expect(await (await get('/__wxa__/appservice.html')).text()).not.toContain('/__wxa__/module/workers/');
  });
});
