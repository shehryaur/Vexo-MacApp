# Vexo Mac App

Local Mac host for Vexo: desktop app, web UI, and the `@t3tools/vexo-mac` computer-use package (lease, screen, click/type, awake, band scan).

Built on the T3 Code monorepo layout. Clone, install, and run the desktop app on macOS.

## Requirements

- macOS
- Node.js and pnpm (see root `package.json` / toolchain docs)
- Xcode CLT for native helpers (Swift scripts under `packages/vexo-mac/scripts`)

## Setup

```bash
pnpm install
pnpm --filter @t3tools/desktop dev
```

Exact scripts may vary with the monorepo; use the desktop and web package scripts once dependencies are installed.

## What this is not

This repo does not include reverse-engineering captures, Ghidra projects, firmware dumps, or internal plan notes.
