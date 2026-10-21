# Evaluation

The prompt, the defaults, and the rules for the conversation text come from tests on real pi sessions.
This page records the method and the results, so a later change can be checked the same way.
The test harness and the sessions are not in the repository, because the sessions are private.

## Method

**Sessions.**
8 real sessions of one developer, from 4 messages and 2,700 characters to 760 messages and 137,000 characters.
4 sessions were used to tune the prompt.
4 were held out and only used to check the result: a medium one, a long one, one where the agent was still working on the newest message, and one in English with the `language` setting unset.

**Checklists.**
For each session and command, a list of 2 to 7 facts that the output must state, checked by hand against the transcript, such as the newest state, the step that waits on the user, and a warning that the agent gave.
Each list also holds 1 to 5 stale claims: things that a model tends to report as open after a later message finished them.

**Runs and grading.**
Each configuration ran 3 times per session and command.
A judge model (Claude Opus 5.5) graded each output against the checklist, without the transcript, as correct, missing, or wrong per fact, and triggered or clear per stale claim.
Each wrong verdict was checked by hand, and the two misjudgments found were removed.

**Metrics.**

- Error outputs: outputs with a wrong fact or a triggered stale claim.
- Missing facts: required facts that the output does not state.
- Language slips: English labels or headings in a Chinese output, or Chinese in an English output.
- Median seconds per call, seconds until the first visible text, and the cost at list prices.

**Models.**
Claude Haiku 5.5 and Gemini 3.8 Flash through one gateway.
Claude Opus 5.5 ran once on the first prompt as a reference.
Gemini 4 Argon ran once on the first prompt and was dropped: no wrong facts, but the slowest and about 5 times the cost of Gemini 3.8 Flash.

## Results with the final prompt and code

Per model and command, over the 8 sessions and 3 runs each.

| Model | Command | Error outputs | Missing facts | Median | First text |
| --- | --- | --- | --- | --- | --- |
| Gemini 3.8 Flash | `/recap` | 0 of 24 | 0 of 45 | 6.3 s | 5.0 s |
| Gemini 3.8 Flash | `/summary` | 0 of 24 | 5 of 132 | 20.6 s | 6.5 s |
| Claude Haiku 5.5 | `/recap` | 5 of 24 | 0 of 45 | 4.3 s | 2.7 s |
| Claude Haiku 5.5 | `/summary` | 6 of 24 | 2 of 132 | 20.2 s | 12.1 s |

For comparison, the first prompt gave Gemini 3.8 Flash 3 error outputs of 18 in `/recap` and 12 missing facts of 93 in `/summary`, and Claude Haiku 5.5 6 error outputs of 18 in `/summary` with English labels in 14 recaps of 18.
Claude Opus 5.5 on the first prompt had 0 error outputs and 1 missing fact, at about 20 times the cost of Claude Haiku 5.5.

Most of the Claude Haiku 5.5 errors are one kind: a step that a later message finished, reported as open.
See the thinking finding below.

## Findings and the decisions they set

### Thinking level

- Claude Haiku 5.5 in `/summary`: `off`, `minimal`, and `low` gave 6 to 7 error outputs of 24; `medium` gave 2 to 6; `high` gave 3 at twice the time (40 s median, 99 s max).
- Claude Haiku 5.5 picks for itself how much to think at `medium`. It skipped thinking in about half of the calls, and the errors sit in those calls. The extension cannot force it.
- Gemini 3.8 Flash: `low` and `medium` had the same errors. `medium` missed 4 facts of 132 and `low` 10, for about 5 seconds more.
- `/recap` at `low` had no more errors than at `medium` for either model, and was 1 to 3 seconds faster.

Decision: `thinking` defaults to `low` for `/recap` and `medium` for `/summary`.

### Prompt rules

