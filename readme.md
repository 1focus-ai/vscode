# 1Focus VSCode extension

## Setup

1. Install [Task](https://taskfile.dev/docs/installation).
2. Run `task setup` and wait until it prints `✔️ you are setup`.

The setup task verifies that `node`, `pnpm`, and the [`f` CLI](https://github.com/1focus-ai/f) are in your `PATH`, installs dependencies with `pnpm install`, and runs `pnpm build` so you know the toolchain works end-to-end.

## Commands

- `1Focus: Commit & Push` - runs `f commitPush` inside the current workspace.
- `1Focus: Focus Last Window` (macOS only) - jumps back to the most recently focused Cursor or VS Code window whose workspace title does **not** end with `.`. This feature stores focus history in `~/Library/Application Support/1focus/window-focus.db` using the system `sqlite3` CLI and requires Cursor/VS Code to be allowed under _System Settings → Privacy & Security → Accessibility_ so the extension can raise the target window.
- `1Focus: Log Window` (macOS only) - forces a one-off focus log and surfaces any setup errors immediately; handy for confirming the SQLite DB gets created.
- `1Focus: Log Current Window` (macOS only) - writes the currently focused Cursor or VS Code window info into `~/Library/Application Support/1focus/window-focus.db`, making it easy to seed focus history before using Focus Last Window.

All commands log into the `1Focus` output channel (View → Output → 1Focus), so you can inspect focus tracking entries or diagnose window switching issues. Run `task` to see all available `task` aliases.

## Install in Cursor

Run `task deploy`. This should install the extension in Cursor (works on my machine).

## Notes

Started of [this template](https://github.com/jinghaihan/starter-vscode).

## Contributing

Any PR to improve is welcome. [codex](https://github.com/openai/codex) & [cursor](https://cursor.com) are nice for dev. Great **working** & **useful** patches are most appreciated (ideally). Issues with bugs or ideas are welcome too.
