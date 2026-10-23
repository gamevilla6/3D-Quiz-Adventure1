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
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("quiz-orbit-language")),
    "en",
    "English selection is saved",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.locator("#welcomeTitle").innerText(), "Wonder a little further.");
  assert.equal(await page.locator("#soundToggle").innerText(), "Answer sounds on");
  await page.locator("#soundToggle").tap();
  assert.equal(await page.locator("#soundToggle").getAttribute("aria-pressed"), "false");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("quiz-orbit-answer-sounds-muted")),
    "true",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("#soundToggle").innerText(), "Answer sounds off");
  assert.equal(await page.locator("#soundToggle").getAttribute("aria-pressed"), "false");

  await page.locator("#startGameButton").click();
  assert.equal(await page.locator("#levelView").evaluate((node) => node.classList.contains("active")), true);
  await page.locator(".level-card.unlocked").click();
  assert.equal(await page.locator("#questionText").innerText(), "Which is Earth's largest ocean?");
  assert.deepEqual(await page.locator(".option span:nth-child(2)").allInnerTexts(), [
    "Atlantic",
    "Indian",
    "Arctic",
    "Pacific",
  ]);

  await page.keyboard.press("4");
  assert.equal(await page.evaluate(() => window.__answerCueOscillators), 0, "muted answers do not create sound cues");
  assert.match(await page.locator("#feedback").innerText(), /Correct! \+10 points/);
  assert.equal(await page.locator("#scoreValue").innerText(), "10");
  assert.equal(await page.locator("#correctCount").innerText(), "1");
  assert.equal(await page.locator(".option").nth(3).getAttribute("disabled"), "");
  assert.equal(await page.locator(".option").nth(3).getAttribute("class").then((value) => value.includes("correct")), true);
  await page.locator("#soundToggle").tap();
  assert.equal(await page.locator("#soundToggle").innerText(), "Answer sounds on");
  const audioTestPage = await context.newPage();
  audioTestPage.on("pageerror", (error) => pageErrors.push(error.message));
  await audioTestPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await audioTestPage.locator("#startGameButton").tap();
  await audioTestPage.locator(".level-card.unlocked").tap();
  assert.equal(await audioTestPage.locator("#questionText").innerText(), "Which is Earth's largest ocean?");
  await audioTestPage.locator(".option").nth(3).tap();
  assert.equal(
    await audioTestPage.evaluate(() => window.__answerCueOscillators),
    1,
    "enabled answers play a sound cue",
  );
  await audioTestPage.close();

  await page.selectOption("#languageSelect", "bn");
  assert.equal(await page.locator("#questionText").innerText(), "পৃথিবীর বৃহত্তম মহাসাগর কোনটি?");
  assert.equal(await page.locator("#soundToggle").innerText(), "উত্তরের শব্দ চালু");
  assert.deepEqual(await page.locator(".option span:nth-child(2)").allInnerTexts(), [
    "আটলান্টিক মহাসাগর",
    "ভারত মহাসাগর",
    "আর্কটিক মহাসাগর",
    "প্রশান্ত মহাসাগর",
  ]);
  assert.match(await page.locator("#feedback").innerText(), /সঠিক! \+১০ পয়েন্ট/);
  assert.equal(await page.locator("#scoreValue").innerText(), "১০");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("quiz-orbit-language")),
    "bn",
    "Bengali selection is saved",
  );

  await page.selectOption("#languageSelect", "en");
  assert.equal(await page.locator("#questionText").innerText(), "Which is Earth's largest ocean?");
  assert.match(await page.locator("#feedback").innerText(), /Correct! \+10 points/);
  assert.equal(await page.locator("#scoreValue").innerText(), "10");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("quiz-orbit-language")),
    "en",
    "switching back to English is saved",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.locator("#welcomeTitle").innerText(), "Wonder a little further.");

  await page.selectOption("#languageSelect", "bn");
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("html").getAttribute("lang"), "bn");
  assert.equal(await page.locator("#welcomeTitle").innerText(), "আরও একটু জেনে নিন।");
  assert.equal(await page.locator("#categoryHeading").innerText(), "মোড বেছে নিন");

  await page.locator("#startGameButton").tap();
  await page.locator(".level-card.unlocked").tap();
  assert.equal(await page.locator("#questionText").innerText(), "পৃথিবীর বৃহত্তম মহাসাগর কোনটি?");
  assert.deepEqual(await page.locator(".option span:nth-child(2)").allInnerTexts(), [
    "আটলান্টিক মহাসাগর",
    "ভারত মহাসাগর",
    "আর্কটিক মহাসাগর",
    "প্রশান্ত মহাসাগর",
  ]);

  const correctOptionIndexes = [3, 1, 1, 2, 1, 2, 3, 0, 1, 2];
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
  const earnedTier = await page.locator("#resultCard").getAttribute("data-tier");
  assert.equal(savedCollection.version, 1, "the reward collection has a storage version");
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

  await page.locator("#homeButton").tap();
  assert.equal(await page.locator("#welcomeView").evaluate((node) => node.classList.contains("active")), true);
  assert.match(await page.locator("#collectionTrophies").innerText(), /ট্রফি/);
  assert.match(await page.locator("#collectionBadges").innerText(), /কুইজ মাস্টার/);
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

  assert.deepEqual(pageErrors, [], `The game page raised browser errors: ${pageErrors.join("; ")}`);
  console.log("Browser check passed: saved reward collection, personal bests, invalid storage recovery, English and Bengali, scoring, replay, keyboard, and touch.");
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
