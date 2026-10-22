/**
 * Worker 里的原生接口，在 Worker 基础库（WAWorker.js）之前执行，见 server/html.ts 的 workerScript
 *
 * 和开发者工具一样，Worker 是浏览器的 Web Worker，逻辑层那一端见 runtime/workers.ts：
 * - WeixinWorker.postMsgToAppService：Worker 基础库发往逻辑层的消息
 * - 逻辑层发来的消息交给 WeixinWorker.appServiceMsgHandler。基础库加载时把全局的 WeixinWorker 换成了自己的包装，处理函数在包装上
 * - workerInvokeJsApi：Worker 里的接口（worker.getFileSystemManager 等）调用原生，结果经 WeixinJSBridge.invokeCallbackHandler 交回。
 *   Worker 基础库只在有它时才创建业务代码用的 worker 对象
 *
 * Worker 只能和页面异步收发消息。基础库同步取结果的接口（*Sync，以及要同步拿到 taskId 的 createRequestTask 等），
 * 开发者工具用 SharedArrayBuffer 阻塞等待，那要求整个页面跨源隔离（COOP / COEP），跨域的图片等资源都会加载不了，所以这里直接失败
 */

import type { FromWorkerMessage, ToWorkerMessage } from './types';

const scope = self as any;

/** 不以 Sync 结尾、但基础库同步取结果的接口。开发者工具的列表里还有 unlink，那是异步接口，Worker 里的 fs.unlink 照常可用 */
const SYNC_APIS = new Set([
  'getSystemInfo',
  'getBackgroundAudioState',
  'setBackgroundAudioState',
  'operateBackgroundAudio',
  'createRequestTask',
  'createUploadTask',
  'createDownloadTask',
  'createSocketTask',
  'operateSocketTask',
  'createAudioInstance'
]);

const send = (message: FromWorkerMessage) => scope.postMessage(message);
const parse = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);

scope.WeixinWorker = {
  __workerId__: Number(new URLSearchParams(location.search).get('id')),
  postMsgToAppService(message: string) {
    send({ type: 'message', data: parse(message) });
  }
};

scope.workerInvokeJsApi = (api: string, args: unknown, callbackId: number) => {
  if (SYNC_APIS.has(api) || api.endsWith('Sync')) {
    return { errMsg: `${api}:fail wxa-runner 的 Worker 里不支持同步接口` };
  }
  send({ type: 'invoke', api, args: parse(args), callbackId });
  return undefined;
};

scope.addEventListener('message', ({ data }: MessageEvent<ToWorkerMessage>) => {
  // Worker 基础库没能加载时（入口已经报告了原因）没有处理函数，消息丢掉
  if (data.type === 'message') scope.WeixinWorker.appServiceMsgHandler?.(data.data);
  else scope.WeixinJSBridge.invokeCallbackHandler(data.callbackId, data.result);
});

/**
 * Worker 基础库捕获的异常都先交给 __wxSourceMapRetrace__（开发者工具用它还原 source map），包括它捕获的接口回调异常，
 * 以及它监听全局 error / unhandledrejection 拿到的异常（拿到后 preventDefault，不再冒泡到逻辑层的 Worker 对象）；
 * 它只打印到 Worker 的控制台，不交给业务的 worker.onError。这里发回逻辑层，原样返回错误。
 * 基础库加载前的异常没有人处理，冒泡到逻辑层的 Worker 对象，见 runtime/workers.ts
 */
scope.__wxSourceMapRetrace__ = (error: unknown) => {
  const err = typeof (error as Error | null)?.message === 'string' ? (error as Error) : null;
  send({ type: 'error', message: err ? err.message : String(error), stack: typeof err?.stack === 'string' ? err.stack : undefined });
  return error;
};
