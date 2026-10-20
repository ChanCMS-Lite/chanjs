# ChanJS

基于 Node.js + Express 5 构建的**标准 HMVC（NHMVC）后端框架**，原生 ESM 纯 JavaScript 开发。
以**模块自治 + 双通道跨模块协作**为核心，约定优于配置，开箱即用，拒绝冗余复杂。

## 设计哲学

> 
> **大道至简。**
> 优秀的开发工具，应当化繁为简。ChanJS 摒弃过度设计与沉重抽象，回归纯粹 JavaScript，用最少的心智负担交付稳定高效的业务能力。

## 核心亮点

- 🛡️ **安全可控**：内置多层防护能力，降低业务安全开发成本
- ⚡ **高性能**：高性能日志、按需组件加载、慢查询监控
- 🪶 **轻量精简**：无多余抽象、低侵入、上手门槛低
- ✅ **务实好用**：聚焦后端业务高频场景，配套完整基础设施

## 特性

### 核心架构

- 原生基于 Express 5+ mysql/pgsql/sqlite 三款数据库支持
- 最低运行环境 Node.js 22.18+
- 全量 ES Modules（import / export）
- **标准 HMVC 架构：模块自治 + 双通道跨模块协作**
- 约定优于配置，减少样板配置代码

### 基础设施

- **高性能日志**：Pino 结构化日志输出
- **全链路请求追踪**：自动注入唯一 `requestId`（`X-Request-Id` 响应头 + `req.id` + `req.log`）
- **访问日志按人归因**：一行纯文本，身份列 `ip + (uid|fp|sid)`，可追踪单个用户/访客的完整访问路径
- **国际化多语言**：i18next，内存高速语言查找
- **全局事件总线**：轻量封装 Node.js EventEmitter，解耦业务事件
- **定时任务调度**：node‑cron，自带异常捕获、停机安全回收
- **数据库层**：Knex 查询构建器，内置慢查询监控告警
- **按需组件容器**：Controller/Service 动态懒加载，成功实例永久缓存；缺失模块不缓存，修改文件即时生效
- **优雅停机**：统一信号监听，资源有序释放，超时强制退出

### 内置安全能力

- WAF 基础防火墙
- XSS 请求防护
- 敏感关键词过滤
- 接口请求限流
- 路由访问白名单
- Cookie 安全加固

### 开箱即用中间件生态

- CORS 跨域处理
- Body / Cookie 请求解析
- 静态资源托管
- favicon 快捷支持
- 自定义响应头注入
- Art‑template 模板引擎渲染

### 优秀开发体验

- 多环境配置隔离（`.env.dev` / `.env.prd`）
- 标准化统一返回体（success / fail）
- Zod 参数校验中间件
- 全局异常捕获兜底
- 内置通用工具函数库

## 目录结构

```
|- app/
|   |- common/            # 公共业务路由
|   |- helper/            # 全局辅助工具函数
|   |- middleware/        # 应用级中间件
|   |- modules/           # 业务模块根目录
|   |   |- <module>/      # 单个业务模块
|   |       |- controller/
|   |       |- service/
|   |       |- middleware/
|   |       |- router.js
|   |- router.js          # 根路由聚合
|- config/                # 框架配置、环境变量加载
|- data/                  # 运行时持久化数据目录
|- doc/                   # 项目文档
|- lang/                  # i18n 语言资源(zh‑CN/en‑US/...)
|- public/                # 前端静态资源
|- view/                  # 视图模板文件
|- app.js                 # 项目业务入口
|- .env.dev / .env.prd    # 环境配置文件
|- pm2.json               # PM2 进程部署配置
```

## 快速开始

```
import Chan from "chanjs";

const chan = new Chan();

// 注册启动前置钩子（事件、定时任务等初始化）
chan.beforeStart(() => {
});

await chan.start();        // 加载配置、i18n、数据库、中间件、路由
chan.run((port) => {       // 启动 HTTP 服务
  console.log(`ChanJS running on ${port}`);
});
```

## 核心能力详解

### 1. 日志系统（Pino）

pino 单实例 + pino-pretty（以 stream 方式跑主进程），**唯一开关 `LOG_LEVEL`**（默认 `info`），不读 `NODE_ENV`。输出格式固定：

