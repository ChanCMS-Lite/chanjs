# 事件系统 EventBus

> 基于 Node 内置 EventEmitter 的轻量事件总线，零第三方依赖。

---

## 一、设计理念

ChanJS 事件总线提供**进程内异步解耦**能力：模块间通过事件名通信，不直接持有对方引用。

**核心决策**：

| 决策 | 说明 |
|------|------|
| 全局单例 | 导出共享实例 `event`，任何模块 `import { event } from "chanjs"` 即可用 |
| 同时导出类 | `EventBus` 类供需要隔离的场景 `new EventBus()` 创建独立实例 |
| App 实例引用 | `this.app.event` 指向全局实例，与 `import { event }` 等价 |
| 优雅停机 | `event.destroy()` 在进程退出时移除全部监听器，防内存泄漏 |

---

## 二、API 文档

### `event.on(event, listener)`

注册监听器，返回取消函数。

```javascript
import { event } from "chanjs";

const off = event.on("user.login", (uid) => {
  console.log(`用户 ${uid} 登录`);
});

// 需要时取消监听
off();
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `event` | `string` | 事件名 |
| `listener` | `(...args) => void` | 监听回调 |
| **返回** | `() => void` | 取消监听函数 |

---

### `event.once(event, listener)`

只监听一次，触发后自动移除。

```javascript
event.once("app.ready", () => {
  console.log("应用启动完成（只触发一次）");
});
```

---

### `event.emit(event, ...args)`

触发事件，同步执行全部监听器。

```javascript
event.emit("order.created", { orderId: 1001, amount: 299.0 });
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `event` | `string` | 事件名 |
| `...args` | `any[]` | 传递给监听器的参数（支持多参数） |

---

### `event.off(event, listener)`

移除指定监听器。

```javascript
const handler = (uid) => console.log(uid);
event.on("user.login", handler);
event.off("user.login", handler);
```

> 注意：`off` 需传入与 `on` 相同的函数引用。匿名函数无法移除。

---

### `event.removeAll(event)`

移除某事件的全部监听器。

```javascript
event.removeAll("user.login");
```

---

### `event.count(event)`

获取某事件的监听器数量。

```javascript
const n = event.count("user.login");
console.log(`当前有 ${n} 个监听器`);
```

---

### `event.destroy()`

移除所有事件的全部监听器。优雅停机时由框架自动调用，业务通常不需要手动调用。

```javascript
event.destroy();
```

---

## 三、使用场景

### 场景一：中间件中使用（无 app 实例）

中间件函数签名是 `(app, config) => void`，但有时在工具函数里没有 app 引用，直接 import 全局实例即可。

```javascript
// app/middleware/audit.js
import { event } from "chanjs";

export function audit(app, config) {
  app.use((req, res, next) => {
    res.on("finish", () => {
      event.emit("audit.log", {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ip: req.ip,
      });
    });
    next();
  });
}
```

### 场景二：定时任务中使用

定时任务回调中没有 HTTP 请求上下文，但可以通过 `event` 触发或监听事件。

```javascript
// app/index/service/SyncTask.js
import { event } from "chanjs";

export default class SyncTask extends Service {
  async register() {
    this.app.task.add("data-sync", "0 */6 * * *", async () => {
      event.emit("sync.started");
      try {
        const data = await this.fetchRemote();
        await this.save(data);
        event.emit("sync.completed", { count: data.length });
      } catch (err) {
        event.emit("sync.failed", { error: err.message });
      }
    });
  }
}
```

### 场景三：Controller / Service 中使用（有 app 实例）

```javascript
// app/modules/user/controller/User.js
export default class User extends Controller {
  async login(req, res) {
    const user = await this.service.user.verify(req.body);

    // 方式一：通过 app 实例
    this.app.event.emit("user.login", user.id);

    // 方式二：直接 import（等价）
    // event.emit("user.login", user.id);

    return this.success({ data: user });
  }
}
```

