# 定时任务 Task

> 基于 `node-cron` 的定时任务管理器，处理"到点自动执行"的业务，如数据清理、定时同步、缓存刷新、报表生成。
> 对外通过 `import { Task } from "chanjs"` 或 `this.app.task`（Chan 应用实例已内置）使用。

---

## 一、设计理念

Channel 把 `node-cron` 封装成 `Task` 类，解决三件事：

| 决策 | 说明 |
|------|------|
| 校验不阻断 | 任务名非法 / cron 非法 / 任务重名 / 回调非函数 → 只打 error 日志并返回 `null`，**不抛异常、不阻断应用启动** |
| 异常不崩溃 | 任务回调内部异常自动捕获并记录日志，**不会导致进程崩溃** |
| 优雅停机 | 进程退出时由框架调用 `stopAll()` 停止全部定时器，防资源泄漏 |

---

## 二、怎么拿到 Task

### 方式一：应用实例内置（推荐）

`Chan` 应用在启动时已创建 `this.task`，业务代码直接使用：

```javascript
// 任意 Controller / Service 里
async syncData(req, res) {
  this.app.task.add("data-sync", "0 */6 * * *", async () => {
    // 每 6 小时同步一次
  });
}
```

### 方式二：直接 import（中间件 / 工具函数等无 app 实例处）

```javascript
import { Task } from "chanjs";

const task = new Task();
task.add("clear-log", "0 3 * * *", async () => { /* ... */ });
```

> 项目里通常用方式一（`this.app.task`），与 EventBus 单例的理念一致。

---

## 三、API 文档

### `task.add(name, expr, fn, opts?)`

注册一个定时任务。**校验失败返回 `null`，成功返回 `node-cron` 的任务实例。**

```javascript
const task = this.app.task.add(
  "clear-log",           // 任务名（唯一标识）
  "0 3 * * *",           // cron 表达式
  async () => {          // 回调
    await this.app.db.raw("DELETE FROM logs WHERE created_at < NOW() - INTERVAL 7 DAY");
  },
  { start: true }        // 选项（可选）
);
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 任务名，`^[a-zA-Z0-9_-]{1,50}$`，必须唯一 |
| `expr` | `string` | cron 表达式（5 段，如 `"0 3 * * *"`） |
| `fn` | `(task) => Promise<void> \| void` | 任务回调，可选异步 |
| `opts.start` | `boolean` | 注册后是否立即启动，默认 `true` |
| `opts.timezone` | `string` | 时区，如 `"Asia/Shanghai"` |
| **返回** | `ScheduledTask \| null` | 任务实例；校验失败返回 `null` |

**校验失败的情况**（返回 `null`，仅打 error 日志）：
- 任务名非法
- cron 表达式非法
- 任务名已存在（重复注册）
- 回调不是函数

```javascript
// 重复注册同名任务 → 返回 null，不报错
const t1 = this.app.task.add("daily", "0 0 * * *", fn1);  // 成功
const t2 = this.app.task.add("daily", "0 0 * * *", fn2);  // null（已存在）
```

---

### `task.start(name)` / `task.stop(name)`

启动 / 停止指定任务（`add` 时 `start: false` 注册的懒启动任务，或暂停后恢复）。

```javascript
// 注册但不立即启动
this.app.task.add("report", "30 8 * * *", genReport, { start: false });

