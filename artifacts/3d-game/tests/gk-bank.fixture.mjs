import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
export const bankSource = html.slice(
  html.indexOf("const GK_CONTENT_YEAR ="),
  html.indexOf("const QUESTIONS_PER_LEVEL ="),
);
export const validationSource = html.slice(
  html.indexOf("const generalKnowledgeBank ="),
  html.indexOf("// Keep maps metadata-only:"),
);
export const { bank, year, reviewedAt } = new Function(
  `${bankSource}\n${validationSource}\nreturn {
    bank: generalKnowledgeBank, year: GK_CONTENT_YEAR, reviewedAt: GK_REVIEWED_AT
  };`,
)();

// Resolve the actual authored question, not a brittle assumed random order.
export async function currentGKFact(page) {
  const text = await page.locator("#questionText").innerText();
  for (const entry of bank) {
    for (const [language, question] of Object.entries(entry.question)) {
      if (question !== text) continue;
      assert.deepEqual(
        await page.locator(".option span:nth-child(2)").allInnerTexts(),
        entry.options[language],
      );
      return { entry, language };
    }
  }
  assert.fail(`Question is not in the curated GK bank: ${text}`);
}

export async function correctGKIndex(page) {
  return (await currentGKFact(page)).entry.answer;
}
