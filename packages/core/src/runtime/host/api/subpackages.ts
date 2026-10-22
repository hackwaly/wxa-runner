/**
 * 分包加载的本地就绪协议：分包预下载（preloadRule）和分包异步化（跨分包组件、require.async）都走这里。
 *
 * AppBuilder 已预注册所有分包模块，静态资源也由开发服务器直接提供，因此这里不下载文件，
 * 只按基础库协议交回任务 ID，再异步通知进度与完成。未知包明确失败，不假装加载成功。
 * Worker 代码配置为分包时（workers.isSubpackage），预下载 Worker 分包的模块名是 /workers.js，与开发者工具一样只在这时成功。
 */

import { ApiHandler, fail, ok } from './registry';

export interface SubpackageApiOptions {
  subPackages: ReadonlyArray<{ root: string; name?: string }>;
  /** app.json 的 workers */
  workers?: string | { isSubpackage?: boolean };
  emit: (event: string, data: Record<string, unknown>) => void;
}

export function createSubpackageApis(options: SubpackageApiOptions): Record<string, ApiHandler> {
  const names = new Set(['__APP__']);
  for (const pkg of options.subPackages) {
    names.add(normalizeName(pkg.root));
    if (pkg.name) names.add(normalizeName(pkg.name));
  }
  if (typeof options.workers === 'object' && options.workers.isSubpackage) names.add('workers.js');
  let taskSeq = 0;

  const createLoadSubPackageTask: ApiHandler = (args, { api }) => {
    const moduleName = args.moduleName;
    if (typeof moduleName !== 'string' || !moduleName || !names.has(normalizeName(moduleName))) {
      return fail(api, 'module not found');
    }

    const loadTaskId = String(++taskSeq);
    // 先让基础库登记任务、业务方绑定进度监听，之后再派发事件，与网络任务的时序一致。
    setTimeout(() => {
      const event = { taskId: loadTaskId, moduleName };
      options.emit('onLoadSubPackageTaskStateChange', {
        ...event, state: 'progressUpdate', progress: 100,
        // 没有网络下载，不伪造传输字节数。
        totalBytesWritten: 0, totalBytesExpectedToWrite: 0
      });
      options.emit('onLoadSubPackageTaskStateChange', { ...event, state: 'success' });
    }, 0);
    return ok(api, { loadTaskId });
  };

  return {
    createLoadSubPackageTask,
    // 事件已由桥接广播，具体监听与回调由基础库管理，无需另建一套订阅状态。
    listenLoadSubPackageTaskStateChange: (_args, { api }) => ok(api),
    // 分包加载完成后渲染层请求注入分包的模板和样式，它们已经打进 page-frame.js，回调后基础库替换占位组件。
    injectSubPackages: (_args, { api }) => ok(api)
  };
}

/** 基础库通常传 /root/；同时接受配置中的 root 与 name，不放宽到任意子路径。 */
function normalizeName(name: string): string {
  return name.replace(/^\.?\//, '').replace(/\/$/, '');
}
