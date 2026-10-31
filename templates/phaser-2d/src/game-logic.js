/**
 * Pure game rules — no Phaser, no DOM. Fully unit-testable in Node.
 * The scene in game.js consumes these functions; tests assert the rules.
 */

export const WORLD = { width: 640, height: 400 };

export function createPlayer() {
  return { x: WORLD.width / 2, y: WORLD.height / 2, vx: 0, vy: 0, speed: 220, alive: true };
}

export function applyInput(player, input, dt) {
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const p = { ...player };
  p.vx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  p.vy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  p.x = clamp(p.x + p.vx * p.speed * dt, 16, WORLD.width - 16);
  p.y = clamp(p.y + p.vy * p.speed * dt, 16, WORLD.height - 16);
  return p;
}

export function spawnObstacles(count, rand = Math.random) {
  const obstacles = [];
  for (let i = 0; i < count; i++) {
    obstacles.push({
      id: `o${i}`,
      x: 40 + rand() * (WORLD.width - 80),
      y: 40 + rand() * (WORLD.height - 80),
      r: 12 + Math.floor(rand() * 10),
    });
  }
  return obstacles;
}

export function checkCollision(player, obstacles) {
  for (const o of obstacles) {
    const dx = player.x - o.x;
    const dy = player.y - o.y;
    if (Math.sqrt(dx * dx + dy * dy) < o.r + 14) return { hit: true, obstacle: o };
  }
  return { hit: false, obstacle: null };
}

export function updateScore(state, dt, starCollected) {
  // callers only invoke this while the player is alive
  const next = {
    score: state.score + dt,
    stars: state.stars + (starCollected ? 1 : 0),
    best: Math.max(state.best, state.score + dt + (starCollected ? 1 : 0)),
  };
  next.score = Math.round(next.score * 100) / 100;
  return next;
}

export function gameState() {
  return { score: 0, stars: 0, best: 0 };
}

export function resetGame(state) {
  return { score: 0, stars: 0, best: state.best };
}

export function isGameOver(player, obstacles) {
  return checkCollision(player, obstacles).hit;
}
