const { sum } = require('./utils/math.js');

const fs = worker.getFileSystemManager();
const notePath = `${worker.env.USER_DATA_PATH}/worker-note.txt`;

worker.onMessage(message => {
  switch (message.type) {
    case 'echo':
      worker.postMessage({ type: 'echo', payload: message.payload });
      break;
    case 'binary':
      worker.postMessage({ type: 'binary', buffer: new Uint8Array(message.buffer).map(n => n * 2).buffer });
      break;
    case 'sum':
      worker.postMessage({ type: 'sum', result: sum(message.numbers) });
      break;
    case 'file':
      fs.writeFile({
        filePath: notePath,
        data: 'Worker 写入的内容',
        encoding: 'utf8',
        success: () =>
          fs.readFile({
            filePath: notePath,
            encoding: 'utf8',
            success: ({ data }) =>
              fs.unlink({
                filePath: notePath,
                success: () => worker.postMessage({ type: 'file', content: `${data}（已删除）` }),
                fail: ({ errMsg }) => worker.postMessage({ type: 'file', errMsg })
              }),
            fail: ({ errMsg }) => worker.postMessage({ type: 'file', errMsg })
          }),
        fail: ({ errMsg }) => worker.postMessage({ type: 'file', errMsg })
      });
      break;
    case 'readSync':
      try {
        worker.postMessage({ type: 'readSync', content: fs.readFileSync(notePath, 'utf8') });
      } catch (error) {
        worker.postMessage({ type: 'readSync', error: error.message });
      }
      break;
    case 'crash':
      throw new Error('Worker 处理消息时出错');
  }
});
