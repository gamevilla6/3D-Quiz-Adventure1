import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { correctGKIndex, currentGKFact } from "./gk-bank.fixture.mjs";

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

async function waitForQuestionAdvance(page, previousQuestion) {
  await page.waitForFunction((previous) => (
    document.querySelector("#questionText")?.textContent !== previous ||
    document.querySelector("#resultsView")?.classList.contains("active")
  ), previousQuestion);
}

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => window.__quizVerseAppReady === true,
    null,
    { timeout: 12_000 },
  );
}

async function loadReadyPage(page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
}

async function reloadReadyPage(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
}

async function acceptRulesBriefingIfOpen(page) {
  const dialogIsOpen = await page.locator("#rulesStartDialog").evaluate((dialog) => dialog.open);
  if (dialogIsOpen) await page.locator("#confirmRulesStartButton").click();
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
  // Hold the startup overlay for a focused viewport/progress-bar check. The
  // production dismiss function is replaced only inside this disposable page.
  const splashContext = await browser.newContext({
    viewport: { width: 280, height: 653 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await splashContext.addInitScript(() => {
    const holdSplash = window.setInterval(() => {
      if (typeof window.__dismissQuizVerseLoading === "function") {
        window.__dismissQuizVerseLoading = () => {};
        window.clearInterval(holdSplash);
      }
    }, 0);
  });
  const splashPage = await splashContext.newPage();
  await splashPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const splashInitialState = await splashPage.evaluate(() => ({
    visible: Boolean(document.querySelector("#loadingScreen") &&
      !document.querySelector("#loadingScreen").classList.contains("is-hidden")),
    title: document.querySelector("#loadingScreen h2")?.textContent.trim(),
    progress: document.querySelector("#loadingPercent")?.textContent.trim(),
    progressLabel: document.querySelector("#loadingProgressLabel")?.textContent.trim(),
  }));
  assert.equal(splashInitialState.visible, true, "the splash remains until startup initialization finishes");
  assert.equal(splashInitialState.title, "QuizVerse 3D");
  assert.match(splashInitialState.progress, /^\d+%$/, "the startup percentage is determinate while loading");
  assert.ok(splashInitialState.progressLabel, "the progress indicator has an accessible label");
  await splashPage.waitForFunction(
    () => document.querySelector("#loadingPercent")?.textContent.trim() === "100%",
    null,
    { timeout: 8_000 },
  );
  for (const [width, height] of [[280, 653], [320, 720], [390, 844], [844, 390], [932, 430]]) {
    await splashPage.setViewportSize({ width, height });
    const splashLayout = await splashPage.evaluate(() => {
      const card = document.querySelector(".loading-screen-card").getBoundingClientRect();
      const title = document.querySelector("#loadingScreen h2").getBoundingClientRect();
      const track = document.querySelector(".loading-progress-track").getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
        titleRight: title.right,
        track: { left: track.left, right: track.right, width: track.width },
      };
    });
    assert.ok(splashLayout.pageWidth <= width, `splash has no horizontal overflow at ${width}×${height}`);
    assert.ok(splashLayout.card.left >= 0 && splashLayout.card.right <= width, `splash card fits at ${width}×${height}`);
    assert.ok(splashLayout.card.top >= 0 && splashLayout.card.bottom <= height, `splash card fits vertically at ${width}×${height}`);
    assert.ok(splashLayout.titleRight <= splashLayout.card.right, `title remains inside its card at ${width}×${height}`);
    assert.ok(splashLayout.track.width > 0 && splashLayout.track.left >= splashLayout.card.left && splashLayout.track.right <= splashLayout.card.right);
  }
  await splashPage.evaluate(() => window.__setQuizVerseLoadingProgress(43));
  assert.equal(await splashPage.locator("#loadingPercent").innerText(), "43%");
  assert.equal(await splashPage.locator('[data-testid="loading-progressbar"]').getAttribute("aria-valuenow"), "43");
  await splashPage.evaluate(() => window.__setQuizVerseLoadingProgress(140));
  assert.equal(await splashPage.locator("#loadingPercent").innerText(), "100%", "progress is clamped to its valid range");
  await splashPage.evaluate(() => {
    const language = document.querySelector("#languageSelect");
    language.value = "fr";
    language.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await splashPage.locator("#loadingLabel").innerText(), "Prêt à jouer", "loading copy follows the active language");
  await splashContext.close();

  const referralContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await referralContext.addInitScript(() => {
    localStorage.setItem("quizverse-daily-share-state-v1", JSON.stringify({
      version: 1,
      lastShareDate: new Date().toISOString().slice(0, 10),
      lastShareTimestamp: Date.now(),
      currentStreak: 3,
      totalClaims: 3,
    }));
    localStorage.setItem("quizverse-daily-share-state-v1:claim-lock", JSON.stringify({
      owner: "legacy",
      expiresAt: Date.now() + 60_000,
    }));
    window.__nativeShareCalls = 0;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => { window.__nativeShareCalls += 1; },
    });
  });
  const referralPage = await referralContext.newPage();
  await loadReadyPage(referralPage);
  assert.equal(await referralPage.locator("#dailyShareBanner, #dailyShareButton").count(), 0, "referral/share-to-earn UI is removed");
  assert.equal(await referralPage.locator("#dailyLoginCard").isVisible(), true, "daily login streak rewards remain available");
  assert.equal(await referralPage.locator("#openBossArenaButton").isVisible(), true, "the daily battle remains available");
  assert.equal(
    await referralPage.evaluate(() => document.body.innerText.match(/refer and earn|invite friends|share\s*&\s*earn/i)),
    null,
    "no referral or share-for-coins copy remains in the interface",
  );
  assert.deepEqual(
    await referralPage.evaluate(() => {
      const collection = JSON.parse(localStorage.getItem("quiz-orbit-reward-collection") || "null");
      return [
        localStorage.getItem("quizverse-daily-share-state-v1"),
        localStorage.getItem("quizverse-daily-share-state-v1:claim-lock"),
        collection?.coins ?? 0,
        window.__nativeShareCalls,
      ];
    }),
    [null, null, 0, 0],
    "startup removes retired claim data without awarding coins or opening a share flow",
  );
  await referralContext.close();

  const loginContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const loginPage = await loginContext.newPage();
  loginPage.setDefaultTimeout(10_000);
  await loadReadyPage(loginPage);
  assert.equal(await loginPage.locator("#dailyLoginCard").isVisible(), true);
  assert.equal(await loginPage.locator("#dailyLoginProgress").innerText(), "0/7 days claimed");
  assert.equal(await loginPage.locator("#dailyLoginClaimButton").evaluate((button) => button.getBoundingClientRect().height >= 48), true);
  for (const viewport of [
    { width: 280, height: 653 },
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await loginPage.setViewportSize(viewport);
    const loginLayout = await loginPage.evaluate(() => {
      const card = document.querySelector("#dailyLoginCard").getBoundingClientRect();
      const button = document.querySelector("#dailyLoginClaimButton").getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        left: card.left,
        right: card.right,
        buttonHeight: button.height,
      };
    });
    assert.ok(loginLayout.documentWidth <= viewport.width, "daily login card must not cause horizontal overflow");
    assert.ok(loginLayout.left >= 0 && loginLayout.right <= viewport.width, "daily login card must remain inside the viewport");
    assert.ok(loginLayout.buttonHeight >= 48, "daily login action must remain touch-sized");
  }
  await loginPage.setViewportSize({ width: 390, height: 844 });
  for (const [language, title] of [
    ["en", "Build your Streak Legend"],
    ["bn", "স্ট্রিক লেজেন্ড হয়ে উঠুন"],
    ["hi", "स्ट्रीक लीजेंड बनें"],
    ["es", "Conviértete en Leyenda de la Racha"],
    ["fr", "Devenez une légende de série"],
  ]) {
    await loginPage.selectOption("#languageSelect", language);
    assert.equal(await loginPage.locator("#dailyLoginTitle").innerText(), title);
  }
  await loginPage.selectOption("#languageSelect", "en");
  await loginPage.locator("#dailyLoginClaimButton").tap();
  await loginPage.waitForFunction(() => document.querySelector("#coinBalance")?.textContent === "25");
  let loginClaim = await loginPage.evaluate(() => ({
    state: JSON.parse(localStorage.getItem("quizverse-daily-login-state-v1")),
    coins: JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")).coins,
    claimDisabled: document.querySelector("#dailyLoginClaimButton").disabled,
  }));
  assert.equal(loginClaim.state.currentStreak, 1);
  assert.equal(loginClaim.state.totalClaims, 1);
  assert.equal(loginClaim.coins, 25);
  assert.equal(loginClaim.claimDisabled, true, "a second same-day claim is disabled");

  await loginPage.evaluate(() => {
    const collectionKey = "quiz-orbit-reward-collection";
    const collection = JSON.parse(localStorage.getItem(collectionKey));
    const yesterday = new Date(Date.now() - 86_400_000);
    const date = yesterday.toISOString().slice(0, 10);
    const previousState = {
      version: 1,
      lastLaunchDate: date,
      lastLaunchTimestamp: yesterday.getTime(),
      totalLaunchDays: 6,
      lastClaimDate: date,
      lastClaimTimestamp: yesterday.getTime(),
      currentStreak: 6,
      totalClaims: 6,
    };
    localStorage.setItem(collectionKey, JSON.stringify({ ...collection, coins: 0, badges: [] }));
    localStorage.setItem("quizverse-daily-login-state-v1", JSON.stringify(previousState));
  });
  await reloadReadyPage(loginPage);
  assert.equal(await loginPage.locator("#dailyLoginProgress").innerText(), "6/7 days claimed");
  assert.equal(await loginPage.locator("#dailyLoginClaimLabel").innerText(), "Claim 75 coins");
  assert.equal(await loginPage.locator('[data-login-day="6"]').getAttribute("data-active"), "true");
  assert.equal(await loginPage.locator('[data-login-day="7"]').getAttribute("data-current"), "true");
  await loginPage.locator("#dailyLoginClaimButton").tap();
  await loginPage.waitForFunction(() => document.querySelector("#coinBalance")?.textContent === "75");
  assert.equal(await loginPage.locator("#dailyLoginDialog").evaluate((dialog) => dialog.open), true);
  assert.equal(await loginPage.locator("#dailyLoginModalReward").innerText(), "+75 coins");
  const milestoneState = await loginPage.evaluate(() => ({
    login: JSON.parse(localStorage.getItem("quizverse-daily-login-state-v1")),
    collection: JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")),
  }));
  assert.equal(milestoneState.login.currentStreak, 7);
  assert.equal(milestoneState.collection.coins, 75);
  assert.ok(milestoneState.collection.badges.includes("streakLegend"), "the day-seven badge is persisted");
  for (const [language, title] of [
    ["bn", "স্ট্রিক লেজেন্ড"],
    ["hi", "स्ट्रीक लीजेंड"],
    ["es", "LEYENDA DE LA RACHA"],
    ["fr", "LÉGENDE DE SÉRIE"],
  ]) {
    await loginPage.selectOption("#languageSelect", language);
    assert.equal(await loginPage.locator("#dailyLoginModalTitle").innerText(), title);
  }
  await loginPage.selectOption("#languageSelect", "en");
  await loginPage.locator("#closeDailyLoginDialogButton").tap();
  await reloadReadyPage(loginPage);
  assert.equal(await loginPage.locator("#coinBalance").innerText(), "75", "reloading on the same day cannot duplicate the claim");
  assert.equal(await loginPage.locator("#dailyLoginClaimButton").isDisabled(), true);

  await loginPage.evaluate(() => {
    const collectionKey = "quiz-orbit-reward-collection";
    const collection = JSON.parse(localStorage.getItem(collectionKey));
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const yesterday = new Date(Date.now() - 86_400_000);
    const date = twoDaysAgo.toISOString().slice(0, 10);
    const launchDate = yesterday.toISOString().slice(0, 10);
    localStorage.setItem(collectionKey, JSON.stringify({ ...collection, coins: 0, badges: [] }));
    localStorage.setItem("quizverse-daily-login-state-v1", JSON.stringify({
      version: 1,
      lastLaunchDate: launchDate,
      lastLaunchTimestamp: yesterday.getTime(),
      totalLaunchDays: 6,
      lastClaimDate: date,
      lastClaimTimestamp: twoDaysAgo.getTime(),
      currentStreak: 6,
      totalClaims: 6,
    }));
  });
  await reloadReadyPage(loginPage);
  assert.equal(await loginPage.locator("#dailyLoginProgress").innerText(), "0/7 days claimed", "a missed claim day resets the streak");
  assert.equal(await loginPage.locator("#dailyLoginClaimLabel").innerText(), "Claim 25 coins");
  await loginPage.locator("#dailyLoginClaimButton").tap();
  await loginPage.waitForFunction(() => document.querySelector("#coinBalance")?.textContent === "25");
  const missedDayState = await loginPage.evaluate(() => ({
    login: JSON.parse(localStorage.getItem("quizverse-daily-login-state-v1")),
    collection: JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")),
  }));
  assert.equal(missedDayState.login.currentStreak, 1);
  assert.equal(missedDayState.collection.coins, 25);
  assert.ok(!missedDayState.collection.badges.includes("streakLegend"), "a missed day does not grant the milestone badge");
  await loginContext.close();

  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await loadReadyPage(page);
  const searchMetadata = await page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content,
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
    schema: JSON.parse(document.querySelector("#gameStructuredData")?.textContent || "{}"),
    bannerSlots: [...document.querySelectorAll(".native-ad-slot")].map((node) => ({
      placement: node.dataset.adPlacement,
      hidden: node.hidden,
      parentView: node.closest(".view")?.id,
    })),
    externalAdSdk: [...document.scripts].some((node) => /google.*ads|admob/i.test(node.src)),
  }));
  assert.match(searchMetadata.title, /General Knowledge.*Trivia/i);
  assert.match(searchMetadata.description, /2026 current affairs/i);
  assert.equal(searchMetadata.manifest, "./manifest.webmanifest");
  assert.equal(
    new URL(
      searchMetadata.manifest,
      "https://gamevilla6.github.io/3D-Quiz-Adventure1/",
    ).pathname,
    "/3D-Quiz-Adventure1/manifest.webmanifest",
    "the web manifest resolves inside a GitHub Pages project path",
  );
  assert.equal(searchMetadata.schema["@type"], "VideoGame");
  assert.equal(searchMetadata.schema.operatingSystem, "Web Browser");
  assert.deepEqual(searchMetadata.bannerSlots, [
    { placement: "home-banner", hidden: true, parentView: "welcomeView" },
    { placement: "level-map-banner", hidden: true, parentView: "levelView" },
  ]);
  assert.equal(searchMetadata.externalAdSdk, false, "the browser build must not load ad SDKs or trackers");
  const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(manifestResponse.ok, true, "the install metadata manifest is served");
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, "QuizVerse 3D: General Knowledge & Trivia");
  assert.equal(manifest.display, "standalone");

  // Exercise the native-wrapper contract separately so real browser tests remain
  // ad-free and the regular mobile layout is unchanged.
  const adContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await adContext.addInitScript(() => {
    window.QUIZVERSE_NATIVE_ADS_ENABLED = true;
    window.__quizVerseAdEvents = [];
    for (const eventName of ["quizverse:banner-placement", "quizverse:interstitial-opportunity"]) {
      window.addEventListener(eventName, (event) => {
        window.__quizVerseAdEvents.push({ type: eventName, ...event.detail });
      });
    }
  });
  const adPage = await adContext.newPage();
  await loadReadyPage(adPage);
  assert.equal(await adPage.locator("#homeBannerAdSlot").isVisible(), true);
  await adPage.locator("#startGameButton").click();
  assert.equal(await adPage.locator("#levelMapBannerAdSlot").isVisible(), true);
  assert.equal(await adPage.locator("#homeBannerAdSlot").isVisible(), false);
  const levelNavigationLayout = await adPage.evaluate(() => {
    const grid = document.querySelector("#levelGrid").getBoundingClientRect();
    const back = document.querySelector("#levelBackButton").getBoundingClientRect();
    return {
      gridBottom: grid.bottom,
      backTop: back.top,
      backHeight: back.height,
      backDock: Boolean(document.querySelector("#levelBackButton").closest(".level-bottom-nav")),
      topbarLogoCount: document.querySelectorAll(".topbar .brand").length,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  assert.ok(levelNavigationLayout.backTop >= levelNavigationLayout.gridBottom, "the level-map back action sits below the roadmap, not in its top-left header");
  assert.ok(levelNavigationLayout.backHeight >= 48 && levelNavigationLayout.backDock, "the bottom navigation dock is touch-sized");
  assert.equal(levelNavigationLayout.topbarLogoCount, 0, "the level map header has no top-left logo");
  assert.equal(levelNavigationLayout.horizontalOverflow, false);
  const bannerEvents = await adPage.evaluate(() => window.__quizVerseAdEvents);
  assert.deepEqual(
    bannerEvents.map((event) => event.placement),
    ["home-banner", "level-map-banner"],
    "wrapper receives bottom-banner placements only on Home and the Level Map",
  );
  await adPage.locator(".level-card.unlocked").first().click();
  await acceptRulesBriefingIfOpen(adPage);
  assert.equal(await adPage.locator("#homeBannerAdSlot").isVisible(), false);
  assert.equal(await adPage.locator("#levelMapBannerAdSlot").isVisible(), false);
  const quizNavigationLayout = await adPage.evaluate(() => ({
    backTop: document.querySelector("#quitButton").getBoundingClientRect().top,
    optionsBottom: document.querySelector("#options").getBoundingClientRect().bottom,
    backText: document.querySelector("#quitButtonLabel").textContent.trim(),
    topbarLogoCount: document.querySelectorAll(".topbar .brand").length,
  }));
  assert.ok(quizNavigationLayout.backTop >= quizNavigationLayout.optionsBottom, "quiz return navigation is below answers instead of crowding the HUD");
  assert.match(quizNavigationLayout.backText, /level map/i);
  assert.equal(quizNavigationLayout.topbarLogoCount, 0, "the gameplay header contains no logo");
  assert.equal(
    (await adPage.evaluate(() => window.__quizVerseAdEvents)).length,
    2,
    "the native wrapper receives no banner placement while gameplay is active",
  );
  await adContext.close();

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
  const rulesLocaleCopy = {
    en: ["How to play", "Keep the game in focus"],
    bn: ["কীভাবে খেলবেন", "গেমে মনোযোগ দিন"],
    hi: ["कैसे खेलें", "गेम पर ध्यान बनाए रखें"],
    es: ["Cómo jugar", "Mantén el juego en primer plano"],
    fr: ["Comment jouer", "Gardez le jeu au premier plan"],
  };
  for (const [language, [title, focusTitle]] of Object.entries(rulesLocaleCopy)) {
    await page.selectOption("#languageSelect", language);
    await page.locator("#openRulesPageButton").click();
    assert.equal(await page.locator("#rulesView").evaluate((node) => node.classList.contains("active")), true);
    assert.equal(await page.locator("#rulesPageTitle").innerText(), title, `the rules guide title is localized in ${language}`);
    assert.equal(await page.locator("#rulesPageFocusTitle").innerText(), focusTitle, `the focus rule is localized in ${language}`);
    assert.equal(await page.locator(".rules-guide-card").count(), 5, "the guide explains all core rule groups");
    assert.ok(
      await page.locator("#rulesBackButton").evaluate((node) => node.getBoundingClientRect().height >= 48),
      "the guide back button has a touch-sized target",
    );
    await page.locator("#rulesBackButton").click();
  }
  await page.setViewportSize({ width: 280, height: 653 });
  await page.locator("#openRulesPageButton").tap();
  const foldableRulesLayout = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    backWidth: document.querySelector("#rulesBackButton").getBoundingClientRect().width,
    backHeight: document.querySelector("#rulesBackButton").getBoundingClientRect().height,
    guideWidth: document.querySelector(".rules-page-shell").getBoundingClientRect().width,
  }));
  assert.ok(foldableRulesLayout.pageWidth <= foldableRulesLayout.viewportWidth, "the rules guide fits a 280px foldable viewport");
  assert.ok(foldableRulesLayout.backWidth >= 48 && foldableRulesLayout.backHeight >= 48, "the compact rules navigation remains touch-sized");
  assert.ok(foldableRulesLayout.guideWidth <= foldableRulesLayout.viewportWidth, "the guide cards stay inside the narrow viewport");
  await page.locator("#rulesBackButton").tap();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.selectOption("#languageSelect", "en");
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("quiz-orbit-language")),
    "en",
    "English selection is saved",
  );
  await reloadReadyPage(page);
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.locator("#welcomeTitle").innerText(), "QuizVerse 3D");
  assert.equal(await page.locator(".topbar .brand").count(), 0, "the shared header has no top-left logo");
  assert.equal(await page.title(), "QuizVerse 3D: General Knowledge & Trivia");
  assert.match(await page.locator('meta[name="viewport"]').getAttribute("content"), /viewport-fit=cover/);
  const mobileHomeTargets = await page.evaluate(() =>
    ["#languageSelect", "#soundToggle", "#startGameButton", "#openRewardsButton", "#homeModesButton", "#openRulesPageButton", "#openPrivacyPageButton", "#openPrivacyModalButton", "#openSettingsHomeButton", "#homeSoundToggle", ".category"]
      .map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })
  );
  assert.ok(mobileHomeTargets.every(({ width, height }) => width >= 48 && height >= 48), "home controls have touch-sized targets");
  const mobileVaultStyle = await page.locator("#coinBalanceChip").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: rect.width,
      height: rect.height,
      background: style.backgroundImage,
      border: style.borderColor,
      glow: style.boxShadow,
      blur: style.backdropFilter,
    };
  });
  assert.ok(mobileVaultStyle.width >= 70 && mobileVaultStyle.height >= 48, "the home coin vault is prominent and touch-sized on mobile");
  assert.match(mobileVaultStyle.glow, /255, 190, 61/, "the home coin vault has a visible gold glow");
  assert.match(mobileVaultStyle.blur, /blur\(16px\)/, "the home coin vault uses a glass blur");
  await page.setViewportSize({ width: 320, height: 720 });
  const narrowHeader = await page.evaluate(() => {
    const actions = document.querySelector(".topbar-actions").getBoundingClientRect();
    return { scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth, actionsLeft: actions.left, actionsRight: actions.right };
  });
  assert.ok(narrowHeader.scrollWidth <= narrowHeader.viewport, "the home vault and controls do not overflow at 320px");
  assert.ok(narrowHeader.actionsRight <= narrowHeader.viewport, `the compact header controls stay in the viewport: ${JSON.stringify(narrowHeader)}`);
  await page.setViewportSize({ width: 280, height: 653 });
  const foldableHomeTargets = await page.evaluate(() => {
    const selectors = ["#languageSelect", "#soundToggle", "#startGameButton", "#openRewardsButton", "#homeModesButton", "#openRulesPageButton", "#openPrivacyPageButton", "#openPrivacyModalButton", "#openSettingsHomeButton", "#homeSoundToggle", ".category"];
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      targets: selectors.map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
      actionsLeft: document.querySelector(".topbar-actions").getBoundingClientRect().left,
      actionsRight: document.querySelector(".topbar-actions").getBoundingClientRect().right,
    };
  });
  assert.ok(foldableHomeTargets.pageWidth <= foldableHomeTargets.viewportWidth, "the home screen has no overflow at 280px");
  assert.ok(foldableHomeTargets.actionsRight <= foldableHomeTargets.viewportWidth, "header controls remain inside the viewport");
  assert.ok(
    foldableHomeTargets.targets.every(({ width, height }) => width >= 48 && height >= 48),
    `all home controls remain touch-sized at 280px: ${JSON.stringify(foldableHomeTargets.targets)}`,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "the narrow mobile layout has no horizontal overflow",
  );
  assert.equal(await page.locator("#soundToggle").innerText(), "Game sounds on");
  await page.locator("#soundToggle").tap();
  assert.equal(await page.locator("#soundToggle").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#homeSoundToggleLabel").innerText(), "Game sounds off");
  assert.equal(await page.locator("#homeSoundToggle").getAttribute("aria-pressed"), "false");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("quiz-orbit-answer-sounds-muted")),
    "true",
  );
  await page.locator("#homeSoundToggle").tap();
  assert.equal(await page.locator("#soundToggle").getAttribute("aria-pressed"), "true", "the dock sound control syncs with the topbar");
  await page.locator("#soundToggle").tap();
  await reloadReadyPage(page);
  assert.equal(await page.locator("#soundToggle").innerText(), "Game sounds off");
  assert.equal(await page.locator("#soundToggle").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator(".home-option-group").count(), 3, "the home dock groups actions, information, and controls");
  assert.equal(await page.locator("#homeOptionHub").isVisible(), true);
  assert.ok(
    await page.locator("#homeSoundToggle").evaluate((node) => node.getBoundingClientRect().height >= 48),
    "the footer sound control remains touch-sized",
  );
  await page.locator("#languageSelect").selectOption("fr");
  assert.equal(await page.locator("#homeQuickGroupTitle").textContent(), "Actions rapides");
  assert.equal(await page.locator("#homeSettingsTitle").innerText(), "Paramètres");
  await page.locator("#languageSelect").selectOption("en");
  await page.locator("#openSettingsHomeButton").tap();
  assert.equal(await page.locator("#settingsDialog").evaluate((node) => node.open), true, "home settings opens the existing settings dialog");
  await page.locator("#closeSettingsButton").tap();
  await page.locator("#openPrivacyModalButton").tap();
  assert.equal(await page.locator("#privacyDialog").evaluate((node) => node.open), true, "privacy summary opens without navigation");
  await page.locator("#closePrivacyButton").tap();
  await page.locator("#openPrivacyPageButton").tap();
  assert.equal(await page.locator("#privacyView").evaluate((node) => node.classList.contains("active")), true);
  await page.locator("#privacyBackButton").tap();
  await page.locator("#homeModesButton").tap();
  assert.equal(await page.locator(".category.selected").count(), 1, "the dock mode shortcut returns focus to the current selection");

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
  assert.equal(await page.locator("#badgeGallery .badge-showcase-card").count(), 8);
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
  assert.equal(await page.locator("#badgeGallery .badge-showcase-card").count(), 6, "IQ filter shows IQ-specific badges and shared badges");
  await page.locator("#dashboardCategoryFilter").selectOption("Science & Technology");
  assert.equal(await page.locator("#badgeGallery .badge-showcase-card").count(), 6, "category filter updates the collection gallery");
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
    assert.equal(await page.locator("#levelGrid .level-card").count(), 500, "all 500 levels are rendered in the scrollable roadmap");
    assert.equal(await page.locator(".level-pagination").count(), 0, "the map has no extra page-navigation controls");
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
    assert.equal(await page.locator("#levelGrid .level-card.locked").count(), 499);
    await page.setViewportSize({ width: 320, height: 740 });
    const narrowMapLayout = await page.evaluate(() => {
      const grid = document.querySelector("#levelGrid");
      const tabs = document.querySelector(".level-category-tabs");
      const cards = [...grid.querySelectorAll(".level-card")];
      const bounds = cards.map((card) => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, scrollWidth: card.scrollWidth, clientWidth: card.clientWidth };
      });
      const overlaps = bounds.some((a, index) => bounds.slice(index + 1).some((b) =>
        a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1
      ));
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        columnGap: getComputedStyle(grid).columnGap,
        tabsOverflowX: getComputedStyle(tabs).overflowX,
        tabsScrolls: tabs.scrollWidth > tabs.clientWidth,
        tabMinHeight: Math.min(...[...tabs.children].map((tab) => tab.getBoundingClientRect().height)),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        cardMinWidth: Math.min(...bounds.map((card) => card.width)),
        cardMinHeight: Math.min(...bounds.map((card) => card.height)),
        cardTextOverflow: bounds.some((card) => card.scrollWidth > card.clientWidth + 1),
        overlaps,
      };
    });
    assert.ok(narrowMapLayout.columns >= 3, "the level map uses a compact responsive grid on a narrow phone");
    assert.equal(narrowMapLayout.tabsOverflowX, "auto");
    assert.equal(narrowMapLayout.tabsScrolls, true, "long category labels remain available in a horizontally swipeable row");
    assert.ok(narrowMapLayout.tabMinHeight >= 48, "category filter tabs remain touch-sized");
    assert.equal(narrowMapLayout.columnGap, "14px", "level nodes keep a consistent separation across viewport sizes");
    assert.ok(narrowMapLayout.cardMinWidth >= 65 && narrowMapLayout.cardMinHeight >= 55, "level nodes exceed the minimum touch target");
    assert.equal(narrowMapLayout.cardTextOverflow, false, "localized level-node content wraps within each tile");
    assert.equal(narrowMapLayout.overlaps, false, "level cards have clear grid gaps with no overlap");
    assert.ok(narrowMapLayout.documentWidth <= narrowMapLayout.viewportWidth, "the narrow roadmap does not create horizontal page overflow");
    for (const language of ["bn", "hi", "es", "fr"]) {
      await page.selectOption("#languageSelect", language);
      const localizedMapFit = await page.locator("#levelGrid .level-card").evaluateAll((cards) =>
        cards.every((card) => card.scrollWidth <= card.clientWidth + 1 && card.getBoundingClientRect().width >= 70),
      );
      assert.equal(localizedMapFit, true, `level-node labels fit without overlap in ${language} at 320px`);
    }
    await page.selectOption("#languageSelect", "en");
    await page.setViewportSize({ width: 280, height: 653 });
    const foldableMapLayout = await page.evaluate(() => {
      const grid = document.querySelector("#levelGrid");
      const tabs = document.querySelector(".level-category-tabs");
      const cards = [...grid.querySelectorAll(".level-card")];
      const bounds = cards.map((card) => card.getBoundingClientRect());
      const overlap = bounds.some((a, index) => bounds.slice(index + 1).some((b) =>
        a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1
      ));
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        cardMinWidth: Math.min(...bounds.map((card) => card.width)),
        cardMinHeight: Math.min(...bounds.map((card) => card.height)),
        tabMinHeight: Math.min(...[...tabs.children].map((tab) => tab.getBoundingClientRect().height)),
        overlap,
        scrollable: grid.scrollHeight > grid.clientHeight && getComputedStyle(grid).overflowY === "auto",
      };
    });
    assert.ok(foldableMapLayout.pageWidth <= foldableMapLayout.viewportWidth, "the level map does not overflow at 280px");
    assert.ok(foldableMapLayout.cardMinWidth >= 65 && foldableMapLayout.cardMinHeight >= 55, "foldable level nodes retain their touch target");
    assert.ok(foldableMapLayout.tabMinHeight >= 48, "foldable category tabs remain touch-sized");
    assert.equal(foldableMapLayout.overlap, false, "foldable level nodes never overlap");
    assert.equal(foldableMapLayout.scrollable, true, "the 500-level map remains vertically touch-scrollable");
    await page.setViewportSize({ width: 390, height: 844 });
    const levelMapScroll = await page.locator("#levelGrid").evaluate((node) => ({
      overflowY: getComputedStyle(node).overflowY,
      canScroll: node.scrollHeight > node.clientHeight,
    }));
    assert.equal(levelMapScroll.overflowY, "auto");
    assert.equal(levelMapScroll.canScroll, true, "the touch level map has its own scrollable area");
    assert.equal(await page.locator(".level-intro").count(), 0, "the roadmap has no oversized intro banner");
    await page.locator("#levelGrid").evaluate((node) => { node.scrollTop = 120; });
    assert.ok(await page.locator("#levelGrid").evaluate((node) => node.scrollTop > 0), "level cards scroll vertically on touch screens");
    await page.locator("#levelGrid").evaluate((node) => { node.scrollTop = 0; });
    await page.setViewportSize({ width: 740, height: 360 });
    const landscapeMap = await page.evaluate(() => {
      const grid = document.querySelector("#levelGrid");
      const cards = [...grid.querySelectorAll(".level-card")];
      const bounds = cards.map((card) => card.getBoundingClientRect());
      const overlap = bounds.some((a, index) => bounds.slice(index + 1).some((b) =>
        a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1
      ));
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        overlap,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    assert.ok(landscapeMap.columns >= 5, "the roadmap expands cleanly in landscape");
    assert.equal(landscapeMap.overlap, false, "landscape level nodes remain separate");
    assert.ok(landscapeMap.documentWidth <= landscapeMap.viewportWidth, "landscape roadmap has no page-wide horizontal overflow");
    await page.setViewportSize({ width: 390, height: 844 });
    const requiresRulesBriefing = await page.evaluate(() =>
      localStorage.getItem("quiz-orbit-rules-accepted") !== "true"
    );
    await page.locator(".level-card.unlocked").click();
    if (requiresRulesBriefing) {
      assert.equal(await page.locator("#rulesStartDialog").evaluate((dialog) => dialog.open), true);
      assert.equal(await page.locator(".rules-modal-item").count(), 4);
      assert.match(await page.locator("#rulesModalLimitBody").innerText(), /two different lifelines/i);
      assert.equal(
        await page.locator("#gameView").evaluate((node) => node.classList.contains("active")),
        false,
        "the first level waits for the rules briefing",
      );
      await page.locator("#cancelRulesStartButton").click();
      assert.equal(await page.locator("#rulesStartDialog").evaluate((dialog) => dialog.open), false);
      assert.equal(await page.locator("#gameView").evaluate((node) => node.classList.contains("active")), false);
      await page.locator(".level-card.unlocked").click();
      assert.equal(await page.locator("#rulesStartDialog").evaluate((dialog) => dialog.open), true);
      await page.locator("#confirmRulesStartButton").click();
      assert.equal(
        await page.evaluate(() => localStorage.getItem("quiz-orbit-rules-accepted")),
        "true",
        "confirming the briefing is remembered for future level starts",
      );
    } else {
      assert.equal(await page.locator("#rulesStartDialog").evaluate((dialog) => dialog.open), false);
    }
    assert.equal(await page.locator("#gameView").evaluate((node) => node.classList.contains("active")), true);
    assert.notEqual(await page.locator("#questionText").innerText(), "");
    assert.equal(await page.locator(".option").count(), 4);
    assert.equal(
      await page.locator("#quizUtilityRow").evaluate((node) => node.closest(".game-sidebar") !== null),
      true,
      "timer, lifelines, and coin balance share the compact sticky HUD",
    );
    assert.equal(await page.locator("#gameCoinBalanceChip").evaluate((node) => node.closest(".game-sidebar") !== null), true);
    assert.equal(await page.locator(".score-hud-card").count(), 0, "the visible score ticker is removed from the quiz HUD");
    assert.equal(await page.locator(".game-score-state").count(), 1, "score tracking remains available to assistive technology and game logic");
    assert.equal(await page.locator("#iqTimer").evaluate((node) => node.closest("#quizUtilityRow") !== null), true);
    assert.equal(await page.locator("#lifelinePanel").evaluate((node) => node.closest("#quizUtilityRow") !== null), true);
    assert.equal(await page.locator(".topbar").isVisible(), false, "global navigation is hidden during a round");
    for (const selector of [".quiz-meta", "#progressTrack", ".question-kicker", ".quiz-actions", "#coinPopupLayer", "#scorePopups"]) {
      assert.equal(await page.locator(selector).isVisible(), false, `${selector} adds no visible quiz-screen clutter`);
    }
    assert.ok(
      await page.locator(".feedback").evaluate((node) => node.getBoundingClientRect().width <= 1),
      "answer feedback remains available to screen readers without visible text",
    );
    assert.equal(await page.locator("#questionText").isVisible(), true);
    assert.equal(await page.locator("#options").isVisible(), true);
    assert.equal(await page.locator("#iqTimer").isVisible(), true);
    assert.equal(await page.locator("#lifelinePanel").isVisible(), true);
    const utilityRowLayout = await page.locator("#quizUtilityRow").evaluate((node) => ({
      columns: getComputedStyle(node).gridTemplateColumns.split(" ").length,
      timerTop: Math.round(node.querySelector("#iqTimer").getBoundingClientRect().top),
      timerHeight: Math.round(node.querySelector("#iqTimer").getBoundingClientRect().height),
      lifelinesTop: Math.round(node.querySelector("#lifelinePanel").getBoundingClientRect().top),
      lifelinesHeight: Math.round(node.querySelector("#lifelinePanel").getBoundingClientRect().height),
    }));
    assert.equal(utilityRowLayout.columns, 2, "timer and lifelines share two columns on a phone");
    assert.ok(Math.abs(utilityRowLayout.timerTop - utilityRowLayout.lifelinesTop) <= 1, "timer and lifelines align as one row");
    assert.ok(utilityRowLayout.timerHeight < 100, "the mobile timer card stays compact beside the lifelines");
    assert.ok(utilityRowLayout.lifelinesHeight <= 165, "the mobile lifeline grid stays compact and touch-sized");
    await page.setViewportSize({ width: 280, height: 653 });
    const foldableHudLayout = await page.evaluate(() => {
      const hud = document.querySelector(".game-sidebar").getBoundingClientRect();
      const card = document.querySelector("#quizCard").getBoundingClientRect();
      const lifelines = [...document.querySelectorAll(".lifeline-button")].map((button) => button.getBoundingClientRect());
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        hudBottom: hud.bottom,
        cardTop: card.top,
        targets: lifelines.map(({ width, height }) => ({ width, height })),
      };
    });
    assert.ok(foldableHudLayout.pageWidth <= foldableHudLayout.viewportWidth, "the active quiz fits a 280px foldable viewport");
    assert.ok(foldableHudLayout.cardTop >= foldableHudLayout.hudBottom, "the narrow HUD and question card do not overlap");
    assert.ok(
      foldableHudLayout.targets.every(({ width, height }) => width >= 48 && height >= 48),
      `all foldable lifeline controls are at least 48px: ${JSON.stringify(foldableHudLayout.targets)}`,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator(".game-sidebar").evaluate((node) => getComputedStyle(node).position), "sticky");
    const hudFlow = await page.evaluate(() => {
      const hud = document.querySelector(".game-sidebar").getBoundingClientRect();
      const topbar = document.querySelector(".topbar").getBoundingClientRect();
      const card = document.querySelector("#quizCard").getBoundingClientRect();
      return { hudTop: Math.round(hud.top), hudBottom: Math.round(hud.bottom), topbarBottom: Math.round(topbar.bottom), cardTop: Math.round(card.top) };
    });
    assert.ok(hudFlow.hudTop >= 0, "the sticky game HUD stays at the viewport top");
    assert.ok(hudFlow.cardTop >= hudFlow.hudBottom, "the quiz card starts below the sticky HUD without overlap");
    assert.ok(
      parseFloat(await page.locator(".game-sidebar").evaluate((node) => getComputedStyle(node).top)) >= 0,
      "the compact HUD has a safe, non-overlapping sticky offset",
    );
    const gameLayoutOrder = await page.locator(".game-layout").evaluate((node) =>
      [...node.children].map((child) => child.classList.contains("game-sidebar") ? "hud" : "quiz")
    );
    assert.deepEqual(gameLayoutOrder, ["hud", "quiz"], "the compact controls HUD precedes the question on mobile");
    assert.equal(await page.locator("#languageSelect").isVisible(), false, "language selection stays on the welcome screen");
    assert.equal(await page.locator("#gameLanguageSelect").isVisible(), true, "a quick language selector stays in the active HUD");
    const gameLanguagePlacement = await page.evaluate(() => {
      const coin = document.querySelector("#gameCoinBalanceChip").getBoundingClientRect();
      const language = document.querySelector("#gameLanguageSelect").getBoundingClientRect();
      return {
        coinRight: coin.right,
        languageLeft: language.left,
        languageWidth: language.width,
        languageHeight: language.height,
        inStickyHud: document.querySelector("#gameLanguageSelect").closest(".game-sidebar") !== null,
      };
    });
    assert.equal(gameLanguagePlacement.inStickyHud, true, "the language control is inside the sticky gameplay HUD");
    assert.ok(gameLanguagePlacement.languageLeft >= gameLanguagePlacement.coinRight, "the language selector sits beside the coin vault");
    assert.ok(gameLanguagePlacement.languageWidth >= 48 && gameLanguagePlacement.languageHeight >= 48, "the gameplay language selector is touch-sized");
    assert.ok(
      await page.locator(".option").first().evaluate((node) => node.getBoundingClientRect().height >= 50),
      "answer options are at least 50px high touch targets",
    );
    assert.equal(await page.locator("#iqTimer").isVisible(), true, "the countdown is active in every category");
    assert.equal(await page.locator(".option").first().getAttribute("data-answer"), null);
    await reloadReadyPage(page);
  }
  const lastPlayed = await page.evaluate(() => JSON.parse(localStorage.getItem("quiz-orbit-last-played-v1")));
  assert.deepEqual(
    { category: lastPlayed.category, level: lastPlayed.level },
    { category: "IQ Check", level: 1 },
    "the last played level is saved independently of the visible level map",
  );
  assert.equal(await page.locator("#continueJourneyButton").isVisible(), true);
  assert.match(await page.locator("#continueJourneyTarget").innerText(), /IQ Check.*1/i);
  await page.locator("#continueJourneyButton").click();
  assert.equal(await page.locator("#gameView").evaluate((node) => node.classList.contains("active")), true);
  assert.match(await page.locator("#gameCategory").textContent(), /IQ CHECK/i);
  await reloadReadyPage(page);

  const progressionContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await progressionContext.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(window.crypto), "getRandomValues", {
      configurable: true,
      value(array) {
        array.fill(0);
        return array;
      },
    });
    window.__coinCueOscillators = 0;
    window.AudioContext = class {
      state = "running";
      currentTime = 0;
      destination = {};
      createOscillator() {
        window.__coinCueOscillators += 1;
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
  const purchasePage = await progressionContext.newPage();
  purchasePage.setDefaultTimeout(10_000);
  await loadReadyPage(purchasePage);
  await purchasePage.evaluate(() => localStorage.setItem("quiz-orbit-reward-collection", JSON.stringify({
    version: 5,
    coins: 700,
  })));
  await reloadReadyPage(purchasePage);
  await purchasePage.locator("#startGameButton").click();
  await purchasePage.locator('.level-card[data-level="4"]').click();
  assert.equal(await purchasePage.locator("#levelUnlockDialog").evaluate((node) => node.open), true);
  assert.match(await purchasePage.locator("#levelUnlockDialogBody").innerText(), /300.*3/);
  await purchasePage.locator("#confirmLevelUnlockButton").click();
  assert.equal(await purchasePage.locator("#levelUnlockDialog").evaluate((node) => node.open), false);
  assert.ok(
    await purchasePage.evaluate(() => window.__coinCueOscillators > 0),
    "spending coins to unlock a level plays the synthesized coin cue",
  );
  assert.equal(await purchasePage.locator("#coinBalance").innerText(), "400");
  assert.equal(await purchasePage.locator("#levelGrid .level-card.unlocked").count(), 4);
  assert.equal(await purchasePage.locator("#levelGrid .level-card.completed").count(), 0, "coin skips do not mark quiz clears as completed");
  assert.equal(await purchasePage.locator("#levelGrid .level-card.locked").count(), 496);
  assert.equal(
    await purchasePage.locator('.level-card[data-level="1"]').evaluate((node) => node.classList.contains("unlocked")),
    true,
    "a skipped but playable stage stays distinct from a completed stage",
  );
  assert.match(await purchasePage.locator("#mapUnlockNotice").innerText(), /Level 4 unlocked/);
  await reloadReadyPage(purchasePage);
  await purchasePage.locator("#startGameButton").click();
  assert.equal(await purchasePage.locator("#levelGrid .level-card.unlocked").count(), 4, "coin-purchased access persists after reload");
  assert.equal(await purchasePage.locator("#coinBalance").innerText(), "400", "the spent balance persists after reload");
  await purchasePage.selectOption("#languageSelect", "fr");
  await purchasePage.locator('.level-card[data-level="10"]').click();
  assert.match(await purchasePage.locator("#levelUnlockDialogBody").innerText(), /niveau 10/i);
  assert.equal(await purchasePage.locator("#confirmLevelUnlockButton").isDisabled(), true);
  assert.match(await purchasePage.locator("#levelUnlockShortfall").innerText(), /200/);
  await purchasePage.locator("#cancelLevelUnlockButton").click();
  await progressionContext.close();

  const thresholdContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await thresholdContext.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(window.crypto), "getRandomValues", {
      configurable: true,
      value(array) {
        array.fill(0);
        return array;
      },
    });
    window.QUIZVERSE_NATIVE_ADS_ENABLED = true;
    window.__quizVerseAdEvents = [];
    for (const eventName of ["quizverse:banner-placement", "quizverse:interstitial-opportunity"]) {
      window.addEventListener(eventName, (event) => {
        window.__quizVerseAdEvents.push({ type: eventName, ...event.detail });
      });
    }
  });
  const thresholdPage = await thresholdContext.newPage();
  thresholdPage.setDefaultTimeout(10_000);
  await loadReadyPage(thresholdPage);
  await thresholdPage.locator("#startGameButton").click();
  await thresholdPage.locator(".level-card.unlocked").click();
  await acceptRulesBriefingIfOpen(thresholdPage);
  for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
    const correctIndex = await correctGKIndex(thresholdPage);
    const questionBeforeAnswer = await thresholdPage.locator("#questionText").innerText();
    const answerIndex = questionIndex < 6 ? correctIndex : (correctIndex + 1) % 4;
    await thresholdPage.locator(".option").nth(answerIndex).click();
    await waitForQuestionAdvance(thresholdPage, questionBeforeAnswer);
  }
  assert.equal(await thresholdPage.locator("#finalCorrect").innerText(), "6");
  assert.equal(
    await thresholdPage.evaluate(() => {
      const token = localStorage.getItem("quiz-orbit-gk-unlocked-level");
      return token ? atob(token).split(":")[2] : null;
    }),
    "2",
    "six correct answers out of ten unlock the next level",
  );
  assert.deepEqual(
    await thresholdPage.evaluate(() => window.__quizVerseAdEvents.map(({ type, placement }) => [type, placement])),
    [
      ["quizverse:banner-placement", "home-banner"],
      ["quizverse:banner-placement", "level-map-banner"],
    ],
    "banner events are limited to non-gameplay screens",
  );
  await thresholdPage.locator("#playAgainButton").click();
  await thresholdPage.waitForFunction(() => document.querySelector("#hudLevel")?.textContent.includes("Level 2"));
  assert.deepEqual(
    await thresholdPage.evaluate(() => window.__quizVerseAdEvents
      .filter(({ type }) => type === "quizverse:interstitial-opportunity")
      .map(({ placement, completedLevel, nextLevel, gameplayVisible }) =>
        ({ placement, completedLevel, nextLevel, gameplayVisible }))),
    [{ placement: "between-levels", completedLevel: 1, nextLevel: 2, gameplayVisible: false }],
    "interstitial opportunities are emitted after a cleared level and before the next one",
  );
  await thresholdPage.evaluate(() => localStorage.clear());
  await reloadReadyPage(thresholdPage);
  await thresholdPage.locator("#startGameButton").click();
  await thresholdPage.locator(".level-card.unlocked").click();
  await acceptRulesBriefingIfOpen(thresholdPage);
  for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
    const correctIndex = await correctGKIndex(thresholdPage);
    const questionBeforeAnswer = await thresholdPage.locator("#questionText").innerText();
    const answerIndex = questionIndex < 5 ? correctIndex : (correctIndex + 1) % 4;
    await thresholdPage.locator(".option").nth(answerIndex).click();
    await waitForQuestionAdvance(thresholdPage, questionBeforeAnswer);
  }
  assert.match(await thresholdPage.locator("#levelUnlockNotice").innerText(), /6 correct/i);
  await thresholdPage.locator("#returnLevelMapButton").click();
  assert.equal(await thresholdPage.locator("#levelGrid .level-card.unlocked").count(), 1, "five correct answers do not unlock the next level");
  await thresholdContext.close();

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
  await reloadReadyPage(page);
  await page.locator('.category[data-category="Science & Technology"]').click();
  await page.locator("#startGameButton").click();
  assert.equal(await page.locator("#levelGrid .level-card.completed").count(), 1);
  assert.equal(await page.locator("#levelGrid .level-card.unlocked").count(), 1);
  assert.equal(await page.locator("#levelGrid .level-card.locked").count(), 498);
  assert.equal(
    await page.locator("#levelGrid .level-card.locked").first().getAttribute("disabled"),
    null,
    "locked levels remain actionable so players can view their coin unlock price",
  );
  await page.locator("#levelBackButton").click();
  await page.locator('.category[data-category="General Knowledge"]').click();
  await page.locator("#startGameButton").click();
  assert.equal(await page.locator("#levelGrid .level-card.unlocked").count(), 1, "science progress does not unlock General Knowledge levels");
  assert.equal(await page.locator("#levelGrid .level-card.locked").count(), 499);
  await page.evaluate((key) => localStorage.removeItem(key), scienceProgressKey);
  await reloadReadyPage(page);
  await page.evaluate(() => localStorage.setItem("quiz-orbit-reward-collection", JSON.stringify({
    version: 5,
    levelResults: [{ category: "Science & Technology", level: 2, stars: 3, coins: 50 }],
  })));
  await reloadReadyPage(page);
  await page.locator('.category[data-category="Science & Technology"]').click();
  await page.locator("#startGameButton").click();
  assert.equal(await page.locator("#levelGrid .level-card.unlocked").count(), 1);
  assert.equal(await page.locator("#levelGrid .level-card.locked").count(), 499);
  assert.equal(
    await page.locator('.level-card[data-level="2"]').evaluate((node) => node.classList.contains("locked")),
    true,
    "saved reward decorations cannot unlock a level without its progression token",
  );
  await page.locator('.level-card[data-level="2"]').click();
  assert.equal(await page.locator("#levelUnlockDialog").evaluate((node) => node.open), true);
  assert.equal(await page.locator("#confirmLevelUnlockButton").isDisabled(), true);
  await page.locator("#cancelLevelUnlockButton").click();
  await page.locator("#levelBackButton").click();
  await page.evaluate(() => localStorage.removeItem("quiz-orbit-reward-collection"));
  await reloadReadyPage(page);

  await page.locator('.category[data-category="General Knowledge"]').click();
  await page.locator("#startGameButton").click();
  assert.equal(await page.locator("#levelView").evaluate((node) => node.classList.contains("active")), true);
  await page.locator(".level-card.unlocked").click();
  const portalCorrectIndex = await correctGKIndex(page);
  await page.keyboard.press(String(portalCorrectIndex + 1));
  assert.equal(await page.evaluate(() => window.__answerCueOscillators), 0, "muted answers do not create sound cues");
  assert.match(await page.locator("#feedback").textContent(), /Correct!/);
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
  assert.equal(await page.locator(".option").nth(portalCorrectIndex).getAttribute("disabled"), "");
  assert.equal(await page.locator(".option").nth(portalCorrectIndex).getAttribute("class").then((value) => value.includes("correct")), true);
  const audioTestPage = await context.newPage();
  audioTestPage.on("pageerror", (error) => pageErrors.push(error.message));
  await loadReadyPage(audioTestPage);
  await audioTestPage.locator("#soundToggle").tap();
  await audioTestPage.locator("#startGameButton").tap();
  await audioTestPage.locator(".level-card.unlocked").tap();
  const audioQuestion = await audioTestPage.locator("#questionText").innerText();
  await audioTestPage.locator(".option").nth(await correctGKIndex(audioTestPage)).tap();
  assert.equal(
    await audioTestPage.evaluate(() => window.__answerCueOscillators),
    2,
    "enabled correct answers play separate answer and coin sound cues",
  );
  await audioTestPage.close();

  const penaltyPage = await context.newPage();
  penaltyPage.on("pageerror", (error) => pageErrors.push(error.message));
  await loadReadyPage(penaltyPage);
  await penaltyPage.locator("#startGameButton").tap();
  await penaltyPage.locator(".level-card.unlocked").tap();
  await penaltyPage.setViewportSize({ width: 844, height: 390 });
  assert.ok(
    await penaltyPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "the landscape quiz layout has no horizontal overflow",
  );
  assert.equal(await penaltyPage.locator(".game-sidebar").evaluate((node) => getComputedStyle(node).position), "sticky");
  await penaltyPage.evaluate(() => window.scrollTo(0, 300));
  await penaltyPage.waitForTimeout(100);
  const landscapeHud = await penaltyPage.evaluate(() => {
    const bounds = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
    };
    return { topbar: bounds(".topbar"), hud: bounds(".game-sidebar"), utility: bounds("#quizUtilityRow"), height: window.innerHeight, scrollY: window.scrollY };
  });
  assert.equal(await penaltyPage.locator(".topbar").isVisible(), false, "the landscape quiz has no global header above the HUD");
  assert.ok(landscapeHud.hud.top >= 0 && landscapeHud.hud.top <= 8, "landscape HUD remains pinned to the viewport top");
  assert.ok(landscapeHud.utility.bottom <= landscapeHud.height, "landscape timer and lifelines stay fully on-screen while scrolling");
  if (landscapeHud.scrollY > 0) {
    assert.ok(landscapeHud.hud.top <= 8, "the sticky HUD remains visible after actual page scrolling");
  }
  await penaltyPage.evaluate(() => window.scrollTo(0, 0));
  await penaltyPage.setViewportSize({ width: 390, height: 844 });
  const initialTimerSeconds = Number((await penaltyPage.locator("#iqTimerValue").innerText()).match(/\d+/)?.[0]);
  await penaltyPage.waitForTimeout(1200);
  const elapsedTimerSeconds = Number((await penaltyPage.locator("#iqTimerValue").innerText()).match(/\d+/)?.[0]);
  assert.ok(elapsedTimerSeconds < initialTimerSeconds, "the visible timer decreases from the active question's start");
  const initialPenaltyQuestion = await penaltyPage.locator("#questionText").innerText();
  await penaltyPage.locator(".option").nth(await correctGKIndex(penaltyPage)).tap();
  const timerAtAnswer = await penaltyPage.locator("#iqTimerValue").innerText();
  await penaltyPage.waitForTimeout(250);
  assert.equal(await penaltyPage.locator("#iqTimerValue").innerText(), timerAtAnswer, "answer submission stops the timer immediately");
  const scoreBeforePenalty = Number(await penaltyPage.locator("#scoreValue").innerText());
  await waitForQuestionAdvance(penaltyPage, initialPenaltyQuestion);
  assert.equal(
    Number((await penaltyPage.locator("#iqTimerValue").innerText()).match(/\d+/)?.[0]),
    15,
    "each new question starts a fresh 15-second deadline",
  );
  const nextCorrectIndex = await correctGKIndex(penaltyPage);
  const questionBeforePenalty = await penaltyPage.locator("#questionText").innerText();
  await penaltyPage.locator(".option").nth((nextCorrectIndex + 1) % 4).tap();
  const scoreAfterPenalty = Number(await penaltyPage.locator("#scoreValue").innerText());
  assert.equal(scoreAfterPenalty, Math.max(0, scoreBeforePenalty - 5));
  assert.equal(await penaltyPage.locator("#feedback").evaluate((node) => node.classList.contains("penalty-warning")), true);
  assert.equal(await penaltyPage.locator("#quizCard").evaluate((node) => node.classList.contains("penalty-screen")), true);
  const scoreBeforeFocusLoss = Number(await penaltyPage.locator("#scoreValue").innerText());
  await waitForQuestionAdvance(penaltyPage, questionBeforePenalty);
  await penaltyPage.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.match(await penaltyPage.locator("#feedback").textContent(), /focus/i);
  assert.equal(
    Number(await penaltyPage.locator("#scoreValue").innerText()),
    Math.max(0, scoreBeforeFocusLoss - 5),
  );
  await penaltyPage.close();

  await reloadReadyPage(page);
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.locator("#welcomeTitle").innerText(), "QuizVerse 3D");

  await page.selectOption("#languageSelect", "bn");
  await reloadReadyPage(page);
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
  assert.equal((await currentGKFact(page)).language, "bn");
  const firstQuestion = await page.locator("#questionText").innerText();
  for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
    const optionIndex = await correctGKIndex(page);
    const questionBeforeAnswer = await page.locator("#questionText").innerText();
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
    await waitForQuestionAdvance(page, questionBeforeAnswer);
  }

  assert.equal(await page.locator("#resultsView").evaluate((node) => node.classList.contains("active")), true);
  assert.equal(await page.locator("#resultTitle").innerText(), "সম্পন্ন");
  assert.equal(await page.locator("#finalCorrect").innerText(), "১০");
  assert.equal(await page.locator("#finalIncorrect").innerText(), "০");
  assert.equal(await page.locator("#finalAccuracy").innerText(), "১০০%");
  assert.equal(await page.locator("#resultMessage").isVisible(), true);
  assert.match(
    await page.locator("#resultMessage").innerText(),
    /১০ পয়েন্ট.*৫ সেকেন্ড.*−৫/,
    "the result explains the correct-answer, speed-bonus, and penalty formula",
  );
  assert.equal(await page.locator("#finalTotal").isVisible(), false, "the clean summary omits the redundant total-question metric");
  assert.equal(await page.locator("#finalDenominator").innerText(), "পয়েন্ট");
  assert.equal(await page.locator("#resultStars").evaluate((node) => node.textContent), "★★★");
  assert.equal(await page.locator("#resultStars").getAttribute("aria-label"), "৩টি তারকা");
  assert.equal(await page.locator(".result-actions button").count(), 2, "results expose only the next-level and map actions");
  assert.equal(await page.locator("#returnLevelMapLabel").innerText(), "লেভেল ম্যাপে ফিরুন");
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
  for (const [language, expectedCopy] of [
    ["en", "Correct:"],
    ["bn", "সঠিক:"],
    ["hi", "सही:"],
    ["es", "Acierto:"],
    ["fr", "Bonne réponse"],
  ]) {
    await page.locator("#languageSelect").selectOption(language);
    assert.match(
      await page.locator("#resultMessage").innerText(),
      new RegExp(expectedCopy),
      `the scoring rule remains localized in ${language}`,
    );
  }
  await page.locator("#languageSelect").selectOption("bn");
  for (const width of [280, 320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const resultBounds = await page.evaluate(() => {
      const card = document.querySelector("#resultCard");
      const buttons = [...document.querySelectorAll(".result-actions > button")];
      const box = card.getBoundingClientRect();
      const rect = (selector) => {
        const element = document.querySelector(selector);
        const { left, right } = element.getBoundingClientRect();
        return { left, right };
      };
      return {
        viewportWidth: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        cardWidth: box.width,
        coin: rect("#coinBalanceChip"),
        language: rect("#languageSelect"),
        soundVisible: getComputedStyle(document.querySelector("#soundToggle")).display !== "none",
        popupDisplay: getComputedStyle(document.querySelector("#coinPopupLayer")).display,
        metricBackground: getComputedStyle(document.querySelector(".result-stat")).backgroundColor,
        actions: buttons.map((button) => ({
          height: button.getBoundingClientRect().height,
          minHeight: getComputedStyle(button).minHeight,
          transform: getComputedStyle(button).transform,
          offsetHeight: button.offsetHeight,
        })),
      };
    });
    assert.ok(resultBounds.pageWidth <= resultBounds.viewportWidth, `no horizontal overflow at ${width}px`);
    assert.ok(resultBounds.cardWidth <= resultBounds.viewportWidth, `result card fits at ${width}px`);
    assert.ok(resultBounds.coin.right <= resultBounds.language.left, `coin counter and language selector do not overlap at ${width}px`);
    assert.equal(resultBounds.soundVisible, false, `the result header stays compact at ${width}px`);
    assert.equal(resultBounds.popupDisplay, "none", `coin popups do not cover the result header at ${width}px`);
    assert.equal(resultBounds.metricBackground, "rgba(255, 255, 255, 0.06)", "result metrics retain high contrast");
    assert.ok(
      resultBounds.actions.every(({ height }) => height >= 50),
      `both actions are touch-sized at ${width}px: ${JSON.stringify(resultBounds)}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    new Intl.NumberFormat("bn-BD").format(savedCollection.bestPoints),
    await page.locator("#finalScore").innerText(),
    "the personal best points match the round",
  );

  assert.equal(await page.locator("#playAgainLabel").innerText(), "পরের লেভেল খেলুন");
  await page.locator("#playAgainButton").tap();
  assert.equal(await page.locator("#gameView").evaluate((node) => node.classList.contains("active")), true);
  assert.notEqual(await page.locator("#questionText").innerText(), firstQuestion);
  assert.equal(await page.locator("#scoreValue").innerText(), "০");
  assert.equal(await page.locator("#correctCount").innerText(), "০");
  assert.equal(await page.locator(".option").count(), 4);
  for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
    const questionBeforeAnswer = await page.locator("#questionText").innerText();
    await page.locator(".option").first().tap();
    await waitForQuestionAdvance(page, questionBeforeAnswer);
  }
  const mergedCollection = await page.evaluate(() => JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")));
  assert.ok(mergedCollection.trophies.includes("gold"), "a later round keeps the previously earned gold trophy");
  assert.ok(mergedCollection.badges.includes("quizMaster"), "a later round keeps previously earned badges");
  assert.equal(mergedCollection.bestStreak, 10, "a later round does not reduce the personal best streak");
  assert.ok(mergedCollection.coins > 0, "the level completion and answer coin rewards persist");
  assert.ok(mergedCollection.claimedLevelCoinRewards.includes("General Knowledge:1"), "the one-time level-clear reward is claimed");
  const resultCoinSummary = await page.locator("#resultCoinAmount").innerText();
  assert.ok(resultCoinSummary.startsWith("+"), "the results screen summarizes coins earned in the round");

  await page.locator("#returnLevelMapButton").tap();
  assert.equal(await page.locator("#levelView").evaluate((node) => node.classList.contains("active")), true);
  await page.locator("#levelBackButton").tap();
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
  assert.equal(await page.locator("#levelGrid .level-card.locked").count(), 498);
  assert.equal(await page.locator('.level-card.completed[data-level="1"] .level-card-stars').innerText(), "★★★");
  assert.equal(await page.locator('.level-card.completed[data-level="1"] .level-card-coins').innerText(), "+৫০ 🪙");
  assert.equal(await page.locator('.level-card.completed[data-level="1"] .level-card-indicator').innerText(), "🏆");
  await page.locator("#levelBackButton").tap();
  await reloadReadyPage(page);
  assert.match(await page.locator("#collectionTrophies").innerText(), /ট্রফি/);
  assert.match(await page.locator("#collectionBadges").innerText(), /কুইজ মাস্টার/);

  await page.evaluate(() => localStorage.setItem("quiz-orbit-reward-collection", "{not valid json"));
  await reloadReadyPage(page);
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
  await loadReadyPage(blockedStoragePage);
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
  await loadReadyPage(lifelinePage);
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
  await reloadReadyPage(lifelinePage);
  const lifelineLocaleCopy = {
    en: ["TACTICAL LIFELINES", "Skip question"],
    bn: ["কৌশলগত লাইফলাইন", "প্রশ্ন বদলান"],
    hi: ["रणनीतिक लाइफलाइन", "प्रश्न बदलें"],
    es: ["SALVAVIDAS TÁCTICOS", "Cambiar pregunta"],
    fr: ["JOKERS TACTIQUES", "Changer la question"],
  };
  for (const [language, [heading, skipLabel]] of Object.entries(lifelineLocaleCopy)) {
    await lifelinePage.selectOption("#languageSelect", language);
    assert.equal(await lifelinePage.locator("#lifelineHeading").textContent(), heading);
    assert.equal(await lifelinePage.locator("#lifelineSkipLabel").textContent(), skipLabel);
  }
  await lifelinePage.selectOption("#languageSelect", "en");
  await lifelinePage.locator('.category[data-category="General Knowledge"]').tap();
  await lifelinePage.locator("#startGameButton").tap();
  await lifelinePage.locator(".level-card.unlocked").tap();
  await lifelinePage.setViewportSize({ width: 280, height: 653 });
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
  assert.ok(
    await lifelinePage.locator("#gameLanguageSelect").evaluate((select) => {
      const rect = select.getBoundingClientRect();
      return rect.width >= 48 && rect.height >= 48 && select.closest("#gameCoinBalanceChip") === null;
    }),
    "the gameplay language selector stays independently touch-accessible beside the coin vault",
  );
  const englishQuestionBeforeSwitch = await lifelinePage.locator("#questionText").innerText();
  await lifelinePage.waitForTimeout(1400);
  const timerBeforeLanguageSwitch = Number(await lifelinePage.locator("#iqTimerBar").getAttribute("aria-valuenow"));
  await lifelinePage.locator("#gameLanguageSelect").selectOption("bn");
  const timerAfterLanguageSwitch = Number(await lifelinePage.locator("#iqTimerBar").getAttribute("aria-valuenow"));
  assert.notEqual(await lifelinePage.locator("#questionText").innerText(), englishQuestionBeforeSwitch, "the active question immediately changes language");
  assert.equal(await lifelinePage.locator("#gameLanguageSelect").inputValue(), "bn");
  assert.equal(await lifelinePage.locator("#languageSelect").inputValue(), "bn", "the home language preference stays synchronized");
  assert.ok(
    timerAfterLanguageSwitch <= timerBeforeLanguageSwitch && timerAfterLanguageSwitch < 15,
    "changing language does not restart the question timer",
  );
  await lifelinePage.locator("#gameLanguageSelect").selectOption("en");
  assert.equal(await lifelinePage.locator("#questionText").innerText(), englishQuestionBeforeSwitch, "the original question returns in English");

  await lifelinePage.emulateMedia({ reducedMotion: "no-preference" });
  await lifelinePage.locator('[data-lifeline="fifty"]').tap();
  assert.equal(await lifelinePage.locator(".option.is-eliminating").count(), 2, "50/50 animates the eliminated options away");
  await lifelinePage.waitForFunction(() => document.querySelectorAll(".option[hidden]").length === 2);
  assert.equal(await lifelinePage.locator(".option:not([hidden])").count(), 2, "50/50 keeps the correct choice and one distractor");
  assert.equal(await lifelinePage.locator("#coinBalance").innerText(), "180");
  assert.equal(await lifelinePage.locator("#gameCoinBalance").innerText(), "180");
  assert.equal(await lifelinePage.locator(".coin-popup").count(), 0, "the streamlined round shows no floating coin popups");
  assert.equal(
    await lifelinePage.evaluate(() => JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")).coins),
    180,
    "lifeline charges persist immediately",
  );
  const questionAfterFiftyFifty = await lifelinePage.locator("#questionText").innerText();
  await lifelinePage.locator("#gameLanguageSelect").selectOption("fr");
  assert.notEqual(await lifelinePage.locator("#questionText").innerText(), questionAfterFiftyFifty, "French translation also updates the active question");
  assert.equal(await lifelinePage.locator("#lifelineHeading").innerText(), "JOKERS TACTIQUES");
  assert.equal(await lifelinePage.locator(".option[hidden]").count(), 2, "a language change preserves the active 50/50 state");
  assert.equal(await lifelinePage.locator("#gameCoinBalance").innerText(), "180", "a language change preserves the coin balance");
  await lifelinePage.locator("#gameLanguageSelect").selectOption("en");

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

  assert.equal(await lifelinePage.locator(".topbar").isVisible(), false, "global navigation and sound controls are not part of active play");
  await lifelinePage.locator(".option:not([hidden])").first().tap();
  const answeredQuestionBeforeSkip = await lifelinePage.locator("#questionText").innerText();
  await waitForQuestionAdvance(lifelinePage, answeredQuestionBeforeSkip);
  const scoreBeforeSkip = Number(await lifelinePage.locator("#scoreValue").innerText());
  const questionBeforeSkip = await lifelinePage.locator("#questionText").innerText();
  await lifelinePage.locator('[data-lifeline="skip"]').tap();
  assert.notEqual(await lifelinePage.locator("#questionText").innerText(), questionBeforeSkip, "skip draws a fresh question from the unused pool");
  assert.equal(Number(await lifelinePage.locator("#scoreValue").innerText()), scoreBeforeSkip, "skip does not add or deduct score points");
  assert.equal(await lifelinePage.locator("#coinBalance").innerText(), "125");
  assert.equal(await lifelinePage.locator("#lifelineNotice").isVisible(), false, "non-hint lifeline feedback does not add a banner");
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
  const externalBalance = await lifelinePage.evaluate(() => {
    const key = "quiz-orbit-reward-collection";
    const collection = JSON.parse(localStorage.getItem(key));
    collection.coins += 1;
    localStorage.setItem(key, JSON.stringify(collection));
    return collection.coins;
  });
  await page.waitForFunction((balance) => {
    const formatted = new Intl.NumberFormat(document.documentElement.lang).format(balance);
    return document.querySelector("#coinBalance").textContent === formatted &&
      document.querySelector("#coinBalanceChip").classList.contains("coin-balance-pulse");
  }, externalBalance);
  const synchronizedVault = await page.evaluate(() => ({
    coins: JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")).coins,
    header: document.querySelector("#coinBalance").textContent,
    telemetry: document.querySelector("#portalVaultBalance").textContent,
    language: document.documentElement.lang,
  }));
  assert.equal(
    synchronizedVault.header,
    new Intl.NumberFormat(synchronizedVault.language).format(synchronizedVault.coins),
    "the home coin vault refreshes from another tab's localStorage update",
  );
  assert.equal(synchronizedVault.telemetry, synchronizedVault.header, "the home telemetry and coin pill stay synchronized");
  assert.equal(synchronizedVault.coins, externalBalance);
  await lifelinePage.close();

  const stabilityPage = await context.newPage();
  const stabilityErrors = [];
  stabilityPage.on("pageerror", (error) => stabilityErrors.push(error.message));
  await stabilityPage.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    const nativeClearInterval = window.clearInterval.bind(window);
    window.__questionIntervals = new Set();
    window.setInterval = (callback, milliseconds, ...args) => {
      const id = nativeSetInterval(callback, milliseconds, ...args);
      if (milliseconds === 50) window.__questionIntervals.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      window.__questionIntervals.delete(id);
      return nativeClearInterval(id);
    };
    const realNow = performance.now.bind(performance);
    window.__timingOffset = 0;
    Object.defineProperty(performance, "now", { value: () => realNow() + window.__timingOffset });
  });
  await stabilityPage.route("**/cdn.jsdelivr.net/**", (route) => route.abort());
  await loadReadyPage(stabilityPage);
  await stabilityPage.setViewportSize({ width: 280, height: 653 });
  assert.ok(await stabilityPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "the settings entry fits a 280px home header");
  await stabilityPage.locator("#openRulesPageButton").click();
  assert.equal(await stabilityPage.locator("#rulesView").evaluate((node) => node.classList.contains("active")), true);
  await stabilityPage.locator("#rulesBackButton").click();
  assert.equal(await stabilityPage.locator("#welcomeView").evaluate((node) => node.classList.contains("active")), true);
  await stabilityPage.locator("#openSettingsButton").click();
  await stabilityPage.locator("#closeSettingsButton").click();
  assert.equal(await stabilityPage.locator("#settingsDialog").evaluate((node) => node.open), false, "the settings back control closes to the same home screen");
  await stabilityPage.locator("#openSettingsButton").click();
  for (const [language, title] of Object.entries({ en: "Settings", bn: "সেটিংস", hi: "सेटिंग्स", es: "Ajustes", fr: "Paramètres" })) {
    await stabilityPage.locator("#settingsLanguageSelect").selectOption(language);
    assert.equal(await stabilityPage.locator("#settingsTitle").innerText(), title);
  }
  await stabilityPage.locator("#settingsLanguageSelect").selectOption("en");
  await stabilityPage.locator("#settingsSoundEnabled").uncheck();
  await stabilityPage.locator("#settingsParticlesEnabled").uncheck();
  assert.equal(await stabilityPage.evaluate(() => document.body.classList.contains("vfx-disabled")), true);
  await stabilityPage.locator("#settingsPrivacyButton").click();
  assert.equal(await stabilityPage.locator("#settingsDialog").evaluate((node) => node.open), true, "privacy quick view preserves the underlying settings");
  assert.equal(await stabilityPage.locator("#privacyModalContent section").count(), 6);
  assert.equal(await stabilityPage.locator("#privacyModalContactLink").getAttribute("href"), "mailto:contact.gamevilla@gmail.com");
  await stabilityPage.locator("#closePrivacyButton").click();
  await stabilityPage.locator("#saveSettingsButton").click();
  await reloadReadyPage(stabilityPage);
  await stabilityPage.locator("#openSettingsButton").click();
  assert.equal(await stabilityPage.locator("#settingsSoundEnabled").isChecked(), false, "sound preference survives reload");
  assert.equal(await stabilityPage.locator("#settingsParticlesEnabled").isChecked(), false, "VFX preference survives reload");
  assert.ok(await stabilityPage.evaluate(() => {
    const rect = document.getElementById("settingsDialog").getBoundingClientRect();
    return rect.width <= innerWidth && rect.left >= 0 && rect.right <= innerWidth;
  }), "the settings dialog stays within narrow screens");
  assert.ok(await stabilityPage.locator("#settingsDialog .sp-row").evaluateAll((rows) => rows.every((row) => {
    const card = row.getBoundingClientRect();
    const children = [...row.children].map((child) => child.getBoundingClientRect());
    return children.every((child) => child.top >= card.top && child.bottom <= card.bottom + 1 &&
      child.left >= card.left && child.right <= card.right + 1) &&
      (children.length < 2 || children[0].bottom <= children[1].top);
  })), "mobile settings cards contain labels and controls without overlaps");
  await stabilityPage.locator("#saveSettingsButton").click();
  await stabilityPage.locator("#openPrivacyPageButton").click();
  assert.equal(await stabilityPage.locator("#privacyView").evaluate((node) => node.classList.contains("active")), true);
  assert.equal(new URL(stabilityPage.url()).hash, "#privacy");
  assert.equal(await stabilityPage.locator("#privacyPageContent section").count(), 6);
  assert.match(await stabilityPage.locator("#privacyPageContent").innerText(), /localStorage/);
  await stabilityPage.locator("#privacyBackButton").click();
  await stabilityPage.locator("#startGameButton").click();
  await stabilityPage.locator(".level-card.unlocked").first().click();
  await acceptRulesBriefingIfOpen(stabilityPage);
  assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 1, "one round owns one countdown interval");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await stabilityPage.evaluate(() => document.getElementById("settingsDialog").showModal());
    await stabilityPage.waitForFunction(() => window.__questionIntervals.size === 0);
    await stabilityPage.locator("#saveSettingsButton").click();
    await stabilityPage.waitForFunction(() => window.__questionIntervals.size === 1);
  }
  await stabilityPage.locator('[data-lifeline="fifty"]').click();
  const hiddenIndexes = await stabilityPage.locator(".option[hidden]").evaluateAll((nodes) => nodes.map((node) => node.dataset.optionIndex));
  assert.equal(hiddenIndexes.length, 2);
  for (const language of ["bn", "hi", "es", "fr", "en"]) {
    await stabilityPage.locator("#gameLanguageSelect").selectOption(language);
    assert.deepEqual(await stabilityPage.locator(".option[hidden]").evaluateAll((nodes) => nodes.map((node) => node.dataset.optionIndex)), hiddenIndexes, "locale changes preserve the exact eliminated options");
    assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 1);
  }
  await stabilityPage.locator('[data-lifeline="freeze"]').click();
  assert.equal(await stabilityPage.locator('[data-lifeline="clue"]').isDisabled(), true);
  const questionBeforeDoubleClick = await stabilityPage.locator("#questionText").innerText();
  await stabilityPage.locator(".option:not([hidden])").first().evaluate((button) => { button.click(); button.click(); });
  assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 0, "answering clears the countdown immediately");
  await waitForQuestionAdvance(stabilityPage, questionBeforeDoubleClick);
  assert.equal(await stabilityPage.locator("#lifelineUseCount").innerText(), "0/2 used", "the next question starts with a fresh lifeline allowance");
  assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 1);
  await stabilityPage.evaluate(() => document.getElementById("settingsDialog").showModal());
  await stabilityPage.waitForFunction(() => window.__questionIntervals.size === 0);
  await stabilityPage.evaluate(() => { window.__timingOffset += 20_000; });
  await stabilityPage.locator("#saveSettingsButton").click();
  await stabilityPage.waitForFunction(() => document.querySelectorAll(".option:disabled").length === 4);
  assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 0, "an expired modal-covered question submits once, without a new interval");
  const expiredQuestion = await stabilityPage.locator("#questionText").innerText();
  await waitForQuestionAdvance(stabilityPage, expiredQuestion);
  await stabilityPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 0);
  await stabilityPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
  assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 1, "a restored page owns only one countdown");
  await stabilityPage.locator("#quitButton").click();
  assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 0, "leaving a level clears the countdown");
  const pausedRound = await stabilityPage.evaluate(() => ({
    question: document.querySelector("#questionText").textContent,
    score: document.querySelector("#scoreValue").textContent,
    snapshot: JSON.parse(localStorage.getItem("quiz-orbit-active-session-v1")),
  }));
  assert.ok(pausedRound.snapshot, "leaving a round saves a resumable session");
  assert.equal(pausedRound.snapshot.currentQuestion >= 0, true);
  await stabilityPage.locator(".level-card.unlocked").first().click();
  assert.equal(await stabilityPage.locator("#gameView").evaluate((node) => node.classList.contains("active")), true);
  assert.equal(await stabilityPage.locator("#questionText").innerText(), pausedRound.question, "the same level resumes on its saved question");
  assert.equal(await stabilityPage.locator("#scoreValue").innerText(), pausedRound.score, "the saved score is restored");
  assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 1, "resuming creates exactly one timer");
  await stabilityPage.locator('[data-lifeline="fifty"]').click();
  const pausedLifelineState = await stabilityPage.evaluate(() => ({
    hidden: [...document.querySelectorAll(".option[hidden]")].map((node) => node.dataset.optionIndex),
    coins: document.querySelector("#gameCoinBalance").textContent,
  }));
  assert.equal(pausedLifelineState.hidden.length, 2, "the paused round keeps its 50/50 state");
  await stabilityPage.locator("#quitButton").click();
  assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 0, "leaving the resumed round also clears its timer");
  await stabilityPage.locator(".level-card.unlocked").first().click();
  assert.deepEqual(
    await stabilityPage.locator(".option[hidden]").evaluateAll((nodes) => nodes.map((node) => node.dataset.optionIndex)),
    pausedLifelineState.hidden,
    "resuming preserves exactly the same eliminated options",
  );
  assert.equal(await stabilityPage.locator("#gameCoinBalance").innerText(), pausedLifelineState.coins, "resuming does not charge for the restored lifeline again");
  assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 1);
  await stabilityPage.locator("#quitButton").click();
  assert.equal(await stabilityPage.evaluate(() => window.__questionIntervals.size), 0);
  await stabilityPage.locator("#levelBackButton").click();
  await stabilityPage.evaluate(() => {
    localStorage.setItem("unrelated-app-data", "keep");
    localStorage.setItem("quizverse-daily-share-state-v1", JSON.stringify({
      version: 1,
      lastShareDate: new Date().toISOString().slice(0, 10),
      lastShareTimestamp: Date.now(),
      currentStreak: 2,
      totalClaims: 2,
    }));
    localStorage.setItem("quizverse-daily-login-state-v1", JSON.stringify({
      version: 1,
      lastLaunchDate: new Date().toISOString().slice(0, 10),
      lastLaunchTimestamp: Date.now(),
      totalLaunchDays: 1,
      lastClaimDate: new Date().toISOString().slice(0, 10),
      lastClaimTimestamp: Date.now(),
      currentStreak: 1,
      totalClaims: 1,
    }));
    localStorage.setItem("quizverse-daily-boss-state-v1", JSON.stringify({
      version: 1,
      ratingPoints: 45,
      wins: 1,
      draws: 0,
      losses: 0,
      lastAttemptDate: "",
      status: "ready",
      lastOutcome: "",
      lastCoinsAwarded: 0,
      lastRpDelta: 0,
      lastResult: null,
      active: null,
    }));
  });
  const savedCoinsBeforeReset = await stabilityPage.locator("#coinBalance").innerText();
  await stabilityPage.locator("#openSettingsButton").click();
  await stabilityPage.locator("#resetProgressButton").click();
  await stabilityPage.locator("#cancelResetProgressButton").click();
  assert.equal(await stabilityPage.locator("#coinBalance").innerText(), savedCoinsBeforeReset, "canceling reset preserves the wallet");
   assert.notEqual(await stabilityPage.evaluate(() => localStorage.getItem("quizverse-daily-share-state-v1")), null, "canceling reset leaves legacy share metadata untouched until confirmation");
  assert.notEqual(await stabilityPage.evaluate(() => localStorage.getItem("quizverse-daily-login-state-v1")), null, "canceling reset preserves the login streak");
  assert.notEqual(await stabilityPage.evaluate(() => localStorage.getItem("quizverse-daily-boss-state-v1")), null, "canceling reset preserves the daily arena rank");
  await stabilityPage.locator("#resetProgressButton").click();
  await Promise.all([
    stabilityPage.waitForEvent("domcontentloaded"),
    stabilityPage.locator("#confirmResetProgressButton").click(),
  ]);
  assert.equal(await stabilityPage.locator("#coinBalance").innerText(), "0");
   assert.equal(await stabilityPage.evaluate(() => localStorage.getItem("quizverse-daily-share-state-v1")), null, "confirmed reset clears legacy share metadata");
  const resetLoginState = await stabilityPage.evaluate(() =>
    JSON.parse(localStorage.getItem("quizverse-daily-login-state-v1"))
  );
  assert.equal(resetLoginState.currentStreak, 0, "confirmed reset clears the local login streak");
  assert.equal(resetLoginState.totalClaims, 0, "confirmed reset clears login reward history");
  assert.equal(resetLoginState.lastClaimDate, "", "a new visit after reset starts without a claimed reward");
  assert.equal(await stabilityPage.evaluate(() => localStorage.getItem("quizverse-daily-boss-state-v1")), null, "confirmed reset clears daily arena progress");
  assert.equal(await stabilityPage.evaluate(() => localStorage.getItem("unrelated-app-data")), "keep", "reset never clears unrelated storage");
  assert.equal(await stabilityPage.evaluate(() => localStorage.getItem("quiz-orbit-particles-enabled")), "false", "reset preserves visual preferences");
  assert.equal(await stabilityPage.evaluate(() => localStorage.getItem("quiz-orbit-answer-sounds-muted")), "true", "reset preserves sound preferences");
  assert.deepEqual(stabilityErrors, []);
  await stabilityPage.close();

  const deniedContext = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const deniedPage = await deniedContext.newPage();
  const deniedErrors = [];
  deniedPage.on("pageerror", (error) => deniedErrors.push(error.message));
  await deniedPage.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"]) {
      Storage.prototype[method] = () => { throw new DOMException("Storage blocked", "SecurityError"); };
    }
  });
  await loadReadyPage(deniedPage);
  await deniedPage.locator("#openSettingsButton").click();
  await deniedPage.locator("#settingsParticlesEnabled").uncheck();
  assert.match(await deniedPage.locator("#settingsStatus").innerText(), /this visit/);
  await deniedPage.locator("#resetProgressButton").click();
  await deniedPage.locator("#confirmResetProgressButton").click();
  assert.match(await deniedPage.locator("#settingsStatus").innerText(), /could not finish/);
  assert.equal(await deniedPage.locator("#settingsDialog").evaluate((dialog) => dialog.open), true);
  await deniedPage.locator("#saveSettingsButton").click();
  await deniedPage.locator("#startGameButton").click();
  await deniedPage.locator(".level-card.unlocked").first().click();
  await acceptRulesBriefingIfOpen(deniedPage);
  assert.equal(await deniedPage.locator(".option").count(), 4, "a storage-denied visitor can still play");
  assert.deepEqual(deniedErrors, []);
  await deniedContext.close();

  const bossContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const bossPage = await bossContext.newPage();
  const bossErrors = [];
  bossPage.on("pageerror", (error) => bossErrors.push(error.message));
  await bossPage.addInitScript(() => {
    const NativeWeakMap = window.WeakMap;
    window.__arenaTestAnswers = new Map();
    window.WeakMap = class CapturingWeakMap extends NativeWeakMap {
      set(key, value) {
        if (key && typeof key.question?.en === "string") {
          window.__arenaTestAnswers.set(key.question.en, value);
        }
        return super.set(key, value);
      }
    };
    Object.defineProperty(Object.getPrototypeOf(window.crypto), "getRandomValues", {
      configurable: true,
      value(array) {
        array.fill(0);
        return array;
      },
    });
    Math.random = () => 0.99;
  });
  await loadReadyPage(bossPage);
  await bossPage.locator("#openBossArenaButton").click();
  assert.ok(
    await bossPage.locator("#bossArenaView").evaluate((node) => node.classList.contains("active")),
    "opening the Boss Arena switches to its dedicated view",
  );
  await bossPage.locator("#languageSelect").selectOption("es");
  assert.equal(await bossPage.locator("#bossArenaTitle").innerText(), "Arena del Jefe", "Arena copy localizes to Spanish");
  await bossPage.locator("#languageSelect").selectOption("en");
  await bossPage.locator("#bossCategorySelect").selectOption("General Knowledge");
  await bossPage.locator("#bossStartButton").click();
  await bossPage.locator("#bossBattlePanel").waitFor({ state: "visible" });
  assert.equal(await bossPage.locator(".boss-option").count(), 4, "the duel presents four touch-ready choices");
  assert.ok(
    await bossPage.locator(".boss-option").first().evaluate((node) => node.getBoundingClientRect().height >= 48),
    "Boss Arena options meet the mobile touch target size",
  );
  const initialBossState = await bossPage.evaluate(() =>
    JSON.parse(localStorage.getItem("quizverse-daily-boss-state-v1"))
  );
  assert.equal(initialBossState.status, "in-progress");
  assert.equal(initialBossState.active.questionIds.length, 10, "the Arena samples ten unique questions");
  assert.equal(new Set(initialBossState.active.questionIds).size, 10);
  const prepareBossTestQuestion = async () => {
    await bossPage.evaluate(() => {
      const key = "quizverse-daily-boss-state-v1";
      const state = JSON.parse(localStorage.getItem(key));
      state.active.deadlineAt = Date.now() + 60_000;
      state.active.botAnswerAt = Date.now() + 150;
      const newValue = JSON.stringify(state);
      localStorage.setItem(key, newValue);
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        newValue,
        storageArea: localStorage,
      }));
    });
    await bossPage.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem("quizverse-daily-boss-state-v1"));
      return state?.active?.botLocked === true;
    }, null, { timeout: 3_000 });
  };
  await prepareBossTestQuestion();
  const initialBossQuestion = await bossPage.locator("#bossQuestionText").innerText();
  await reloadReadyPage(bossPage);
  await bossPage.locator("#openBossArenaButton").click();
  await bossPage.locator("#bossBattlePanel").waitFor({ state: "visible" });
  assert.equal(await bossPage.locator("#bossQuestionText").innerText(), initialBossQuestion, "an in-progress daily duel resumes on the same question");
  assert.equal(await bossPage.locator("#bossRoundLabel").innerText(), "Question 1 of 10 · General Knowledge");
  const reloadPenalty = await bossPage.evaluate(() =>
    JSON.parse(localStorage.getItem("quizverse-daily-boss-state-v1")).active
  );
  assert.equal(reloadPenalty.playerChoice, -1, "reloading during an active duel records a missed answer as a fair-play penalty");
  assert.equal(reloadPenalty.roundResolved, true, "the rival's locked answer resolves the interrupted round");
  await bossPage.locator("#bossNextButton").click();
  await bossPage.waitForFunction(() => document.querySelector("#bossRoundLabel")?.textContent.includes("Question 2"));
  for (let questionIndex = 1; questionIndex < 10; questionIndex += 1) {
    await prepareBossTestQuestion();
    const prompt = await bossPage.locator("#bossQuestionText").innerText();
    const answerIndex = await bossPage.evaluate((text) => window.__arenaTestAnswers.get(text), prompt);
    assert.ok(Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < 4, "the localized GK question has a concealed runtime answer");
    await bossPage.locator(".boss-option").nth(answerIndex).click();
    await bossPage.locator("#bossNextButton").waitFor({ state: "visible", timeout: 9_000 });
    if (questionIndex < 9) {
      const previousRoundLabel = await bossPage.locator("#bossRoundLabel").innerText();
      await bossPage.locator("#bossNextButton").click();
      await bossPage.waitForFunction(
        (previous) => document.querySelector("#bossRoundLabel")?.textContent !== previous,
        previousRoundLabel,
      );
    } else {
      await bossPage.locator("#bossNextButton").click();
    }
  }
  await bossPage.locator("#bossResultPanel").waitFor({ state: "visible" });
  const completedBossState = await bossPage.evaluate(() =>
    JSON.parse(localStorage.getItem("quizverse-daily-boss-state-v1"))
  );
  assert.equal(completedBossState.status, "completed");
  assert.equal(completedBossState.lastResult.outcome, "win", "a player score above the simulated rival wins");
  assert.equal(completedBossState.ratingPoints, 30, "Arena victory adds 30 rating points");
  assert.equal(completedBossState.wins, 1);
  assert.equal(completedBossState.lastCoinsAwarded, 100, "Arena victory pays its exclusive coin reward");
  assert.ok(
    JSON.parse(await bossPage.evaluate(() => localStorage.getItem("quiz-orbit-reward-collection"))).badges.includes("arenaChampion"),
    "a first Arena win unlocks the collection badge",
  );
  await bossPage.locator("#bossResultHomeButton").click();
  await bossPage.locator("#openBossArenaButton").click();
  assert.equal(await bossPage.locator("#bossStartButton").isDisabled(), true, "a completed daily attempt cannot be replayed on the same UTC day");
  assert.deepEqual(bossErrors, [], `Boss Arena raised browser errors: ${bossErrors.join("; ")}`);
  await bossContext.close();

  const nightBlitzContext = await browser.newContext({
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    timezoneId: "UTC",
  });
  const nightBlitzPage = await nightBlitzContext.newPage();
  const nightBlitzErrors = [];
  nightBlitzPage.on("pageerror", (error) => nightBlitzErrors.push(error.message));
  await nightBlitzPage.addInitScript((initialTime) => {
    const NativeDate = window.Date;
    let fixedNow = Number(sessionStorage.getItem("__nightBlitzTestNow")) || initialTime;
    class TestDate extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedNow]));
      }
      static now() {
        return fixedNow;
      }
      static advance(milliseconds) {
        fixedNow += milliseconds;
        sessionStorage.setItem("__nightBlitzTestNow", String(fixedNow));
      }
    }
    window.Date = TestDate;
    Object.defineProperty(Object.getPrototypeOf(window.crypto), "getRandomValues", {
      configurable: true,
      value(array) {
        array.fill(0);
        return array;
      },
    });
    Math.random = () => 0.99;
    const NativeWeakMap = window.WeakMap;
    window.__nightBlitzTestAnswers = new Map();
    window.WeakMap = class CapturingWeakMap extends NativeWeakMap {
      set(question, encodedAnswer) {
        if (question && typeof question.question?.en === "string") {
          Object.values(question.question).forEach((prompt) => {
            window.__nightBlitzTestAnswers.set(prompt, encodedAnswer);
          });
        }
        return super.set(question, encodedAnswer);
      }
    };
  }, Date.UTC(2026, 5, 11, 20, 59, 30));
  await loadReadyPage(nightBlitzPage);
  const blitzCoinsBefore = await nightBlitzPage.evaluate(() =>
    JSON.parse(localStorage.getItem("quiz-orbit-reward-collection") || '{"coins":0}').coins
  );
  await nightBlitzPage.locator("#openNightBlitzButton").click();
  assert.equal(await nightBlitzPage.locator("#nightBlitzStartButton").isDisabled(), true,
    "Night Prime stays locked before 9 PM local time");
  assert.match(await nightBlitzPage.locator("#nightBlitzStatus").innerText(), /00:00:30/,
    "the event screen shows a local-time countdown");
  assert.equal(await nightBlitzPage.locator("#nightBlitzOptions .night-blitz-option").count(), 0,
    "players cannot enter the round before the daily window");
  await nightBlitzPage.evaluate(() => Date.advance(30_000));
  await nightBlitzPage.waitForFunction(
    () => document.querySelector("#nightBlitzStartButton")?.disabled === false,
    null,
    { timeout: 3_000 },
  );
  await nightBlitzPage.locator("#languageSelect").selectOption("es");
  assert.equal(await nightBlitzPage.locator("#nightBlitzTitle").innerText(), "Ráfaga Prime Nocturna",
    "the Night Prime page localizes to Spanish");
  await nightBlitzPage.locator("#languageSelect").selectOption("en");
  await nightBlitzPage.locator("#nightBlitzCategorySelect").selectOption("General Knowledge");
  await nightBlitzPage.locator("#nightBlitzStartButton").click();
  await nightBlitzPage.locator("#nightBlitzRoundPanel").waitFor({ state: "visible" });
  const startedBlitzState = await nightBlitzPage.evaluate(() =>
    JSON.parse(localStorage.getItem("quizverse-night-prime-blitz-v1"))
  );
  assert.equal(startedBlitzState.status, "in-progress");
  assert.equal(startedBlitzState.active.questionIds.length, 5, "Night Prime selects five questions");
  assert.equal(new Set(startedBlitzState.active.questionIds).size, 5, "Night Prime questions are unique");
  assert.equal(startedBlitzState.active.category, "General Knowledge", "the chosen mode is retained");
  assert.equal(await nightBlitzPage.locator("#nightBlitzOptions .night-blitz-option").count(), 4);
  assert.ok(
    await nightBlitzPage.locator("#nightBlitzOptions .night-blitz-option").first()
      .evaluate((node) => node.getBoundingClientRect().height >= 50),
    "Night Prime answers keep touch-sized targets on a 320px viewport",
  );
  const firstBlitzQuestion = await nightBlitzPage.locator("#nightBlitzQuestionText").innerText();
  const firstBlitzDeadline = startedBlitzState.active.deadlineAt;
  await nightBlitzPage.evaluate(() => Date.advance(2_000));
  await nightBlitzPage.waitForFunction(
    () => document.querySelector("#nightBlitzClock")?.textContent.includes("13"),
    null,
    { timeout: 3_000 },
  );
  await nightBlitzPage.locator("#languageSelect").selectOption("fr");
  assert.equal(await nightBlitzPage.locator("#nightBlitzQuestionLabel").innerText(),
    "Question 1 sur 5 · Connaissances générales", "the active round localizes without restarting");
  assert.equal(
    await nightBlitzPage.evaluate(() =>
      JSON.parse(localStorage.getItem("quizverse-night-prime-blitz-v1")).active.deadlineAt
    ),
    firstBlitzDeadline,
    "changing language leaves the countdown deadline unchanged",
  );
  await nightBlitzPage.locator("#languageSelect").selectOption("en");
  await reloadReadyPage(nightBlitzPage);
  await nightBlitzPage.locator("#openNightBlitzButton").click();
  await nightBlitzPage.locator("#nightBlitzRoundPanel").waitFor({ state: "visible" });
  assert.equal(await nightBlitzPage.locator("#nightBlitzQuestionText").innerText(), firstBlitzQuestion,
    "reloading resumes the same saved question");
  for (let questionIndex = 0; questionIndex < 5; questionIndex += 1) {
    if (questionIndex > 0) {
      await nightBlitzPage.waitForFunction(
        (expected) => document.querySelector("#nightBlitzQuestionLabel")?.textContent.includes(`Question ${expected}`),
        questionIndex + 1,
      );
    }
    const prompt = await nightBlitzPage.locator("#nightBlitzQuestionText").innerText();
    const answerIndex = await nightBlitzPage.evaluate(
      (questionText) => window.__nightBlitzTestAnswers.get(questionText),
      prompt,
    );
    assert.ok(Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < 4,
      "the current localized question has a concealed answer index");
    await nightBlitzPage.locator("#nightBlitzOptions .night-blitz-option").nth(answerIndex).click();
    await nightBlitzPage.locator("#nightBlitzNextButton").waitFor({ state: "visible" });
    await nightBlitzPage.locator("#nightBlitzNextButton").click();
  }
  await nightBlitzPage.locator("#nightBlitzResultPanel").waitFor({ state: "visible" });
  const completedBlitzState = await nightBlitzPage.evaluate(() =>
    JSON.parse(localStorage.getItem("quizverse-night-prime-blitz-v1"))
  );
  assert.equal(completedBlitzState.status, "completed");
  assert.equal(completedBlitzState.result.correct, 5);
  assert.equal(completedBlitzState.result.coins, 45, "five correct answers earn 25 coins and the 20-coin clear bonus");
  const blitzCoinsAfter = await nightBlitzPage.evaluate(() =>
    JSON.parse(localStorage.getItem("quiz-orbit-reward-collection")).coins
  );
  assert.equal(blitzCoinsAfter - blitzCoinsBefore, 45, "the result pays coins once to the shared vault");
  assert.equal(await nightBlitzPage.locator("#nightBlitzResultCorrect").innerText(), "5 / 5");
  await nightBlitzPage.locator("#nightBlitzResultHomeButton").click();
  await nightBlitzPage.locator("#openNightBlitzButton").click();
  assert.equal(await nightBlitzPage.locator("#nightBlitzStartButton").isDisabled(), true,
    "a completed attempt cannot be replayed on the same local date");
  await nightBlitzPage.setViewportSize({ width: 280, height: 640 });
  const blitzNarrowLayout = await nightBlitzPage.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    cardWidth: document.querySelector("#nightBlitzView .boss-arena-shell").getBoundingClientRect().width,
  }));
  assert.ok(blitzNarrowLayout.scrollWidth <= blitzNarrowLayout.viewportWidth,
    "Night Prime has no horizontal overflow on a narrow phone");
  assert.ok(blitzNarrowLayout.cardWidth <= blitzNarrowLayout.viewportWidth,
    "Night Prime card fits the narrow phone viewport");
  assert.deepEqual(nightBlitzErrors, [], `Night Prime raised browser errors: ${nightBlitzErrors.join("; ")}`);
  await nightBlitzContext.close();

  assert.deepEqual(pageErrors, [], `The game page raised browser errors: ${pageErrors.join("; ")}`);
  console.log("Browser check passed: responsive layouts, localized rounds, progression/rewards, timer and focus cleanup, Settings/Privacy, storage recovery, Daily Boss, and 9 PM Night Prime scheduling, resume, countdown, payout, mobile fit, and one-attempt enforcement.");
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
