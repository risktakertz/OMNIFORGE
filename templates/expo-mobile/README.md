# expo-mobile template

Restaurant ordering app starter: Expo (React Native + TypeScript), FlatList
menu, tap-to-add order cart, honest "demo only — no real checkout" footer.

## Honest toolchain requirements

- `npm install && npm start` runs Metro; you can preview in a browser, Android
  emulator, or physical device via Expo Go.
- **Native builds** require the Android SDK (local) or EAS Build (a paid cloud
  service). `omniforge doctor` reports toolchain status truthfully; CI never
  claims device-test success it cannot run.
- App Store / Play Store publishing needs developer accounts and signing — a
  separately approved milestone.

```bash
npm install
npm start        # then scan the QR with Expo Go, or press w for web
npm test         # structural checks (no device required)
```

Customize `App.tsx` (menu is fixture data) and `app.json` (name, slug,
bundle/package identifiers before any store submission).
