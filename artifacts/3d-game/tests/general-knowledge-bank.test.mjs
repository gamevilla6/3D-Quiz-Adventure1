import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { bank, bankSource, categoryAllowlist, categoryBanks, categoryScopeSource, html, reviewedAt, validationSource, year } from "./gk-bank.fixture.mjs";

assert.equal(year, 2026);
assert.equal(bank.length, 52);
assert.equal(new Set(bank.map((item) => item.id)).size, bank.length);
const current = bank.filter((item) => item.kind === "current-affairs");
assert.equal(current.length, 10);
assert.ok(current.every((item) => item.references.length && item.reviewedAt === reviewedAt));
assert.ok(current.filter((item) => item.status === "completed").every((item) => item.eventDate <= reviewedAt));
assert.ok(current.filter((item) => item.status === "scheduled").every((item) => item.eventDate > reviewedAt));
for (const language of ["en", "bn", "hi", "es", "fr"]) {
  assert.equal(new Set(bank.map((item) => item.question[language])).size, bank.length);
  for (const item of bank) {
    assert.ok(item.options[language][item.answer]);
    assert.equal(item.options[language].length, 4);
    assert.equal(new Set(item.options[language]).size, 4);
  }
}
for (const subject of ["history", "geography", "science", "literature", "arts", "monuments"]) {
  assert.ok(bank.some((item) => item.subject === subject), `${subject} is represented`);
}
assert.ok(!bank.some((item) => /guacamole|hexagon|three sides|shuttlecock|smallest prime|minutes.*hour|2016 Summer Olympics/i.test(item.question.en)));
const expected2026Answers = {
  "gk-2026-bbnj": "17 January",
  "gk-2026-woman-farmer": "Year of the Woman Farmer",
  "gk-2026-rangelands": "Pastoralists",
  "gk-2026-volunteers": "Volunteers for Sustainable Development",
  "gk-2026-rabat": "Rabat",
  "gk-2026-artemis-moon": "The Moon",
  "gk-2026-artemis-crew": "Four",
  "gk-2026-artemis-orion": "Orion",
  "gk-2026-cop31": "Antalya, Türkiye",
  "gk-2026-water": "United Arab Emirates and Senegal",
};
for (const item of current) assert.equal(item.options.en[item.answer], expected2026Answers[item.id]);
for (const mutation of [
  'quizData["General Knowledge"][0].options.bn.pop();',
  'quizData["General Knowledge"][0].answer = 4;',
  'currentAffairs2026[0].references = [];',
  'currentAffairs2026[0].eventDate = "2026-12-31";',
]) {
  assert.throws(new Function(`${bankSource}\n${mutation}\n${validationSource}`), /Invalid|Unverified/);
}

