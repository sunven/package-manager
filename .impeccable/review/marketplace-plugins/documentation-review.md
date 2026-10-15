# 文档复核

执行方式：独立文档代理因模型服务限流失败；主代理按 `reference/degraded/documenter.md` 与 `reference/document.md` 完成替代复核。

设计系统：No changes。核对 `src/styles.css`、`src/components/ui.tsx`、`components/ui/table.tsx`、`components/ui/button.tsx` 及本次页面组件，与现有市场页面基线和最终生产截图一致；没有需要新增为全局规则的设计决定。

文档同步：`README.md` 修正遗留的三个页签描述；插件 surface brief 更名为 `src-components-codexpluginlist-tsx.md` 并记录嵌入结构；Hooks brief 同步两个页签与跳转入口；原插件验证记录修复当前实现链接，保留历史测试命令。`PRODUCT.md` 与市场 brief 已反映合并后的能力与组织方式。

1. 色彩：延续浅色蓝灰背景、白色面板与蓝色操作强调，以及既有深色主题。
2. 字体：沿用 Outfit 与中文回退字形；代码、版本和路径使用 JetBrains Mono；标题、正文与提示保留既有层级。
3. 容器：沿用 Panel 与表格行展开，插件列表嵌入市场详情，不增加嵌套卡片。
4. 交互：沿用按钮、Radix 页签与确认框；确认结果与重读失败分别反馈，关闭后恢复焦点。
5. 布局：桌面保留紧凑表格，窄窗口局部滚动；长名称与来源路径可换行。

未固化或修复：仓库既有缺少全局 `DESIGN.md` 的情况继续保留；本次普通扩展不补建全局设计系统，也不将合成验证数据或历史页面组织固化为设计规则。
