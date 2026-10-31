// Phaser scene — consumes the pure rules in game-logic.js (tested in Node).
import {
  WORLD, createPlayer, applyInput, spawnObstacles, checkCollision,
  updateScore, gameState, resetGame, isGameOver,
} from "./game-logic.js";

const configEl = document.getElementById("game-config");
const cfg = configEl ? JSON.parse(configEl.textContent) : { title: "Star Dash", obstacleCount: 7 };

function boot(Phaser) {
  window.__GAME_STARTED__ = true;
  let player, obstacles, stars, scoreText, state = gameState();
  const input = { left: false, right: false, up: false, down: false };

  new Phaser.Game({
    type: Phaser.AUTO,
    width: WORLD.width,
    height: WORLD.height,
    parent: "game",
    backgroundColor: "#e7f5f3",
    scene: {
      create() {
        player = this.add.circle(createPlayer().x, createPlayer().y, 14, 0x0f766e);
        player.body = { x: player.x, y: player.y };
        obstacles = spawnObstacles(cfg.obstacleCount ?? 7);
        obstacles.forEach((o) => this.add.circle(o.x, o.y, o.r, 0xf59e0b));
        stars = this.add.group();
        this.time.addEvent({ delay: 3000, loop: true, callback: () => {
          const s = this.add.circle(40 + Math.random() * (WORLD.width - 80), 40 + Math.random() * (WORLD.height - 80), 9, 0x7c3aed);
          stars.add(s);
        } });
        scoreText = this.add.text(12, 10, "", { fontSize: "18px", color: "#1c1917" });
        const keyMap = { LEFT: "left", A: "left", RIGHT: "right", D: "right", UP: "up", W: "up", DOWN: "down", S: "down" };
        Object.entries(keyMap).forEach(([key, dir]) => {
          const kb = this.input.keyboard.addKey(key, true, false);
          kb.on("down", () => (input[dir] = true));
          kb.on("up", () => (input[dir] = false));
        });
        this.input.keyboard.on("keydown-SPACE", () => {
          if (!state.score === false && !player.alive) {
            state = resetGame(state);
            player.alive = true;
            player.x = WORLD.width / 2;
            player.y = WORLD.height / 2;
          }
        });
      },
      update(time, delta) {
        if (!player || !player.alive) return;
        const dt = Math.min(delta / 1000, 0.05);
        const moved = applyInput({ x: player.x, y: player.y, speed: 220, alive: true, vx: 0, vy: 0 }, input, dt);
        player.x = moved.x;
        player.y = moved.y;
        const body = { x: player.x, y: player.y, alive: true };
        if (isGameOver(body, obstacles)) {
          player.alive = false;
          scoreText.setText(`Crashed! Score ${state.score.toFixed(1)} + ${state.stars}★\nPress SPACE to restart`);
          return;
        }
        let collected = false;
        stars.children.iterate((s) => {
          if (s && Math.hypot(s.x - player.x, s.y - player.y) < 23) {
            s.destroy();
            stars.remove(s, true, true);
            collected = true;
          }
        });
        state = updateScore(state, dt, collected);
        scoreText.setText(`Score ${state.score.toFixed(1)}  ★ ${state.stars}  Best ${state.best.toFixed(1)}`);
      },
    },
  });
}

if (window.Phaser) {
  boot(window.Phaser);
} else {
  // Phaser loaded from CDN; if it failed, index.html shows the honest fallback.
  window.addEventListener("phaser-loaded", () => boot(window.Phaser));
}