### 场景四：启动钩子中注册监听

```javascript
// app/index.js
import Chan from "chanjs";

const chan = new Chan();

chan.beforeStart(() => {
  // 监听用户登录事件
  const off = chan.event.on("user.login", (uid) => {
    logger.info(`[Hook] 用户登录: ${uid}`);
  });

  // 监听订单创建事件
  chan.event.on("order.created", ({ orderId, amount }) => {
    logger.info(`[Hook] 新订单: ${orderId}, 金额: ${amount}`);
  });
});

await chan.start();
```

### 场景五：跨模块通信

模块 A 发出事件，模块 B 监听，互不依赖。

```javascript
// 模块 A：订单服务发出事件
// app/modules/order/service/Order.js
export default class OrderService extends Service {
  async create(data) {
    const order = await this.repository.order.create(data);
    this.app.event.emit("order.created", { orderId: order.id, amount: order.amount });
    return order;
  }
}

// 模块 B：积分服务监听事件（无需 import OrderService）
// app/modules/points/service/Points.js
export default class PointsService extends Service {
  async init() {
    this.app.event.on("order.created", ({ orderId, amount }) => {
      // 根据订单金额计算积分
      const points = Math.floor(amount);
      this.repository.points.add(orderId, points);
    });
  }
}
```

### 场景六：使用独立实例（隔离场景）

需要事件隔离时，创建独立实例，与全局实例互不干扰。

```javascript
import { EventBus } from "chanjs";

const localBus = new EventBus();

localBus.on("local.event", () => { /* ... */ });
localBus.emit("local.event");

// 全局实例不受影响
event.count("local.event"); // 0
```

---

## 四、事件命名规范

推荐使用**点分层命名**，格式：`<模块>.<动作>` 或 `<模块>.<资源>.<动作>`。

| 事件名 | 说明 |
|--------|------|
| `user.login` | 用户登录 |
| `user.logout` | 用户退出 |
| `user.register` | 用户注册 |
| `order.created` | 订单创建 |
| `order.paid` | 订单支付 |
| `order.cancelled` | 订单取消 |
| `sync.started` | 同步开始 |
| `sync.completed` | 同步完成 |
| `sync.failed` | 同步失败 |
| `app.ready` | 应用启动完成 |
| `audit.log` | 审计日志 |

---

## 五、注意事项

### 1. 监听器异常不会阻断 emit

`emit()` 是同步的，但单个监听器抛异常会影响后续监听器执行。建议在监听器内部 try-catch。

```javascript
event.on("order.created", async ({ orderId }) => {
  try {
    await sendNotification(orderId);
  } catch (err) {
    logger.error(`通知发送失败: ${err.message}`);
  }
});
```

### 2. 异步监听器

`emit()` 不会 await 异步监听器。如果需要等待异步操作完成，在监听器内部自行处理。

```javascript
event.on("order.created", async ({ orderId }) => {
  // emit 不会 await 这个 Promise
  await processOrder(orderId);
});
```

### 3. 监听器上限

默认上限 50 个监听器/事件。超出时 Node 会打印警告。如需调整：

```javascript
import { EventBus } from "chanjs";

const bus = new EventBus();
// 独立实例可自行调整（全局实例不建议改）
```

### 4. 内存泄漏防护

- `on()` 返回的取消函数务必在不需要时调用。
- 优雅停机时框架自动调用 `event.destroy()` 移除全部监听器。
- 定时任务中注册的监听器如果只在任务生命周期内有效，任务结束时调用 `off()`。

### 5. 性能说明

- `EventEmitter` 是 Node 原生 V8 级实现，`emit/on` 时间复杂度 O(1)~O(n)。
- 全局单例避免重复实例化，零额外内存开销。
- `emit()` 是同步操作，监听器不宜执行耗时逻辑（应异步化或放入定时任务）。
