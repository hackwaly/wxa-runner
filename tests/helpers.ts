import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { findCompilerBinaries } from '../packages/compiler/src/locate';
import { listBaseLibs } from '../packages/extractor/src/baselib';

export const REPO_ROOT = path.resolve(__dirname, '..');
export const EXAMPLES = path.join(REPO_ROOT, 'examples');

/** 在临时目录里按 { 相对路径: 内容 } 创建文件，Buffer 原样写入，其余对象序列化为 JSON */
export function createProject(files: Record<string, string | object>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-runner-test-'));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  }
  return root;
}

/** 按 .wxvpkg 格式打包（基础库、插件代码包都是这个格式），Buffer 原样写入 */
export function packWxvpkg(files: Record<string, string | Buffer>): Buffer {
  const entries = Object.entries(files).map(([name, content]) => ({
    name: Buffer.from(name, 'utf8'),
    data: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
  }));
  const indexSize = 4 + entries.reduce((sum, entry) => sum + 12 + entry.name.length, 0);
  const header = Buffer.alloc(14);
  header[0] = 0xbe;
  header.writeUInt32BE(0, 1);
  header.writeUInt32BE(indexSize, 5);
  header[13] = 0xed;

  const index = Buffer.alloc(indexSize);
  index.writeUInt32BE(entries.length, 0);
  let pos = 4;
  let offset = header.length + indexSize;
  for (const entry of entries) {
    index.writeUInt32BE(entry.name.length, pos);
    entry.name.copy(index, pos + 4);
    pos += 4 + entry.name.length;
    index.writeUInt32BE(offset, pos);
    index.writeUInt32BE(entry.data.length, pos + 4);
    pos += 8;
    offset += entry.data.length;
  }
  return Buffer.concat([header, index, ...entries.map(entry => entry.data)]);
}

/** 按 Electron 的 .asar 格式打包（新版开发者工具的 app.asar），路径用 / 分隔，如 js/libs/a */
export function packAsar(files: Record<string, string>): Buffer {
  type Dir = { files: Record<string, Dir | { size: number; offset: string }> };
  const root: Dir = { files: {} };
  const contents: Buffer[] = [];
  let offset = 0;
  for (const [file, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const parts = file.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = (dir.files[part] ??= { files: {} }) as Dir;
    dir.files[parts[parts.length - 1]] = { size: data.length, offset: String(offset) };
    contents.push(data);
    offset += data.length;
  }

  // 两段 pickle：[4][文件头长度]，[内容长度][JSON 长度][JSON，补齐到 4 字节]；文件内容紧跟其后
  const json = Buffer.from(JSON.stringify(root), 'utf8');
  const payload = Math.ceil((4 + json.length) / 4) * 4;
  const header = Buffer.alloc(12 + payload);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(payload + 4, 4);
  header.writeUInt32LE(payload, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);
  return Buffer.concat([header, ...contents]);
}

/** 编译器和兼容的基础库是否都找得到（开发者工具或内置基础库），依赖它们的测试在没有时跳过 */
export function hasToolchain(): boolean {
  try {
    findCompilerBinaries();
    return listBaseLibs().some(lib => lib.compatible);
  } catch {
    return false;
  }
}

/** 生成指定尺寸的纯色 PNG，默认灰色 */
export function png(width: number, height: number, rgb: [number, number, number] = [0x80, 0x80, 0x80]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 每个颜色分量 8 位
  header[9] = 2; // RGB
  // 每行以过滤类型（0 表示不过滤）开头
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: width }, () => Buffer.from(rgb))]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
