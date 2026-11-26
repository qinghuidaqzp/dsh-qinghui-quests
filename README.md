# Qinghui 任务冒险日志 · Qinghui Quests

把待办清单变成一场小冒险：添加任务，完成真实工作后领取 XP，升级并解锁徽章。

这是 DeepSeek Harness 的原生工具插件。无需额外 API Key，插件自身不发送网络请求。任务进度由 Harness 存储服务持久化，按会话隔离。

```text
🗺️ Qinghui 任务冒险日志
Lv.2 · 150 XP
▰▰▱▱▱▱▱▱▱▱ 50/200 XP
完成 15 个任务 · 进行中 0 个
徽章：🌱 冒险启程 · 🧭 渐入佳境
```

## 安装

已验证 DeepSeek Harness **0.2.2-rc.2**，Node.js 22+。桌面版先打开一次以初始化配置，再完全退出后安装：

```sh
dsh plugin --profile desktop add "https://github.com/qinghuidaqzp/dsh-qinghui-quests/releases/download/v0.1.1/dsh-qinghui-quests-0.1.1.tgz"
```

使用 `dsh web` 的用户将 `desktop` 改为 `web`。重启后即可使用。也可从 [GitHub Release](https://github.com/qinghuidaqzp/dsh-qinghui-quests/releases/tag/v0.1.1) 下载 `.tgz`，将网址替换为文件的绝对路径。发行包已构建，无需 npm 账号或额外构建权限。

### 从 0.1.0 升级

本项目原名为 `dsh-quest-log`。为与其他作者的社区插件区分，0.1.1 起使用 `dsh-qinghui-quests`；仓库改名保留 Git 历史、旧 Release，并由 GitHub 将旧仓库地址重定向到新地址。

完全退出 Harness 后，在原来的 profile 中先移除旧包，再安装新包；不要同时启用两个版本：

```sh
dsh plugin --profile desktop remove dsh-quest-log
dsh plugin --profile desktop add "https://github.com/qinghuidaqzp/dsh-qinghui-quests/releases/download/v0.1.1/dsh-qinghui-quests-0.1.1.tgz"
```

Web 版同样将 `desktop` 改为 `web`。工具名称由 `quest_add` 等改为 `qinghui_quest_add` 等；自定义提示中若写了旧工具名，请同步替换。插件配置节点也已更名，原来调整过的 `maxActive`、`maxBoards` 请在新插件设置中重新填写。内部存储域继续使用历史名称 `dsh_quest_log`，移除旧包不会删除已保存数据；在同一 Harness 存储配置下恢复原会话，新版会继续读取旧版任务、经验与徽章，无需搬动或重写数据文件。

## 怎么玩

直接在 Harness 对话里说：

> 帮我添加一个中等难度的冒险：做完登录页面。

> 列出这次对话里还没完成的冒险。

> 登录页面已经完成，把这个任务标记为完成，看看我升到几级了。

> 查看我的冒险者等级和徽章。

| 工具 | 功能 |
| --- | --- |
| `qinghui_quest_add` | 添加任务，填写 `title`，可选 `difficulty` |
| `qinghui_quest_list` | 列出进行中、已完成或全部任务 |
| `qinghui_quest_complete` | 用任务 ID 领取一次经验 |
| `qinghui_quest_status` | 查看当前会话的等级、XP、进度条和徽章 |
| `qinghui_quest_abandon` | 放弃一个进行中的任务，不增加或扣除 XP |

任务日志只负责追踪目标，不执行任务，也不独立核验工作质量。完成状态应来自用户确认或代理对实际工作的验证。它不是后台自动化或系统通知工具。

## 经验与徽章

| 难度 | 值 | 完成奖励 |
| --- | --- | ---: |
| 轻松 | `easy` | 10 XP |
| 挑战 | `medium`（默认） | 25 XP |
| 精英 | `hard` | 50 XP |

Lv.2 需要累计 100 XP，Lv.3 需要 300 XP，Lv.4 需要 600 XP；每次升级需要的经验逐步增加。同一个任务 ID 不会重复发放经验。

| 徽章 | 解锁条件 |
| --- | --- |
| 🌱 冒险启程 | 完成 1 个任务 |
| 🧭 渐入佳境 | 完成 5 个任务 |
| 🏅 任务达人 | 完成 20 个任务 |
| 🐉 精英猎人 | 完成 3 个 `hard` 任务 |
| 🌈 全能冒险者 | 三种难度均至少完成 1 个任务 |

同名的进行中任务不能重复添加；已完成后可为下一次工作建立同名新任务。经验属于自我记录，不是防作弊积分或有价值的代币。

## 工具参数

```json
{"name":"qinghui_quest_add","arguments":{"title":"做完登录页面","difficulty":"medium"}}
```

```json
{"name":"qinghui_quest_list","arguments":{"filter":"all","limit":20}}
```

`qinghui_quest_add` 与 `qinghui_quest_list` 会返回完整 UUID。把这个 ID 传给 `qinghui_quest_complete` 或 `qinghui_quest_abandon` 的 `quest_id` 字段。不要自己猜 ID。

标题限制为 1–160 个字符，不允许控制字符或换行。`qinghui_quest_list.filter` 支持 `active`（默认）、`completed`、`all`；`limit` 为每个分组最多展示的条数，范围 1–100，默认 20。

## 设置与保存位置

| 原生设置 | 默认值 | 含义 |
| --- | ---: | --- |
| `maxActive` | 30 | 每个会话最多同时进行中的任务，范围 1–100 |
| `maxBoards` | 500 | 最多保存的会话记录数量，范围 1–2000 |

设置修改由 Harness 重新挂载插件后生效。

- 使用原生 `storageDomain` 服务，域名是 `dsh_quest_log`，不扫描工作区，也不接收模型提供的存储文件路径。
- 每个会话使用自身 ID 的 SHA-256 作为记录键。恢复原会话会恢复进度；新会话和派生会话分别从零开始，不读取其他会话的任务。此插件没有跨会话查询工具。
- 存储后端与目录由 Harness 配置决定。默认 JSON 后端使用该后端根目录中的 `dsh_quest_log.json`；任务标题以明文保存在本地，不包含完整聊天记录。
- 最近保留 100 条完成记录，累计经验、完成数和徽章仍保留。更早的任务 ID 已从历史移除时，重复完成请求会被拒绝，也不会再次奖励 XP。
- 同一插件实例中的读改写操作排队执行；宿主 JSON 后端负责原子写入。跨进程共享同一个 JSON 存储根目录不在本插件的并发保证范围内。
- 存储损坏或格式校验失败会阻止加载，不会悄悄覆盖损坏文件；可先备份，再由用户恢复有效备份。
- 卸载插件不删除已保存数据；没有“全部重置”工具，避免误清空进度。

## 从源码开发

在源码检出目录运行：

```sh
npm ci
npm run check
npm pack
```

测试使用真实 Cordis、ToolsService、Storage、JSON 后端和 DomainFacility，覆盖会话隔离、持久化与重启、并发任务创建和重复完成、容量限制、取消、存储损坏、经验阈值以及 Markdown 字面量输出。无需调用模型。

MIT License。问题反馈：[GitHub Issues](https://github.com/qinghuidaqzp/dsh-qinghui-quests/issues)。
