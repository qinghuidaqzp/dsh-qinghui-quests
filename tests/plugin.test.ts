import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolsService, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { Storage } from '@deepseek-ai/dsh-storage';
import * as json from '@deepseek-ai/dsh-storage-json';
import * as domains from '@deepseek-ai/dsh-storage-domain';
import * as plugin from '../src/index.js';

async function storageHarness(root: string, config: Partial<plugin.Config> = {}) {
  const ctx = new Context();
  await ctx.plugin(Storage).await();
  await ctx.plugin(json, { root }).await();
  await ctx.plugin(domains, { backend: 'json' }).await();
  await ctx.plugin(SystemPrompt, {}).await();
  await ctx.plugin(ToolsService).await();
  const fiber = ctx.plugin(plugin, config);
  await fiber.await();
  return {
    ctx, fiber,
    execute(name: string, args: unknown, sessionId = 'session-A', signal = new AbortController().signal) {
      const tool = ctx.tools.get(name);
      assert.ok(tool, `${name} should be registered`);
      return tool.execute(args, { signal, agent: { session: { id: sessionId } } } as ToolRunContext) as Promise<{ text: string }>;
    },
  };
}
async function setup(t: TestContext, config: Partial<plugin.Config> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-quest-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const h = await storageHarness(root, config);
  t.after(() => h.ctx.fiber.dispose());
  return { ...h, root };
}
function idOf(text: string): string {
  const found = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  assert.ok(found, text);
  return found[0];
}

test('native tools mount with schemas and clean up on unload', async t => {
  const h = await setup(t);
  assert.deepEqual(h.ctx.tools.schemas().map(tool => tool.name), ['qinghui_quest_add', 'qinghui_quest_list', 'qinghui_quest_complete', 'qinghui_quest_status', 'qinghui_quest_abandon']);
  assert.deepEqual(h.ctx.tools.get('qinghui_quest_add')!.parameters.required, ['title']);
  assert.deepEqual(h.ctx.tools.get('qinghui_quest_complete')!.parameters.required, ['quest_id']);
  await h.fiber.dispose();
  assert.deepEqual(h.ctx.tools.definitions(), []);
  assert.equal(h.ctx.storageDomain.get('dsh_quest_log'), undefined);
});

test('progress persists through real host JSON storage and plugin restart', async t => {
  const h = await setup(t);
  const quest = await h.execute('qinghui_quest_add', { title: '写出一个可用的小工具', difficulty: 'hard' });
  await h.execute('qinghui_quest_complete', { quest_id: idOf(quest.text) });
  await h.ctx.fiber.dispose();
  const reopened = await storageHarness(h.root);
  t.after(() => reopened.ctx.fiber.dispose());
  assert.match((await reopened.execute('qinghui_quest_status', {})).text, /50 XP/);
  assert.match((await reopened.execute('qinghui_quest_list', { filter: 'completed' })).text, /写出一个可用的小工具/);
  const disk = await readFile(join(h.root, 'dsh_quest_log.json'), 'utf8');
  assert.doesNotMatch(disk, /session-A/);
  assert.match(disk, new RegExp(plugin.sessionKey('session-A')));
});

