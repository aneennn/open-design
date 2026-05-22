# apps/launcher

Follow the root `AGENTS.md` and `apps/AGENTS.md` first. This app owns the native stable launcher experiment.

## Owns

- Channel/namespace-scoped launcher path layout.
- Launcher state contracts for `current`, `pending`, and `previous` payload pointers.
- Native stable-entry process startup primitives that are independent of the product runtime being launched.
- Build-time Windows executable resource metadata, including the launcher icon.

## Does not own

- Electron desktop runtime behavior.
- Daemon/web sidecar startup internals.
- Product updater UI.
- Release feed selection or artifact download logic.
- Installer registry writes or NSIS script behavior.

## Rules

- Keep the launcher payload-agnostic. A payload is described by a manifest and an entry command; the launcher must not special-case Electron, daemon, web, or Open Design business protocols.
- Keep platform-specific OS behavior in `crates/launcher-platform`.
- Keep state and manifest DTOs in `crates/launcher-core`.
- Windows launcher builds must embed an `.ico` through the `OD_LAUNCHER_WIN_ICON` build input, defaulting to `tools/pack/resources/win/icon.ico`.
