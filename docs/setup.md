---
description: 用 wxa.setup.ts 在小程序启动前预置 Storage、mock wx.login 等原生 API、拦截 wx.request，跳过登录。从最小示例开始，按场景给出写法，并说明每个配置项。
---

# 启动前准备（setup）

在浏览器里拿不到真实的登录 code、用户信息、定位。setup 文件在小程序启动前（`App.onLaunch` 之前）执行，不用改业务代码就能：

- **预置存储**：比如写入 token，小程序一启动就是「已登录」
- **替换原生 API**：比如让 `wx.getLocation` 返回固定的坐标
- **拦截请求**：比如让登录接口直接返回 token，不发到后端

## 快速上手

**1. 新建 `wxa.setup.ts`**

- 原生小程序：放在 `project.config.json` 所在目录，启动时自动执行
- uni-app、Taro 等框架：编译产物目录（如 `dist/dev/mp-weixin`）由框架生成，重新构建时可能被清空，所以放在源码目录，
  启动时用 `--setup` 指定

**2. 写入要预置的数据**

```ts
// wxa.setup.ts
import { defineSetup } from '@open-wxa/wxa-runner-core/setup';

export default defineSetup({
  storage: { token: 'test-token' }
});
```

不用安装任何依赖就能运行。把 `@open-wxa/wxa-runner-core` 加为开发依赖后，编辑器里有类型提示。

**3. 启动，确认生效**

```bash
# 原生小程序
wxa-runner dev .

# uni-app
wxa-runner dev ./dist/dev/mp-weixin --setup ./wxa.setup.ts
```

启动信息里出现 `setup` 一行，说明找到了文件；浏览器控制台打印 `[wxa-runner] setup 已应用`，并列出预置的存储、
替换的 API 和拦截规则。文件写错或执行出错时，模拟器显示错误，小程序不会启动。

修改 setup 文件后页面自动刷新。下面的示例都省略了第一行 `import`。

## 常见场景

### 跳过登录

先看小程序怎么判断「已登录」，再选对应的写法。

**启动时只检查本地有没有 token**：直接预置 token 和用户信息。

```ts
export default defineSetup({
  storage: {
    token: 'test-token',
    userInfo: { id: 1, nickName: '测试用户' }
  }
});
```

**每次启动都调 `wx.login`，再拿 code 请求后端换 token**：拦截换 token 的接口，直接返回 token。

```ts
export default defineSetup({
  network: {
    routes: {
      'POST **/api/auth/login': {
        body: { code: 200, data: { token: 'test-token' } }
      }
    }
  }
});
```

不用处理 `wx.login`：没加 `--devtools-login` 时，它会成功返回一个假 code（`wxa_mock_code_` 开头），真实后端不认。
但换 token 的请求已经被拦截，后端收不到这个 code，所以没关系。

想让请求真的发到测试环境后端，就要让 `wx.login` 返回后端认的 code：测试后端约定了固定的 code 时，
用 `mock: { login: { code: 'test_code' } }`；否则用[借用开发者工具登录态](./devtools-login.md)。

**token 要现场向测试后端申请**：在 `run` 里申请，再写进存储。

```ts
export default defineSetup({
  async run(wxa) {
    const url = 'https://test-api.example.com/dev/token';
    const res = await wxa.fetch(url, { method: 'POST' });
    const { token } = await res.json();
    wxa.storage.set('token', token);
  }
});
```

**后端要用真实的 code 换 session，或者要真实手机号**：setup 做不到，启动时加 `--devtools-login`，见[借用开发者工具登录态](./devtools-login.md)。

### 不把 token 写死在文件里

导出一个函数，从环境变量读取。只有 `WXA_` 开头的变量会传进来：

```ts
export default defineSetup(({ env }) => ({
  storage: { token: env.WXA_TOKEN }
}));
```

```bash
WXA_TOKEN=xxx wxa-runner dev .
```

### 模拟定位和授权

默认已授权用户信息和定位，`wx.getLocation` 返回北京天安门的坐标。换成别的位置：

```ts
export default defineSetup({
  mock: {
    getLocation: { latitude: 31.23, longitude: 121.47 }  // 上海
  }
});
```

模拟用户没有授权定位，调用时失败：

```ts
export default defineSetup({
  mock: {
    getSetting: { authSetting: { 'scope.userLocation': false } },
    // errMsg 为 'getLocation:fail auth deny'
    getLocation: () => {
      throw new Error('auth deny');
    }
  }
});
```

### 模拟接口返回、报错和慢网络

```ts
export default defineSetup({
  network: {
    routes: {
      // 返回空列表
      'GET **/api/feed': { body: { list: [] } },
      // 服务端报错
      'GET **/api/user/*': { status: 500, body: { msg: '异常' } },
      // 3 秒后才返回
      'GET **/api/banner': { body: { list: [] }, delay: 3000 },
      // 按请求内容返回
      'POST **/api/orders': req => {
        const { skuId } = JSON.parse(req.data as string);
        return { status: 201, body: { id: `order-${skuId}` } };
      }
    }
  }
});
```

## 配置项

一共四项，按 storage → mock → network → run 的顺序执行。每次打开、刷新页面都会重新执行一遍。

### storage

预置小程序的存储，`wx.getStorageSync` 读到的就是这些值。值保持原来的类型（对象、数字、Date 等），覆盖同名的旧值。

存储一定要在 setup 里写：基础库会把读过的存储缓存在内存里，小程序启动后再从外部改 localStorage，小程序读不到。

### mock

按 API 的名字替换 `wx` 上的原生实现，值可以是：