// 需要时手动启动 / 停止
this.app.task.start("report");
this.app.task.stop("report");
```

---

### `task.list()`

返回全部已注册任务名数组。

```javascript
const names = this.app.task.list();   // ["clear-log", "data-sync", ...]
```

---

### `task.stopAll()`

停止全部任务并清空注册表。**优雅停机时框架自动调用，业务通常不需要手动调用。**

```javascript
this.app.task.stopAll();
```

---

## 四、cron 表达式速查

`node-cron` 使用 5 段标准 cron：`分钟 小时 日 月 星期`。

| 表达式 | 含义 |
|--------|------|
| `0 3 * * *` | 每天 03:00 |
| `0 */6 * * *` | 每 6 小时整点 |
| `30 8 * * 1-5` | 工作日 08:30 |
| `0 0 1 * *` | 每月 1 日 00:00 |
| `*/5 * * * *` | 每 5 分钟 |
| `0 0 * * 0` | 每周日 00:00 |

> 支持 `*`（任意）、`*/n`（每 n）、`a-b`（范围）、`a,b`（列表）。

---

## 五、使用场景

### 场景一：定时清理过期数据

```javascript
// app/modules/sys/service/CleanTask.js
import { Service } from "chanjs";

export default class CleanTask extends Service {
  register() {
    this.app.task.add("clean-expired", "0 4 * * *", async () => {
      // 删除 7 天前的登录日志
      await this.repo.logs.deleteExpired(7);
      // 清理过期的临时验证码（store 无按前缀删除，需遍历或存集合后逐个 del）
      // 例：已知要清的 key 列表
      for (const key of expiredCodeKeys) {
        await this.app.store.del(key);
      }
    }, { timezone: "Asia/Shanghai" });
  }
}
```

### 场景二：定时同步外部数据

```javascript
this.app.task.add("sync-wx-token", "0 */30 * * *", async () => {
  const token = await fetchWechatToken();
  await this.app.store.set("wx:token", token, 60 * 60 * 1000);
});
```

### 场景三：定时刷新热点缓存

```javascript
this.app.task.add("refresh-home-cache", "0 */10 * * *", async () => {
  await clearHomeCache();   // 业务缓存清理函数
});
```

### 场景四：生成日报 / 周报

```javascript
this.app.task.add("daily-report", "0 8 * * *", async () => {
  const report = await buildReport();
  await sendToAdmin(report);
});
```

### 场景五：与事件总线配合（任务触发事件）

任务完成后 `emit` 事件，其他模块监听处理：

```javascript
this.app.task.add("data-sync", "0 */6 * * *", async () => {
  this.app.event.emit("sync.started");
  try {
    const data = await fetchRemote();
    await saveAll(data);
    this.app.event.emit("sync.completed", { count: data.length });
  } catch (err) {
    this.app.event.emit("sync.failed", { error: err.message });
  }
});
```

---

## 六、注册时机

定时任务通常在**启动钩子**里注册最合适：

```javascript
// app/app.js
import Chan from "chanjs";

const chan = new Chan();

chan.beforeStart(async () => {
  // 注册全部定时任务
  const syncTask = new SyncTask();
  syncTask.register();
});

await chan.start();
```

> 或写在某个 `Service` 的 `register()` 方法里，在启动钩子中调用。

---

## 七、注意事项

### 1. 回调内部务必 try-catch（或依赖框架自动捕获）

框架会自动捕获回调抛出的异常并打 error 日志，不会崩溃。但若你希望失败时做补偿，可自行 try-catch：

```javascript
this.app.task.add("sync", "0 */6 * * *", async () => {
  try {
    await doSync();
  } catch (err) {
    logger.error("同步失败，已跳过本次", err);
    // 可在此告警
  }
});
```

### 2. 回调不传 `req` / `res`

定时任务没有 HTTP 请求上下文，需要访问数据请用 `this.repo` / `this.app.db` / `this.app.store`。

### 3. 任务名全局唯一

重复注册同名任务会返回 `null`。建议按 `<模块>-<动作>` 命名，如 `data-sync`、`clean-log`。

### 4. 时区

默认使用服务器本地时区。跨时区定时请显式传 `{ timezone: "Asia/Shanghai" }`。

### 5. 优雅停机

进程退出时 `signal.js` 会自动调用 `stopAll()`，你无需处理。但若在插件 / 独立脚本里手动 `new Task()`，记得自己 `stopAll()`。
