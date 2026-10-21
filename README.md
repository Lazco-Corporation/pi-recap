<div align="center">

# pi-recap

Pi extension: `/recap` and `/summary` show where the conversation stands, in a popup, without adding to the session.

[![npm](https://img.shields.io/npm/v/@lazco/pi-recap)](https://www.npmjs.com/package/@lazco/pi-recap) [![License](https://img.shields.io/npm/l/@lazco/pi-recap)](LICENSE)

<img src="https://lazco-public-15298932ec.pub.t4.txg1.lazco.cloud/pi-recap/recap.gif" width="720" alt="In a pi session, the user types /recap. A popup opens with three lines: Goal, Now, and Your turn.">

[Demo video](#demo-video) · [Installation](#installation) · [Usage](#usage) · [Settings](#settings) · [Limitations](#limitations)

</div>

## Highlights

- **Two views.** [`/recap`](#recap) shows 3 lines at most. [`/summary`](#summary) writes a handoff record in 6 sections.
- **Zero tokens in the session.** A separate model call writes the text, and only the popup shows it.
- **One key to copy.** Press `c` to copy the result as Markdown, for a pull request, an issue, or a handoff note.
- **Your choice of model.** A [setting](#settings) sends the call to a smaller, cheaper model.
- **Instructions per run.** Text after the command adds instructions for one run, for example `/recap focus on git changes`.

## Demo video

The 60-second video shows the install, `/recap`, `/summary`, the copy key, and the `model` setting.
Click the image to play the video.

<a href="https://lazco-public-15298932ec.pub.t4.txg1.lazco.cloud/pi-recap/Demo.mp4"><img src="https://lazco-public-15298932ec.pub.t4.txg1.lazco.cloud/pi-recap/demo-poster.png" width="720" alt="The first frame of the demo video. The /recap popup shows the lines Goal, Now, and Your turn over a pi session."></a>

## Installation

You need [pi](https://github.com/earendil-works/pi) and Node.js 22.19.0 or later.

```sh
pi install npm:@lazco/pi-recap
```

Then run `/reload` in pi.
To check the install, run `pi list`.
The list of user packages shows `npm:@lazco/pi-recap`.

## Usage

In a pi session that has messages, type one of the two commands:

| Command | Use it when | The popup shows |
| --- | --- | --- |
| [`/recap`](#recap) | You come back to a session and do not remember where you were. | Goal, Now, Your turn |
| [`/summary`](#summary) | You hand work to another person or session, or write a pull request or an issue. | 6 sections, from the goal to the next steps |

A popup opens over the chat.
While the model reads the conversation, a spinner shows how many messages it reads.
If the model shows its thinking, the newest line of it shows under the spinner.
The text shows as the model writes it.
Press `Esc` to close the popup.
If the model still writes, `Esc` also stops it.
The text does not go into the session.

The text uses the language of your newest message.
To set a fixed language, use the [`language`](#settings) setting.

### `/recap`

The popup shows text like this:

> **Goal:** Add rate limiting to `POST /api/login` to stop brute-force attempts.
>
> **Now:** The agent added `src/middleware/rateLimit.ts` with a `Retry-After` header, and all 42 tests pass.
>
> **Your turn:** Pick the limit: 5 or 10 tries per minute per IP.

- **Goal:** what you want.
- **Now:** what the agent did last, or what it does now.
- **Your turn:** what waits on you: a question that you did not answer, or a step that the agent asked you to do or confirm. The model leaves out this line when nothing waits.

### `/summary`

<img src="https://lazco-public-15298932ec.pub.t4.txg1.lazco.cloud/pi-recap/summary.png" width="720" alt="The /summary popup shows the sections Goal, Decisions, Done, and Current state, with a scroll bar and the key hints.">

The record has these sections, in this order:

1. **Goal**
2. **Decisions**, each with its reason
3. **Done**
4. **Current state**
5. **Open questions**, including steps that wait on you and risks that the agent warned about
6. **Next steps**

The model leaves out a section that has nothing to say.

### Popup keys

| Key | Action |
| --- | --- |
| `↑` `↓` `j` `k`, mouse wheel | Scroll one line |
| `PgUp` `PgDn` `Space` | Scroll one page |
| `Home` `End` `g` `G` | Go to the top or the bottom |
| `c` | Copy the text as Markdown, after the model finishes |
| `Esc` `Enter` `q` | Close the popup |

`Esc` during loading also stops the model call.
The top right corner of the popup shows the name of the model that wrote the text.

### Warnings

A warning at the top of the popup tells you what the model did not get, so you can tell a thin result from a thin conversation.
The popup shows a warning when:

- the conversation is larger than `maxInputChars`, with the count of older messages that are left out and the count of older user messages that stay
- a message is longer than 20000 characters, so the model gets only its start and its end
- a user message contains an image, which the model does not see
- the configured model is not available, so the session model wrote the text
- a custom prompt has a placeholder that nothing fills
- the model stopped at its output limit, so the text can end early

There is no warning when the model shows no thinking.

### RPC mode

In [RPC mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md), there is no popup.
Send the command as a `prompt` command, for example `{"type": "prompt", "message": "/recap"}`.
The client gets `notify` records of the type `extension_ui_request`, in this order:

1. `Reading <N> messages with <model-id>…`, with `notifyType` `"info"`.
2. Each [warning](#warnings), with `notifyType` `"warning"`. The output limit warning comes after the model call instead.
3. The text as Markdown, with `notifyType` `"info"`. If the model call fails, the error, with `notifyType` `"error"`.

The `prompt` response, with `disposition` `"handled"`, comes after the last record.
The RPC `abort` command does not stop the model call.

## Settings

The settings file is `~/.pi/agent/recap.json`.
The file is optional.
Each command run reads the file again, so an edit applies without `/reload`.

This example sends the call to a smaller model and sets the output language:

```json
{
  "model": "anthropic/claude-haiku-4-5",
  "language": "English"
}
```

### Model and output

| Field | Default | Value |
| --- | --- | --- |
| `model` | `null` | `"<provider>/<model-id>"`, or `null` for the session model |
| `thinking` | `null` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` for both commands, or `null` for `low` in `/recap` and `medium` in `/summary` |
| `maxInputChars` | `240000` | The max size of the conversation text, from 1000 to 2000000 |
| `language` | `null` | The output language, for example `"Traditional Chinese"`, or `null` to match your messages |

If pi cannot find the `model`, or the model has no API key, the command uses the session model and shows a warning.

A small, fast model is enough for both commands.
In our tests on 8 real sessions, Gemini 3.8 Flash and Claude Haiku 5.5 both gave usable results in 5 to 25 seconds.
Gemini 3.8 Flash made fewer errors about the latest state, so it is the better default when you set a model.

### Prompts

All prompt fields default to `null`.

| Field | Value |
| --- | --- |
| `appendPrompt` | Extra instructions for both commands |
| `recapAppendPrompt` | Extra instructions for `/recap` only |
| `summaryAppendPrompt` | Extra instructions for `/summary` only |
| `recapPrompt` | A full custom prompt for `/recap` |
| `summaryPrompt` | A full custom prompt for `/summary` |

To write a custom prompt, see [docs/custom-prompts.md](docs/custom-prompts.md).

If the file has bad JSON or a bad field, the command shows an error and stops.

## Limitations

- **No print or JSON mode.** These modes have no UI, so the commands do nothing.
- **Text only.** The model reads your messages and the text of the agent replies. It does not read tool calls, tool results, thinking, or images. A detail that is only in a tool result can be missing from the result.
- **Progress notes are dropped.** When the agent writes several messages in one turn, its short messages before the last one, such as "Now I run the tests", are left out. A message of 300 characters or more stays, so a report followed by a short notice is not lost. The turn after your newest message is kept whole.
- **Skills show as commands.** A skill run shows to the model as the command that you typed, for example `/skill:<name> <args>`.
- **No unfinished replies.** While the agent works, its unfinished reply is not in the conversation. The recap then only says what the agent works on.
- **Long conversations are cut.** Past `maxInputChars`, the model gets the first user message, the newest messages, and from the part between them only your messages, each cut to 1000 characters. The agent replies in that part are left out, so the reasons behind the decisions there can be missing from the summary. Raise `maxInputChars` when the warning shows. A message longer than 20000 characters keeps only its start and its end.
- **Each run costs tokens.** Each run is a new model call with no prompt cache.
- **Nothing is saved.** Press `c` before you close the popup to keep the text.

## Contributing

To report a bug or ask a question, open an issue on [GitHub](https://github.com/Lazco-Corporation/pi-recap/issues).
The build, test, and release steps are in [AGENTS.md](AGENTS.md).

## License

[AGPL-3.0-or-later](LICENSE)
