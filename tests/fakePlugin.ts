/**
 * 模拟微信下发的插件代码包（getplugincode 的响应）
 *
 * 真实的包是 .wxvpkg 格式（与基础库相同），里面是编译好的产物，结构取自一个线上插件：
 *   /plugin.json         插件页面表和页面的 window 配置
 *   /appservice.js       逻辑层：definePlugin(...) 包着 $gwx_<appid>、__wxAppCode__、各模块的 define，最后 requirePlugin 初始化
 *   /pageframe.js        渲染层：$gwx_<appid> 和各页面、组件的样式函数
 *   /pages/x/x.html      插件页面：注入样式，用 $gwx_<appid> 取模板后派发 generateFuncReady
 *   /static/...          图片等资源
 * 模板用本机的 wcc 现编，第三方插件的代码不进仓库。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { compileWxml } from '../packages/compiler/src/wcc';
import { packWxvpkg, png } from './helpers';

export interface FakePluginPage {
  /** 插件对外的页面名，plugin://别名/<name> */
  name: string;
  /** 插件内的路径，不带扩展名，如 pages/hello/hello */
  path: string;
  wxml: string;
  /** 页面模块的代码，Page 可用 */
  js: string;
  title: string;
}

export async function packFakePlugin(appid: string, pages: FakePluginPage[]): Promise<Buffer> {
  const gwx = `$gwx_${appid}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-runner-plugin-'));
  for (const page of pages) {
    fs.mkdirSync(path.join(dir, path.dirname(page.path)), { recursive: true });
    fs.writeFileSync(path.join(dir, `${page.path}.wxml`), page.wxml);
  }
  const compile = (cut: boolean) =>
    compileWxml({
      cwd: dir,
      files: pages.map(page => `./${page.path}.wxml`),
      components: pages.map(page => ({ path: page.path, tags: [] })),
      cut,
      genfuncName: gwx
    });
  // 本机较新的 wcc 会在模板函数开头调用小程序的 $gwx('init')；微信下发的插件是旧版编译器编的，没有这一行
  const [serviceGwx, pageGwx] = (await Promise.all([compile(true), compile(false)])).map(code => code.replace(/^\$gwx\('init', global\);$/m, ''));
  fs.rmSync(dir, { recursive: true, force: true });

  const privatePath = (page: FakePluginPage) => `plugin-private://${appid}/${page.path}`;
  const routePath = (page: FakePluginPage) => `__plugin__/${appid}/${page.path}`;

  // 基础库调用插件函数时不传 console，真实的包和这里一样先存一份再补上
  const appservice = `var __wxAppConsole__ = console;
definePlugin("plugin://${appid}", function(define, require, module, exports, global, wx, App, Page, Component, Behavior, getApp, getCurrentPages, console, requireMiniProgram) {
if (typeof console === 'undefined') { console = __wxAppConsole__; }
${serviceGwx}
${pages.map(page => `global.__wxAppCode__['${privatePath(page)}.json'] = {"usingComponents":{}};
global.__wxAppCode__['${privatePath(page)}.wxml'] = ${gwx}('./${page.path}.wxml');`).join('\n')}
global.__wxAppCode__['plugin-private://${appid}/plugin.json'] = ${JSON.stringify({ publicComponents: {}, pages: Object.fromEntries(pages.map(page => [page.name, page.path])), main: 'index.js' })};
define("index.js", function(require, module, exports) { module.exports = {}; });
${pages.map(page => `global.__wxRoute = '${routePath(page)}'; global.__wxRouteBegin = true; global.__wxAppCurrentFile__ = '${privatePath(page)}.js';
define("${page.path}.js", function(require, module, exports) {
${page.js}
});
require("${page.path}.js");`).join('\n')}
global.publishDomainComponents(${JSON.stringify(Object.fromEntries(pages.map(page => [`plugin://${appid}/${page.name}`, privatePath(page)])))});
module.exports = function() { return require('index.js'); };
});
requirePlugin("plugin://${appid}");`;

  const pageframe = `${pageGwx}
${pages.map(page => `__wxAppCode__['${privatePath(page)}.wxss'] = function() {};`).join('\n')}`;

  const pageHtml = (page: FakePluginPage) => `<style> </style> <page></page> <script>
__wxAppCode__['${privatePath(page)}.wxss']();
(function() {
  var gf = ${gwx}('./${page.path}.wxml');
  if (window.__wxAppCodeReadyCallback__) {
    window.__wxAppCodeReadyCallback__(gf);
  } else {
    document.dispatchEvent(new CustomEvent("generateFuncReady", { detail: { generateFunc: gf } }));
  }
})();
</script>`;

  const pluginJson = {
    page: Object.fromEntries(pages.map(page => [
      `${routePath(page)}.html`,
      { window: { usingComponents: {}, navigationBarTitleText: page.title } }
    ])),
    pages: Object.fromEntries(pages.map(page => [page.name, routePath(page)]))
  };

  return packWxvpkg({
    '/plugin.json': JSON.stringify(pluginJson),
    '/appservice.js': appservice,
    '/pageframe.js': pageframe,
    ...Object.fromEntries(pages.map(page => [`/${page.path}.html`, pageHtml(page)])),
    '/static/logo.png': png(2, 2)
  });
}