```
2026-09-04 23:01:16.811 [Chan] HTTP服务启动，监听端口：3000
2026-09-04 23:01:16.811 ip=127.0.0.1 uid=2 GET /base/menu/list 200 6ms
```

时间是本地时区 `yyyy-MM-dd HH:mm:ss.SSS`，后面直接接正文——没有 `level/pid/hostname/module` 固定头，也没有 pino-pretty 默认的方括号和冒号。输出一律 stdout：本地开发直接看控制台，线上由 pm2 收集（框架不写日志文件、不接自定义管道）。

```
import { logger } from "chanjs";

// 全局日志实例（logger 是具名导出，默认导出是 Chan 主类）
logger.info("启动完成");
logger.error("查询失败", err);   // 自动识别 Error 对象

// 携带上下文用 pino 原生 child（如请求链路 req.log）
const reqLog = logger.child({ userId: 1 });
reqLog.warn("慢查询");
```

访问日志由 **pino-http** 官方中间件接管（`middleware/log.js` 内 `app.use(pinoHttp({ logger: root }))`），自动记录 `req/res/status/duration`，并挂载 `req.log` 供业务打点：

```js
import pinoHttp from "pino-http";
import { root } from "../utils/logger.js";

app.use(pinoHttp({ logger: root }));
```

`middleware/log.js` 只额外补两件 pino-http 不管的事：① 匿名访客自动种 `_sid`（30 天 httpOnly cookie，按浏览器归人）；② 用 `customSuccessMessage` 把访问行拼成 morgan 一行，身份列 = 来源IP + 用户标识（登录打 `uid`，未登录有设备指纹打 `fp`，再否则打 `sid`），用于按人追踪访问路径：

```
# 游客首访（自动种 _sid）
2026-09-04 22:59:36.768 ip=127.0.0.1 sid=2aad120e7b1c85b9 GET /news/index.html 200 23ms
# 同一浏览器后续请求 → 同一 sid，可串出完整访问序列
2026-09-04 22:59:36.868 ip=127.0.0.1 sid=2aad120e7b1c85b9 GET /news/hydraulic/index.html 200 23ms
# 未登录但有设备指纹 → fp
2026-09-04 22:59:36.903 ip=127.0.0.1 fp=fp_dev_hash_9x GET /news/hydraulic/article-58.html 200 23ms
# 登录用户 → uid 优先
2026-09-04 22:59:37.161 ip=127.0.0.1 uid=2 GET /base/menu/list 200 7ms
```

四列身份的取值优先级（`middleware/log.js` 内 `who()`）：

| 列 | 来源 | 说明 |
|---|---|---|
| `ip` | `getIp(req)`（取 `X-Forwarded-For` / `X-Real-IP`） | 常驻，每行必有 |
| `uid` | `req.user.uid` | 登录用户（后台 auth、前台会员 `optionalAuth`），优先级最高 |
| `fp` | cookie `_f` | 设备指纹，未登录但有指纹时打 |
| `sid` | cookie `_sid` | 匿名访客，首访由服务端生成并种 30 天 httpOnly cookie |

每个请求注入唯一 `requestId`（响应头 `X-Request-Id` + `req.id` + `req.log`），Controller 内可直接携带链路日志：

```
// 在 Controller 中
async getUser(req, res) {
  req.log.info("查询用户详情");  // 日志自动附带 requestId
}
```

### 2. 事件总线（EventBus）

基于 Node.js 原生 EventEmitter 封装的全局单例事件中心，用于业务解耦。

```
import { event, EventBus } from "chanjs";

// 使用全局事件实例
const off = event.on("user.login", (uid) => {
  logger.info(`用户 ${uid} 登录`);
});
event.emit("user.login", 1001);
off();  // 解绑监听

// 创建独立隔离的事件实例
const localBus = new EventBus();
```

> 
> 详细文档：[doc/07‑事件系统EventBus.md](./doc/07%E2%80%91%E4%BA%8B%E4%BB%B6%E7%B3%BB%E7%BB%9FEventBus.md)

### 3. 定时任务（Task）

基于 node‑cron 封装，内置 cron 表达式校验、任务异常捕获、优雅停机回收。

```
import Chan from "chanjs";

const chan = new Chan();

chan.beforeStart(() => {
  // 注册定时任务，框架启动后自动运行
  chan.task.add("clear-log", "0 3 * * *", async () => {
    await chan.db.raw("DELETE FROM logs WHERE created_at < NOW() - INTERVAL 7 DAY");
  });
});

await chan.start();
chan.run();
```

