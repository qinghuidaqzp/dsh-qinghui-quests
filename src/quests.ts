import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const XP = { easy: 10, medium: 25, hard: 50 } as const;
export type Difficulty = keyof typeof XP;
export const DIFFICULTY_LABELS = { easy: '轻松', medium: '挑战', hard: '精英' } as const;
export class QuestError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'QuestError'; }
}
const titleSchema = z.string().trim().min(1).max(160).refine(value => !/[\u0000-\u001f\u007f]/u.test(value), '任务标题不能包含控制字符');
const questSchema = z.object({
  id: z.string().uuid(), title: titleSchema, difficulty: z.enum(['easy', 'medium', 'hard']), createdAt: z.string().datetime(),
}).strict();
const completedSchema = questSchema.extend({ completedAt: z.string().datetime() }).strict();
const count = z.number().int().min(0).max(10_000_000);
export const boardSchema = z.object({
  version: z.literal(1),
  xp: z.number().int().min(0).max(1_000_000_000),
  completed: z.object({ easy: count, medium: count, hard: count }).strict(),
  active: z.array(questSchema).max(100),
  recent: z.array(completedSchema).max(100),
}).strict().superRefine((board, ctx) => {
  const expected = board.completed.easy * XP.easy + board.completed.medium * XP.medium + board.completed.hard * XP.hard;
  if (expected !== board.xp) ctx.addIssue({ code: 'custom', message: '经验值与已完成任务计数不一致' });
  if (board.recent.length > board.completed.easy + board.completed.medium + board.completed.hard) {
    ctx.addIssue({ code: 'custom', message: '历史记录数超过完成数' });
  }
  const ids = [...board.active, ...board.recent].map(quest => quest.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: '任务 ID 重复' });
});
export type Board = z.infer<typeof boardSchema>;
export type Quest = z.infer<typeof questSchema>;

export function displayTitle(title: string): string {
  return title.replace(/[\\`*_{}\[\]()#+\-.!|<>]/g, '\\$&');
}

export function newBoard(): Board {
  return { version: 1, xp: 0, completed: { easy: 0, medium: 0, hard: 0 }, active: [], recent: [] };
}

export function levelInfo(xp: number) {
  const level = Math.floor((1 + Math.sqrt(1 + 8 * xp / 100)) / 2);
  const floor = 100 * level * (level - 1) / 2;
  const next = 100 * level * (level + 1) / 2;
  return { level, current: xp - floor, required: next - floor, nextLevelAt: next };
}

export function badges(board: Board): string[] {
  const total = board.completed.easy + board.completed.medium + board.completed.hard;
  return [
    total >= 1 && '🌱 冒险启程', total >= 5 && '🧭 渐入佳境', total >= 20 && '🏅 任务达人',
    board.completed.hard >= 3 && '🐉 精英猎人',
    Object.values(board.completed).every(value => value > 0) && '🌈 全能冒险者',
  ].filter((badge): badge is string => !!badge);
}

export function statusText(board: Board): string {
  const level = levelInfo(board.xp);
  const filled = Math.floor(level.current / level.required * 10);
  const unlocked = badges(board);
  const total = Object.values(board.completed).reduce((sum, value) => sum + value, 0);
  return `🗺️ Qinghui 任务冒险日志\nLv.${level.level} · ${board.xp} XP\n${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${level.current}/${level.required} XP\n完成 ${total} 个任务 · 进行中 ${board.active.length} 个\n徽章：${unlocked.length ? unlocked.join(' · ') : '完成第一个任务，点亮第一枚徽章！'}`;
}

export function addQuest(board: Board, title: string, difficulty: string, maxActive: number, now = new Date()): { board: Board; quest: Quest } {
  const parsed = titleSchema.safeParse(title);
  if (!parsed.success) throw new QuestError('INVALID_TITLE', '任务标题需为 1–160 个字符，且不能包含换行或控制字符。');
  if (!Object.hasOwn(XP, difficulty)) throw new QuestError('INVALID_DIFFICULTY', '难度只能是 easy、medium 或 hard。');
  if (board.active.length >= maxActive) throw new QuestError('ACTIVE_LIMIT', `当前会话最多保留 ${maxActive} 个进行中的任务，请先完成或放弃部分任务。`);
  const normalized = parsed.data.normalize('NFKC').toLowerCase();
  if (board.active.some(quest => quest.title.normalize('NFKC').toLowerCase() === normalized)) {
    throw new QuestError('DUPLICATE_QUEST', '同名任务已在冒险清单中，请使用原任务 ID。');
  }
  const quest: Quest = { id: randomUUID(), title: parsed.data, difficulty: difficulty as Difficulty, createdAt: now.toISOString() };
  return { board: { ...board, active: [...board.active, quest] }, quest };
}

export function completeQuest(board: Board, id: string, now = new Date()) {
  validateId(id);
  const quest = board.active.find(item => item.id === id);
  if (!quest) {
    if (board.recent.some(item => item.id === id)) return { board, changed: false, earned: 0, newBadges: [] as string[], quest: board.recent.find(item => item.id === id)! };
    throw new QuestError('QUEST_NOT_FOUND', '当前会话没有这个进行中的任务，请先列出任务获取正确 ID。');
  }
  const next: Board = {
    ...board,
    xp: board.xp + XP[quest.difficulty],
    completed: { ...board.completed, [quest.difficulty]: board.completed[quest.difficulty] + 1 },
    active: board.active.filter(item => item.id !== id),
    recent: [{ ...quest, completedAt: now.toISOString() }, ...board.recent].slice(0, 100),
  };
  if (!boardSchema.safeParse(next).success) throw new QuestError('PROGRESS_LIMIT', '当前冒险记录达到数值上限，不能继续累计经验。');
  const previous = new Set(badges(board));
  return { board: next, changed: true, earned: XP[quest.difficulty], newBadges: badges(next).filter(badge => !previous.has(badge)), quest };
}

export function abandonQuest(board: Board, id: string): Board {
  validateId(id);
  if (!board.active.some(quest => quest.id === id)) throw new QuestError('QUEST_NOT_FOUND', '当前会话没有这个进行中的任务。');
  return { ...board, active: board.active.filter(quest => quest.id !== id) };
}

export function validateId(id: string): void {
  if (typeof id !== 'string' || !z.string().uuid().safeParse(id).success) {
    throw new QuestError('INVALID_QUEST_ID', '请使用 qinghui_quest_add 或 qinghui_quest_list 返回的完整任务 ID。');
  }
}

export function listText(board: Board, filter: 'active' | 'completed' | 'all', limit: number): string {
  const lines: string[] = [];
  if (filter !== 'completed') {
    lines.push('⚔️ 进行中的冒险');
    lines.push(...board.active.slice(0, limit).map(quest => `• ${displayTitle(quest.title)} [${DIFFICULTY_LABELS[quest.difficulty]} · ${XP[quest.difficulty]} XP]\n  ID: ${quest.id}`));
    if (!board.active.length) lines.push('还没有任务，试着添加一个小目标。');
    if (board.active.length > limit) lines.push(`另有 ${board.active.length - limit} 个任务未显示，可增大 limit（最多 100）。`);
  }
  if (filter !== 'active') {
    lines.push('📜 最近完成的冒险（最多保留 100 条）');
    lines.push(...board.recent.slice(0, limit).map(quest => `✓ ${displayTitle(quest.title)} [${XP[quest.difficulty]} XP]\n  ID: ${quest.id}`));
    if (!board.recent.length) lines.push('完成第一项任务后，历史会出现在这里。');
  }
  return lines.join('\n');
}