test('renamed v0.1.1 tools retain real v0.1.0 progress without rewriting it on load', async t => {
  const root = await mkdtemp(join(tmpdir(), 'qinghui-legacy-upgrade-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Captured by running the original v0.1.0 plugin against the host JSON backend.
  const legacy = await readFile(new URL('./fixtures/v0.1.0-board.json', import.meta.url), 'utf8');
  const storageFile = join(root, 'dsh_quest_log.json');
  await writeFile(storageFile, legacy);
  const h = await storageHarness(root);
  t.after(() => h.ctx.fiber.dispose());
  assert.equal(plugin.questDomain.name, 'dsh_quest_log');
  assert.equal(h.ctx.tools.get('quest_add'), undefined);
  const status = await h.execute('qinghui_quest_status', {}, 'legacy-session');
  assert.match(status.text, /50 XP/);
  assert.match(status.text, /完成 1 个任务 · 进行中 1 个/);
  assert.match(status.text, /冒险启程/);
  const active = await h.execute('qinghui_quest_list', {}, 'legacy-session');
  assert.match(active.text, /旧版进行中任务/);
  assert.match((await h.execute('qinghui_quest_list', { filter: 'completed' }, 'legacy-session')).text, /旧版已完成任务/);
  assert.equal(await readFile(storageFile, 'utf8'), legacy);
  await h.execute('qinghui_quest_complete', { quest_id: idOf(active.text) }, 'legacy-session');
  assert.match((await h.execute('qinghui_quest_status', {}, 'legacy-session')).text, /60 XP/);
  await h.execute('qinghui_quest_complete', { quest_id: idOf(active.text) }, 'legacy-session');
  assert.match((await h.execute('qinghui_quest_status', {}, 'legacy-session')).text, /60 XP/);
});

test('separate sessions cannot list or complete each other’s quests', async t => {
  const h = await setup(t);
  const result = await h.execute('qinghui_quest_add', { title: '仅属于会话 A', difficulty: 'easy' });
  assert.doesNotMatch((await h.execute('qinghui_quest_list', {}, 'session-B')).text, /仅属于会话 A/);
  await assert.rejects(h.execute('qinghui_quest_complete', { quest_id: idOf(result.text) }, 'session-B'), { code: 'QUEST_NOT_FOUND' });
  assert.match((await h.execute('qinghui_quest_status', {}, 'session-B')).text, /0 XP/);
});

test('concurrent adds and repeated completions never lose tasks or duplicate XP', async t => {
  const h = await setup(t);
  const results = await Promise.all(Array.from({ length: 15 }, (_, index) => h.execute('qinghui_quest_add', { title: `并发任务 ${index}`, difficulty: 'easy' })));
  await Promise.all(results.flatMap(result => Array.from({ length: 3 }, () => h.execute('qinghui_quest_complete', { quest_id: idOf(result.text) }))));
  const status = await h.execute('qinghui_quest_status', {});
  assert.match(status.text, /150 XP/);
  assert.match(status.text, /完成 15 个任务 · 进行中 0 个/);
});

test('capacity and invalid argument failures do not poison the write queue', async t => {
  const h = await setup(t, { maxActive: 1, maxBoards: 1 });
  const result = await h.execute('qinghui_quest_add', { title: 'first' });
  await assert.rejects(h.execute('qinghui_quest_add', { title: 'second' }), { code: 'ACTIVE_LIMIT' });
  await assert.rejects(h.execute('qinghui_quest_add', { title: 'other session' }, 'session-B'), { code: 'BOARD_LIMIT' });
  await assert.rejects(h.execute('qinghui_quest_list', { limit: 0 }), { code: 'INVALID_LIMIT' });
  await h.execute('qinghui_quest_abandon', { quest_id: idOf(result.text) });
  assert.match((await h.execute('qinghui_quest_add', { title: 'next' })).text, /next/);
});

test('pre-cancelled tools do not mutate durable state; unscoped calls are rejected', async t => {
  const h = await setup(t);
  const controller = new AbortController();
  const reason = new Error('user cancelled');
  controller.abort(reason);
  await assert.rejects(h.execute('qinghui_quest_add', { title: 'cancelled' }, 'session-A', controller.signal), error => error === reason);
  assert.doesNotMatch((await h.execute('qinghui_quest_list', {})).text, /cancelled/);
  await assert.rejects(h.ctx.tools.get('qinghui_quest_status')!.execute({}, { signal: new AbortController().signal } as ToolRunContext), { code: 'SESSION_REQUIRED' });
});

test('user titles remain literal Markdown data in add, list and completion output', async t => {
  const h = await setup(t);
  const added = await h.execute('qinghui_quest_add', { title: '![x](https://example.com/pixel)', difficulty: 'easy' });
  const listed = await h.execute('qinghui_quest_list', {});
  const completed = await h.execute('qinghui_quest_complete', { quest_id: idOf(added.text) });
  for (const result of [added, listed, completed]) {
    assert.ok(result.text.includes('\\!\\[x\\]\\(https://example\\.com/pixel\\)'));
    assert.ok(!result.text.includes('![x]('));
  }
  const stored = h.ctx.storageDomain.get('dsh_quest_log')!.table('boards').get(plugin.sessionKey('session-A')) as { recent: Array<{ title: string }> };
  assert.equal(stored.recent[0].title, '![x](https://example.com/pixel)');
});

test('malformed storage is rejected without overwriting the damaged file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-quest-corrupt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(Storage).await();
  await ctx.plugin(json, { root }).await();
  await ctx.plugin(domains, { backend: 'json' }).await();
  const target = join(root, 'dsh_quest_log.json');
  await writeFile(target, '{invalid-but-must-stay');
  await assert.rejects(ctx.storage.domain.open(plugin.questDomain), { code: 'malformed-medium' });
  assert.equal(await readFile(target, 'utf8'), '{invalid-but-must-stay');
});

test('invalid stored progress fails schema validation instead of granting forged XP', async t => {
  const h = await setup(t);
  await h.execute('qinghui_quest_add', { title: 'valid task' });
  await h.ctx.fiber.dispose();
  const target = join(h.root, 'dsh_quest_log.json');
  const document = JSON.parse(await readFile(target, 'utf8'));
  document.tables.boards[plugin.sessionKey('session-A')].xp = 999999;
  await writeFile(target, JSON.stringify(document));
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(Storage).await();
  await ctx.plugin(json, { root: h.root }).await();
  await ctx.plugin(domains, { backend: 'json' }).await();
  await assert.rejects(ctx.storage.domain.open(plugin.questDomain), { code: 'invalid-record' });
});
