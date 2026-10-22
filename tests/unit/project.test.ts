import path from 'path';
import { describe, expect, it } from 'vitest';
import { MiniProgram } from '../../packages/core/src/project/MiniProgram';
import { createWxConfig } from '../../packages/core/src/project/wxConfig';
import { createProject } from '../helpers';

function sampleProject() {
  return createProject({
    'project.config.json': { appid: 'wx123', miniprogramRoot: 'src/' },
    'src/app.json': {
      pages: ['pages/home/home', 'pages/list/list'],
      subPackages: [
        { root: 'pkg', pages: ['detail/detail'] },
        { root: 'solo', pages: ['entry'], independent: true }
      ],
      usingComponents: { 'g-button': '/components/button/button', 'g-rel': 'components/rel/rel' },
      tabBar: { list: [{ pagePath: 'pages/home/home', text: '首页' }] },
      window: { navigationBarTitleText: 'Demo' }
    },
    'src/pages/home/home.json': { usingComponents: { card: '../../components/card/card' }, navigationBarTitleText: 'Home' },
    'src/pages/list/list.json': { usingComponents: { 'van-cell': '@vant/weapp/cell/index' } },
    'src/pkg/detail/detail.json': {},
    'src/solo/entry.json': {},
    'src/components/button/button.json': { component: true },
    'src/components/rel/rel.json': { component: true },
    'src/components/card/card.json': {
      component: true,
      usingComponents: { inner: './inner' },
      componentGenerics: { slotted: { default: '/components/button/button' } }
    },
    'src/components/card/inner.json': { component: true },
    'src/miniprogram_npm/@vant/weapp/cell/index.json': { component: true, usingComponents: { icon: '../icon/index' } },
    'src/miniprogram_npm/@vant/weapp/icon/index.json': { component: true },
    'src/app.js': '',
    'src/node_modules/lib/index.js': '',
    'src/.hidden/x.js': '',
    'src/sitemap.json': {}
  });
}

describe('MiniProgram 项目解析', () => {
  const project = new MiniProgram(sampleProject());
  const app = project.readAppJson();

  it('按 project.config.json 的 miniprogramRoot 定位代码目录并读取 appid', () => {
    expect(path.basename(project.root)).toBe('src');
    expect(project.appid).toBe('wx123');
  });

  it('页面列表包含分包页面', () => {
    expect(project.allPages(app)).toEqual(['pages/home/home', 'pages/list/list', 'pkg/detail/detail', 'solo/entry']);
  });

  it('全局组件展开到页面：绝对路径保持不变，相对路径换算成相对页面', () => {
    const json = project.readUnitJson('pages/home/home', app);
    expect(json.usingComponents).toEqual({
      card: '../../components/card/card',
      'g-button': '/components/button/button',
      'g-rel': '../../components/rel/rel'
    });
    expect(json.navigationBarTitleText).toBe('Home');
  });

  it('页面自己声明的同名组件优先于全局组件', () => {
    const custom = new MiniProgram(createProject({
      'app.json': { pages: ['p/p'], usingComponents: { x: '/a/a' } },
      'p/p.json': { usingComponents: { x: '/b/b' } }
    }));
    expect(custom.readUnitJson('p/p', custom.readAppJson()).usingComponents.x).toBe('/b/b');
  });

  it('miniprogram_npm 内的组件和独立分包不展开全局组件', () => {
    expect(project.readUnitJson('miniprogram_npm/@vant/weapp/cell/index', app).usingComponents).toEqual({ icon: '../icon/index' });
    expect(project.readUnitJson('solo/entry', app).usingComponents).toEqual({});
  });

  it('递归收集组件：相对路径、绝对路径、npm 包和抽象节点默认实现', () => {
    const { components } = project.collectUnits(app);
    expect(components.sort()).toEqual([
      'components/button/button',
      'components/card/card',
      'components/card/inner',
      'components/rel/rel',
      'miniprogram_npm/@vant/weapp/cell/index',
      'miniprogram_npm/@vant/weapp/icon/index'
    ]);
  });

  it('插件组件和不存在的组件被忽略', () => {
    expect(project.resolveComponent('pages/home/home', 'plugin://x/y')).toBeNull();
    expect(project.resolveComponent('pages/home/home', './missing')).toBeNull();
  });

  it('列文件时跳过 node_modules、隐藏目录和指定目录', () => {
    expect(project.listFiles(['.js'])).toEqual(['app.js']);
  });

  it('app.json 不合法时给出文件名', () => {
    const broken = createProject({ 'app.json': '{ pages: ' });
    expect(() => new MiniProgram(broken).readAppJson()).toThrow(/app\.json 不是合法的 JSON/);
  });

  it('缺少 app.json 时报错', () => {
    expect(() => new MiniProgram(createProject({ 'a.js': '' }))).toThrow('没有 app.json');
  });
});

describe('__wxConfig', () => {
  const project = new MiniProgram(sampleProject());
  const app = project.readAppJson();
  const { pages } = project.collectUnits(app);
  const unitJson = new Map(pages.map(id => [id, project.readUnitJson(id, app)]));
  const config = createWxConfig({ app, pages, unitJson, appid: 'wx123', subPackages: project.subPackages(app) });

  it('入口页面和 tabBar 路径带 .html 后缀', () => {
    expect(config.entryPagePath).toBe('pages/home/home.html');
    expect(config.tabBar.list[0].pagePath).toBe('pages/home/home.html');
  });

  it('每个页面（含分包）都有 window 配置，全局窗口配置带默认值', () => {
    expect(Object.keys(config.page)).toEqual(pages.map(p => p + '.html'));
    expect(config.page['pages/home/home.html'].window.navigationBarTitleText).toBe('Home');
    expect(config.global.window).toMatchObject({ navigationBarTitleText: 'Demo', backgroundColor: '#ffffff' });
  });

  it('包含基础库运行需要的账号与启动信息', () => {
    expect(config.accountInfo.appId).toBe('wx123');
    expect(config.appLaunchInfo).toEqual({ scene: 1001, path: 'pages/home/home', query: {} });
    expect(config.platform).toBe('devtools');
  });
});