### 4. 国际化（i18next）

服务启动时一次性扫描加载 `lang/` 全部语言资源至内存，运行时 O(1) 快速读取翻译文本。

```
lang/
  zh-CN/
    common.json    # { "user.welcome": "欢迎，{{name}}" }
  en-US/
    common.json    # { "user.welcome": "Welcome, {{name}}" }
```

```
import { initLang } from "chanjs";

const i18n = await initLang("zh-CN");
i18n.t("user.welcome", { name: "张三" });  // → "欢迎，张三"
```

### 5. 数据库（Knex + 慢查询监控）

支持多数据库连接管理，自动开启慢查询与 SQL 异常监控。

```
// 框架启动自动读取 config.db 注册数据库连接
// 业务代码内可通过 this.db / getApp().db 获取默认连接

// 运行时动态调整慢查询告警阈值（毫秒）
chan.dbManager.setSlowThreshold(500);
```

### 6. 组件容器 · 双通道跨模块调用

Controller / Service 继承容器基类，内置 `this.get()` 方法，通过「模块名 + 组件名」动态加载跨模块业务组件。

> 
> 加载成功后实例永久缓存；组件文件缺失不缓存，新增文件无需重启即可识别。

```
// 同模块调用 Service
const cat = await this.get("book", "BookCategory");

// 跨模块调用 Service（推荐，HMVC 双通道‑服务通道）
const book = await this.get("book", "Book", "service");
const special = await this.get("cms", "Special", "service");
```

- 返回实例或 null，异步调用必须 await
- 内置名称校验、路径越界安全防护
- 跨模块业务复用优先使用容器调用，摒弃超长相对路径 import

#### HMVC 标准实现说明

传统教程常将「控制器嵌套发起子 HTTP 请求」当作 HMVC 的标准，该方式混淆了**实现手段**和架构本质。

> 
> HMVC 的核心 = 分层解耦 + 模块自治 + 跨模块业务复用。

ChanJS 提供双通道协作模式，回归 HMVC 本质：

1. 控制器通道：`await this.get("模块", "Controller")`
2. 服务通道（推荐）：`await this.get("模块", "Service", "service")`

### 7. 优雅停机

统一监听 `SIGTERM / SIGINT / SIGQUIT` 退出信号，按顺序逐级释放资源：

```
HTTP 服务 → 定时任务 → 缓存存储 → 数据库连接 → 事件总线
```

单个资源关闭失败不会阻断其余回收流程，超时后进程强制退出。

## 环境变量配置

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `NODE_ENV` | 运行环境标识(dev/prd) | dev |
| `PORT` | HTTP 监听端口 | 3000 |
| `LOCALE` | 默认语言 | zh‑CN |
| `LOG_LEVEL` | 日志输出级别（trace/debug/info/warn/error/fatal） | info |
| `TRUSTED_PROXIES` | 信任反向代理网段 | loopback |
| `SHUTDOWN_TIMEOUT` | 优雅停机超时时间(ms) | 5000 |
| `REDIS_ENABLED` | 是否开启 Redis | false |

## 项目依赖清单

### 运行依赖

- express ^5.2.1
- knex ^3.2.10
- pino ^9.5.0
- pino‑http ^10.3.0
- i18next ^24.2.0
- node‑cron ^3.0.3
- art‑template ^4.13.4
- mysql2 ^3.22.3
- ioredis ^5.4.6

### 开发依赖

- pino‑pretty ^11.3.0

### 可选 Peer 依赖

- zod ^4.4.3（接口参数校验）

## Hono 高性能版本

[chanjs‑hono](https://www.npmjs.com/package/chanjs%E2%80%91hono) 为 ChanJS 衍生高性能分支，基于 Hono，API 保持一致，性能更强。

```
npm install chanjs-hono
```

## 文档 & 生态资源

- ChanJS官网文档：[ChanJS](https://chancms.top/)
- ChanJS-Hono官网文档：[ChanJS-Hono](https://chancms.top/)
- ChanJS-cli官方脚手架：[ChanJS-cli](https://chancms.top/)
- ChanCMS官方开源 CMS：[ChanCMS](https://chancms.top/)

## 开源协议

ISC
