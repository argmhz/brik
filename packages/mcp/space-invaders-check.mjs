import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../examples/space-invaders/', import.meta.url));
const client = new Client({ name: 'space-invaders-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('./src/server.mjs', import.meta.url))],
  env: { ...process.env, BRIK_MCP_PORT: '5198' }, stderr: 'inherit' }));
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find(c => c.type === 'text')?.text;
  if (result.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}
try {
  await call('open_project', { path: root });
  const atlas = await call('draw_sprites', {
    path: 'assets/invaders.png', scale: 2,
    palette: { w: '#ffffff' },
    sprites: {
      ship: ['.......ww.......','.......ww.......','......wwww......','......wwww......','..wwwwwwwwwwww..','.wwwwwwwwwwwwww.','wwwwwwwwwwwwwwww','wwwwwwwwwwwwwwww','wwwwwwwwwwwwwwww','wwww........wwww','ww............ww','................'],
      alienA: ['....w......w....','.....w....w.....','....wwwwwwww....','...ww.wwww.ww...','..wwwwwwwwwwww..','..w.wwwwwwww.w..','..w.w......w.w..','.....ww..ww.....','....ww....ww....','...ww......ww...','................','................'],
      alienB: ['......wwww......','....wwwwwwww....','...wwwwwwwwww...','..www..ww..www..','..wwwwwwwwwwww..','.....wwwwww.....','....ww.ww.ww....','...ww......ww...','..ww........ww..','...ww......ww...','................','................']
    }
  });
  console.log('Atlas:', JSON.stringify(atlas));
  const info = await call('project_info');
  console.log('Project:', JSON.stringify(info));
  const existing = await call('get_hierarchy');
  if (!existing.length) {
    await call('create_entity', { kind: 'camera', name: 'Main Camera', components: { Camera2D: { zoom: 1, clearColor: { r: .015, g: .025, b: .065, a: 1 } } } });
    await call('create_entity', { kind: 'text', name: 'Preview', components: { Text2D: { text: 'SPACE INVADERS\n\nTryk Play\n\n← →  flyt     MELLEMRUM  skyd', size: 24, font: 'monospace', color: { r: .25, g: .95, b: 1, a: 1 } } } });
    const source = await readFile(root + 'scripts/Invaders.ts', 'utf8');
    const compiled = await call('write_script', { path: 'scripts/Invaders.ts', content: source });
    assert.equal(compiled.status, 'ok', JSON.stringify(compiled));
    const game = await call('create_entity', { name: 'Game' });
    await call('attach_script', { id: game.id, script: 'Invaders' });
    await call('set_script_field', { id: game.id, script: 'Invaders', key: 'texture', value: atlas.guid });
    await call('save_scene');
  }
  const [game] = await call('find_entities', { name: 'Game' });
  const state = async () => (await call('inspect_entity', { id: game.id })).scripts[0].live;
  await call('play');
  await call('step', { frames: 1 });
  assert.equal((await call('find_entities', { name: 'Invader' })).length, 36);
  const initialBlocks = (await call('find_entities', { name: 'Bunker' })).length;
  const [player] = await call('find_entities', { name: 'Player' });
  const x = async () => (await call('inspect_entity', { id: player.id })).components.Transform2D.position.x;
  const start = await x();
  await call('step', { frames: 30, hold: ['ArrowRight'] });
  assert.ok(await x() > start + 100, 'Player moves');
  await call('step', { frames: 300, hold: ['Space'] });
  const firing = await state();
  assert.ok(firing.shotsFired > 10, 'Held Space repeats shots');
  assert.ok(firing.kills > 0 && firing.score > 0, 'Shots destroy aliens and score points');
  await call('step', { frames: 1, press: ['KeyP'] });
  const before = await x();
  await call('step', { frames: 60, hold: ['ArrowLeft', 'Space'] });
  assert.equal(await x(), before, 'Pause freezes gameplay');
  await call('step', { frames: 1, press: ['KeyP'] });
  await call('step', { frames: 600, hold: ['ArrowRight'] });
  assert.ok(await x() <= 300, 'Player stays inside arena');
  for (let i = 0; i < 30 && !(await state()).gameOver; i++) await call('step', { frames: 600 });
  assert.equal((await state()).gameOver, true, 'Invasion ends game');
  assert.ok((await call('find_entities', { name: 'Bunker' })).length < initialBlocks, 'Bunkers erode during combat');
  await call('step', { frames: 1, press: ['Enter'] });
  const reset = await state();
  assert.equal(reset.gameOver, false); assert.equal(reset.lives, 3); assert.equal(reset.score, 0);
  assert.equal((await call('find_entities', { name: 'Invader' })).length, 36);
  const errors = await call('get_console', { level: 'error' });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('PASS: movement, bounds, shooting, kills, score, pause, bunker erosion, game over, restart.');
  await call('stop');
  await call('close_project');
} finally { await client.close(); }

// Reproduce the last hit of a wave in an isolated running engine.
// This fixture avoids making the integration check depend on a random full playthrough.
const { HeadlessSession } = await import('./src/headless.mjs');
const session = await HeadlessSession.open(root);
try {
  await session.call('play');
  await session.call('step', { frames: 1 });
  const { BehaviourRuntime, Name } = globalThis.__brik;
  const world = session.project.editor.world;
  const e = [...world.query([Name])].find(e => world.store(Name).value[e] === 'Game');
  const game = world.resource(BehaviourRuntime).instance(e, 0);
  for (const enemy of game.enemies.slice(1)) game.retire(enemy);
  game.enemies = game.enemies.slice(0, 1);
  game.enemyTimer = 999;
  game.invincible = 999;
  const last = game.enemies[0];
  const shot = game.body('Wave test shot', last.x, last.y - 20, 4, 16);
  shot.vy = 530;
  game.shots.push(shot);
  await session.call('step', { frames: 1 });
  assert.equal(game.enemies.length, 0, 'Last shot clears formation');
  await session.call('step', { frames: 120 });
  assert.equal(game.wave, 2, 'Next wave begins after intermission');
  assert.equal(game.enemies.length, 36, 'Next wave has a complete formation');
  console.log('PASS: final kill, wave intermission, next wave.');
  await session.call('stop');
} finally { session.close(); }
