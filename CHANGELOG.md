# Changelog

All releases of `@lazco/pi-recap` are in this file.
The newest release is at the top.

## [Unreleased]

### Added

- In fullscreen mode, drag the mouse over the popup text to select it.
  When you let go, the popup copies only the selected text, without the frame and without the chat behind the popup.

### Fixed

- A question in the popup now stands apart from the text above it.
  A line sets the questions apart from the result, and each question shows after a `›` marker in bold.
  Before, some themes showed the question almost like the answer.

## [0.4.0] - 2026-10-24

### Added

- After the result, press `Tab` to ask a question about the session in the popup.
  The answer shows under the question, and you can ask more questions.
  The model gets the conversation with the tool calls of the agent and their results cut short, the result that you read, and the earlier questions and answers.
  `Esc` stops an answer, and the next question can go out after it.
  The questions and the answers do not go into the session.
- A warning under the first question shows how many tool calls lost their result or are left out to fit `maxInputChars`.

### Changed

- `c` copies the newest answer, or the result when there is no answer yet.

## [0.3.0] - 2026-10-21

### Added

- The popup shows the text while the model writes it, with a spinner under it until the model ends.
  `Esc` stops the model while it writes.
  `c` copies after the model ends.
- While the model reads, the spinner shows how many messages the model gets, and the newest line of the model's thinking when it shows one.
- A warning at the top of the popup tells you what the model did not get: older messages past `maxInputChars`, messages longer than 20000 characters, your messages with images, a model that stood in for the configured one, a placeholder in a custom prompt that nothing fills, or a text that stopped at the output limit.
  In RPC mode, each warning is a `notify` record.

### Changed

- `/recap` and `/summary` report the latest state of the work.
  The prompt tells the model that a later message can finish or cancel an earlier one, to check later messages before it lists an open item, and to call work done only when a message says so.
- **Your turn** and **Open questions** also cover steps that the agent asked you to do or confirm, risks that it warned about, and small items such as a step to retry or a pull request that waits for review.
- When the agent is still working, the recap treats what your newest message asked for as work in progress, not as open items.
- The `thinking` setting defaults to `null`.
  Then `/recap` runs at `low` and `/summary` runs at `medium`.
  A set value still applies to both commands.
  With a session or configured model that has no `thinking` setting, `/summary` is slower than before and costs more, because it thinks more.
- The conversation text that the model reads follows new rules.
  Progress notes are left out: when the agent writes several messages in one turn, its messages under 300 characters before the last one do not go in, and the turn after your newest message is kept whole.
  A message keeps up to 20000 characters before it is cut in the middle, up from 8000, so a long agent report with tables stays whole.
  `maxInputChars` defaults to `240000`, up from `120000`, because past the budget the middle of the chat is left out and the decisions in it are missing from the summary.
  Past the budget, your messages from the part that is left out still go in, each cut to 1000 characters and within a quarter of the budget, so the model sees what you asked for and decided there.

### Fixed

- With the `language` setting, the recap labels and the summary headings are in that language.
  Before this fix, a small model often kept the English labels **Goal**, **Now**, and **Your turn**, or the English section headings.

### Docs

- The README has a section on what the model reads, and advice on the model and thinking level.
- `docs/evaluation.md` records the tests behind the prompt and the defaults.

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

[0.4.0]: https://github.com/Lazco-Corporation/pi-recap/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Lazco-Corporation/pi-recap/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Lazco-Corporation/pi-recap/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Lazco-Corporation/pi-recap/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Lazco-Corporation/pi-recap/releases/tag/v0.1.0