- Rules that say to report the latest state, to check later messages before an item counts as open, and to call work done only when a message says so: Gemini 3.8 Flash missing facts fell from 14 to 5 of 84 on the tuning sessions. Claude Haiku 5.5 did not change at `low`.
- A rule that counts small items, such as a step to retry or a pull request that waits for review, as open questions: Gemini 3.8 Flash missing facts fell from 10 to 7, with no change for Claude Haiku 5.5.
- A rule that put every request in the newest agent message under open questions cut Gemini's missing facts further but made Claude Haiku 5.5 list finished steps as open in 3 outputs of 3 on one session. Rejected.
- A rule for shorter bullets cut the summary by a quarter and 1.7 seconds, but lost 2 facts of 132. Rejected.
- With the English labels `Goal`, `Now`, `Your turn` and the English section headings in the template, small models kept them in a Chinese output in up to 18 outputs of 18. The template now names the labels and headings in prose, and the slips went to 0 of 48 per model.
- When the agent still works, a status line that says the newest request is in progress cut the "waits on the user" errors of Gemini 3.8 Flash on that session from 1 of 3 to 0.

### Progress notes

- Agent messages that another agent message follows before the next user message are notes such as "Now I check the pods". Across 542 sessions on one machine they are 15,524 messages and a quarter of all text; half are under 100 characters and 95% under 350.
- Leaving them out: Gemini 3.8 Flash `/recap` errors fell from 2 to 0 and `/summary` missing facts from 7 to 4.
- But a full report that a short notice follows, such as a notice from a subagent, was lost too. On one session, 4 facts that only such a report held went from 6 to 11 correct of 12 to 0 of 12 for both models.
- With notes under 300 characters left out and longer ones kept, those facts came back to 8 and 9 of 12, and the other results did not change.

Decision: a note under 300 characters is left out.

### Budget and long sessions

- With the whole session, Claude Haiku 5.5 and Gemini 3.8 Flash stated 17 and 16 of 18 decisions from the middle of an 86,000-character session. With a budget of 40,000 characters, 9 and 6. With 20,000, 0 and 0. The facts about the latest state did not change.
- Across 542 sessions, 5 are larger than 120,000 characters after the notes are out, and 2 are larger than 240,000.

Decision: `maxInputChars` defaults to 240,000.

- Keeping the user messages of the cut part, each cut to 1,000 characters and within a quarter of the budget: on a session where the user made the decisions, at a 20,000 budget, Claude Haiku 5.5 stated 13 of 18 user decisions instead of 7, and Gemini 3.8 Flash 8 instead of 9. On a session where the agent made the decisions, the block pushed older agent replies out and cost 2 to 6 of 18 decisions at a 40,000 budget. On the two real sessions over 240,000 characters, the block is 0.1% and 1.8% of the budget.

Decision: the user messages of the cut part stay.

### Long messages

- Across 542 sessions, 81 messages are longer than 8,000 characters: 51 pasted by the user, 30 written by the agent. Most of the long agent messages are narration. One is an 11,700-character report with 7 headings and 42 table rows, and a cap of 8,000 cut its middle.
- A cap of 20,000 keeps every report seen whole, and no session crosses the budget because of it.

Decision: a message keeps up to 20,000 characters.

### Speed

- The popup shows the text as it arrives. For `/summary`, the first text shows after 5 to 8 seconds with Gemini 3.8 Flash and after 3 to 15 seconds with Claude Haiku 5.5, against 20 seconds for the whole text.
- The gateway in the tests applied a prompt cache no matter what the extension asked for. A second call on the same session within minutes showed the first text after 2 seconds instead of 17. The extension does not control this.

## Limits of the method

- Each configuration ran 3 times. A difference of 1 or 2 outputs is noise.
- The judge and the reference model are from the same family. Facts outside the checklists are not measured.
- Gemini 3.8 Flash returned no reasoning tokens in most calls through this gateway, so its `thinking` levels may behave differently elsewhere.
- The sessions are from one developer, mostly in Traditional Chinese, about infrastructure and tooling work.
