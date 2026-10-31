# tauri-desktop template

Lightweight desktop app starter on **Tauri 2**: a small note-taking UI
(`ui/index.html`) plus a minimal Rust shell (`src-tauri`). CSP is locked to
`default-src 'self'` and no external scripts — a deliberately small security
surface.

## Honest toolchain requirements

- Building requires the Rust toolchain plus platform webviews/SDKs
  (`omniforge doctor` reports what exists).
- **Signed installers are a separate approved milestone** — code-signing
  certificates cost money and are account-bound.

```bash
npm test                                   # structure checks (no toolchain)
cd src-tauri && cargo tauri dev            # requires tauri-cli + Rust
```

Extend with Tauri commands (fs, notifications, tray) as features justify them.
