# 国际化 i18n（Lang）

> 基于 `i18next` 的多语言支持，启动时扫描 `lang/` 目录加载全部 JSON 语言包，运行时 O(1) 查词。
> 对外通过 `import { initLang } from "chanjs"` 或 `this.app.lang`（Chan 应用实例已内置）使用。

---

## 一、设计理念

| 决策 | 说明 |
|------|------|
| 成熟库 | 采用 `i18next`，复用其插值、复数、命名空间等成熟能力，不重复造轮子 |
| 启动加载 | 启动时扫描 `lang/` 目录，把全部语言包读进内存，运行时零 I/O |
| 全局单例 | `initLang` 返回的就是 i18next 单例，`this.app.lang` 指向同一实例 |
| 后端不转义 | `interpolation.escapeValue: false`，JSON 输出 / 邮件等后端场景不自动转义 |

---

## 二、语言包目录结构

在项目**根目录**下建 `lang/`，每个语言一个子目录，每个命名空间一个 JSON 文件：

```
lang/
├── zh-CN/
│   ├── common.json      # 默认命名空间
│   └── user.json        # 也可按模块拆命名空间
├── en/
│   ├── common.json
│   └── user.json
└── ja/
    └── common.json
```

`lang/zh-CN/common.json` 示例：

```json
{
  "user": {
    "welcome": "欢迎，{{name}}",
    "login": "登录",
    "logout": "退出"
  },
  "order": {
    "created": "订单创建成功，编号 {{id}}"
  }
}
```

> 语言目录名需匹配 `^[a-zA-Z_-]+$`（如 `zh-CN`、`en`、`ja`）。命名空间 = JSON 文件名（如 `common`）。

---

## 三、初始化 initLang

### 应用实例内置（推荐）

`Chan` 应用启动时会自动调用 `initLang`，并把结果挂到 `this.app.lang`：

```javascript
// app/app.js
import Chan from "chanjs";

const chan = new Chan();
await chan.start();   // 内部已初始化 i18n，默认语言来自 config
```

启动后业务代码直接用 `this.app.lang`：

```javascript
const msg = this.app.lang.t("user.welcome", { name: "张三" });  // → "欢迎，张三"
```

### 手动初始化（中间件 / 独立脚本）

```javascript
import { initLang } from "chanjs";

const i18n = await initLang("zh-CN");   // 返回 i18next 实例
i18n.t("user.welcome", { name: "张三" });  // → "欢迎，张三"
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `locale` | `string` | 默认语言，默认 `"zh-CN"` |
| **返回** | `Promise<i18next>` | i18next 实例 |

---

## 四、翻译 `t(key, opts?)`

### 4.1 基础查词

```javascript
this.app.lang.t("user.login");   // → "登录"
```

### 4.2 插值（`{{变量}}`）

```javascript
this.app.lang.t("user.welcome", { name: "张三" });   // → "欢迎，张三"
```

### 4.3 复数（i18next 原生支持）

语言包：

```json
{ "item": {
  "one": "有 {{count}} 个商品",
  "other": "有 {{count}} 个商品"
} }
```

```javascript
this.app.lang.t("item", { count: 1 });   // → "有 1 个商品"
this.app.lang.t("item", { count: 5 });   // → "有 5 个商品"
```

### 4.4 指定命名空间

语言包拆了多个命名空间时，用 `ns` 指定：

```javascript
// lang/user.json: { "title": "用户中心" }
this.app.lang.t("title", { ns: "user" });   // → "用户中心"
```

> 未指定 `ns` 时默认用 `common` 命名空间。

---

## 五、动态切换语言 changeLanguage

业务运行时（登录后 / 用户偏好 / 请求头）可随时切换：

```javascript
// 切换语言并等待资源生效
await this.app.lang.changeLanguage("en");

// 切换后立即按新语言取词
const msg = this.app.lang.t("user.welcome", { name: "Zhang San" });  // 英文包
```

### 按请求动态切换（多语言站点）

```javascript
// app/middleware/i18n.js  —— 每个请求按 Accept-Language 切换
import { event } from "chanjs";

export function i18nMw(app) {
  app.use(async (req, res, next) => {
    const lang = req.headers["accept-language"]?.split(",")[0] || "zh-CN";
    await app.lang.changeLanguage(lang);
    next();
  });
}
```

> 注意：`changeLanguage` 是异步的，切换后记得 `await` 再取词。

---

## 六、使用场景

### 场景一：接口返回多语言文案

```javascript
// Controller 里
async greet(req, res) {
  const name = req.query.name || "朋友";
  return this.success({
    data: {
      msg: this.app.lang.t("user.welcome", { name }),
    },
  });
}
```

### 场景二：邮件 / 短信模板

```javascript
const subject = this.app.lang.t("email.subject", { ns: "mail" });
const body = this.app.lang.t("email.reset_body", { name: user.name, link });
await sendMail(user.email, subject, body);
```

### 场景三：错误提示本地化

```javascript
const KeyedError = new AppError(this.app.lang.t("error.order_not_found"));
throw KeyedError;   // → 按当前语言给出错误提示
```

---

## 七、注意事项

### 1. 语言包必须存在，否则回退 zh-CN

`fallbackLng` 固定为 `zh-CN`。某语言缺词时自动回退到中文包，不会报错。

### 2. `escapeValue: false`（后端不转义）

这是后端场景特意关闭的。若用于**前端渲染用户输入**，请自行 `XSS` 过滤（见 `filterXSS`），不要直接拼接。

### 3. 单文件解析失败不阻断

某个语言包的 JSON 解析失败会被跳过，不影响其它语言和应用启动。

### 4. 与 `changeLanguage` 配合 requestId

`changeLanguage` 是异步切换，多语言站点建议在请求期间保持语言一致，避免并发切换串语言。

### 5. 新增语言步骤

1. 在 `lang/` 下建语言目录（如 `lang/fr/`）
2. 放入 `common.json`（及需要的命名空间文件）
3. 重启应用（启动时扫描加载）
4. 用 `changeLanguage("fr")` 切换后按 `fr` 渲染
