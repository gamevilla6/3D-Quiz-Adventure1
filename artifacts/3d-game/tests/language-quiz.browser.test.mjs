import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const projectDirectory = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const chromiumPath =
  process.env.CHROMIUM_BIN ??
  execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();

async function findAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForServer(server, url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready.\n${server.output}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for Vite at ${url}.\n${server.output}`);
}

const port = await findAvailablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(
  "pnpm",
  ["exec", "vite", "--config", "vite.config.ts", "--host", "127.0.0.1", "--port", String(port)],
  {
    cwd: projectDirectory,
    env: { ...process.env, PORT: String(port), BASE_PATH: "/" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.output = "";
server.stdout.setEncoding("utf8").on("data", (chunk) => (server.output += chunk));
server.stderr.setEncoding("utf8").on("data", (chunk) => (server.output += chunk));

let browser;
try {
  await waitForServer(server, baseUrl);
  browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(window.crypto), "getRandomValues", {
      configurable: true,
      value(array) {
        array.fill(0);
        return array;
      },
    });
    window.__answerCueOscillators = 0;
    window.AudioContext = class {
      state = "running";
      currentTime = 0;
      destination = {};
      createOscillator() {
        window.__answerCueOscillators += 1;
        return {
          type: "",
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          start() {},
          stop() {},
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
        };
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const pageErrors = [];
  page.on("close", () => console.log("DEBUG: main test page closed"));
  browser.on("disconnected", () => console.log("DEBUG: browser disconnected"));
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.selectOption("#languageSelect", "en");
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("quiz-orbit-language")),
    "en",
    "English selection is saved",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.locator("#welcomeTitle").innerText(), "QuizVerse 3D");
  assert.equal(await page.locator(".brand-name").innerText(), "QuizVerse 3D");
  assert.equal(await page.title(), "QuizVerse 3D — Quiz Game");
  assert.match(await page.locator('meta[name="viewport"]').getAttribute("content"), /viewport-fit=cover/);
  const mobileHomeTargets = await page.evaluate(() =>
    ["#brandHome", "#languageSelect", "#soundToggle", "#startGameButton", "#openRewardsButton", ".category"]
      .map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })
  );
  assert.ok(mobileHomeTargets.every(({ width, height }) => width >= 48 && height >= 48), "home controls have touch-sized targets");
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "the narrow mobile layout has no horizontal overflow",
  );
  assert.equal(await page.locator("#soundToggle").innerText(), "Game sounds on");
  await page.locator("#soundToggle").tap();
  assert.equal(await page.locator("#soundToggle").getAttribute("aria-pressed"), "false");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("quiz-orbit-answer-sounds-muted")),
    "true",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("#soundToggle").innerText(), "Game sounds off");
  assert.equal(await page.locator("#soundToggle").getAttribute("aria-pressed"), "false");

  assert.equal(await page.locator(".category").count(), 5, "all five quiz subjects are available");
  assert.equal(await page.locator(".category-preview").count(), 5, "each mode has an interactive progress preview");
  assert.ok(await page.locator(".category-difficulty").first().innerText());
  assert.equal(await page.locator("#heroStatCategoriesValue").innerText(), "5");
  assert.equal(await page.locator("#heroStatLevelsValue").innerText(), "2,500+");
  assert.equal(await page.locator("#heroStatActiveValue").innerText(), "ACTIVE");
  const initialHeroTagline = await page.locator("#orbitLabel").innerText();
  await page.waitForTimeout(5200);
  assert.notEqual(await page.locator("#orbitLabel").innerText(), initialHeroTagline, "the hero message rotates");
  await page.locator("#openRewardsButton").click();
  assert.equal(await page.locator(".category-progress-item").count(), 5, "the home analytics hub shows every subject");
  assert.equal(await page.locator("#rewardsDialogTitle").innerText(), "Your Collection");
  assert.equal(await page.locator("#dashboardCategoryFilter option").count(), 6, "collection filter covers every category plus all");
  assert.equal(await page.locator("#dashboardStatusFilter option").count(), 3, "collection can sort by default, unlocked, or locked");
  assert.equal(await page.locator("#trophyGallery .trophy-showcase-card").count(), 3);
  assert.equal(await page.locator("#badgeGallery .badge-showcase-card").count(), 5);
  assert.ok(
    await page.locator("#badgeGallery .badge-showcase-card.locked").first().getAttribute("data-tooltip"),
    "locked badges include their unlock instructions",
  );
  await page.locator("#dashboardCategoryFilter").selectOption("IQ Check");
  assert.equal(await page.locator("#badgeGallery .badge-showcase-card").count(), 3, "IQ filter shows IQ-specific badges and the shared badge");
  await page.locator("#dashboardCategoryFilter").selectOption("Science & Technology");
  assert.equal(await page.locator("#badgeGallery .badge-showcase-card").count(), 3, "category filter updates the collection gallery");
  await page.locator("#dashboardCategoryFilter").selectOption("all");
  await page.locator("#dashboardStatusFilter").selectOption("locked");
  assert.ok(
    await page.locator("#closeRewardsButton").evaluate((node) => node.getBoundingClientRect().height >= 48),
    "the rewards dashboard close control has a touch-sized target",
  );
  await page.locator("#closeRewardsButton").click();
  for (const [category, theme] of [
    ["Science & Technology", "theme-science"],
    ["Pop Culture & Movies", "theme-pop"],
    ["History & Geography", "theme-history"],
    ["IQ Check", "theme-iq"],
  ]) {
    await page.locator(`.category[data-category="${category}"]`).click();
    assert.equal(await page.locator("body").evaluate((node, expectedTheme) => node.classList.contains(expectedTheme), theme), true);
    await page.locator("#startGameButton").click();
    assert.equal(await page.locator("#levelView").evaluate((node) => node.classList.contains("active")), true);
    assert.equal(await page.locator("#levelGrid .level-card.unlocked").count(), 1);
    assert.equal(await page.locator("#levelGrid .level-card.locked").count(), 24);
    const levelMapScroll = await page.locator("#levelGrid").evaluate((node) => ({
      overflowY: getComputedStyle(node).overflowY,
      canScroll: node.scrollHeight > node.clientHeight,
    }));
    assert.equal(levelMapScroll.overflowY, "auto");
    assert.equal(levelMapScroll.canScroll, true, "the touch level map has its own scrollable area");
    const pageButtonHeight = await page.locator("#levelNextButton").evaluate((node) => node.getBoundingClientRect().height);
    assert.ok(pageButtonHeight >= 48, "level map navigation uses a touch-sized target");
    await page.locator("#levelGrid").evaluate((node) => { node.scrollTop = 120; });
    assert.ok(await page.locator("#levelGrid").evaluate((node) => node.scrollTop > 0), "level cards scroll vertically on touch screens");
    await page.locator("#levelGrid").evaluate((node) => { node.scrollTop = 0; });
    await page.locator(".level-card.unlocked").click();
    assert.equal(await page.locator("#gameView").evaluate((node) => node.classList.contains("active")), true);
    assert.notEqual(await page.locator("#questionText").innerText(), "");
    assert.equal(await page.locator(".option").count(), 4);
    const gameLayoutOrder = await page.locator(".game-layout").evaluate((node) =>
      [...node.children].map((child) => child.classList.contains("game-sidebar") ? "hud" : "quiz")
    );
    assert.deepEqual(gameLayoutOrder, ["hud", "quiz"], "the score and streak HUD precedes the question on mobile");
    for (const selector of ["#quitButton", "#languageSelect", "#soundToggle"]) {
      assert.ok(
        await page.locator(selector).evaluate((node) => node.getBoundingClientRect().height >= 48),
        `${selector} remains a touch-sized game control`,
      );
    }
    assert.ok(
      await page.locator(".option").first().evaluate((node) => node.getBoundingClientRect().height >= 48),
      "answer options are large touch targets",
    );
    assert.equal(await page.locator("#iqTimer").isVisible(), true, "the countdown is active in every category");
    assert.equal(await page.locator(".option").first().getAttribute("data-answer"), null);
    for (const language of ["bn", "hi", "es", "fr"]) {
      await page.selectOption("#languageSelect", language);
      const localizedQuestion = await page.locator("#questionText").innerText();
      assert.ok(localizedQuestion && localizedQuestion !== "undefined");
      assert.equal(await page.locator(".option").count(), 4);
      assert.ok(await page.locator("#continueJourneyLabel").innerText());
      assert.ok(await page.locator("#heroStatCategoriesLabel").innerText());
      assert.ok(await page.locator("#heroStatLevelsLabel").innerText());
      assert.ok(await page.locator("#heroStatFocusLabel").innerText());
    }
    await page.selectOption("#languageSelect", "en");
    await page.locator("#quitButton").click();
  }
  const lastPlayed = await page.evaluate(() => JSON.parse(localStorage.getItem("quiz-orbit-last-played-v1")));
  assert.deepEqual(
    { category: lastPlayed.category, level: lastPlayed.level },
    { category: "IQ Check", level: 1 },
    "the last played level is saved independently of the visible level map",
  );
  assert.equal(await page.locator("#continueJourneyButton").isVisible(), true);
  assert.match(await page.locator("#continueJourneyTarget").innerText(), /IQ Check.*1/);
  await page.locator("#continueJourneyButton").click();
  assert.equal(await page.locator("#gameView").evaluate((node) => node.classList.contains("active")), true);
  assert.match(await page.locator("#gameCategory").innerText(), /IQ CHECK/);
  await page.locator("#quitButton").click();

  const scienceProgressKey = "quiz-orbit-science-technology-unlocked-level";
  await page.evaluate(() => {
    const category = "Science & Technology";
    const level = 2;
    const payload = `quiz-orbit-category-progress-v2:${category}:${level}`;
    let hash = 0x811c9dc5;
    for (let index = 0; index < payload.length; index += 1) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    const checksum = (hash >>> 0).toString(36);
    localStorage.setItem(
      "quiz-orbit-science-technology-unlocked-level",
      btoa(`2:${category}:${level}:${checksum}`),
    );
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('.category[data-category="Science & Technology"]').click();
  await page.locator("#startGameButton").click();
  assert.equal(await page.locator("#levelGrid .level-card.completed").count(), 1);
  assert.equal(await page.locator("#levelGrid .level-card.unlocked").count(), 1);
  assert.equal(await page.locator("#levelGrid .level-card.locked").count(), 23);
  assert.notEqual(
    await page.locator("#levelGrid .level-card.locked").first().getAttribute("disabled"),
    null,
  );
  await page.locator("#levelBackButton").click();
  await page.locator('.category[data-category="General Knowledge"]').click();
  await page.locator("#startGameButton").click();
  assert.equal(await page.locator("#levelGrid .level-card.unlocked").count(), 1, "science progress does not unlock General Knowledge levels");
  assert.equal(await page.locator("#levelGrid .level-card.locked").count(), 24);
  await page.evaluate((key) => localStorage.removeItem(key), scienceProgressKey);
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.locator('.category[data-category="General Knowledge"]').click();
  await page.locator("#startGameButton").click();
  assert.equal(await page.locator("#levelView").evaluate((node) => node.classList.contains("active")), true);
  await page.locator(".level-card.unlocked").click();
  assert.equal(await page.locator("#questionText").innerText(), "The Eiffel Tower is in which city?");
  assert.deepEqual(await page.locator(".option span:nth-child(2)").allInnerTexts(), [
    "Rome",
    "Paris",
    "Madrid",
    "Vienna",
  ]);

  await page.keyboard.press("2");
  assert.equal(await page.evaluate(() => window.__answerCueOscillators), 0, "muted answers do not create sound cues");
  assert.match(await page.locator("#feedback").innerText(), /Correct!/);
  assert.ok(Number(await page.locator("#scoreValue").innerText()) >= 10);
  assert.ok(Number(await page.locator("#coinBalance").innerText()) >= 10, "a correct answer immediately awards coins");
  assert.equal(
    await page.locator("#gameCoinBalance").innerText(),
    await page.locator("#coinBalance").innerText(),
    "the home and game HUDs share one live coin balance",
  );
  assert.ok(
    await page.evaluate(() => JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")).coins >= 10),
    "answer coins are saved immediately",
  );
  assert.equal(await page.locator("#correctCount").innerText(), "1");
  assert.equal(await page.locator(".option").nth(1).getAttribute("disabled"), "");
  assert.equal(await page.locator(".option").nth(1).getAttribute("class").then((value) => value.includes("correct")), true);
  await page.locator("#soundToggle").tap();
  assert.equal(await page.locator("#soundToggle").innerText(), "Game sounds on");
  const audioTestPage = await context.newPage();
  audioTestPage.on("pageerror", (error) => pageErrors.push(error.message));
  await audioTestPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await audioTestPage.locator("#startGameButton").tap();
  await audioTestPage.locator(".level-card.unlocked").tap();
  assert.equal(await audioTestPage.locator("#questionText").innerText(), "The Eiffel Tower is in which city?");
  await audioTestPage.locator(".option").nth(1).tap();
  assert.equal(
    await audioTestPage.evaluate(() => window.__answerCueOscillators),
    2,
    "enabled correct answers play separate answer and coin sound cues",
  );
  await audioTestPage.close();

  const penaltyPage = await context.newPage();
  penaltyPage.on("pageerror", (error) => pageErrors.push(error.message));
  await penaltyPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await penaltyPage.locator("#startGameButton").tap();
  await penaltyPage.locator(".level-card.unlocked").tap();
  await penaltyPage.locator(".option").nth(1).tap();
  const scoreBeforePenalty = Number(await penaltyPage.locator("#scoreValue").innerText());
  await penaltyPage.locator("#nextButton").tap();
  assert.equal(await penaltyPage.locator("#questionText").innerText(), "How many sides does a hexagon have?");
  await penaltyPage.locator(".option").first().tap();
  const scoreAfterPenalty = Number(await penaltyPage.locator("#scoreValue").innerText());
  assert.equal(scoreAfterPenalty, Math.max(0, scoreBeforePenalty - 5));
  assert.equal(await penaltyPage.locator("#feedback").evaluate((node) => node.classList.contains("penalty-warning")), true);
  assert.equal(await penaltyPage.locator("#quizCard").evaluate((node) => node.classList.contains("penalty-screen")), true);
  const scoreBeforeFocusLoss = Number(await penaltyPage.locator("#scoreValue").innerText());
  await penaltyPage.locator("#nextButton").tap();
  await penaltyPage.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.match(await penaltyPage.locator("#feedback").innerText(), /focus/i);
  assert.equal(
    Number(await penaltyPage.locator("#scoreValue").innerText()),
    Math.max(0, scoreBeforeFocusLoss - 5),
  );
  await penaltyPage.close();

  for (const language of ["hi", "es", "fr"]) {
    await page.selectOption("#languageSelect", language);
    const localizedQuestion = await page.locator("#questionText").innerText();
    assert.ok(localizedQuestion && localizedQuestion !== "undefined");
    assert.equal(await page.locator(".option").count(), 4);
  }
  await page.selectOption("#languageSelect", "en");
  await page.selectOption("#languageSelect", "bn");
  assert.equal(await page.locator("#questionText").innerText(), "আইফেল টাওয়ার কোন শহরে অবস্থিত?");
  assert.equal(await page.locator("#soundToggle").innerText(), "গেমের শব্দ চালু");
  assert.deepEqual(await page.locator(".option span:nth-child(2)").allInnerTexts(), [
    "রোম",
    "প্যারিস",
    "মাদ্রিদ",
    "ভিয়েনা",
  ]);
  assert.match(await page.locator("#feedback").innerText(), /সঠিক!/);
  assert.ok(await page.locator("#scoreValue").innerText());
  assert.equal(
    await page.evaluate(() => localStorage.getItem("quiz-orbit-language")),
    "bn",
    "Bengali selection is saved",
  );

  await page.selectOption("#languageSelect", "en");
  assert.equal(await page.locator("#questionText").innerText(), "The Eiffel Tower is in which city?");
  assert.match(await page.locator("#feedback").innerText(), /Correct!/);
  assert.ok(Number(await page.locator("#scoreValue").innerText()) >= 10);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("quiz-orbit-language")),
    "en",
    "switching back to English is saved",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.locator("#welcomeTitle").innerText(), "QuizVerse 3D");

  await page.selectOption("#languageSelect", "bn");
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("html").getAttribute("lang"), "bn");
  assert.equal(await page.locator("#welcomeTitle").innerText(), "QuizVerse 3D");
  assert.equal(await page.locator("#categoryHeading").innerText(), "মোড বেছে নিন");

  await page.locator("#startGameButton").tap();
  await page.locator(".level-card.unlocked").tap();
  assert.equal(await page.locator("#questionText").innerText(), "আইফেল টাওয়ার কোন শহরে অবস্থিত?");
  assert.deepEqual(await page.locator(".option span:nth-child(2)").allInnerTexts(), [
    "রোম",
    "প্যারিস",
    "মাদ্রিদ",
    "ভিয়েনা",
  ]);

  const correctOptionIndexes = [1, 1, 2, 1, 3, 3, 3, 3, 3, 3];
  const firstQuestion = await page.locator("#questionText").innerText();
  for (const [questionIndex, optionIndex] of correctOptionIndexes.entries()) {
    if (questionIndex > 0) await page.locator("#nextButton").tap();
    await page.locator(".option").nth(optionIndex).tap();
    assert.equal(
      await page.locator(".option").nth(optionIndex).getAttribute("class").then((value) => value.includes("correct")),
      true,
      `Expected option ${optionIndex + 1} to be correct for question ${questionIndex + 1}`,
    );
    assert.equal(
      await page.locator("#correctCount").innerText(),
      new Intl.NumberFormat("bn-BD").format(questionIndex + 1),
    );
  }
  await page.locator("#nextButton").tap();

  assert.equal(await page.locator("#resultsView").evaluate((node) => node.classList.contains("active")), true);
  assert.equal(await page.locator("#resultTitle").innerText(), "অসাধারণ করেছেন।");
  assert.equal(await page.locator("#finalCorrect").innerText(), "১০");
  assert.equal(await page.locator("#finalAccuracy").innerText(), "১০০%");
  assert.equal(await page.locator("#finalTotal").innerText(), "১০");
  assert.equal(await page.locator("#finalDenominator").innerText(), "নেট পয়েন্ট");
  assert.match(await page.locator("#finalScore").innerText(), /[১-৯]/);
  const savedCollection = await page.evaluate(() => JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")));
  assert.notEqual(await page.evaluate(() => localStorage.getItem("quiz-orbit-gk-unlocked-level")), "1");
  const earnedTier = await page.locator("#resultCard").getAttribute("data-tier");
  assert.equal(savedCollection.version, 4, "the reward collection has a storage version");
  assert.ok(savedCollection.trophies.includes(earnedTier), "the round trophy is persisted");
  assert.ok(savedCollection.badges.includes("quizMaster"), "the earned badge is persisted");
  assert.equal(savedCollection.bestStreak, 10, "the personal best streak is updated");
  assert.equal(
    new Intl.NumberFormat("bn-BD").format(savedCollection.bestPoints),
    await page.locator("#finalScore").innerText(),
    "the personal best points match the round",
  );

  await page.locator("#playAgainButton").tap();
  assert.equal(await page.locator("#gameView").evaluate((node) => node.classList.contains("active")), true);
  assert.notEqual(await page.locator("#questionText").innerText(), firstQuestion);
  assert.equal(await page.locator("#scoreValue").innerText(), "০");
  assert.equal(await page.locator("#correctCount").innerText(), "০");
  assert.equal(await page.locator(".option").count(), 4);
  for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
    await page.locator(".option").first().tap();
    if (questionIndex < 9) await page.locator("#nextButton").tap();
  }
  await page.locator("#nextButton").tap();
  const mergedCollection = await page.evaluate(() => JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")));
  assert.ok(mergedCollection.trophies.includes("gold"), "a later round keeps the previously earned gold trophy");
  assert.ok(mergedCollection.badges.includes("quizMaster"), "a later round keeps previously earned badges");
  assert.equal(mergedCollection.bestStreak, 10, "a later round does not reduce the personal best streak");
  assert.ok(mergedCollection.coins > 0, "the level completion and answer coin rewards persist");
  assert.ok(mergedCollection.claimedLevelCoinRewards.includes("General Knowledge:1"), "the one-time level-clear reward is claimed");
  assert.ok(
    await page.locator("#resultCoinAmount").innerText().startsWith("+"),
    "the results screen summarizes coins earned in the round",
  );

  await page.locator("#homeButton").tap();
  assert.equal(await page.locator("#welcomeView").evaluate((node) => node.classList.contains("active")), true);
  assert.equal(
    await page.locator('.category[data-category="General Knowledge"]').getAttribute("data-progress-percent"),
    "0.2",
    "the mode card reflects completed level progress",
  );
  assert.match(await page.locator("#collectionTrophies").innerText(), /ট্রফি/);
  assert.match(await page.locator("#collectionBadges").innerText(), /কুইজ মাস্টার/);
  assert.notEqual(await page.locator("#collectionCoinBalance").innerText(), "০", "the home collection shows the saved coin balance");
  assert.equal(
    await page.locator("#coinBalance").innerText(),
    await page.locator("#collectionCoinBalance").innerText(),
    "the home HUD and collection panel stay in sync",
  );
  await page.locator("#openRewardsButton").tap();
  assert.equal(
    await page.locator("#dashboardCoinBalance").innerText(),
    await page.locator("#coinBalance").innerText(),
    "the collection dashboard shows the accumulated balance",
  );
  await page.locator("#closeRewardsButton").tap();
  await page.locator("#startGameButton").tap();
  assert.equal(await page.locator("#levelGrid .level-card.completed").count(), 1);
  assert.equal(await page.locator("#levelGrid .level-card.unlocked").count(), 1);
  assert.equal(await page.locator("#levelGrid .level-card.locked").count(), 23);
  await page.locator("#levelBackButton").tap();
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.match(await page.locator("#collectionTrophies").innerText(), /ট্রফি/);
  assert.match(await page.locator("#collectionBadges").innerText(), /কুইজ মাস্টার/);

  await page.evaluate(() => localStorage.setItem("quiz-orbit-reward-collection", "{not valid json"));
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("#collectionBestPoints").innerText(), "০");
  assert.equal(await page.locator("#collectionBestStreak").innerText(), "০");
  assert.equal(await page.locator("#collectionTrophies").innerText(), "এখনো কিছু নেই");
  assert.equal(await page.locator("#collectionBadges").innerText(), "এখনো কিছু নেই");

  const blockedStoragePage = await context.newPage();
  blockedStoragePage.setDefaultTimeout(10_000);
  const blockedStorageErrors = [];
  blockedStoragePage.on("pageerror", (error) => blockedStorageErrors.push(error.message));
  await blockedStoragePage.addInitScript(() => {
    const storageBlocked = () => {
      throw new DOMException("Browser storage is blocked", "SecurityError");
    };
    Storage.prototype.getItem = storageBlocked;
    Storage.prototype.setItem = storageBlocked;
  });
  await blockedStoragePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.equal(await blockedStoragePage.locator("#collectionBestPoints").innerText(), "0");
  await blockedStoragePage.locator("#startGameButton").click();
  assert.equal(await blockedStoragePage.locator("#levelView").evaluate((node) => node.classList.contains("active")), true);
  assert.deepEqual(blockedStorageErrors, [], "the game remains usable when browser storage is blocked");

  await page.setViewportSize({ width: 844, height: 390 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "landscape resizing does not introduce horizontal overflow",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(pageErrors, [], `The game page raised browser errors: ${pageErrors.join("; ")}`);
  console.log("Browser check passed: mobile touch targets and scrolling, orientation layout, rotating hero, five live mode previews, Continue Journey, localized rounds, independent level maps, timer/focus penalties, rewards, and storage recovery.");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", resolve);
    setTimeout(() => {
      server.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
}
