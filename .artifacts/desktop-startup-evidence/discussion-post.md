# 桌面端启动慢：首窗等待完整 Host 约 6 秒，app-boot 为已暴露的内部模块多花约 0.5–0.9 秒

**Summary (EN):** On Windows 11, the installed Desktop app shows its first window at 6.6–7.7 s. The shared loading page renderer starts at 0.57–0.72 s, and the Host process spawns at 0.91–1.03 s, but the window is only shown after backend readiness and the welcome/credential decision. Separately, `app-boot` reads five Node internals through `node-addon-require-builtin` even though the Desktop Host already passes `--expose-internals`; the CPU profile attributes 917 ms to `requireBuiltin`, and a direct benchmark of the resolver path is 1–2 ms with the flag vs 534–544 ms without it.

## 环境

| 项目 | 值 |
|:--|:--|
| OS | Windows 11 Pro, build 26200 |
| CPU | Intel Core i7-8750H, 6C/12T |
| Desktop | DeepSeek Harness 0.2.2-rc.1 |
| Electron / Node | 44.7.0 / 24.21.0 |
| 安装位置 | `M:\deepseek\harness`（NTFS 固定磁盘） |
| 基线 commit | `fcc0ad4` |
| 配置 | profile 启用 6 个 bundle（含外部插件） |

测量均为热启动、连续 3 次；时间为墙钟，不含安装或构建。

```text
0.00 s  Electron 主进程启动
0.57–0.72 s  共享加载页 renderer 已启动（窗口仍隐藏）
0.91–1.03 s  Host 子进程 spawn
5.25–6.43 s  Host Web 服务监听
约 5.6–6.8 s  Host 发送 ready（listen 后约 0.35 s）
6.63–7.72 s  第一个可见窗口
```

## 证据 1：安装版首次窗口时间线

测量方式：启动 `DeepSeek Harness.exe`，从进程启动开始轮询 Electron 主进程、Host 子进程、Host 监听端口和 `MainWindowHandle`。

| run | renderer 进程 | Host spawn | Host listen | 第一个窗口 |
|:--|--:|--:|--:|--:|
| 1 | 717 ms | 1,034 ms | 6,432 ms | 7,715 ms |
| 2 | 579 ms | 993 ms | 5,327 ms | 6,712 ms |
| 3 | 569 ms | 909 ms | 5,254 ms | 6,628 ms |

原始日志：`installed-gui-timeline.log`

<details><summary>installed-gui-timeline.log</summary>

```text
run=1 renderer=717 hostSpawn=1034 hostListen=6432 firstWindow=7715 title=DeepSeek Harness
run=2 renderer=579 hostSpawn=993 hostListen=5327 firstWindow=6712 title=DeepSeek Harness
run=3 renderer=569 hostSpawn=909 hostListen=5254 firstWindow=6628 title=DeepSeek Harness
```

</details>

结论：

- 共享加载页的 renderer 在 **0.57–0.72 s** 就已经启动。
- 窗口直到 **6.6–7.7 s** 才出现，也就是 renderer 启动后还隐藏了约 **6 秒**。
- Host 的 `ready` IPC 在实际 profile 中约在 `dsh web` 监听之后 0.35 s（核心 profile 约 16 ms）；因此窗口出现在 Host 就绪后约 **1 秒**。

代码路径（基线 commit `fcc0ad4`）：

1. `apps/desktop/src/main.ts:1296` 创建窗口：`createWindow(appPreload, false, true)`，`show: false`。
2. `apps/desktop/src/main.ts:671` `reconcileBackend()`：先 `navigateMain(applicationUrl)`，再 `await backend.start(...)`（:674）；这里没有任何 `show()`。
3. `apps/desktop/src/main.ts:1343` `enterWorkspace()` 在 :1348 才执行 `window.show()`。
4. `apps/desktop/src/main.ts:1366` `showWelcome()` 是另一个可见入口。
5. `apps/desktop/src/main.ts:1427` `openInitialWindow()` 在 Host ready 后才读取凭证和语言，再选择欢迎页或工作区。

因此加载页虽然已经渲染，但窗口的首次显示被 `backend.start`、`openInitialWindow` 和欢迎/工作区决策串行挡住。

## 证据 2：Host 启动耗时

使用真实 Desktop Host 子进程，参数与 Desktop 一致（`--expose-internals`、安装版 `app.asar/dsh`、`runtime/primary-runtime`），从 spawn 到收到 `ready`。

| profile | run 1 | run 2 |
|:--|--:|--:|
| 仅核心 bundle（`dsh-base` + `dsh-web-app`） | 2,309 ms | 2,260 ms |
| 实际 profile（6 个 bundle，含外部插件） | 3,737 ms | 3,773 ms |

原始日志：`host-boot-core-profile.log`、`host-boot-real-profile.log`

<details><summary>host-boot-core-profile.log</summary>

```text
===== core run 1 =====
   299ms  IPC starting
  2293ms  OUT dsh web: http://127.0.0.1:52364/?token=<redacted>
  2309ms  IPC ready
===== core run 2 =====
   283ms  IPC starting
  2245ms  OUT dsh web: http://127.0.0.1:61427/?token=<redacted>
  2260ms  IPC ready
```

</details>

<details><summary>host-boot-real-profile.log</summary>

```text
===== run 1 =====
   292ms  IPC starting
  3388ms  OUT dsh web: http://127.0.0.1:58151/?token=<redacted>
  3737ms  IPC ready
===== run 2 =====
   290ms  IPC starting
  3419ms  OUT dsh web: http://127.0.0.1:51672/?token=<redacted>
  3773ms  IPC ready
```

</details>

