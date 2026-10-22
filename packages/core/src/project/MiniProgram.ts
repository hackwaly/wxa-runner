/**
 * 小程序项目结构解析
 *
 * 负责读取 app.json / 页面与组件 json，并按开发者工具的规则做预处理：
 * - app.json 的全局 usingComponents 展开到每个页面和组件（miniprogram_npm 内除外）
 * - 每个页面/组件 json 都保证有 usingComponents 字段
 */

import fs from 'fs';
import path from 'path';

export interface AppJson {
  pages: string[];
  entryPagePath?: string;
  window?: Record<string, any>;
  tabBar?: {
    custom?: boolean;
    list: Array<{ pagePath: string; text?: string; iconPath?: string; selectedIconPath?: string }>;
    [key: string]: any;
  };
  subPackages?: Array<{ root: string; pages: string[]; independent?: boolean; [key: string]: any }>;
  subpackages?: AppJson['subPackages'];
  usingComponents?: Record<string, string>;
  workers?: string | { path: string };
  [key: string]: any;
}

export interface UnitJson {
  usingComponents: Record<string, string>;
  componentGenerics?: Record<string, boolean | { default?: string }>;
  component?: boolean;
  [key: string]: any;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', '.idea', '.vscode']);
// wxa.setup.js 是 wxa-runner 的启动前脚本，不属于小程序
const PROJECT_FILES = new Set(['project.config.json', 'project.private.config.json', 'sitemap.json', 'app.json', 'wxa.setup.js']);

export class MiniProgram {
  /** 小程序代码根目录（已考虑 project.config.json 的 miniprogramRoot） */
  readonly root: string;
  readonly appid: string;

  constructor(readonly projectPath: string) {
    const projectConfig = readJsonFile(path.join(projectPath, 'project.config.json')) || {};
    this.root = path.resolve(projectPath, projectConfig.miniprogramRoot || '');
    this.appid = projectConfig.appid || 'touristappid';

    if (!fs.existsSync(path.join(this.root, 'app.json'))) {
      throw new Error(`${this.root} 下没有 app.json，不是有效的小程序目录`);
    }
  }

  readAppJson(): AppJson {
    const app = readJsonFile(path.join(this.root, 'app.json'));
    if (!app || !Array.isArray(app.pages) || app.pages.length === 0) {
      throw new Error('app.json 缺少 pages 配置');
    }
    return app;
  }

  subPackages(app: AppJson) {
    return app.subPackages || app.subpackages || [];
  }

  /** 主包页面 + 分包页面（带 root 前缀） */
  allPages(app: AppJson): string[] {
    const pages = [...app.pages];
    for (const pkg of this.subPackages(app)) {
      for (const page of pkg.pages) {
        const full = path.posix.join(pkg.root, page);
        if (!pages.includes(full)) pages.push(full);
      }
    }
    return pages;
  }

  /** 读取并预处理页面/组件 json，id 不带扩展名 */
  readUnitJson(id: string, app: AppJson): UnitJson {
    const json: UnitJson = { ...readJsonFile(path.join(this.root, id + '.json')) };
    json.usingComponents = { ...json.usingComponents };

    if (!id.startsWith('miniprogram_npm/') && !this.isInIndependentSubPackage(id, app)) {
      for (const [tag, ref] of Object.entries(app.usingComponents || {})) {
        if (json.usingComponents[tag]) continue;
        if (ref.startsWith('/') || ref.startsWith('plugin://')) {
          json.usingComponents[tag] = ref;
        } else {
          const relative = path.posix.relative(path.posix.dirname(id), ref);
          json.usingComponents[tag] = relative.startsWith('.') ? relative : './' + relative;
        }
      }
    }
    return json;
  }

  /**
   * 解析组件引用到组件路径（不带扩展名）；插件组件或找不到时返回 null。
   * 规则：/ 开头为根目录绝对路径；否则先按相对路径找，再沿目录向上查找 miniprogram_npm。
   */
  resolveComponent(fromId: string, ref: string): string | null {
    if (!ref || ref.startsWith('plugin://') || ref.startsWith('plugin-private://')) return null;

    const fromDir = path.posix.dirname(fromId);
    const candidates: string[] = [];

    if (ref.startsWith('/')) {
      candidates.push(ref.slice(1));
    } else {
      candidates.push(path.posix.join(fromDir, ref));
      if (!ref.startsWith('.')) {
        let dir = fromDir;
        for (;;) {
          candidates.push(path.posix.join(dir === '.' ? '' : dir, 'miniprogram_npm', ref));
          if (dir === '.' || dir === '') break;
          dir = path.posix.dirname(dir);
        }
      }
    }

    for (const candidate of candidates) {
      const normalized = path.posix.normalize(candidate);
      for (const id of [normalized, path.posix.join(normalized, 'index')]) {
        if (fs.existsSync(path.join(this.root, id + '.json'))) return id;
      }
    }
    return null;
  }

  /** 收集页面、隐式自定义 tabBar 及它们（递归）引用到的组件 */
  collectUnits(app: AppJson): { pages: string[]; components: string[] } {
    const pages = this.allPages(app);
    const components: string[] = [];
    const visited = new Set<string>(pages);

    const visit = (id: string) => {
      const json = this.readUnitJson(id, app);
      const refs = Object.values(json.usingComponents);
      for (const generic of Object.values(json.componentGenerics || {})) {
        if (typeof generic === 'object' && generic.default) refs.push(generic.default);
      }
      for (const ref of refs) enter(this.resolveComponent(id, ref));
    };
    const enter = (id: string | null) => {
      if (!id || visited.has(id)) return;
      visited.add(id);
      components.push(id);
      visit(id);
    };

    // 自定义 tabBar 不在 usingComponents 中声明，但基础库会按固定路径创建它。
    if (app.tabBar?.custom) enter(this.resolveComponent('app', '/custom-tab-bar/index'));
    pages.forEach(visit);
    return { pages, components };
  }

  /** 列出代码根目录下指定扩展名的文件，返回 posix 风格的相对路径 */
  listFiles(extensions: string[], excludeDirs: string[] = []): string[] {
    const result: string[] = [];
    const excluded = new Set(excludeDirs.map(dir => dir.replace(/^\/|\/$/g, '')));

    const walk = (dir: string, rel: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!excluded.has(childRel)) walk(path.join(dir, entry.name), childRel);
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
          if (!rel && PROJECT_FILES.has(entry.name)) continue;
          result.push(childRel);
        }
      }
    };

    walk(this.root, '');
    return result.sort();
  }

  exists(relPath: string): boolean {
    return fs.existsSync(path.join(this.root, relPath));
  }

  readText(relPath: string): string {
    return fs.readFileSync(path.join(this.root, relPath), 'utf8');
  }

  private isInIndependentSubPackage(id: string, app: AppJson): boolean {
    return this.subPackages(app).some(pkg => pkg.independent && id.startsWith(pkg.root.replace(/\/?$/, '/')));
  }
}

function readJsonFile(file: string): any {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} 不是合法的 JSON：${(error as Error).message}`);
  }
}
