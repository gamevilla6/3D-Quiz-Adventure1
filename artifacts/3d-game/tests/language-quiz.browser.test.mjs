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
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.selectOption("#languageSelect", "en");
  const portalLocaleCopy = {
    en: ["Initiate sequence", "LIVE NEURAL TELEMETRY"],
    bn: ["মিশন শুরু করুন", "লাইভ নিউরাল টেলিমেট্রি"],
    hi: ["मिशन शुरू करें", "लाइव न्यूरल टेलीमेट्री"],
    es: ["Iniciar secuencia", "TELEMETRÍA NEURAL EN VIVO"],
    fr: ["Lancer la séquence", "TÉLÉMÉTRIE NEURALE EN DIRECT"],
  };
  for (const [language, [startAction, telemetryTitle]] of Object.entries(portalLocaleCopy)) {
    await page.selectOption("#languageSelect", language);
    assert.equal(
      (await page.locator("#startGameLabel").innerText()).toLocaleUpperCase(),
      startAction.toLocaleUpperCase(),
    );
    assert.equal(await page.locator("#portalTelemetryTitle").innerText(), telemetryTitle);
  }
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
  assert.equal(await page.locator("#badgeGallery .badge-showcase-card").count(), 6);
  assert.equal(await page.locator(".collection-tab").count(), 4, "collection has All, Trophies, Badges, and Category Stats tabs");
  assert.equal(await page.locator("#collectionTabAll").getAttribute("aria-selected"), "true");
  await page.locator("#collectionTabAll").press("ArrowRight");
  assert.equal(await page.locator("#collectionTabTrophies").getAttribute("aria-selected"), "true", "arrow keys move between collection tabs");
  assert.equal(await page.locator("#trophyGallery").isVisible(), true);
  assert.equal(await page.locator("#dashboardOverallMetrics").isVisible(), false);
  await page.locator("#collectionTabBadges").click();
  assert.equal(await page.locator("#badgeGallery").isVisible(), true);
  assert.equal(await page.locator("#trophyGallery").isVisible(), false);
  await page.locator("#collectionTabStats").click();
  assert.equal(await page.locator("#dashboardCategoryProgressGrid").isVisible(), true);
  assert.equal(await page.locator("#trophyGallery").isVisible(), false);
  await page.locator("#dashboardCategoryFilter").selectOption("IQ Check");
  assert.equal(await page.locator(".category-progress-item").count(), 1, "category filter narrows the stats tab");
  await page.locator("#dashboardCategoryFilter").selectOption("all");
  await page.locator("#collectionTabAll").click();
  assert.ok(
    await page.locator("#badgeGallery .badge-showcase-card.locked").first().getAttribute("data-tooltip"),
    "locked badges include their unlock instructions",
  );
  await page.locator("#dashboardCategoryFilter").selectOption("IQ Check");
  assert.equal(await page.locator("#badgeGallery .badge-showcase-card").count(), 4, "IQ filter shows IQ-specific badges and shared badges");
  await page.locator("#dashboardCategoryFilter").selectOption("Science & Technology");
  assert.equal(await page.locator("#badgeGallery .badge-showcase-card").count(), 4, "category filter updates the collection gallery");
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
    assert.equal(await page.locator(".level-category-tab").count(), 5, "the roadmap filters all five categories");
    assert.equal(
      await page.locator(`.level-category-tab[data-category="${category}"]`).getAttribute("aria-selected"),
      "true",
      "the current mode is selected in the roadmap filters",
    );
    assert.ok(
      await page.locator(".level-category-tabs").evaluate((node) => getComputedStyle(node).overflowX === "auto"),
      "category filters remain horizontally swipeable on mobile",
    );
    const alternateMapCategory = category === "Science & Technology" ? "General Knowledge" : "Science & Technology";
    await page.locator(`.level-category-tab[data-category="${alternateMapCategory}"]`).tap();
    assert.equal(
      await page.locator(`.level-category-tab[data-category="${alternateMapCategory}"]`).getAttribute("aria-selected"),
      "true",
      "tapping a category switches the roadmap",
    );
    await page.locator(`.level-category-tab[data-category="${category}"]`).tap();
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
    assert.equal(
      await page.locator("#iqTimer").evaluate((node) => node.closest(".score-hud-card") !== null),
      true,
      "the timer shares the sticky score, level, streak, and coin HUD",
    );
    assert.equal(await page.locator(".topbar").evaluate((node) => getComputedStyle(node).position), "sticky");
    assert.equal(await page.locator(".game-sidebar").evaluate((node) => getComputedStyle(node).position), "sticky");
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
      await page.locator(".option").first().evaluate((node) => node.getBoundingClientRect().height >= 50),
      "answer options are at least 50px high touch targets",
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
  await page.evaluate(() => localStorage.setItem("quiz-orbit-reward-collection", JSON.stringify({
    version: 5,
    levelResults: [{ category: "Science & Technology", level: 2, stars: 3, coins: 50 }],
  })));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('.category[data-category="Science & Technology"]').click();
  await page.locator("#startGameButton").click();
  assert.equal(await page.locator("#levelGrid .level-card.unlocked").count(), 1);
  assert.equal(await page.locator("#levelGrid .level-card.locked").count(), 24);
  assert.notEqual(
    await page.locator('.level-card[data-level="2"]').getAttribute("disabled"),
    null,
    "saved reward decorations cannot unlock a level without its progression token",
  );
  await page.locator("#levelBackButton").click();
  await page.evaluate(() => localStorage.removeItem("quiz-orbit-reward-collection"));
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.locator('.category[data-category="General Knowledge"]').click();
  await page.locator("#startGameButton").click();
  assert.equal(await page.locator("#levelView").evaluate((node) => node.classList.contains("active")), true);
  await page.locator(".level-card.unlocked").click();
  const portalRandomizedQuestionOptions = {
    "The Eiffel Tower is in which city?": ["Rome", "Paris", "Madrid", "Vienna"],
    "In which city is the Colosseum?": ["Athens", "Rome", "Istanbul", "Naples"],
  };
  const portalIntroQuestion = await page.locator("#questionText").innerText();
  assert.ok(Object.hasOwn(portalRandomizedQuestionOptions, portalIntroQuestion), "the level draws a valid question from its randomized pool");
  assert.deepEqual(
    await page.locator(".option span:nth-child(2)").allInnerTexts(),
    portalRandomizedQuestionOptions[portalIntroQuestion],
  );

  await page.keyboard.press("2");
  assert.equal(await page.evaluate(() => window.__answerCueOscillators), 0, "muted answers do not create sound cues");
  assert.match(await page.locator("#feedback").innerText(), /Correct!/);
  assert.ok(Number(await page.locator("#scoreValue").innerText()) >= 10);
  assert.ok(Number(await page.locator("#coinBalance").innerText()) >= 10, "a correct answer immediately awards coins");
  assert.equal(
    await page.locator("#portalVaultBalance").innerText(),
    await page.locator("#coinBalance").innerText(),
    "the portal telemetry mirrors the live coin balance",
  );
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
  const audioQuestion = await audioTestPage.locator("#questionText").innerText();
  assert.ok(Object.hasOwn(portalRandomizedQuestionOptions, audioQuestion));
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
  await penaltyPage.setViewportSize({ width: 844, height: 390 });
  assert.ok(
    await penaltyPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "the landscape quiz layout has no horizontal overflow",
  );
  assert.equal(await penaltyPage.locator(".game-sidebar").evaluate((node) => getComputedStyle(node).position), "sticky");
  await penaltyPage.setViewportSize({ width: 390, height: 844 });
  const initialTimerSeconds = Number((await penaltyPage.locator("#iqTimerValue").innerText()).match(/\d+/)?.[0]);
  await penaltyPage.waitForTimeout(1200);
  const elapsedTimerSeconds = Number((await penaltyPage.locator("#iqTimerValue").innerText()).match(/\d+/)?.[0]);
  assert.ok(elapsedTimerSeconds < initialTimerSeconds, "the visible timer decreases from the active question's start");
  await penaltyPage.locator(".option").nth(1).tap();
  const timerAtAnswer = await penaltyPage.locator("#iqTimerValue").innerText();
  await penaltyPage.waitForTimeout(250);
  assert.equal(await penaltyPage.locator("#iqTimerValue").innerText(), timerAtAnswer, "answer submission stops the timer immediately");
  const scoreBeforePenalty = Number(await penaltyPage.locator("#scoreValue").innerText());
  await penaltyPage.locator("#nextButton").tap();
  assert.equal(
    Number((await penaltyPage.locator("#iqTimerValue").innerText()).match(/\d+/)?.[0]),
    15,
    "each new question starts a fresh 15-second deadline",
  );
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
  assert.equal(await page.locator(".level-category-tab").count(), 5);
  assert.equal(
    await page.locator('.level-category-tab[data-category="General Knowledge"]').innerText(),
    "সাধারণ জ্ঞান",
    "roadmap category filters update with the selected language",
  );
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
  assert.equal(savedCollection.version, 5, "the reward collection has a storage version");
  assert.deepEqual(
    savedCollection.levelResults.find(({ category, level }) => category === "General Knowledge" && level === 1),
    { category: "General Knowledge", level: 1, stars: 3, coins: 50 },
    "the completed level stores its best star rating and one-time coin reward",
  );
  assert.ok(savedCollection.trophies.includes(earnedTier), "the round trophy is persisted");
  assert.ok(savedCollection.badges.includes("quizMaster"), "the earned badge is persisted");
  assert.ok(savedCollection.badges.includes("streakGod"), "a five-answer streak unlocks the Streak God badge");
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
  const resultCoinSummary = await page.locator("#resultCoinAmount").innerText();
  assert.ok(resultCoinSummary.startsWith("+"), "the results screen summarizes coins earned in the round");

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
  assert.ok(await page.locator("#trophyGallery .trophy-vector").count() > 0, "earned trophies render as rotating inline SVG models");
  await page.locator("#closeRewardsButton").tap();
  await page.locator("#startGameButton").tap();
  assert.equal(await page.locator("#levelGrid .level-card.completed").count(), 1);
  assert.equal(await page.locator("#levelGrid .level-card.unlocked").count(), 1);
  assert.equal(await page.locator("#levelGrid .level-card.locked").count(), 23);
  assert.equal(await page.locator('.level-card.completed[data-level="1"] .level-card-stars').innerText(), "★★★");
  assert.equal(await page.locator('.level-card.completed[data-level="1"] .level-card-coins').innerText(), "+৫০ 🪙");
  assert.equal(await page.locator('.level-card.completed[data-level="1"] .level-card-indicator').innerText(), "🏆");
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
  const lifelinePage = await context.newPage();
  lifelinePage.setDefaultTimeout(10_000);
  lifelinePage.on("pageerror", (error) => pageErrors.push(error.message));
  await lifelinePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await lifelinePage.evaluate(() => {
    const key = "quiz-orbit-reward-collection";
    const collection = {
      version: 4,
      trophies: [],
      badges: [],
      coins: 200,
      claimedLevelCoinRewards: [],
      bestPoints: 0,
      bestStreak: 0,
      trophyRecords: [],
      categoryStats: Object.fromEntries([
        "General Knowledge",
        "Science & Technology",
        "Pop Culture & Movies",
        "History & Geography",
        "IQ Check",
      ].map((category) => [category, { runs: 0, correct: 0, incorrect: 0, completedLevels: 0 }])),
      gkRuns: 0,
      gkCorrect: 0,
      gkIncorrect: 0,
      gkCompletedLevels: 0,
      iqRuns: 0,
      iqCorrect: 0,
      iqIncorrect: 0,
      iqLatestEstimate: null,
    };
    localStorage.setItem(key, JSON.stringify(collection));
    localStorage.setItem("quiz-orbit-answer-sounds-muted", "false");
  });
  await lifelinePage.reload({ waitUntil: "domcontentloaded" });
  await lifelinePage.selectOption("#languageSelect", "en");
  await lifelinePage.locator('.category[data-category="General Knowledge"]').tap();
  await lifelinePage.locator("#startGameButton").tap();
  await lifelinePage.locator(".level-card.unlocked").tap();
  assert.deepEqual(
    await lifelinePage.locator(".lifeline-cost").allInnerTexts(),
    ["20 🪙", "15 🪙", "25 🪙", "40 🪙"],
  );
  assert.ok(
    await lifelinePage.locator(".lifeline-button").evaluateAll((buttons) =>
      buttons.every((button) => button.getBoundingClientRect().width >= 48 && button.getBoundingClientRect().height >= 48)
    ),
    "all four lifelines are touch-sized",
  );

  await lifelinePage.emulateMedia({ reducedMotion: "no-preference" });
  await lifelinePage.locator('[data-lifeline="fifty"]').tap();
  assert.equal(await lifelinePage.locator(".option.is-eliminating").count(), 2, "50/50 animates the eliminated options away");
  await lifelinePage.waitForFunction(() => document.querySelectorAll(".option[hidden]").length === 2);
  assert.equal(await lifelinePage.locator(".option:not([hidden])").count(), 2, "50/50 keeps the correct choice and one distractor");
  assert.equal(await lifelinePage.locator("#coinBalance").innerText(), "180");
  assert.equal(await lifelinePage.locator("#gameCoinBalance").innerText(), "180");
  assert.equal(await lifelinePage.locator(".coin-popup.spent").last().innerText(), "−20 🪙", "lifeline spending shows a floating deduction");
  const spentPopupBounds = await lifelinePage.locator(".coin-popup.spent").last().boundingBox();
  const gameCoinBounds = await lifelinePage.locator("#gameCoinBalanceChip").boundingBox();
  assert.ok(spentPopupBounds.x >= gameCoinBounds.x + gameCoinBounds.width - 1, "coin deductions float beside, not over, the balance");
  assert.equal(
    await lifelinePage.evaluate(() => JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")).coins),
    180,
    "lifeline charges persist immediately",
  );

  await lifelinePage.waitForTimeout(1200);
  await lifelinePage.locator('[data-lifeline="freeze"]').tap();
  const frozenTimerValue = await lifelinePage.locator("#iqTimerValue").innerText();
  assert.equal(await lifelinePage.locator("#iqTimer").evaluate((node) => node.classList.contains("frozen")), true);
  assert.notEqual(
    await lifelinePage.locator("#iqTimerBar").evaluate((node) => getComputedStyle(node, "::after").backgroundImage),
    "none",
    "time freeze adds an animated matrix overlay to the timer track",
  );
  await lifelinePage.waitForTimeout(1200);
  assert.equal(await lifelinePage.locator("#iqTimerValue").innerText(), frozenTimerValue, "time freeze pauses the visible countdown");
  assert.match(await lifelinePage.locator("#lifelineUseCount").innerText(), /2/);
  assert.equal(await lifelinePage.locator('[data-lifeline="clue"]').isDisabled(), true, "the third distinct lifeline is locked");
  assert.equal(await lifelinePage.locator('[data-lifeline="skip"]').isDisabled(), true, "the two-use limit locks remaining lifelines");
  assert.equal(await lifelinePage.locator('[data-lifeline="fifty"]').isDisabled(), true, "a lifeline cannot be reused on one question");

  const lifelineLocaleCopy = {
    en: ["TACTICAL LIFELINES", "Skip question"],
    bn: ["কৌশলগত লাইফলাইন", "প্রশ্ন বদলান"],
    hi: ["रणनीतिक लाइफलाइन", "प्रश्न बदलें"],
    es: ["SALVAVIDAS TÁCTICOS", "Cambiar pregunta"],
    fr: ["JOKERS TACTIQUES", "Changer la question"],
  };
  for (const [language, [heading, skipLabel]] of Object.entries(lifelineLocaleCopy)) {
    await lifelinePage.selectOption("#languageSelect", language);
    assert.equal(await lifelinePage.locator("#lifelineHeading").innerText(), heading);
    assert.equal(await lifelinePage.locator("#lifelineSkipLabel").innerText(), skipLabel);
    assert.equal(await lifelinePage.locator(".option:not([hidden])").count(), 2, "language changes preserve the active 50/50 effect");
  }
  await lifelinePage.selectOption("#languageSelect", "en");
  await lifelinePage.locator(".option:not([hidden])").first().tap();
  await lifelinePage.locator("#nextButton").tap();
  const scoreBeforeSkip = Number(await lifelinePage.locator("#scoreValue").innerText());
  const questionBeforeSkip = await lifelinePage.locator("#questionText").innerText();
  await lifelinePage.locator('[data-lifeline="skip"]').tap();
  assert.notEqual(await lifelinePage.locator("#questionText").innerText(), questionBeforeSkip, "skip draws a fresh question from the unused pool");
  assert.equal(Number(await lifelinePage.locator("#scoreValue").innerText()), scoreBeforeSkip, "skip does not add or deduct score points");
  assert.equal(await lifelinePage.locator("#coinBalance").innerText(), "125");
  assert.match(await lifelinePage.locator("#lifelineNotice").innerText(), /fresh question/i);
  assert.equal(await lifelinePage.locator("#lifelineUseCount").innerText(), "0/2 used", "the replacement question gets its own two-use allowance");
  await lifelinePage.locator('[data-lifeline="clue"]').tap();
  assert.equal(await lifelinePage.locator("#lifelineNotice").evaluate((node) => node.classList.contains("is-typing")), true);
  await lifelinePage.waitForFunction(() => !document.getElementById("lifelineNotice").classList.contains("is-typing"));
  const smartClue = await lifelinePage.locator("#lifelineNotice").innerText();
  assert.match(smartClue, /^Clue:/);
  assert.ok(
    !(await lifelinePage.locator(".option span:nth-child(2)").allInnerTexts()).includes(smartClue.replace(/^Clue: /, "")),
    "the contextual hint does not reveal an answer option",
  );
  assert.equal(await lifelinePage.locator("#coinBalance").innerText(), "100");
  assert.equal(
    await lifelinePage.evaluate(() => JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")).coins),
    100,
  );
  assert.ok(await lifelinePage.evaluate(() => window.__answerCueOscillators > 0), "lifeline use plays a synthetic Web Audio cue");
  await lifelinePage.close();

  assert.deepEqual(pageErrors, [], `The game page raised browser errors: ${pageErrors.join("; ")}`);
  console.log("Browser check passed: mobile touch targets and scrolling, orientation layout, five live mode previews, localized rounds, independent level maps, timer and focus penalties, coin economy, four strategic lifelines, rewards, and storage recovery.");
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
