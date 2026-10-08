# Changelog

All releases of `@lazco/pi-recap` are in this file.
The newest release is at the top.

## [0.2.1] - 2026-10-08

### Fixed

- The popup shows `**bold**` and `*italic*` next to CJK punctuation, for example `**目標：**你想` and `這是**「重點」**文字`.
  Before this fix, the popup showed the raw `**` stars.
  The popup follows the CJK-friendly amendment to CommonMark, so English text such as `**English:**text` keeps the CommonMark result.

## [0.2.0] - 2026-10-08

### Added

- `/recap` and `/summary` work in RPC mode. The client gets the result as `notify` requests, not as a popup.
- The pi package manifest has a preview image and a demo video.

### Docs

- The README has a new structure and a new "RPC mode" section.
- The new guide `docs/custom-prompts.md` tells how to write a custom prompt.

> [!WARNING]
> In RPC mode, you cannot stop the model call.
> RPC has no Esc key, and the RPC `abort` command does not stop the call.

## [0.1.0] - 2026-10-03

This is the first release.

### Added

- `/recap` shows the goal, the last step, and the open question, in three lines.
- `/summary` shows a full record in six sections, from the goal to the next steps.
- The result shows in a popup. You can scroll it and press `c` to copy the text as Markdown.
- The settings file `~/.pi/agent/recap.json` sets the model, the thinking level, the input size, the language, and the prompts.
- Text after the command adds instructions for one run, for example `/recap focus on git changes`.

[0.2.1]: https://github.com/Lazco-Corporation/pi-recap/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Lazco-Corporation/pi-recap/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Lazco-Corporation/pi-recap/releases/tag/v0.1.0
