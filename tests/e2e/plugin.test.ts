/**
 * 端到端：打开插件页面（plugin://别名/页面）
 *
 * 插件代码由开发服务器借开发者的登录态向微信下载（--devtools-login）。这里把对微信的下载请求换成
 * 模拟的插件代码包（tests/fakePlugin.ts），其余请求照常发出。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Frame } from 'playwright';
import { TICKET_ENV } from '../../packages/extractor/src/devtools';
import { packFakePlugin } from '../fakePlugin';
import { e2eReady, expectText, Runner, startRunner } from './runner';

const PLUGIN = 'wxplugin00000001';
const PLUGIN_API = 'https://plugin.example.com/hello';

/** 微信对插件的校验和插件信息（verifyplugin、batchgetcontact），格式取自实测 */
const WECHAT_PLUGIN_INFO: Record<string, object> = {
  verifyplugin: { baseresponse: { errcode: 0 }, list: [{ plugin_id: PLUGIN, request_domain: ['https://plugin.example.com'], host_sign: 'sign' }] },
  batchgetcontact: {
    baseresponse: { errcode: 0 },
    contact_list: [{ appid: PLUGIN, plugin_info: { plugin_list: [{ nickname: '测试插件', PluginNetWork: { RequestDomain: ['https://plugin.example.com'] } }] } }]
  }
};

const PAGE_JS = `
Page({
  data: { result: '' },
  go() {
    wx.navigateTo({ url: 'plugin://hello/hello?num=from-api', fail: err => this.setData({ result: err.errMsg }) });
  }
});
`;

describe.skipIf(!e2eReady)('插件页面', () => {
  let runner: Runner;

  beforeAll(async () => {
    const pluginPackage = await packFakePlugin(PLUGIN, [{
      name: 'hello',
      path: 'pages/hello/hello',
      title: '插件页面',
      wxml: '<view id="num">{{num}}</view><view id="server">{{fromServer}}</view><image id="relative" src="../../static/logo.png" /><image id="absolute" src="/static/logo.png" />',
      js: `Page({
  data: { num: '', fromServer: '' },
  onLoad(query) {
    this.setData({ num: query.num });
    wx.request({ url: '${PLUGIN_API}', success: res => this.setData({ fromServer: res.data.text }), fail: err => this.setData({ fromServer: err.errMsg }) });
  }
});`
    }]);
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://servicewechat.com/wxa-dev/getplugincode')) return Promise.resolve(new Response(new Uint8Array(pluginPackage)));
      const info = WECHAT_PLUGIN_INFO[url.match(/^https:\/\/servicewechat\.com\/wxa-dev-logic\/(\w+)/)?.[1] ?? ''];
      return info ? Promise.resolve(new Response(JSON.stringify(info))) : realFetch(input, init);
    });
    vi.stubEnv(TICKET_ENV, 'e2e');
    runner = await startRunner({
      'app.json': { pages: ['pages/index/index'], plugins: { hello: { version: '1.0.0', provider: PLUGIN } } },
      'pages/index/index.json': {},
      'pages/index/index.wxml': `<button id="go" bindtap="go">打开</button>
<navigator id="link" url="plugin://hello/hello?num=from-navigator">链接</navigator>
<view id="result">{{result}}</view>`,
      'pages/index/index.js': PAGE_JS
    }, { devtoolsLogin: true });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await runner?.close();
  });

  async function currentFrame(): Promise<Frame> {
    await runner.page.waitForFunction(() => window.__wxa_test_api__.pageStack().length === 2, null, { timeout: 5000 });
    const { frameName } = (await runner.page.evaluate(() => window.__wxa_test_api__.currentPage()))!;
    return runner.page.frame({ name: frameName })!;
  }

  it('开发者用 wx.navigateTo 打开插件页面，页面拿到参数，导航栏标题是插件配置的', async () => {
    const frame = await runner.open('/');

    await frame.click('#go');

    const plugin = await currentFrame();
    await expectText(plugin, '#num', 'from-api');
    expect(await runner.page.textContent('.wxa-navbar-title')).toBe('插件页面');
  });

  it('开发者用 navigator 组件打开插件页面', async () => {
    const frame = await runner.open('/');

    await frame.click('#link');

    await expectText(await currentFrame(), '#num', 'from-navigator');
  });

  it('插件页面里的 wx.request 照常发出，拿到服务器返回的数据', async () => {
    await runner.page.addInitScript(url => {
      window.__wxa_before_launch__ = api => api.route(url, { body: { text: 'from-server' } });
    }, PLUGIN_API);
    const frame = await runner.open('/');

    await frame.click('#go');

    await expectText(await currentFrame(), '#server', 'from-server');
  });

  it('插件页面里的图片显示出来，相对路径和以 / 开头的都按插件的目录解析', async () => {
    const frame = await runner.open('/');
    await frame.click('#go');
    const plugin = await currentFrame();

    // image 组件把图片设成内部 div 的背景，地址已按页面解析成完整的 url
    const urls = await plugin.waitForFunction(() => {
      const found = ['#relative', '#absolute'].map(selector => {
        const div = document.querySelector(`${selector} div`);
        return div ? getComputedStyle(div).backgroundImage.match(/url\("(.+)"\)/)?.[1] : undefined;
      });
      return found.every(Boolean) && found;
    }, null, { timeout: 5000 }).then(handle => handle.jsonValue() as Promise<string[]>);
    const statuses = await plugin.evaluate(list => Promise.all(list.map(url => fetch(url).then(res => res.status))), urls);
    expect(statuses).toEqual([200, 200]);
  });
});
