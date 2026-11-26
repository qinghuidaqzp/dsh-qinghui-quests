把待办事项变成冒险，完成任务获得经验、升级并解锁徽章。

- 已验证 DeepSeek Harness 0.2.2-rc.2。
- 15 项自动化测试通过；三个趣味插件一起安装后，11 个原生工具均成功注册，代表性操作已在真实 Harness 中调用通过。
- 无需额外 API Key，无需 npm 账号。

桌面版先完全退出 Harness，再安装：

```sh
dsh plugin --profile desktop add "https://github.com/qinghuidaqzp/dsh-quest-log/releases/download/v0.1.0/dsh-quest-log-0.1.0.tgz"
```

Web 版将 `desktop` 改为 `web`。完整说明见 [README](https://github.com/qinghuidaqzp/dsh-quest-log#readme)。

进度使用 Harness 原生存储按会话持久保存；插件追踪任务，不自动执行或核验实际工作。

附件包含预构建安装包和 SHA-256 校验文件。
