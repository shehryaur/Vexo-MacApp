# Vexo Mac App (T3 Code Hybrid)

A hybrid local agent control plane built by **forking [T3 Code](https://github.com/pingdotgg/t3code)** and **reverse-engineering the Vexo AI (YC Fall 2026) Mac App**.

## What it does

- **Wearable to Local Agents:** Route *"Hey Vexo"* voice instructions and notes from your Vexo band directly to local CLI agents running on your MacBook.
- **Lid-Closed Operation:** Keeps running background tasks, coding agents, and reminders even when your MacBook lid is closed.
- **Local CLI Control:** Directly orchestrates Claude Code, Codex, Cursor, Antigravity, and local terminal workflows without cloud proxying.
- **Integrated Surfaces:** Multi-tab workspace with built-in Browser, Terminal, Git Diff, and Device preview panels.

## Quick Start

```bash
# 1. Clone & enter
git clone https://github.com/shehryaur/Vexo-MacApp.git
cd Vexo-MacApp

# 2. Install dependencies
pnpm install

# 3. Launch desktop app
pnpm dev:desktop
```

*Requires macOS, Node.js 20+, and pnpm.*

## License

[MIT](./LICENSE)
