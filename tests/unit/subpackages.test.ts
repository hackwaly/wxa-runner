import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSubpackageApis } from '../../packages/core/src/runtime/host/api/subpackages';
import { ApiHandler, ApiResult } from '../../packages/core/src/runtime/host/api/registry';

const call = (apis: Record<string, ApiHandler>, api: string, args: object = {}) =>
  apis[api](args, { api, from: 'service', webviewId: 1 }) as ApiResult;

function setup() {
  vi.useFakeTimers();
  const emit = vi.fn();
  const apis = createSubpackageApis({
    subPackages: [{ root: 'pages/birthday' }, { root: 'assets/hot', name: 'hot-assets' }],
    emit
  });
  return { apis, emit };
}

afterEach(() => { vi.useRealTimers(); });

describe('已预注册分包的原生加载任务', () => {
  it('同步返回 loadTaskId，随后按 taskId 派发进度与成功，不产生下载流量', () => {
    const { apis, emit } = setup();
    const result = call(apis, 'createLoadSubPackageTask', { moduleName: '/pages/birthday/' });
    expect(result.errMsg).toBe('createLoadSubPackageTask:ok');
    expect(typeof result.loadTaskId).toBe('string');
    expect(result.loadTaskId).not.toBe('');
    expect(emit).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(emit.mock.calls).toEqual([
      ['onLoadSubPackageTaskStateChange', {
        taskId: result.loadTaskId, moduleName: '/pages/birthday/', state: 'progressUpdate',
        progress: 100, totalBytesWritten: 0, totalBytesExpectedToWrite: 0
      }],
      ['onLoadSubPackageTaskStateChange', {
        taskId: result.loadTaskId, moduleName: '/pages/birthday/', state: 'success'
      }]
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['assets/hot', '/assets/hot/', './assets/hot/', 'hot-assets', '__APP__'])
  ('支持已声明的根路径、包名和已注册主包：%s', moduleName => {
    const { apis, emit } = setup();
    expect(call(apis, 'createLoadSubPackageTask', { moduleName }).loadTaskId).toBeTruthy();
    vi.runAllTimers();
    expect(emit).toHaveBeenLastCalledWith('onLoadSubPackageTaskStateChange', expect.objectContaining({ state: 'success' }));
  });

  it.each([undefined, '', 1, {}, 'missing', 'pages/birthday/not-declared', '../assets/hot', '/assets//hot/'])
  ('未知包或非法名称明确失败，不制造成功事件：%s', moduleName => {
    const { apis, emit } = setup();
    const result = call(apis, 'createLoadSubPackageTask', { moduleName });
    expect(result.errMsg).toMatch(/^createLoadSubPackageTask:fail/);
    expect(result.loadTaskId).toBeUndefined();
    vi.runAllTimers();
    expect(emit).not.toHaveBeenCalled();
  });

  it('并发与重复调用使用不同任务 ID，各自只完成一次', () => {
    const { apis, emit } = setup();
    const first = call(apis, 'createLoadSubPackageTask', { moduleName: '/assets/hot/' });
    const second = call(apis, 'createLoadSubPackageTask', { moduleName: '/assets/hot/' });
    expect(first.loadTaskId).not.toBe(second.loadTaskId);
    vi.runAllTimers();
    expect(emit.mock.calls.filter(([, data]) => data.state === 'success').map(([, data]) => data.taskId))
      .toEqual([first.loadTaskId, second.loadTaskId]);
  });

  it('基础库的进度监听声明由桥接广播承接，不额外重复发送', () => {
    const { apis, emit } = setup();
    const { loadTaskId } = call(apis, 'createLoadSubPackageTask', { moduleName: '/assets/hot/' });
    expect(call(apis, 'listenLoadSubPackageTaskStateChange', { taskId: loadTaskId, states: ['progressUpdate'] }).errMsg)
      .toBe('listenLoadSubPackageTaskStateChange:ok');
    vi.runAllTimers();
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('渲染层注入分包时直接成功：模板和样式已在 page-frame.js 中', () => {
    const { apis, emit } = setup();
    expect(call(apis, 'injectSubPackages', { subPackages: ['/assets/hot/'] }).errMsg).toBe('injectSubPackages:ok');
    vi.runAllTimers();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('Worker 分包的加载任务', () => {
  const create = (workers?: string | { path: string; isSubpackage?: boolean }) => {
    vi.useFakeTimers();
    const emit = vi.fn();
    return { apis: createSubpackageApis({ subPackages: [], workers, emit }), emit };
  };

  it('workers 配置为分包时，预下载 Worker 分包（模块名 /workers.js）成功', () => {
    const { apis, emit } = create({ path: 'workers/', isSubpackage: true });
    const result = call(apis, 'createLoadSubPackageTask', { moduleName: '/workers.js' });
    expect(result.loadTaskId).toBeTruthy();
    vi.runAllTimers();
    expect(emit).toHaveBeenLastCalledWith('onLoadSubPackageTaskStateChange', expect.objectContaining({
      taskId: result.loadTaskId, moduleName: '/workers.js', state: 'success'
    }));
  });

  it.each([undefined, 'workers', { path: 'workers' }])
  ('Worker 代码不是分包时，预下载 Worker 分包失败，与开发者工具一致：%j', workers => {
    const { apis, emit } = create(workers);
    expect(call(apis, 'createLoadSubPackageTask', { moduleName: '/workers.js' }).errMsg).toBe('createLoadSubPackageTask:fail module not found');
    vi.runAllTimers();
    expect(emit).not.toHaveBeenCalled();
  });
});
