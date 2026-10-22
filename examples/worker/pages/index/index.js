Page({
  data: { echo: '', sum: '', status: '', file: '', readSync: '' },
  onLoad() {
    this.start();
  },
  start() {
    this.worker = wx.createWorker('workers/index.js');
    this.worker.onMessage(({ type, ...reply }) => {
      if (type === 'echo') this.setData({ echo: JSON.stringify(reply.payload) });
      if (type === 'sum') this.setData({ sum: `1 到 100 的和是 ${reply.result}` });
      if (type === 'file') this.setData({ file: reply.content || reply.errMsg });
      if (type === 'readSync') this.setData({ readSync: reply.error || reply.content });
    });
  },
  echo() {
    this.setData({ echo: '等待回复' });
    this.worker.postMessage({ type: 'echo', payload: { text: '你好', list: [1, { deep: true }] } });
  },
  sum() {
    this.worker.postMessage({ type: 'sum', numbers: Array.from({ length: 100 }, (_, i) => i + 1) });
  },
  terminate() {
    this.worker.terminate();
    this.setData({ status: '已结束' });
  },
  restart() {
    this.start();
    this.setData({ status: '已重新创建' });
  },
  file() {
    this.worker.postMessage({ type: 'file' });
  },
  readSync() {
    this.worker.postMessage({ type: 'readSync' });
  },
  crash() {
    this.worker.postMessage({ type: 'crash' });
  }
});
