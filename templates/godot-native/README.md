# godot-native template

Minimal, original Godot 4 project: a 3D scene with a ground plane, lighting, and
a `CharacterBody3D` player implementing WASD/arrow movement with gravity — the
honest core of an "adventure" milestone, extensible with levels, enemies and
quests.

## Honest toolchain requirements

Running, headless validation and native/web **export require the Godot editor
or binary locally** (`omniforge doctor` reports whether `godot` is installed).
Without it, this template's structural tests still run in Node and the engine
status is reported as **blocked — not simulated**.

```bash
npm test                 # structure + logic checks (Node)
godot --path .           # open/run in the Godot editor when installed
godot --headless --path . --quit   # headless smoke when installed
```

Customize: rename `config/name` in `project.godot`, extend `scenes/main.tscn`,
and build gameplay on top of `scripts/player.gd`.
