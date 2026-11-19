# 磁盘扫描验证

Status: done

日期：2026-11-19。需求依据：[PRD.md](./PRD.md)。

## 实现

- `src-tauri/src/disk_scan.rs`：后台逐层遍历、每目录硬链接去重、真正取消、部分结果、挂载与链接排除、百万条目上限、目录查询及路径设置。原生内存保留目录树，进度通知只包含摘要。
- `src/diskScanWorkflow.ts`、`src/hooks/useDiskScan.ts`：单轮任务、输入草稿、切页保留、扫描与浏览请求的迟到结果隔离、观察台账记录。
- `src/components/DiskScanPage.tsx`、`src/diskScan.css`：选择与输入目录、扫描进度、目录列表、根内导航、复制路径、每次增加 200 行。沿用现有 Hum 主题。
- Shell/App 新增「观察 → 磁盘扫描」，观察覆盖度注册 `disk-scan`；台账只保存元数据。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 74 个文件、565 项测试通过 |
| `pnpm build` | TypeScript 检查和生产构建通过；保留既有的主包超过 500 kB 提示 |
| `cd src-tauri && cargo test --lib --quiet` | 455 项通过，12 项按既有约定或手动测试说明跳过 |
| `cd src-tauri && cargo test --lib disk_scan::tests -- --nocapture` | 本功能 10 项通过，2 项手动测试另行执行 |
| `rustfmt --check src/disk_scan.rs src/disk_scan_tests.rs --edition 2021`（`src-tauri` 内） | 通过 |
| `git diff --check` | 通过 |

本功能测试覆盖：隐藏与嵌套目录、空目录、各层硬链接独立去重、根链接解析、内部链接及循环链接、特殊条目、设备边界、权限错误、目录在校验后移动导致路径消失、停止底层遍历、达到条目上限、扫描期间排序稳定、终态重排、缓存浏览、无效起点保留旧任务、重启仅恢复路径。

前端测试覆盖：路径选择只修改草稿、提交与浏览、复制路径、200 行继续加载、不完整空列表、取消等待原生终态、切页保留位置、迟到进度与目录结果隔离、失败读取重试、覆盖度完整性与范围。

早期全量 Rust 测试曾在现有 `app_environment::tests::gui_launch_finds_npm_and_its_node_interpreter_from_zshrc` 触发 1 秒超时。对 HEAD 临时源码副本复核通过，随后当前修改的全量测试通过；没有修改该测试或生产环境探测代码。

## 规模验证

使用本功能的两个显式忽略测试执行手动验证：

```sh
cd src-tauri
DISK_SCAN_VERIFY_ROOT=/Users/sunven/github/package-manager cargo test --lib disk_scan::tests::inspect_real_directory -- --ignored --exact --nocapture
cargo test --lib disk_scan::tests::million_entry_directory_page_is_bounded -- --ignored --exact --nocapture
```

- 真实开发目录：125,646 个条目，25,691,717,632 字节占用，0 处读取问题，2,071 个主动排除条目；948 ms，5 次进度通知。扫描包含本仓库的开发依赖与构建产物。
- 百万条目夹具：保留 1,000,000 个节点；构建节点 76.96 ms，排序并生成首批 200 行 16.27 ms，IPC JSON 39,039 字节。达到上限后遍历终止，结果保持不完整。
- 直接用 `/usr/bin/time -l` 执行已编译的该测试，最大 RSS 为 183,517,184 字节（约 175 MiB）。不把编译器内存算作扫描内存。

百万条目测试验证内存树、排序、首批传输与停止边界，未在磁盘上创建百万文件；单次本机耗时不代表所有文件系统表现。

## 界面验证

通过 `agent-browser` 操作真实 Shell、DiskScanPage 和 workflow。浏览器无法调用 Tauri，因此在忽略目录 `.taste-skill/disk-scan/` 内建立验证入口，载入上述原生扫描产生的真实摘要和目录结果，替代 IPC 传输。验证入口使用现有 Vite 配置单独构建，未加入应用发布入口。

- 进入 `src`、返回根目录；根目录禁用「上一级」。
- 进入子目录后切换总览，再回到磁盘扫描，浏览位置和列表保留。
- 提交不存在的路径，显示原因并保留原目录与列表。
- 扫描状态点击停止，接收终态后保留列表；真实底层取消另由 Rust 测试覆盖。
- 查看完成、扫描中、部分读取、失败提示、首次进入及恢复路径的空态；检查深浅主题与 1180、768、390 px 视口。
- 空态容器曾因共享组件的宽度与外边距出现裁切，已在磁盘扫描页内修正；小屏减少间距，首批目录行更早出现。

生产构建使用 `design-taste-frontend/scripts/inspect.mjs --app` 检查：浅色完成态 0 FAIL / 0 WARN；深色扫描态和空态各 0 FAIL / 1 WARN。既有 Hum 的按钮效果、面板阴影获允许；奶油色背景及深色模式的浅色文字沿用品牌色。空态的留白提示来自尚未扫描时没有结果，保留该留白。`lint.mjs --app` 为 0 FAIL / 1 WARN，等宽字体仅用于真实文件系统路径。截图与报告保留在 `.taste-skill/disk-scan/final-*`。

截图复核：名称与大小清晰，主操作和目录导航可识别；桌面表格与小屏纵向条目使用相同字段。设计 7.5、可用性 8、创意 7、内容 8，加权 7.6；采用既有应用设计系统，不适用营销页面的照片、滚动动效要求。无新增装饰动效，继续使用现有按钮反馈。

axe 检查磁盘扫描页面为 0 个违规项；纹理背景导致自动对比度检查有 1 类待人工判断，已查看深浅主题截图，未发现不可读文字。

## 验证边界

- 已运行原生扫描实现和命令编译检查；系统目录选择器、原生 WebView 到 Rust 的完整 IPC 流程未做桌面窗口自动化验收。浏览器数据传输为夹具，不能替代该验收。
- 跨磁盘排除使用设备号差异夹具验证，未新建或挂载磁盘。未对整盘、网络盘或千万文件规模作性能承诺。
- 文件系统变化时返回本轮逐步读取的记录，不提供原子快照；取消在文件系统调用之间检查。权限失败和已观察到的路径变化会标为不完整。
