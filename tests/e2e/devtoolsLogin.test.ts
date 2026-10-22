/**
 * 端到端：开发者工具登录态（--devtools-login）失败时，宿主页面在手机外面提示开发者
 *
 * 登录态过期这类问题出在开发环境，不是小程序的 bug：业务代码照常收到 fail，
 * 同时页面上要有提示，否则开发者只能翻控制台或 Network 才知道为什么登录不上。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TICKET_ENV } from '../../packages/extractor/src/devtools';
import { e2eReady, expectText, Runner, startRunner } from './runner';

const EXPIRED = '微信开发者工具的登录态已过期，请打开开发者工具刷新登录态';

const PAGE_JS = `
Page({
  data: { result: '' },
  onLogin() {
    wx.login({ complete: res => this.setData({ result: res.errMsg }) });
  }
});
`;

describe.skipIf(!e2eReady)('开发者工具登录态失败的提示', () => {
  let runner: Runner;

  beforeAll(async () => {
    // 登录接口的结果由 page.route 决定，开发服务器不用去连本机的开发者工具
    vi.stubEnv(TICKET_ENV, 'e2e');
    runner = await startRunner({
      'app.json': { pages: ['pages/index/index'] },
      'pages/index/index.json': {},
      'pages/index/index.wxml': '<button id="login" bindtap="onLogin">登录</button><view id="result">{{result}}</view>',
      'pages/index/index.js': PAGE_JS
    }, { devtoolsLogin: true });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await runner?.close();
  });

  it('登录态过期时，业务代码收到 fail，页面在手机外面显示原因，点关闭后消失', async () => {
    const { page } = runner;
    await page.route('**/__wxa__/api/login', route => route.fulfill({ status: 500, json: { error: EXPIRED } }));
    const frame = await runner.open('/');

    await frame.click('#login');

    await expectText(frame, '#result', `login:fail ${EXPIRED}`);
    const notice = page.locator('.wxa-notice');
    await notice.waitFor({ timeout: 5000 });
    expect(await notice.textContent()).toContain(EXPIRED);
    expect(await notice.textContent()).toContain('wx.login');
    expect(await page.locator('.wxa-device .wxa-notice').count()).toBe(0);

    await notice.getByRole('button', { name: '关闭' }).click();
    await notice.waitFor({ state: 'detached', timeout: 5000 });
  });
});