// Evaluate the exact inline pool/picker with browser-independent state. Generators
// are deliberately unavailable: a GK route into numeric generation fails here.
const pickerSource = html.slice(
  html.indexOf("function getCategoryQuestionPool("),
  html.indexOf("function scrollLevelMapTo("),
);
const engine = new Function("randomIndex", `
  ${bankSource}
  ${validationSource}
  const PROGRESSION_CATEGORIES = ["General Knowledge"];
  const LEVELS_PER_CATEGORY = 500;
  const QUESTIONS_PER_LEVEL = 10;
  const categoryLevels = {"General Knowledge": Array.from({length: 500}, (_, i) => ({level: i + 1}))};
  const sessionUsedQuestionIds = new Set();
  const answers = new WeakMap();
  function storeConcealedAnswer(item, answer) { answers.set(item, answer); return item; }
  function readConcealedAnswer(item) { return answers.has(item) ? answers.get(item) : item.answer; }
  let activeQuestionPool = [];
  ${pickerSource}
  return {
    pool: level => getCategoryQuestionPool("General Knowledge", level),
    round(level = 1) {
      activeQuestionPool = getCategoryQuestionPool("General Knowledge", level);
      return selectRoundQuestionIndexes("General Knowledge", level).map(i => activeQuestionPool[i]);
    },
    clear: () => sessionUsedQuestionIds.clear()
  };
`)(randomInt);
assert.equal(engine.pool(1).length, 40);
assert.equal(engine.pool(101).length, 46);
assert.equal(engine.pool(301).length, 52);
const first = engine.round();
assert.equal(first.filter((item) => item.kind === "current-affairs").length, 2);
assert.equal(new Set(first.filter((item) => item.kind === "current-affairs").map((item) => item.event)).size, 2);
const seen = new Set(first.map((item) => item.id));
for (let round = 1; round < 4; round += 1) {
  for (const item of engine.round()) {
    assert.ok(!seen.has(item.id), "no repeats before the level-one bank is exhausted");
    seen.add(item.id);
  }
}
assert.equal(seen.size, 40);
for (const level of [101, 301]) {
  engine.clear();
  const encountered = new Set();
  const size = engine.pool(level).length;
  for (let round = 0; round < Math.ceil(size / 10); round += 1) {
    engine.round(level).forEach((item) => encountered.add(item.id));
  }
  assert.equal(encountered.size, size, "a non-multiple-of-ten bank never discards its unused tail");
}
for (let level = 1; level <= 500; level += 1) {
  const round = engine.round(level);
  assert.equal(round.length, 10);
  assert.equal(new Set(round.map((item) => item.id)).size, 10);
  assert.ok(round.every((item) => item.source === "trivia" && !item.id.startsWith("generated-")));
}
assert.throws(() => engine.pool(0), RangeError);
assert.throws(() => engine.pool(501), RangeError);
assert.equal(categoryBanks["Science & Technology"].length, 10);
assert.equal(categoryBanks["Pop Culture & Movies"].length, 11);
assert.equal(categoryBanks["History & Geography"].length, 12);
assert.ok(!categoryBanks["Science & Technology"].some((item) =>
  /water|genetic|plants|atmosphere/i.test(item.question.en),
), "Science & Technology excludes chemistry/biology questions outside its physics, space, technology and AI scope");
assert.ok(categoryBanks["Science & Technology"].some((item) => item.year === 2026 && item.subject === "ai"));
assert.ok(categoryBanks["Science & Technology"].some((item) => item.year === 2026 && item.subject === "space-exploration"));
assert.ok(categoryBanks["Pop Culture & Movies"].some((item) =>
  item.id === "pop-2026-best-picture" && item.options.en[item.answer] === "One Battle After Another",
));
assert.ok(categoryBanks["History & Geography"].some((item) => item.status === "scheduled" && item.event === "cop31"));
assert.ok(categoryBanks["History & Geography"].some((item) => item.status === "scheduled" && item.event === "water2026"));
for (const [category, questions] of Object.entries(categoryBanks)) {
  const allowed = new Set(categoryAllowlist[category] ?? ["logic"]);
  assert.equal(new Set(questions.map((item) => item.id)).size, questions.length);
  for (const item of questions) {
    assert.ok(allowed.has(item.subject), `${category}: ${item.question.en} stays within its category`);
    for (const language of ["en", "bn", "hi", "es", "fr"]) {
      assert.equal(item.options[language].length, 4);
      assert.ok(item.options[language][item.answer]);
    }
  }
}
const categoryPoolSource = html.slice(
  html.indexOf("function getCategoryQuestionPool("),
  html.indexOf("function selectRoundQuestionIndexes("),
);
const categoryPoolEngine = new Function("randomIndex", `
  ${bankSource}
  ${categoryScopeSource}
  const categoryLevels = Object.fromEntries(PROGRESSION_CATEGORIES.map(category => [category, Array.from({length: 500}, (_, i) => ({level: i + 1}))]));
  const answers = new WeakMap();
  function storeConcealedAnswer(item, answer) { answers.set(item, answer); return item; }
  function readConcealedAnswer(item) { return answers.has(item) ? answers.get(item) : item.answer; }
  let activeQuestionPool = [];
  ${categoryPoolSource}
  return category => getCategoryQuestionPool(category, 1);
`)(randomInt);
for (const category of ["Science & Technology", "Pop Culture & Movies", "History & Geography"]) {
  const pool = categoryPoolEngine(category);
  assert.equal(pool.length, categoryBanks[category].length);
  assert.ok(pool.every((item) => item.source === "trivia" && !item.id.startsWith("generated-")));
  assert.deepEqual(pool.map((item) => item.id).sort(), categoryBanks[category].map((item) => item.id).sort());
}
console.log("PASS: strict category scopes, 2026 sources, five locales, all 500 GK levels and repeat-free rounds.");
