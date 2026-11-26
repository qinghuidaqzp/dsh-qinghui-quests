import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addQuest, abandonQuest, badges, boardSchema, completeQuest, levelInfo, listText, newBoard } from '../src/quests.js';

test('adding quests trims titles, isolates the previous state and validates input', () => {
  const previous = newBoard();
  const created = addQuest(previous, '  修好登录按钮  ', 'medium', 30);
  assert.equal(created.quest.title, '修好登录按钮');
  assert.equal(previous.active.length, 0);
  assert.equal(created.board.active.length, 1);
  for (const title of ['', ' ', 'a\nbody', 'x'.repeat(161)]) assert.throws(() => addQuest(previous, title, 'medium', 30), { code: 'INVALID_TITLE' });
  assert.throws(() => addQuest(previous, 'something', '__proto__', 30), { code: 'INVALID_DIFFICULTY' });
  assert.throws(() => addQuest(created.board, '修好登录按钮', 'hard', 30), { code: 'DUPLICATE_QUEST' });
});

test('active task capacity is enforced and abandoning awards no XP', () => {
  const { board, quest } = addQuest(newBoard(), 'first', 'easy', 1);
  assert.throws(() => addQuest(board, 'second', 'easy', 1), { code: 'ACTIVE_LIMIT' });
  const abandoned = abandonQuest(board, quest.id);
  assert.equal(abandoned.active.length, 0);
  assert.equal(abandoned.xp, 0);
  assert.throws(() => completeQuest(abandoned, quest.id), { code: 'QUEST_NOT_FOUND' });
});

test('completion is idempotent and awards correct difficulty XP', () => {
  const added = addQuest(newBoard(), 'ship tests', 'hard', 30);
  const first = completeQuest(added.board, added.quest.id);
  assert.equal(first.earned, 50);
  assert.equal(first.board.xp, 50);
  assert.deepEqual(first.newBadges, ['🌱 冒险启程']);
  assert.equal(first.board.active.length, 0);
  const retry = completeQuest(first.board, added.quest.id);
  assert.equal(retry.changed, false);
  assert.equal(retry.earned, 0);
  assert.equal(retry.board.xp, 50);
});

test('levels and progress use increasing XP thresholds at boundaries', () => {
  assert.deepEqual(levelInfo(0), { level: 1, current: 0, required: 100, nextLevelAt: 100 });
  assert.equal(levelInfo(99).level, 1);
  assert.deepEqual(levelInfo(100), { level: 2, current: 0, required: 200, nextLevelAt: 300 });
  assert.equal(levelInfo(299).level, 2);
  assert.equal(levelInfo(300).level, 3);
});

test('badges unlock from completed task facts and recent history stays bounded', () => {
  let state = newBoard();
  for (let i = 0; i < 110; i++) {
    const next = addQuest(state, `task ${i}`, ['easy', 'medium', 'hard'][i % 3], 30);
    state = completeQuest(next.board, next.quest.id).board;
  }
  assert.equal(state.recent.length, 100);
  assert.equal(Object.values(state.completed).reduce((a, b) => a + b), 110);
  assert.equal(badges(state).length, 5);
  assert.ok(boardSchema.safeParse(state).success);
  assert.match(listText(state, 'completed', 1), /task 109/);
  assert.doesNotMatch(listText(state, 'completed', 1), /task 108/);
});

test('persisted state validates XP consistency, duplicated IDs and unknown fields', () => {
  const created = addQuest(newBoard(), 'test', 'easy', 30);
  assert.equal(boardSchema.safeParse({ ...created.board, xp: 99 }).success, false);
  assert.equal(boardSchema.safeParse({ ...created.board, active: [created.quest, created.quest] }).success, false);
  assert.equal(boardSchema.safeParse({ ...created.board, unexpected: 'data' }).success, false);
  assert.throws(() => completeQuest(created.board, '../../other'), { code: 'INVALID_QUEST_ID' });
});