- **对象**：直接作为调用结果
- **函数**：按调用参数返回结果，可以是 async 的。抛错表示调用失败，`errMsg` 为 `<API 名>:fail <错误信息>`

```ts
export default defineSetup({
  mock: {
    // 摄像头权限申请失败，其他权限都同意。
    // 失败时 errMsg 为 'authorize:fail auth deny'
    authorize: ({ scope }) => {
      if (scope === 'scope.camera') throw new Error('auth deny');
      return {};
    }
  }
});
```

- 有两类 API 不能替换，写了会报错：`request`、`downloadFile`、`uploadFile`、`connectSocket`（`wx.request` 用 [`network.routes`](#network) 拦截）；
  `getStorage` 等存储 API（用 [`storage`](#storage) 预置）。其他 API 都能按名字替换
- `login`、`getSetting`、`getLocation`、`scanCode`、`requestPayment` 等常用 API 有返回值的类型提示

不 mock 时，登录、用户信息这类在浏览器里拿不到真实结果的接口返回固定的假数据：

| API | 不 mock 时 |
| --- | --- |
| `login` | 成功，code 是假的（`wxa_mock_code_` 开头），真实后端不认。加 `--devtools-login` 时是真实的 code |
| 手机号按钮（`open-type="getPhoneNumber"`） | 成功，手机号 code 是假的。加 `--devtools-login` 时是真实的 |
| `checkSession`、`authorize` | 成功 |
| `getSetting` | 已授权用户信息（`scope.userInfo`）和定位（`scope.userLocation`） |
| `getUserInfo`、`getUserProfile` | 昵称为 `wxa-runner` 的用户 |
| `getLocation` | 北京天安门的坐标 |
| `requestPayment` | 失败，要用到支付时必须 mock |
| `scanCode` | 失败（`cancel`），要用到扫码时必须 mock |
| 还没有实现的 API | 成功，控制台警告「尚未实现」，Playwright 测试里会记进 `errors()` |

### network

目前只有 `routes` 一项：拦截 `wx.request`。键是匹配规则，值是要返回的响应。

**匹配规则**写成 `'请求方法 地址'`，请求方法可以省略：

| 写法 | 匹配 |
| --- | --- |
| `'POST https://api.example.com/login'` | 这个地址的 POST 请求 |
| `'**/api/login'` | 地址以 `/api/login` 结尾的请求，不限请求方法 |
| `'GET **/api/user/*'` | `/api/user/` 下一级路径的 GET 请求，如 `/api/user/1`，不包括 `/api/user/1/orders` |

`*` 匹配一段路径，`**` 匹配任意内容；查询参数不参与匹配。多条规则都匹配时，写在后面的优先。没有匹配的请求照常发出。

**响应**可以是对象：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `status` | `200` | 状态码 |
| `header` | | 响应头 |
| `body` | 空 | 对象按 JSON 返回；字符串原样返回；ArrayBuffer、Uint8Array 按二进制返回 |
| `delay` | `0` | 多少毫秒后返回 |

也可以是函数：根据请求返回上面的响应对象，可以是 async 的；什么都不返回时，按 200、空内容返回。函数拿到的请求有：

| 字段 | 说明 |
| --- | --- |
| `url` | 完整地址。GET 请求的 `data` 已经拼在地址的查询参数里 |
| `method` | 大写，如 `POST` |
| `header` | 请求头 |
| `data` | 请求体，通常是 JSON 字符串，用 `JSON.parse` 解析。业务代码传的是 ArrayBuffer 时，这里也是 ArrayBuffer |

- 命中的请求会在浏览器控制台打印 `[wxa-runner] 拦截请求`
- 拦截的响应默认立即返回，比真机快。如果业务代码依赖网络耗时（比如在登录回调里假设首页已经创建），加上 `delay`
- 和真机一样，小程序拿到的 `res.data` 由请求的 `responseType` 决定：`arraybuffer` 时是 ArrayBuffer，否则是文本，JSON 文本会解析成对象
- `downloadFile`、`uploadFile`、`connectSocket` 暂不拦截

### run

在前三项之后执行的函数，可以是 async 的。适合需要先请求、再决定写什么的情况。参数 `wxa` 有：

| 成员 | 作用 |
| --- | --- |
| `wxa.env` | `WXA_` 开头的环境变量 |
| `wxa.storage.get(key)` | 读存储 |
| `wxa.storage.set(key, value)` | 写存储，同 [`storage`](#storage) |
| `wxa.storage.remove(key)` / `clear()` | 删除一项 / 清空 |
| `wxa.mock(api, impl)` | 替换原生 API，同 [`mock`](#mock) |
| `wxa.route(pattern, handler)` | 拦截请求，同 [`network.routes`](#network)，后添加的优先 |
| `wxa.fetch(url, init?)` | 发请求，由开发服务器转发，不受浏览器跨域限制。`init` 可以有 `method`、`header`、`body`（字符串），返回标准的 `Response` |

## 注意事项

- **密钥**：setup 文件和 `WXA_` 环境变量都会发到浏览器里，只放测试用的 token，不要放真正的密钥。不想提交到 git 的值用环境变量传入
- **可以 import 其他文件**：比如共用的测试数据，会一起打包。不能 import Node 的内置模块（如 `fs`）
- **在 Playwright 测试中**：setup 同样执行。用例里的 `mock`、`route` 会覆盖 setup 里的同名配置，也可以撤销，
  见[在 Playwright 中测试](./testing.md)
- **临时不执行**：启动时加 `--no-setup`
