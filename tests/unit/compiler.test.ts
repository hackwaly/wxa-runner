import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locateCompilerBinaries } from '../../packages/compiler/src/locate';
import { findDevtoolsPackageDirs } from '../../packages/extractor/src/devtools';
import { compileWxml } from '../../packages/compiler/src/wcc';
import { compileWxss, parseWcscOutput, unescapeJsString } from '../../packages/compiler/src/wcsc';
import { createProject, hasToolchain } from '../helpers';

describe('wcsc 输出解析', () => {
  it('把 key=value 交替的输出拆成对象，并还原转义', () => {
    const output = 'version=v0.4=comm=var a \\x3d 1;\\nvar b\\x3d\\x22x\\x22=./pages/a.wxss=setCssToHead([\\x22.a{}\\x22])';
    expect(parseWcscOutput(output)).toEqual({
      version: 'v0.4',
      comm: 'var a = 1;\nvar b="x"',
      './pages/a.wxss': 'setCssToHead([".a{}"])'
    });
  });

  it('处理 \\u、\\\\ 和普通字符转义', () => {
    expect(unescapeJsString('\\u4e2d\\\\\\\'\\t')).toBe('中\\\'\t');
  });
});

describe('编译器定位', () => {
  // 开发者工具里的编译器在 Windows 上是 wcc.exe、wcsc.exe
  const ext = process.platform === 'win32' ? '.exe' : '';

  // 环境变量指定的编译器优先于其它来源
  beforeEach(() => {
    vi.stubEnv('WXA_WCC', '');
    vi.stubEnv('WXA_WCSC', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('装了开发者工具时使用开发者工具的编译器', () => {
    const devtools = createProject({ [`node_modules/wcc-exec/wcc${ext}`]: '', [`node_modules/wcc-exec/wcsc${ext}`]: '' });
    expect(locateCompilerBinaries([devtools]).wcc).toBe(path.join(devtools, `node_modules/wcc-exec/wcc${ext}`));
  });

  it('新版开发者工具（Electron）的编译器在 app.asar.unpacked 里，同样使用它', () => {
    const app = createProject({
      'Contents/Resources/app.asar.unpacked/package.json': '{}',
      [`Contents/Resources/app.asar.unpacked/node_modules/wcc-exec/wcc${ext}`]: '',
      [`Contents/Resources/app.asar.unpacked/node_modules/wcc-exec/wcsc${ext}`]: ''
    });
    vi.stubEnv('WXA_DEVTOOLS_PATH', app);
    expect(locateCompilerBinaries(findDevtoolsPackageDirs()).wcc)
      .toBe(path.join(app, `Contents/Resources/app.asar.unpacked/node_modules/wcc-exec/wcc${ext}`));
  });

  it('没装开发者工具时（如 Linux、CI），使用 miniprogram-compiler 自带的编译器，并且可以直接执行', () => {
    const { wcc, wcsc } = locateCompilerBinaries([]);
    for (const file of [wcc, wcsc]) {
      expect(file).toContain(`${path.sep}miniprogram-compiler${path.sep}`);
      expect(() => fs.accessSync(file, fs.constants.X_OK)).not.toThrow();
    }
  });
});

describe.skipIf(!hasToolchain())('官方编译器', () => {
  const root = createProject({
    'pages/index/index.wxml': '<wxs module="m" src="../../utils/m.wxs"/><view class="a">{{m.twice(n)}}</view><counter/>',
    'pages/index/index.wxss': '.a { padding: 20rpx; }',
    'components/counter/counter.wxml': '<view>counter</view>',
    'utils/m.wxs': 'module.exports = { twice: function (n) { return n * 2 } }',
    'app.wxss': 'page { color: red; }'
  });
  const files = ['./pages/index/index.wxml', './components/counter/counter.wxml', './utils/m.wxs'];
  const components = [{ path: 'pages/index/index', tags: ['counter'] }, { path: 'components/counter/counter', tags: [] }];

  it('wxml 和 wxs 一起编译成一个 $gwx', async () => {
    const code = await compileWxml({ cwd: root, files, components, cut: false });
    expect(code).toContain('$gwx=function');
    expect(code).toContain('./pages/index/index.wxml');
    expect(code).toContain('twice');
  });

  it('逻辑层的裁剪版与渲染层版本不同', async () => {
    const [full, cut] = await Promise.all([
      compileWxml({ cwd: root, files, components, cut: false }),
      compileWxml({ cwd: root, files, components, cut: true })
    ]);
    expect(cut).not.toBe(full);
  });

  it('wxml 语法错误时报告文件位置', async () => {
    const broken = createProject({ 'a.wxml': '<view></vie>' });
    await expect(compileWxml({ cwd: broken, files: ['./a.wxml'], components: [], cut: false }))
      .rejects.toThrow(/a\.wxml:1:\d+/);
  });

  it('页面样式单独输出，app.wxss 进入公共部分', async () => {
    const result = await compileWxss({ cwd: root, pageFiles: ['./pages/index/index.wxss'], commonFiles: ['./app.wxss'] });
    expect(Object.keys(result.pages)).toEqual(['pages/index/index.wxss']);
    expect(result.pages['pages/index/index.wxss']).toContain('setCssToHead');
    expect(result.comm).toContain('color: red');
  });

  it('多次重复编译结果稳定（子进程方式不受原生模块崩溃影响）', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => compileWxml({ cwd: root, files, components, cut: false })));
    expect(new Set(results).size).toBe(1);
  });

  // CI 上偶发「wcc 编译失败：std::out_of_range」：miniprogram-compiler 的 wcc 在某些时刻编译会崩溃，开发者工具的不会
  it('使用 miniprogram-compiler 的编译器（Linux、CI）时，任何时刻编译都不会崩溃', async () => {
    vi.stubEnv('WXA_WCC', '');
    vi.stubEnv('WXA_WCSC', '');
    const packaged = locateCompilerBinaries([]);
    vi.stubEnv('WXA_WCC', packaged.wcc);
    vi.stubEnv('WXA_WCSC', packaged.wcsc);
    vi.resetModules();
    const { compileWxml: compileWithPackaged } = await import('../../packages/compiler/src/wcc');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const time of [1792250000007, 1792250000042, 1792250001234]) {
        vi.setSystemTime(time);
        expect(await compileWithPackaged({ cwd: root, files, components, cut: false })).toContain('$gwx=function');
      }
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});
