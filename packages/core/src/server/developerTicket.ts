/**
 * --devtools-login 用的开发者 ticket 从哪来
 *
 * 环境变量 WECHAT_DEV_TICKET 优先。新版开发者工具（Electron）把登录态加密存放，磁盘上只剩旧版留下的、
 * 早已作废的 ticket，所以要向正在运行的开发者工具要：用它的命令行为项目开启自动化接口，
 * 再通过自动化协议的 Tool.getTicket 取当前生效的 ticket。旧版（package.nw）照旧读磁盘上的登录数据。
 *
 * 不调用 Tool.refreshTicket：刷新会让别人手里的 ticket 立即作废，ticket 过期时开发者工具取的时候会自己刷新。
 */

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { setTimeout as sleep } from 'timers/promises';
import { WebSocket } from 'ws';
import { DeveloperTicket, findDeveloperTicket, findElectronDevtoolsCli, TICKET_ENV } from '@open-wxa/wxa-runner-extractor';

export type TicketSource = () => Promise<DeveloperTicket | null>;

/** 自动化接口的惯用端口；被占用时开发者工具会换一个，以命令行返回的为准 */
const AUTO_PORT = 9420;
/** 开发者工具没在运行时命令行要先启动它，项目窗口还可能在等用户确认信任 */
const CLI_TIMEOUT = 60_000;
/**
 * 取 ticket 平时 10ms 左右，项目窗口刚打开时第一次约 1s。项目窗口被关掉后开发者工具的后台可能还在监听，
 * 请求不报错而是一直挂着，超时就当自动化接口失效，重新开启
 */
const AUTOMATOR_TIMEOUT = 5_000;
/** 开启自动化后项目窗口要过一会儿才登记好，之前取 ticket 会报找不到窗口（开发者工具自己的命令行开启后等 8s 再用） */
const WINDOW_TIMEOUT = 10_000;
const WINDOW_RETRY_INTERVAL = 500;

/**
 * @param projectPath 项目目录（project.config.json 所在目录），开发者工具为它开启自动化接口，项目窗口没开时会打开
 * @param logger 开启自动化接口时告诉用户，因为开发者工具里可能多出一个项目窗口
 * @returns 每次调用都重新取，开发者工具重新登录、刷新 ticket 后不用重启。取不到时抛错，消息是给用户看的原因和处理办法
 */
export function developerTicketSource(projectPath: string, logger: Pick<Console, 'log'>): TicketSource {
  const cli = findElectronDevtoolsCli();
  if (!cli) return async () => findDeveloperTicket();

  let automatorPort: Promise<number> | null = null;
  // 同时发起的几次请求共用一次开启；失败了下次请求再试，用户改好设置后不用重启
  const startOnce = () => {
    if (!automatorPort) {
      const starting = startAutomation(cli, projectPath).then(port => {
        logger.log(`[wxa-runner] --devtools-login：已在微信开发者工具里为项目开启自动化接口（端口 ${port}），ticket 从开发者工具实时获取`);
        return port;
      });
      starting.catch(() => {
        if (automatorPort === starting) automatorPort = null;
      });
      automatorPort = starting;
    }
    return automatorPort;
  };

  return async () => {
    if (process.env[TICKET_ENV]) return { newticket: process.env[TICKET_ENV] };

    const port = startOnce();
    try {
      return await requestTicketOnceWindowReady(await port, projectPath);
    } catch (error) {
      if (!(error instanceof AutomatorGone)) throw error;
      // 开发者工具重启过、项目窗口被关掉：重新开启一次再试
      if (automatorPort === port) automatorPort = null;
      return requestTicketOnceWindowReady(await startOnce(), projectPath);
    }
  };
}

/** 自动化接口连不上或不响应了，消息是重新开启后还这样时给用户看的 */
class AutomatorGone extends Error {}
class WindowNotFound extends Error {}

async function requestTicketOnceWindowReady(port: number, projectPath: string): Promise<DeveloperTicket> {
  const deadline = Date.now() + WINDOW_TIMEOUT;
  for (;;) {
    try {
      return await requestTicket(port);
    } catch (error) {
      if (!(error instanceof WindowNotFound)) throw error;
      if (Date.now() >= deadline) throw new Error(`微信开发者工具里找不到项目窗口，请在微信开发者工具里打开项目 ${projectPath}`);
      await sleep(WINDOW_RETRY_INTERVAL);
    }
  }
}

/**
 * 用开发者工具的命令行为项目开启自动化接口：开发者工具没在运行时启动它，项目窗口已经开着时复用
 *
 * @returns 自动化接口的端口
 */
