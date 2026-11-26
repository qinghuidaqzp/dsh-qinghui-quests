为避免社区重名，任务冒险日志现更名为 **Qinghui 任务冒险日志**，包名与仓库为 `dsh-qinghui-quests`，版本为 **0.1.1**。

- 五个原生工具统一改用 `qinghui_quest_` 前缀。
- 原有任务、经验与徽章继续从历史存储域 `dsh_quest_log` 读取。
- 16 项自动化测试通过，包括真实 v0.1.0 JSON 数据升级后保留进度、继续完成任务和防止重复奖励。
- 已验证 DeepSeek Harness 0.2.2-rc.2；无需额外 API Key 或 npm 账号。

新用户在完全退出 Harness 桌面版后安装：

```sh
dsh plugin --profile desktop add "https://github.com/qinghuidaqzp/dsh-qinghui-quests/releases/download/v0.1.1/dsh-qinghui-quests-0.1.1.tgz"
```

从旧版升级的用户，先在同一 profile 中运行 `dsh plugin --profile desktop remove dsh-quest-log`，然后安装新版。不要同时启用新旧包。工具名由 `quest_add` 等变为 `qinghui_quest_add` 等，需要同步更新自定义提示。

Web 版将 `desktop` 改为 `web`。原仓库地址由 GitHub 重定向，新旧 Release 与 Git 历史均保留。完整说明见 [README](https://github.com/qinghuidaqzp/dsh-qinghui-quests#readme)。

插件追踪任务，不自动执行或核验实际工作。附件包含预构建安装包和 SHA-256 校验文件。
