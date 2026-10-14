# 市场刷新遵循 Codex 官方同步语义

市场源管理首版需要刷新 Git 市场，采用用户手动逐个调用官方 `codex plugin marketplace upgrade <name>` 的方式。用户确认接受官方同步行为：刷新可能连带同步已配置插件，本工具不承诺操作只改变市场目录或保持已安装插件不变。

官方配置参考说明市场刷新可能安装或刷新已配置插件，即使插件被禁用。在独立临时环境中，本机 `codex-cli 0.162.1` 的 `marketplace upgrade` 也确实刷新了已禁用测试插件的缓存内容，并保留其禁用设置；这是单版本验证，尚无跨版本保证。选择官方同步语义可以提供所需的刷新能力，但不能将“首版没有独立的插件安装／更新操作”解释为“市场刷新绝不触及插件”。界面需要说明这一影响边界；新功能仍不提供独立的插件安装、更新或卸载操作。

依据：[官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、[CLI marketplace reference](https://developers.openai.com/codex/cli/reference#codex-plugin-marketplace)。已确认范围见 [PRD](../../.scratch/codex-marketplace-management/PRD.md)。
