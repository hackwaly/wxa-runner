/**
 * 提交信息和分支名规范：commit-msg、pre-push hook 和 CI 跑的是同样的检查
 *
 * release-please 靠提交类型决定发不发版、升哪一位、写进 CHANGELOG 的哪一节，格式不对的提交会被它直接忽略。
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../helpers';

/** 用 node 直接运行入口：node_modules/.bin 下的 shim 在 Windows 上没法 spawn。@returns 退出码，0 为通过 */
const commitlint = (message: string) =>
  spawnSync(process.execPath, [path.join(REPO_ROOT, 'node_modules/@commitlint/cli/cli.js')], {
    cwd: REPO_ROOT,
    input: message,
    encoding: 'utf8'
  }).status;

/** 有参数时检查这些分支名，没有时像 pre-push hook 一样从标准输入读推送的 ref；@returns 退出码，0 为通过 */
const checkBranch = (names: string[], pushedRefs = '') =>
  spawnSync('node', [path.join(REPO_ROOT, 'scripts/check-branch-name.mjs'), ...names], {
    cwd: REPO_ROOT,
    input: pushedRefs,
    encoding: 'utf8'
  }).status;

describe('提交信息', () => {
  it('带类型前缀的提交信息通过，中文描述、release-please 的发布提交和合并提交都可以', () => {
    const messages = [
      'feat: 支持选图、预览与保存图片',
      'fix(compiler): 没装开发者工具时偶发 wcc 编译崩溃',
      // 中文描述常以英文专有名词开头
      'docs: README 不再把热更新列为选用理由',
      'ci: GitHub Actions 在 Linux 上跑全部测试',
      'chore: release 0.2.3 (#26)',
      "Merge branch 'fix/wcc-split'：没装开发者工具时偶发 wcc 编译崩溃"
    ];
    for (const message of messages) expect(commitlint(message), message).toBe(0);
  });

  it('没有类型前缀、类型拼错或冒号后没有空格的提交信息被拒绝', () => {
    const messages = ['wxss 改动热替换，不再整页刷新', 'feature: 支持选图', 'fix:偶发 wcc 编译崩溃'];
    for (const message of messages) expect(commitlint(message), message).not.toBe(0);
  });
});

describe('分支名', () => {
  it('「类型/短横线描述」格式的分支名通过，main 和 release-please 开的分支也可以', () => {
    const names = ['fix/wcc-split', 'feat/isolated-context-spike', 'ci/release-please', 'main', 'release-please--branches--main--components--wxa-runner'];
    for (const name of names) expect(checkBranch([name]), name).toBe(0);
  });

  it('不带类型、类型不在列表里或带大写字母的分支名被拒绝', () => {
    for (const name of ['wcc-fix', 'feature/media', 'Fix/WccSplit', 'fix/']) expect(checkBranch([name]), name).not.toBe(0);
  });

  it('推送时检查推送到远程的分支名，删除远程分支和推送 tag 不检查', () => {
    const sha = 'a'.repeat(40);
    const none = '0'.repeat(40);
    expect(checkBranch([], `refs/heads/fix/wcc-split ${sha} refs/heads/wcc-fix ${none}\n`)).not.toBe(0);
    expect(checkBranch([], `refs/heads/wcc-fix ${sha} refs/heads/fix/wcc-split ${none}\n`)).toBe(0);
    expect(checkBranch([], `(delete) ${none} refs/heads/old-branch ${sha}\n`)).toBe(0);
    expect(checkBranch([], `refs/tags/v0.2.3 ${sha} refs/tags/v0.2.3 ${none}\n`)).toBe(0);
  });
});
