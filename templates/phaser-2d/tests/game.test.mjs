// Pure-logic game tests (Node, no browser needed).
import assert from "node:assert/strict";
import {
  WORLD, createPlayer, applyInput, spawnObstacles, checkCollision,
  updateScore, gameState, resetGame, isGameOver,
} from "../dist/game-logic.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const player = () => ({ x: WORLD.width / 2, y: WORLD.height / 2, speed: 220, alive: true, vx: 0, vy: 0 });

test("player movement respects input and bounds", () => {
  const p = applyInput(player(), { right: true, down: false, up: false, left: false }, 1);
  assert.ok(p.x > WORLD.width / 2);
  const edge = applyInput({ ...player(), x: WORLD.width - 16 }, { right: true }, 1);
  assert.equal(edge.x, WORLD.width - 16);
});

test("obstacles spawn inside the world", () => {
  const obs = spawnObstacles(20, () => 0.5);
  assert.equal(obs.length, 20);
  for (const o of obs) {
    assert.ok(o.x > 0 && o.x < WORLD.width && o.y > 0 && o.y < WORLD.height);
  }
});

test("collision detection hits only when close", () => {
  const p = { x: 100, y: 100 };
  const near = [{ x: 105, y: 105, r: 12 }];
  const far = [{ x: 300, y: 300, r: 12 }];
  assert.equal(checkCollision(p, near).hit, true);
  assert.equal(checkCollision(p, far).hit, false);
  assert.equal(isGameOver(p, near), true);
  assert.equal(isGameOver(p, far), false);
});

test("score accumulates with time and stars", () => {
  let s = gameState();
  s = updateScore(s, 1.5, false);
  s = updateScore(s, 1.0, true);
  assert.equal(s.stars, 1);
  assert.ok(Math.abs(s.score - 2.5) < 1e-9);
  assert.ok(s.best >= s.score);
});

test("reset keeps best score", () => {
  let s = gameState();
  s = updateScore(s, 3, true);
  const r = resetGame(s);
  assert.equal(r.score, 0);
  assert.equal(r.stars, 0);
  assert.equal(r.best, s.best);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL - ${name}: ${e.message}`);
  }
}
if (failed) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}
console.log(`${tests.length} game logic tests passed`);
