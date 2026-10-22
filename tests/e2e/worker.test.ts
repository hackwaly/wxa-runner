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

const errorMessages = (runner: Runner) => runner.page.evaluate(() => window.__wxa_test_api__.errors().map(error => error.message));

const waitForError = (runner: Runner, message: string) =>
  runner.page
    .waitForFunction(text => window.__wxa_test_api__.errors().some(error => error.message.includes(text)), message, { timeout: 5000 })
    .catch(() => undefined);

/** 创建 Worker 的页面：worker.onError 收到的每条错误依次显示在 #worker-errors，点击 #callback 等按钮让 Worker 抛出对应的异常 */
const WORKER_ERRORS_PAGE = {
  'pages/index/index.json': {},
  'pages/index/index.wxml': `
<view id="worker-errors">{{workerErrors}}</view>
<view wx:for="{{['callback', 'message', 'rejection']}}" wx:key="*this" id="{{item}}" data-kind="{{item}}" bindtap="send">{{item}}</view>`,
  'pages/index/index.js': `
Page({
  data: { workerErrors: '' },
  onLoad() {
    this.worker = wx.createWorker('workers/index.js');
    this.worker.onError(error => this.setData({ workerErrors: this.data.workerErrors + error.message }));
  },
  send(event) {
    this.worker.postMessage({ kind: event.currentTarget.dataset.kind });
  }
});`
};

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

        it('页面和 Worker 之间传的 ArrayBuffer 收到时仍是原来的字节', async () => {
          const frame = await runner.open('/');
          await frame.click('#binary');
          await expectText(frame, '#binary-reply', '2,4,6');
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

        it('Worker 里异步写入、读出再删除文件，读到写入的内容，删除成功', async () => {
          const frame = await runner.open('/');
          await frame.click('#file');
          await expectText(frame, '#file-reply', 'Worker 写入的内容（已删除）');
        });

        it('Worker 里调用同步接口时明确报错，说明 wxa-runner 不支持', async () => {
          const frame = await runner.open('/');
          await frame.click('#read-sync');
          await expectText(frame, '#read-sync-reply', /readFileSync.*Worker.*不支持同步接口/);
        });

        it('Worker 处理消息时抛出的异常交给页面的 worker.onError，并记入 errors()', async () => {
          const frame = await runner.open('/');
          expect(await errorMessages(runner)).toEqual([]);
          await frame.click('#crash');
          await runner.page
            .waitForFunction(
              () => window.__wxa_test_api__.errors().some(error => error.message.includes('Worker 处理消息时出错')),
              undefined,
              { timeout: 5000 }
            )
            .catch(() => undefined);
          expect(await errorMessages(runner)).toContainEqual(expect.stringContaining('Worker 处理消息时出错'));
          await expectText(frame, '#worker-error', 'Worker 处理消息时出错');
        });
      });

      describe('Worker 里没有被业务捕获的异常', () => {
        let runner: Runner;

        beforeAll(async () => {
          runner = await startRunner(
            {
              'app.json': { pages: ['pages/index/index'], workers: 'workers' },
              ...WORKER_ERRORS_PAGE,
              'workers/index.js': `
const fs = worker.getFileSystemManager();
worker.onMessage(({ kind }) => {
  if (kind === 'callback') {
    fs.writeFile({ filePath: worker.env.USER_DATA_PATH + '/note.txt', data: '内容', encoding: 'utf8', success: () => { throw new Error('接口回调里出错'); } });
  }
  if (kind === 'message') throw new Error('处理消息时出错');
  if (kind === 'rejection') Promise.reject(new Error('Promise 没有处理的错误'));
});`
            },
            { baseLibVersion: version }
          );
        });

        afterAll(async () => {
          await runner?.close();
        });

        for (const [kind, scenario, message] of [
          ['callback', '接口的 success 回调里抛出的异常（被基础库捕获）', '接口回调里出错'],
          ['message', '处理消息时抛出的异常', '处理消息时出错'],
          ['rejection', '没有处理的 Promise 拒绝', 'Promise 没有处理的错误']
        ]) {
          it(`${scenario}只交给页面的 worker.onError 一次，并只记入 errors() 一次`, async () => {
            const frame = await runner.open('/');
            await frame.click(`#${kind}`);
            await waitForError(runner, message);
            await frame.waitForTimeout(NO_REPLY_WAIT);
            expect((await errorMessages(runner)).filter(text => text.includes(message))).toHaveLength(1);
            expect((await frame.textContent('#worker-errors'))!.split(message)).toHaveLength(2);
          });
        }
      });

      for (const [scenario, url] of [
        ['入口 worker.js 返回 HTTP 500', '**/__wxa__/worker.js?*'],
        ['Worker 基础库 WAWorker.js 加载失败', '**/__baselib__/WAWorker.js']
      ]) {
        it(`${scenario}时，Worker 启动失败只交给页面的 worker.onError 一次，并只记入 errors() 一次`, async () => {
          const runner = await startRunner(
            {
              'app.json': { pages: ['pages/index/index'], workers: 'workers' },
              ...WORKER_ERRORS_PAGE,
              'workers/index.js': 'worker.onMessage(() => {});'
            },
            { baseLibVersion: version }
          );
          await runner.page.context().route(url, route => route.fulfill({ status: 500, body: '' }));
          try {
            const frame = await runner.open('/');
            await runner.page
              .waitForFunction(() => window.__wxa_test_api__.errors().length > 0, undefined, { timeout: 5000 })
              .catch(() => undefined);
            await frame.waitForTimeout(NO_REPLY_WAIT);
            const errors = await errorMessages(runner);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toMatch(/worker\.js|WAWorker\.js/);
            expect(await frame.textContent('#worker-errors')).toBe(errors[0]);
          } finally {
            await runner.close();
          }
        });
      }

      it('没有配置 workers 时，wx.createWorker 不返回 Worker，控制台报告 Worker 不存在', async () => {
        // 基础库捕获了创建失败的异常，只在控制台报告，业务代码捕获不到，与开发者工具一致
        const runner = await startRunner(
          {
            'app.json': { pages: ['pages/index/index'] },
            'pages/index/index.json': {},
            'pages/index/index.wxml': '<view id="result">{{result}}</view>',
            'pages/index/index.js': `
Page({
  data: { result: '' },
  onLoad() {
    const worker = wx.createWorker('workers/index.js');
    this.setData({ result: worker ? '返回了 Worker' : '没有返回 Worker' });
  }
});`
          },
          { baseLibVersion: version }
        );
        const logs: string[] = [];
        runner.page.on('console', message => logs.push(message.text()));
        try {
          const frame = await runner.open('/');
          await expectText(frame, '#result', '没有返回 Worker');
          expect(logs).toContainEqual(expect.stringContaining('Worker "workers/index.js" does not exists'));
        } finally {
          await runner.close();
        }
      });

      it('workers 配置为分包时，预下载 Worker 分包成功，之后创建的 Worker 照常通信', async () => {
        const runner = await startRunner(
          {
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
          },
          { baseLibVersion: version }
        );
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
