import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import { HarnessError } from '@deepseek-ai/dsh-llm';
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { addQuest, abandonQuest, boardSchema, completeQuest, displayTitle, levelInfo, listText, newBoard, QuestError, statusText, XP } from './quests.js';

export const name = 'quest-log';
export const inject = ['tools', 'storageDomain'];
export interface Config { maxActive: number; maxBoards: number }
export const Config = schema.object({
  maxActive: schema.number().step(1).min(1).max(100).default(30).description('每个会话最多进行中的任务数。'),
  maxBoards: schema.number().step(1).min(1).max(2000).default(500).description('插件最多保存多少个会话的冒险记录。'),
});

export const questDomain = defineDomain({ name: 'dsh_quest_log', version: 1, layout: 'single', tables: { boards: domainTable(boardSchema) } });
export function sessionKey(id: unknown): string {
  if (typeof id !== 'string' || !id || id.length > 1024) throw new QuestError('SESSION_REQUIRED', '任务冒险日志需要在有效的 Harness 会话中调用。');
  return createHash('sha256').update(id).digest('hex');
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const domain = await ctx.storageDomain.open(questDomain);
  const boards = domain.table('boards');
  let chain: Promise<unknown> = Promise.resolve();
  let disposed = false;
  ctx.effect(() => async () => { disposed = true; await chain; await domain.close(); });

  function run<T>(exec: ToolRunContext, operation: (key: string) => Promise<T> | T): Promise<T> {
    const work = chain.then(async () => {
      exec.signal.throwIfAborted();
      if (disposed) throw new QuestError('PLUGIN_UNLOADED', '任务冒险日志已卸载，请重新启用插件。');
      return operation(sessionKey(exec.agent?.id ?? exec.agent?.session?.id));
    }).catch(error => {
      if (error instanceof QuestError) throw new HarnessError(error.message, error.code, { cause: error });
      throw error;
    });
    chain = work.then(() => {}, () => {});
    return work;
  }

  const output = {
    schema: { type: 'object', properties: { text: { type: 'string', required: true } }, additionalProperties: false },
    render: (_args: unknown, value: { text: string }) => [{ type: 'text' as const, text: value.text }],
  } as const;

  ctx.tools.register(defineTool({
    name: 'quest_add',
    description: 'Add a user-requested task to this session’s adventure log. This only tracks a task; it does not perform or schedule the underlying work. Easy=10 XP, medium=25 XP, hard=50 XP. Choose difficulty with the user’s intent.',
    parameters: { title: { type: 'string', required: true, description: 'A concrete task title, 1–160 characters.' }, difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Difficulty, default medium.' } },
    output, isConcurrencySafe: () => true,
    execute: (args, exec) => run(exec, async key => {
      if (!boards.get(key) && boards.size >= config.maxBoards) throw new QuestError('BOARD_LIMIT', '冒险记录已达到会话数上限，请在插件设置中提高 maxBoards。');
      const result = addQuest(boards.get(key) ?? newBoard(), args.title, args.difficulty ?? 'medium', config.maxActive);
      await boards.put(key, result.board);
      return { text: `⚔️ 新冒险已加入：${displayTitle(result.quest.title)}\n奖励：${XP[result.quest.difficulty]} XP\n任务 ID：${result.quest.id}\n完成实际工作后，再将此任务标记为完成。` };
    }),
    presentCall: args => ({ card: 'generic', title: `添加冒险：${args.title}`, kind: 'edit' }),
  }));

  ctx.tools.register(defineTool({
    name: 'quest_list', description: 'List tasks and recent completed quests for the current Harness session only.',
    parameters: { filter: { type: 'string', enum: ['active', 'completed', 'all'], description: 'Default active.' }, limit: { type: 'integer', description: 'Maximum items in each section, 1–100; default 20.' } },
    output, isConcurrencySafe: () => true,
    execute: (args, exec) => run(exec, key => {
      const limit = args.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new QuestError('INVALID_LIMIT', 'limit 必须是 1–100 的整数。');
      const filter = args.filter ?? 'active';
      if (!['active', 'completed', 'all'].includes(filter)) throw new QuestError('INVALID_FILTER', 'filter 只能是 active、completed 或 all。');
      return { text: listText(boards.get(key) ?? newBoard(), filter, limit) };
    }),
    presentCall: () => ({ card: 'generic', title: '查看冒险清单', kind: 'read' }),
  }));

  ctx.tools.register(defineTool({
    name: 'quest_complete',
    description: 'Mark a quest complete only after the user confirms completion or the actual work has been verified. This awards XP; it does not execute or verify the underlying work itself. A quest ID can earn XP only once.',
    parameters: { quest_id: { type: 'string', required: true, description: 'Full quest UUID returned by quest_add/quest_list.' } },
    output, isConcurrencySafe: () => true,
    execute: (args, exec) => run(exec, async key => {
      const previous = boards.get(key) ?? newBoard();
      const result = completeQuest(previous, args.quest_id);
      if (!result.changed) return { text: `✅ 这个任务已经完成，本次没有重复增加经验。\n${statusText(result.board)}` };
      await boards.put(key, result.board);
      const leveledUp = levelInfo(result.board.xp).level > levelInfo(previous.xp).level;
      return { text: `🎉 冒险完成：${displayTitle(result.quest.title)}\n+${result.earned} XP${leveledUp ? '\n✨ 升级了！' : ''}${result.newBadges.length ? `\n新徽章：${result.newBadges.join(' · ')}` : ''}\n\n${statusText(result.board)}` };
    }),
    presentCall: () => ({ card: 'generic', title: '完成冒险并领取经验', kind: 'edit' }),
  }));

  ctx.tools.register(defineTool({
    name: 'quest_status', description: 'Show this session’s level, XP, active quest count and unlocked badges. Does not expose other sessions.',
    parameters: {}, output, isConcurrencySafe: () => true,
    execute: (_args, exec) => run(exec, key => ({ text: statusText(boards.get(key) ?? newBoard()) })),
    presentCall: () => ({ card: 'generic', title: '查看冒险者状态', kind: 'read' }),
  }));

  ctx.tools.register(defineTool({
    name: 'quest_abandon', description: 'Remove one active quest only when the user wants to abandon it. Does not award or subtract XP. Completed history is not removed.',
    parameters: { quest_id: { type: 'string', required: true, description: 'Full active quest UUID.' } },
    output, isConcurrencySafe: () => true,
    execute: (args, exec) => run(exec, async key => {
      const next = abandonQuest(boards.get(key) ?? newBoard(), args.quest_id);
      await boards.put(key, next);
      return { text: '🏕️ 已放下这个任务，经验不变。休息一下，也可以开启新的冒险。' };
    }),
    presentCall: () => ({ card: 'generic', title: '放弃当前冒险', kind: 'edit' }),
  }));
}
