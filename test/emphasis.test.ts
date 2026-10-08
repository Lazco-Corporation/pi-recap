import assert from "node:assert/strict";
import { test } from "node:test";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import { addEmphasisMarkers, removeEmphasisMarkers } from "../src/emphasis.ts";

const plain = (text: string) => text;
const theme: MarkdownTheme = {
  heading: plain,
  link: plain,
  linkUrl: plain,
  code: (text) => `<code>${text}</code>`,
  codeBlock: plain,
  codeBlockBorder: plain,
  quote: plain,
  quoteBorder: plain,
  hr: plain,
  listBullet: plain,
  bold: (text) => `<b>${text}</b>`,
  italic: (text) => `<i>${text}</i>`,
  strikethrough: plain,
  underline: plain,
};

function render(markdown: string): string {
  return new Markdown(markdown, 0, 0, theme, undefined, { transform: addEmphasisMarkers })
    .render(120)
    .map((line) => removeEmphasisMarkers(line).trimEnd())
    .join("\n");
}

for (const [source, expected] of [
  ["**目標：**你想", "<b>目標：</b>你想"],
  ["這是**「重點」**文字", "這是<b>「重點」</b>文字"],
  ["你*「斜體」*的", "你<i>「斜體」</i>的"],
  ["***粗斜：***你", "<i><b>粗斜：</b></i>你"],
  ["是**(重要)**的", "是<b>(重要)</b>的"],
  ["**重要(important)**的", "<b>重要(important)</b>的"],
  ["**“重點”**的", "<b>“重點”</b>的"],
  ["**スクリプト（script）**は", "<b>スクリプト（script）</b>は"],
  ["**스크립트(script)**는", "<b>스크립트(script)</b>는"],
  ["**🎉：**你", "<b>🎉：</b>你"],
  ["- **目標：**你\n- **進度：**好", "- <b>目標：</b>你\n- <b>進度：</b>好"],
] satisfies [string, string][]) {
  test(`CJK emphasis is parsed: ${source}`, () => {
    assert.equal(render(source), expected);
  });
}

for (const [source, expected] of [
  ["a **b** c", "a <b>b</b> c"],
  ["**foo.**bar", "**foo.**bar"],
  ["*(*foo*)*", "<i>(<i>foo</i>)</i>"],
  ["2*3*4", "2<i>3</i>4"],
  ["中文__粗體__中文", "中文__粗體__中文"],
  ["\\*\\*目標：**你", "**目標：**你"],
] satisfies [string, string][]) {
  test(`text without the CJK problem keeps the CommonMark result: ${source}`, () => {
    assert.equal(render(source), expected);
  });
}

test("code spans and fenced code blocks do not change", () => {
  const source = "`a：**你` **目標：**你\n\n```\n目標：**你\n```";
  const marked = addEmphasisMarkers(source);
  assert.ok(marked.startsWith("`a：**你` "));
  assert.ok(marked.endsWith("```\n目標：**你\n```"));
  assert.equal(render(source), "<code>a：**你</code> <b>目標：</b>你\n\n```\n  目標：**你\n```");
});

test("text that needs no marker comes back unchanged", () => {
  for (const source of ["no stars here", "a **b** c", "* item", "***"]) {
    assert.equal(addEmphasisMarkers(source), source);
  }
});

test("the rendered lines have no marker left", () => {
  assert.ok(!render("**目標：**你想").includes("\u2060"));
});
