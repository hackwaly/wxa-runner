/**
 * 测试 API 和 Playwright fixture 的说明：类型注释是唯一的说明来源，docs/test-api.md 的表格不能漏写成员
 */

import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { Host } from '../../packages/core/src/runtime/host/Host';
import { installTestApi } from '../../packages/core/src/runtime/host/testApi';
import { REPO_ROOT } from '../helpers';

const TEST_API_FILE = path.join(REPO_ROOT, 'packages/core/src/runtime/host/testApi.ts');
const FIXTURE_FILE = path.join(REPO_ROOT, 'packages/playwright/src/index.ts');

/** 运行时 window.__wxa_test_api__ 上的成员；安装时只把对象挂到 window 上，不访问宿主 */
function testApiMembers(): string[] {
  const global = globalThis as { window?: unknown };
  global.window = {};
  try {
    return Object.keys(installTestApi({} as Host, Promise.resolve()));
  } finally {
    delete global.window;
  }
}

/** docs/test-api.md「成员」一节表格里列出的成员 */
function documentedMembers(): Set<string> {
  // Windows 上按 CRLF 检出时也能按行切分
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'docs/test-api.md'), 'utf8').replace(/\r\n/g, '\n');
  const section = doc.split(/^## /m).find(part => part.startsWith('成员\n'));
  if (!section) throw new Error('docs/test-api.md 里找不到「## 成员」一节');
  const rows = section.split('\n').filter(line => line.startsWith('|'));
  return new Set(rows.flatMap(row => [...row.matchAll(/`(\w+)/g)].map(match => match[1])));
}

/** 编辑器悬停时看不到说明的成员：没有注释，经映射类型复用的注释也算有 */
function undocumentedMembers(program: ts.Program, file: string, typeName: string): string[] {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`找不到 ${file}`);
  const moduleSymbol = checker.getSymbolAtLocation(source)!;
  let symbol = checker.getExportsOfModule(moduleSymbol).find(s => s.name === typeName);
  if (!symbol) throw new Error(`${file} 没有导出 ${typeName}`);
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const members = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol));
  // 类型解析失败（如导入路径不对）时成员为空，检查会空转通过
  if (!members.length) throw new Error(`${typeName} 没有解析出成员`);
  return members
    .filter(member => !ts.displayPartsToString(member.getDocumentationComment(checker)).trim())
    .map(member => member.name);
}

describe('测试 API 的说明', () => {
  it('测试 API 的每个成员都写在 docs/test-api.md 的表格里', () => {
    const documented = documentedMembers();
    expect(testApiMembers().filter(member => !documented.has(member))).toEqual([]);
  });

  it('测试 API 和 Playwright fixture 的每个成员在编辑器里悬停都能看到说明', () => {
    const program = ts.createProgram([TEST_API_FILE, FIXTURE_FILE], {
      strict: true,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      skipLibCheck: true,
      lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
      // 直接读源码里的注释，不依赖构建产物
      baseUrl: REPO_ROOT,
      paths: {
        '@open-wxa/wxa-runner-core': ['packages/core/src/index.ts'],
        '@open-wxa/wxa-runner-core/*': ['packages/core/src/*']
      }
    });

    expect(undocumentedMembers(program, TEST_API_FILE, 'WxaTestApi')).toEqual([]);
    expect(undocumentedMembers(program, FIXTURE_FILE, 'MiniProgram')).toEqual([]);
  });
});
