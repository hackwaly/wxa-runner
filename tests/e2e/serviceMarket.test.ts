/**
 * 端到端：业务代码调用 wx.serviceMarket.invokeService（--devtools-login）
 *
 * 基础库把调用交给原生 operateWXData，开发服务器再转发给微信。这里用 page.route 返回实测的微信响应，
 * 验证基础库能从中解析出 invokeService 的结果，不依赖本机登录态和服务市场的额度。
 * 3.7.0 及以前的基础库在浏览器里加载不了 wx.serviceMarket 所在的 WACloud.js，只测更新的版本。
 */

import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { TICKET_ENV } from '../../packages/extractor/src/devtools';
import { compareVersions } from '../../packages/extractor/src/baselib';
import { e2eReady, expectText, installedBaseLibs, Runner, startRunner } from './runner';

const BASELIB = [...installedBaseLibs].filter(version => compareVersions(version, '3.7.1') >= 0).sort(compareVersions)[0];

const PAGE_JS = `
Page({
  data: { result: '' },
  onInvoke() {
    wx.serviceMarket
      .invokeService({ service: 'wxcae50ba710ca29d3', api: 'jokebot', data: { mode: 2 } })
      .then(res => this.setData({ result: res.errMsg + ' ' + res.requestId + ' ' + res.data.data_list[0].result }))
      .catch(err => this.setData({ result: String(err.errMsg || err.message || err) }));
  }
});
`;

/** 微信服务市场的结果：外层是 jsoperatewxdata 的 data，里面的 data 才是服务的返回值 */
function wechatData(result: object) {
  return { data: JSON.stringify(result), err_no: 0 };
}

describe.skipIf(!e2eReady || !BASELIB)('服务市场 wx.serviceMarket', () => {
  let runner: Runner;

  beforeAll(async () => {
    vi.stubEnv(TICKET_ENV, 'e2e');
    runner = await startRunner({
      'app.json': { pages: ['pages/index/index'] },
      'pages/index/index.json': {},
      'pages/index/index.wxml': '<button id="invoke" bindtap="onInvoke">调用</button><view id="result">{{result}}</view>',
      'pages/index/index.js': PAGE_JS
    }, { devtoolsLogin: true, baseLibVersion: BASELIB });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await runner?.close();
  });

  it('开发者调用服务市场的接口，拿到服务返回的数据和 requestId', async () => {
    const { page } = runner;
    const joke = { err_code: 0, err_msg: 'null', data_list: [{ error: null, result: '一个笑话' }] };
    await page.route('**/__wxa__/api/operate-wx-data', route =>
      route.fulfill({ json: { data: wechatData({ request_id: 'req-1', errcode: 0, errmsg: 'ok', scene: 4, data: JSON.stringify(joke) }) } })
    );
    const frame = await runner.open('/');

    await frame.click('#invoke');

    await expectText(frame, '#result', 'invokeService:ok req-1 一个笑话');
  });

  it('服务市场拒绝调用时（如额度不足），开发者拿到服务市场的错误码和 requestId', async () => {
    const { page } = runner;
    await page.route('**/__wxa__/api/operate-wx-data', route =>
      route.fulfill({ json: { data: wechatData({ request_id: 'req-2', errcode: 9301010, errmsg: 'consumption failure', scene: 4 }) } })
    );
    const frame = await runner.open('/');

    await frame.click('#invoke');

    await expectText(frame, '#result', 'invokeService:fail 9301010 consumption failure (requestId: req-2)');
  });

  it('转发失败时（如登录态过期），开发者在 invokeService 的错误里看到原因', async () => {
    const { page } = runner;
    await page.route('**/__wxa__/api/operate-wx-data', route =>
      route.fulfill({ status: 500, json: { error: '微信开发者工具的登录态已过期，请打开开发者工具刷新登录态' } })
    );
    const frame = await runner.open('/');

    await frame.click('#invoke');

    await expectText(frame, '#result', /^invokeService:fail .*微信开发者工具的登录态已过期，请打开开发者工具刷新登录态/);
  });
});
