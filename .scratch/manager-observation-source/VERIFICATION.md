# 观察来源改造验证

日期：2026-10-21。

| 检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run` | 40 个文件，300 项通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --quiet` | 286 项通过，10 项 ignored；main/doc tests 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib native_cli_freezes_default_tls_and_named_ssh_connections -- --ignored` | 新增的 Docker 原生隔离测试单独运行通过 |
| `pnpm build` | 通过；仍有既有的主 JS 包超过 500 kB 提示 |
| 修改文件的 `rustfmt --check`、`git diff --check` | 通过 |

全量 Rust 中的 10 项 ignored 包含上述已单独验证的 Docker 测试；其余 9 项既有专用环境测试未运行。

## 覆盖

- 从各管理器扫描入口断言清单和来源一并返回；核对路径来源与原有编码、解释器选择、空／相对路径、来源读取失败、Bun 未确认的全局目录及 uv 两类来源不完整。
- Docker 默认 context 切换、同名 context 修改后，后续查询仍使用同一临时 context、原 endpoint、TLS 材料和 HTTP headers。
- 导出、导入、来源解析、配置读取失败，以及 daemon 身份变化、空值、无效 JSON、超时，均保留可读清单并取消来源比较资格。
- 单项资源查询失败时保留已经读取的资源，标记清单不完整；历史错误摘要不包含临时配置路径。
- 临时 context 不作为用户可复制的操作候选；临时配置随扫描释放。
- 旧、新、未知 Docker 来源及清单重启后原样保留；新旧或不同 daemon 不比较，同来源完整清单仍可比较。

## 原生验证范围

本机版本：Docker 29.8.2，build 7fc2dff。原生测试只使用临时配置，通过真实 CLI 导出／导入 default TLS 与命名 SSH context；模拟资源查询，并确认原证书文件及原 context 修改不影响冻结结果。

另以本地 HTTP 模拟 daemon 运行实际 Docker CLI 的两次身份读取与 image/container/volume/system-df 四类查询。第一次身份读取后把原 context 改到其他端点、修改原 headers，所有后续请求仍到达冻结的端点并保留原 headers；前后返回同一身份。此实验未连接真实用户 daemon，也未执行资源维护。

未验证远程 TLS 握手或 SSH 登录。来源保证限于固定本轮连接设置并在读取前后核实身份；不声称识别透明转发背后所有瞬时切换，也不提供资源清单事务快照。