- 外部插件使 Host 启动增加约 **1.45–1.5 s**。
- 即使关闭全部外部插件，核心 Host 仍需约 **2.26 s**；窗口仍然要等它。
- 这解释了“关闭插件后感觉差别不大”：插件确实减少了 Host 时间，但窗口被整体门控，用户感知到的改善有限。

## 证据 3：CPU 采样热点

对安装版真实 profile 的 Host 启动做 CPU profile（采样间隔 500 µs，总采样 4.87 s）。按 self time：

| self time | 函数 / 文件 |
|--:|:--|
| **917 ms** | `requireBuiltin` @ `node-addon-native-custom-loader/lib/index.js:570` |
| 335 ms | `compileSourceTextModule` @ `node:internal/modules/esm/utils` |
| 296 ms | `spawnSync` @ `node:internal/child_process` |
| 141 ms | `getOrCreateArchive` @ Electron asar |
| 104 ms | `structuredClone` @ `worker/js_transferable` |

完整输出：`cpu-profile-top.txt`
原始 profile：`profile/CPU.20261110.141945.27084.0.001.cpuprofile`

`requireBuiltin` 是 Host 启动中最大的单点开销。CPU profile 的函数归因包含采样开销；下文的隔离基准对同一 5 次调用测得 534–544 ms。

## 证据 4：内部模块查找的真实基准

Desktop Host 启动时已经带有 `--expose-internals`：

- `apps/desktop/src/host-process.ts:213` 的 spawn 参数包含该 flag。

但 `app-boot` 仍然无条件通过 addon 读取 5 个内部模块：

- `packages/boot/app-boot/src/profile-resolution/resolver.ts:735` 创建 addon
- 同文件 `:736`、`:739`、`:740`、`:743`、`:746` 共 5 次 `addon.requireBuiltin(...)`

直接执行修改前/后的 resolver 代码，Electron Node 模式、3 次运行：

| 路径 | 耗时 |
|:--|--:|
| `--expose-internals` 存在，直接 `require(id)` | **1–2 ms** |
| 无 flag，走 `node-addon-require-builtin` | **534–544 ms** |

原始输出：`interception-benchmark.log`
基准脚本：`bench-interception.mjs`

<details><summary>interception-benchmark.log</summary>

```text
Electron Node mode (44.7.0 / Node 24.21.0)
with-flag run 1:    2 ms
with-flag run 2:    2 ms
with-flag run 3:    1 ms
without-flag run 1: 534 ms
without-flag run 2: 541 ms
without-flag run 3: 544 ms
```

</details>

这与 CPU profile 中的 917 ms 相互印证：该查找在 Electron Node 模式下每次调用约 100–130 ms。

## 证据 5：先显示加载页的 A/B

为了验证“窗口等待 Host”本身是主要原因，在同一个开发版构建上做了 A/B；唯一差异是是否在 `backend.start` 前调用 `showStartupWindow()`。

| 版本 | Electron 出现 | 第一个窗口 | Host spawn | Host listen |
|:--|--:|--:|--:|--:|
| 先显示加载页（warm） | 402 ms | **430 ms** | 558 ms | 1,556 ms |
| 基线（warm） | 321 ms | **2,874 ms** | 457 ms | 1,365 ms |

原始数据与方法：`dev-first-window-ab.txt`；开发版日志：`dsh-dev-patched2.log`、`dsh-dev-baseline2.log`。

- 修改后窗口在 Host spawn 之前就出现（430 ms vs 558 ms）。
- 基线要等 Host 和欢迎决策（2,874 ms）。
- 开发版只有核心 bundle，所以基线比安装版（6.6–7.7 s）快；机制相同。

## 复现命令

```powershell
# 1. 安装版首窗时间线（会启动并关闭 3 次安装版应用）
& .artifacts\desktop-startup-evidence\measure-installed.ps1 -Runs 3

# 2. Host 单独启动；第一个参数为 profile 目录
node .artifacts\desktop-startup-evidence\measure-host.mjs `
  C:\Users\lucky\.dsh\profiles\desktop

# 3. 内部模块查找基准
$env:ELECTRON_RUN_AS_NODE = '1'
& "M:\deepseek\harness\DeepSeek Harness.exe" --expose-internals --import tsx/esm `
  .artifacts\desktop-startup-evidence\bench-interception.mjs
& "M:\deepseek\harness\DeepSeek Harness.exe" --import tsx/esm `
  .artifacts\desktop-startup-evidence\bench-interception.mjs
Remove-Item Env:\ELECTRON_RUN_AS_NODE
```

## 建议的修复方向

1. **窗口不要等 Host**：静态页面加载完成后先显示共享加载页，工作区仍等启动注入和凭证检查后再挂载。开发版 A/B 为 2,874 ms → 430 ms。
2. **复用已暴露的内部模块**：`--expose-internals` 存在时先直接 `require`，失败再回退到 addon；与 vendored Loader、HMR 的现有查找顺序一致。该路径 534–544 ms → 1–2 ms。

参考实现（fork，不是上游 PR；上游当前不接受外部 PR）：

- `https://github.com/haikuotianko/deepseek-harness/pull/1`
- `https://github.com/haikuotianko/deepseek-harness/pull/2`

完整证据（原始日志、CPU profile、复现脚本、中文报告）：[evidence branch](https://github.com/haikuotianko/deepseek-harness/tree/evidence/desktop-startup/.artifacts/desktop-startup-evidence)

## 需要说明的测量边界

- 单机、热启动、连续 3 次；冷启动可能更慢。
- 安装版 Electron 为 44.7.0；开发版 A/B 使用缓存 Electron 44.10.2，A/B 在同一二进制内比较。
- `Host listen` 是就绪的近似信号；Host 日志中的 `ready` 约晚 0.35 s。
- 日志中的 Host URL token 已替换为 `<redacted>`；CPU profile 和路径包含本机用户目录名。
