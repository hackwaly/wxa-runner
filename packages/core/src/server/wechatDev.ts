/**
 * 借开发者的登录态访问微信后台：开发者工具访问的同一组接口（servicewechat.com 下的 wxa-dev、wxa-dev-logic）
 *
 * 登录、手机号、服务市场、插件都经这里，ticket、超时、网络错误和登录态失效的提示在这里统一处理。
 * 这些接口没有公开文档，请求和响应的格式取自开发者工具的实现和实测。
 */

import { DeveloperTicket, TICKET_ENV } from '@open-wxa/wxa-runner-extractor';

const BASE_URL = 'https://servicewechat.com';
/** 开发者工具请求这些接口时带的版本号 */
const CLIENT_VERSION = '1021810240';
const DEFAULT_TIMEOUT = 10_000;

const ERROR_HINTS: Record<number, string> = {
  // 40001：开发者工具刷新过 ticket，旧的随即作废
  40001: '（登录态已失效，请在微信开发者工具里重新登录）',
  40029: '（登录态已失效，请在微信开发者工具里重新登录）',
  85023: '（当前微信账号不是该小程序的开发者）'
};

export type FindTicket = () => DeveloperTicket | null | Promise<DeveloperTicket | null>;

/**
 * 取出可用的 ticket
 *
 * @throws 没有登录态或已过期时，消息是给用户看的处理办法
 */
export function requireUsableTicket(ticket: DeveloperTicket | null): string {
  if (!ticket) throw new Error(`未找到微信开发者工具的登录态，请登录开发者工具，或设置环境变量 ${TICKET_ENV}`);
  if (ticket.expiredAt !== undefined && ticket.expiredAt <= Date.now()) {
    throw new Error('微信开发者工具的登录态已过期，请打开开发者工具刷新登录态');
  }
  return ticket.newticket;
}

/** 给错误码加上处理办法，如登录态失效时提示重新登录 */
export function explainErrcode(errcode: number | undefined): string {
  return (errcode !== undefined && ERROR_HINTS[errcode]) || '';
}

/**
 * 检查 baseresponse 里的结果码
 *
 * @throws 结果码不为 0 时，消息是 action 加上结果码、错误信息和处理办法
 */
export function requireOk<T extends { baseresponse?: { errcode?: number; errmsg?: string } }>(body: T, action: string): T {
  const errcode = body.baseresponse?.errcode;
  if (errcode !== 0) throw new Error(`${action} ${errcode}: ${body.baseresponse?.errmsg || '未知错误'}${explainErrcode(errcode)}`);
  return body;
}

export class WechatDevClient {
  /**
   * @param findTicket 每次请求都重新取：开发者工具重新登录、切换账号后不用重启服务器
   */
  constructor(
    readonly appid: string,
    private readonly findTicket: FindTicket
  ) {}

  /**
   * POST JSON 到 path（如 wxa-dev-logic/jslogin），带上 appid 和开发者 ticket
   *
   * @throws 没有可用的登录态、超时、连不上、HTTP 状态不是 2xx 时，消息是给用户看的原因
   */
  async post(path: string, body: object, timeout = DEFAULT_TIMEOUT): Promise<Response> {
    const query = new URLSearchParams({ appid: this.appid, newticket: requireUsableTicket(await this.findTicket()), clientversion: CLIENT_VERSION });
    const response = await fetch(`${BASE_URL}/${path}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    }).catch((error: Error & { cause?: Error }) => {
      // Node 的 fetch 只报 fetch failed，具体原因（DNS、连接被拒等）在 cause 里
      throw new Error(error.name === 'TimeoutError'
        ? `请求微信服务器超时（${timeout / 1000}s）`
        : `请求微信服务器失败：${error.cause?.message ?? error.message}`);
    });
    if (!response.ok) throw new Error(`微信服务器返回 HTTP ${response.status}`);
    return response;
  }

  /** 同 post，返回解析后的 JSON */
  async postJson(path: string, body: object): Promise<any> {
    return (await this.post(path, body)).json();
  }
}
