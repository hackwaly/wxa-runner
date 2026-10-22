/**
 * 端到端：Worker（wx.createWorker），运行 examples/worker 和临时小程序
 *
 * 基础库通过原生的 WeixinWorker 创建 Worker、收发消息，Worker 里的基础库（WAWorker.js）通过 workerInvokeJsApi 调原生接口，
 * 本机有哪个已验证版本就测哪个。
 */

import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES } from '../helpers';
import { e2eReady, expectText, installedBaseLibs, Runner, startRunner, VERIFIED_BASELIBS } from './runner';

/** 等一段时间，确认这段时间里没有回复 */
const NO_REPLY_WAIT = 1000;

const errorMessages = (runner: Runner) =>
  runner.page.evaluate(() => window.__wxa_test_api__.errors().map(error => error.message));

describe.skipIf(!e2eReady)('Worker', () => {
  for (const version of VERIFIED_BASELIBS) {
    describe.skipIf(!installedBaseLibs.has(version))(`基础库 ${version}`, () => {
      describe('配置了 workers 目录的小程序', () => {
        let runner: Runner;

        beforeAll(async () => {
          runner = await startRunner(path.join(EXAMPLES, 'worker'), { baseLibVersion: version });
        });

        afterAll(async () => {
          await runner?.close();
        });

        it('页面发给 Worker 的消息原样回到页面，嵌套的对象和数组不丢', async () => {
          const frame = await runner.open('/');
          await frame.click('#echo');
          await expectText(frame, '#echo-reply', JSON.stringify({ text: '你好', list: [1, { deep: true }] }));
        });

        it('Worker 代码引用同目录下的模块，算出的结果回到页面', async () => {
          const frame = await runner.open('/');
          await frame.click('#sum');
          await expectText(frame, '#sum-reply', '1 到 100 的和是 5050');
        });

        it('结束后的 Worker 不再回复，重新创建的 Worker 照常通信', async () => {
          const frame = await runner.open('/');
          await frame.click('#terminate');
          await expectText(frame, '#status', '已结束');
          await frame.click('#echo');
          await frame.waitForTimeout(NO_REPLY_WAIT);
          await expectText(frame, '#echo-reply', '等待回复');

          await frame.click('#restart');
          await expectText(frame, '#status', '已重新创建');
          await frame.click('#echo');
          await expectText(frame, '#echo-reply', /你好/);
        });

        it('Worker 里异步写入再读出文件，读到写入的内容', async () => {
          const frame = await runner.open('/');
          await frame.click('#file');
          await expectText(frame, '#file-reply', 'Worker 写入的内容');
        });

        it('Worker 里调用同步接口时明确报错，说明 wxa-runner 不支持', async () => {
          const frame = await runner.open('/');
          await frame.click('#read-sync');
          await expectText(frame, '#read-sync-reply', /readFileSync.*Worker.*不支持同步接口/);
        });

        it('Worker 处理消息时抛出的异常记入 errors()', async () => {
          const frame = await runner.open('/');
          expect(await errorMessages(runner)).toEqual([]);
          await frame.click('#crash');
          await runner.page.waitForFunction(
            () => window.__wxa_test_api__.errors().some(error => error.message.includes('Worker 处理消息时出错')),
            undefined,
            { timeout: 5000 }
          ).catch(() => undefined);
          expect(await errorMessages(runner)).toContainEqual(expect.stringContaining('Worker 处理消息时出错'));
        });
      });

      it('没有配置 workers 时，wx.createWorker 报告 Worker 不存在', async () => {
        const runner = await startRunner({
          'app.json': { pages: ['pages/index/index'] },
          'pages/index/index.json': {},
          'pages/index/index.wxml': '<view id="error">{{error}}</view>',
          'pages/index/index.js': `
Page({
  data: { error: '' },
  onLoad() {
    try {
      wx.createWorker('workers/index.js');
      this.setData({ error: '没有报错' });
    } catch (error) {
      this.setData({ error: error.message });
    }
  }
});`
        }, { baseLibVersion: version });
        try {
          const frame = await runner.open('/');
          await expectText(frame, '#error', /Worker "workers\/index\.js" does not exists/);
        } finally {
          await runner.close();
        }
      });

      it('workers 配置为分包时，预下载 Worker 分包成功，之后创建的 Worker 照常通信', async () => {
        const runner = await startRunner({
          'app.json': { pages: ['pages/index/index'], workers: { path: 'workers', isSubpackage: true } },
          'pages/index/index.json': {},
          'pages/index/index.wxml': '<view id="reply">{{reply}}</view>',
          'pages/index/index.js': `
Page({
  data: { reply: '' },
  onLoad() {
    wx.preDownloadSubpackage({
      packageType: 'workers',
      success: () => {
        const worker = wx.createWorker('workers/index.js');
        worker.onMessage(message => this.setData({ reply: message.text }));
        worker.postMessage({ text: 'ping' });
      },
      fail: ({ errMsg }) => this.setData({ reply: errMsg })
    });
  }
});`,
          'workers/index.js': "worker.onMessage(message => worker.postMessage({ text: message.text + ' pong' }));"
        }, { baseLibVersion: version });
        try {
          const frame = await runner.open('/');
          await expectText(frame, '#reply', 'ping pong');
        } finally {
          await runner.close();
        }
      });
    });
  }
});
