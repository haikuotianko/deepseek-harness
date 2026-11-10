# Desktop startup: first window waits ~6 s for the Host; app-boot spends ~0.5–0.9 s on already-exposed internals

**Summary (EN):** On Windows 11, the installed Desktop app shows its first window at 6.6–7.7 s. The shared loading page renderer starts at 0.57–0.72 s and the Host process spawns at 0.91–1.03 s, but the window is only shown after backend readiness and the welcome/credential decision. Separately, `app-boot` reads five Node internals through `node-addon-require-builtin` even though the Desktop Host already passes `--expose-internals`; `requireBuiltin` is the largest self-time entry in the Host startup CPU profile (917 ms), while a direct benchmark of the resolver path is 1–2 ms with the flag vs 534–544 ms without it.

## Environment

Windows 11 build 26200, Intel Core i7-8750H (6C/12T), NTFS fixed volumes.
DeepSeek Harness 0.2.2-rc.1, Electron 44.7.0 / Node 24.21.0, base commit `fcc0ad4`.
Profile: 6 bundles with external plugins. All numbers are warm starts.

## Installed app timeline (3 runs)

| run | renderer | Host spawn | Host listen | first window |
|:--|--:|--:|--:|--:|
| 1 | 717 ms | 1,034 ms | 6,432 ms | 7,715 ms |
| 2 | 579 ms | 993 ms | 5,327 ms | 6,712 ms |
| 3 | 569 ms | 909 ms | 5,254 ms | 6,628 ms |

The loading page renderer exists at ~0.6 s, but the window stays hidden for ~6 s.

## Host boot (standalone Host, same launch arguments)

| profile | run 1 | run 2 |
|:--|--:|--:|
| core bundles only | 2,309 ms | 2,260 ms |
| real profile with plugins | 3,737 ms | 3,773 ms |

External plugins add ~1.5 s. Even with no external plugins, the core Host still needs ~2.26 s, and the window still waits for it.

## CPU profile (Host startup, real profile)

| self time | function |
|--:|:--|
| **917 ms** | `requireBuiltin` (`node-addon-native-custom-loader`) |
| 335 ms | `compileSourceTextModule` |
| 296 ms | `spawnSync` |
| 141 ms | `getOrCreateArchive` |

## Direct benchmark of the resolver path

Electron Node mode, 3 runs each:

| path | time |
|:--|--:|
| `--expose-internals` present, direct `require(id)` | 1–2 ms |
| no flag, `node-addon-require-builtin` | 534–544 ms |

## Code path

- `apps/desktop/src/main.ts:1296` creates the main window with `show: false`.
- `apps/desktop/src/main.ts:671` `reconcileBackend()` awaits `backend.start(...)` at `:674` without showing the window.
- `apps/desktop/src/main.ts:1343` `enterWorkspace()` calls `window.show()` at `:1348`.
- `apps/desktop/src/main.ts:1366` `showWelcome()` is the other visible entry.
- `apps/desktop/src/main.ts:1427` `openInitialWindow()` reads credentials/locale after Host ready, then chooses welcome or workspace.
- `apps/desktop/src/host-process.ts:213` already passes `--expose-internals`.
- `packages/boot/app-boot/src/profile-resolution/resolver.ts:735–746` still calls `addon.requireBuiltin(...)` five times.

## First-window A/B (development build, same binary)

| build | first window | Host spawn | Host listen |
|:--|--:|--:|--:|
| show the loaded page before `backend.start` | **430 ms** | 558 ms | 1,556 ms |
| baseline | **2,874 ms** | 457 ms | 1,365 ms |

The development profile is core-only, so its baseline is faster than the installed app; the mechanism is identical.

## Proposed fixes

1. Show the already loaded shared loading page after the document loads, before `backend.start`; keep the workspace unmounted until boot injections and credential checks.
2. Prefer direct Node internals when `--expose-internals` is present, with the addon as fallback, matching the vendored Loader and HMR lookup.

Reference implementations (fork; upstream PRs are disabled): `https://github.com/haikuotianko/deepseek-harness/pull/1` and `https://github.com/haikuotianko/deepseek-harness/pull/2`.

Full logs, raw CPU profile, scripts, and the detailed report: [evidence branch](https://github.com/haikuotianko/deepseek-harness/tree/evidence/desktop-startup/.artifacts/desktop-startup-evidence).