async function startAutomation(cli: string, projectPath: string): Promise<number> {
  // 开发者工具设了「CLI 访问令牌」时，命令行自己从继承的环境变量 WECHAT_DEVTOOLS_CLI_TOKEN 读取
  const stdout = await runCli(cli, ['agent', 'start', '--project', projectPath, '--auto-port', String(AUTO_PORT), '--lang', 'zh']);
  // 成功时最后打印一段 JSON；失败时退出码多半还是 0，错误以 [error] 开头打印
  let autoPort = NaN;
  try {
    autoPort = Number(JSON.parse(stdout.match(/^\{$[\s\S]*?^\}$/m)?.[0] ?? '').autoPort);
  } catch {
    // 没有 JSON，从输出里找原因
  }
  if (Number.isInteger(autoPort) && autoPort > 0) return autoPort;

  if (stdout.includes('服务端口已关闭')) {
    throw new Error('微信开发者工具的服务端口已关闭，请在开发者工具「设置 → 安全设置」里开启服务端口');
  }
  throw new Error(`微信开发者工具没能为项目开启自动化接口：${cliErrorMessage(stdout)}`);
}

/** @returns 命令行的标准输出；命令行退出码不为 0 时也返回，由调用方从输出里找原因 */
function runCli(cli: string, args: string[]): Promise<string> {
  // Windows 上是 cli.bat，要经 cmd 运行，路径里常有空格（Program Files）
  const bat = cli.endsWith('.bat');
  const [file, fileArgs] = bat ? [`"${cli}"`, args.map(arg => `"${arg}"`)] : [cli, args];
  return new Promise((resolve, reject) => {
    const child = execFile(file, fileArgs, { shell: bat, timeout: CLI_TIMEOUT, windowsHide: true }, (error, stdout) => {
      if (error?.killed) {
        reject(new Error(`微信开发者工具的命令行 ${CLI_TIMEOUT / 1000}s 内没有完成，请看开发者工具里是否有等待确认的弹窗（如信任项目、扫码登录）`));
      } else if (error && !stdout) {
        reject(new Error(`运行微信开发者工具的命令行失败：${error.message}`));
      } else {
        resolve(stdout);
      }
    });
    child.stdin?.end();
  });
}

/**
 * 命令行把错误对象按 util.inspect 的格式打印，原因在 message 的第一行。
 * util.inspect 默认用单引号，字符串里有单引号时改用双引号，两种都有时用反引号
 */
function cliErrorMessage(stdout: string): string {
  // oxlint-disable-next-line no-control-regex -- 去掉命令行输出里的 ANSI 颜色
  const output = stdout.replace(/\x1b\[[0-9;]*m/g, '');
  const start = output.indexOf('[error]');
  const error = (start < 0 ? output : output.slice(start + '[error]'.length)).trim();
  const message = error.match(/message: (['"`])((?:\\.|(?!\1)[^\\])*?)(?:\\n|\1)/)?.[2];
  return message ?? (error.replace(/\s+/g, ' ').slice(0, 200) || '命令行没有输出');
}

/**
 * 通过自动化协议取开发者工具当前的 ticket：一条 WebSocket，{ id, method, params } → { id, result | error }
 *
 * 开发者工具会把别的自动化会话的消息也广播给每个连接，自己的回包还会收到两遍，按 id 认第一条
 */
function requestTicket(port: number): Promise<DeveloperTicket> {
  return new Promise((resolve, reject) => {
    const id = `wxa-runner-${randomUUID()}`;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      socket.removeAllListeners().on('error', () => undefined).terminate();
      finish();
    };
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(new AutomatorGone(`微信开发者工具的自动化接口 ${AUTOMATOR_TIMEOUT / 1000}s 内没有响应，请确认开发者工具里打开了项目窗口`))
        ),
      AUTOMATOR_TIMEOUT
    );
    const gone = () => settle(() => reject(new AutomatorGone(`连不上微信开发者工具的自动化接口（端口 ${port}），请确认开发者工具在运行`)));

    socket.on('error', gone);
    socket.on('close', gone);
    socket.on('open', () => socket.send(JSON.stringify({ id, method: 'Tool.getTicket', params: {} })));
    socket.on('message', data => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message?.id !== id) return;
      if (message.error) settle(() => reject(explainAutomatorError(String(message.error.message))));
      else if (typeof message.result?.ticket !== 'string') settle(() => reject(new Error('微信开发者工具没有返回登录票据')));
      else settle(() => resolve({ newticket: message.result.ticket, expiredAt: message.result.expiredTime }));
    });
  });
}

/** 开发者工具给的是英文，换成处理办法 */
function explainAutomatorError(message: string): Error {
  if (message.includes('GUI project window is not found')) return new WindowNotFound(message);
  if (message.includes('not allow to get')) {
    return new Error('微信开发者工具不允许获取登录票据，请在开发者工具「设置 → 安全设置」里打开「允许获取工具登录票据」');
  }
  if (message.includes('need to login')) return new Error('微信开发者工具未登录，请先在开发者工具里登录');
  return new Error(`微信开发者工具返回错误：${message}`);
}
