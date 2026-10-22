/**
 * 逻辑层的原生 WeixinWorker：基础库的 wx.createWorker 用它创建 Worker、收发消息，Worker 那一端见 runtime/worker.ts
 *
 * 和开发者工具一样，每个 Worker 是一个浏览器的 Web Worker，加载 /__wxa__/worker.js（server/html.ts 的 workerScript）。
 * create 收到的脚本名总是 workers.js（整个 workers 目录），业务指定的入口随后由基础库发消息让 Worker 去 require。
 * 基础库加载时把全局的 WeixinWorker 换成自己的包装，原始对象留给自己调用；Worker 发来的消息交给包装上的 workerMsgHandler
 */

import type { FromWorkerMessage, HostApi, ToWorkerMessage } from './types';

interface CreateOptions {
  /** Worker 里允许调用的原生接口 */
  APIList?: string[];
}

/** 必须在基础库之前调用：基础库加载后会从全局的 __wxConfig 里删掉 workers */
export function createWeixinWorker(win: Window, host: HostApi) {
  const g = win as any;
  const configured = !!g.__wxConfig?.workers;
  const workers = new Map<number, Worker>();
  let nextId = 1;

  const send = (worker: Worker, message: ToWorkerMessage) => worker.postMessage(message);

  const invoke = (worker: Worker, allowed: Set<string>, { api, args, callbackId }: Extract<FromWorkerMessage, { type: 'invoke' }>) => {
    const reply = (result: unknown) => send(worker, { type: 'callback', callbackId, result });
    if (!allowed.has(api)) reply({ errMsg: `${api}:fail not support` });
    else host.invoke('service', win, api, args, reply);
  };

  return {
    /** 返回 Worker 的编号；没有配置 workers 时返回 -1，基础库报告 Worker 不存在 */
    create(_script: string, options: CreateOptions = {}): number {
      if (!configured) return -1;
      const id = nextId++;
      const worker = new Worker(`/__wxa__/worker.js?id=${id}`);
      const allowed = new Set(options.APIList || []);
      worker.addEventListener('message', ({ data }: MessageEvent<FromWorkerMessage>) => {
        if (data.type === 'message') g.WeixinWorker.workerMsgHandler(id, data.data);
        else if (data.type === 'invoke') invoke(worker, allowed, data);
        else host.reportError('service', 0, data);
      });
      workers.set(id, worker);
      return id;
    },
    postMsgToWorker(id: number, message: string) {
      const worker = workers.get(id);
      if (worker) send(worker, { type: 'message', data: JSON.parse(message) });
    },
    terminate(id: number) {
      workers.get(id)?.terminate();
      workers.delete(id);
    }
  };
}
