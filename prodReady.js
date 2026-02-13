import { chromium } from "playwright";
import {
  computeTargetClassDate,
  computeOpenTimeForClass,
  toISODate,
  buildScheduleUrl,
  cardMatches,
  sleep,
  msUntilDateTime,
  clickReserveAndFinish,
  dismissCookieBanner,
} from "./src/utils.js";

import {
  ENV,
  TARGET_WEEKDAY,
  TARGET_DAY_INDEX,
  MUST_INCLUDE,
  OPEN_TIME,
  READY_MINUTES_BEFORE,
  USE_WAIT_UNTIL_OPEN,
  LOGIN_URL,
  SCHEDULE_DEFAULTS
} from "./src/constants.js";


// =====================================================
// 🔐 Credentials
// Pulled from environment variables (GitHub Secrets in CI)
// =====================================================

const EMAIL = process.env[ENV.EMAIL];      // process.env["LT_EMAIL"]
const PASSWORD = process.env[ENV.PASSWORD]; // process.env["LT_PASSWORD"]


// =====================================================
// 🚀 Main Reservation Flow
// =====================================================

async function run({ classDate, openAt }) {

  // Safety check: ensure credentials exist
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      `Missing ${ENV.EMAIL} or ${ENV.PASSWORD} environment variables.`
    );
  }

  // -------------------------------------------------
  // ⏰ Compute "ready time"
  // Example:
  // openAt = Sun Feb 15 2026 20:00:00
  // READY_MINUTES_BEFORE = 1
  //
  // readyAt = 7:59:00 PM
  //
  // This is when we want to START browser work.
  // -------------------------------------------------
  const readyAt = new Date(
    openAt.getTime() - READY_MINUTES_BEFORE * 60000
  );

  // Convert classDate into YYYY-MM-DD format
  // Example: Mon Mar 02 2026 -> "2026-03-02"
  const selectedDate = toISODate(classDate);

  // Build Lifetime schedule URL for correct week
  // Example result:
  // https://my.lifetime.life/clubs/va/fairfax/classes.html?...
  const scheduleUrl = buildScheduleUrl({
    clubPath: SCHEDULE_DEFAULTS.clubPath,
    selectedDate,
    location: SCHEDULE_DEFAULTS.location,
    interest: SCHEDULE_DEFAULTS.interest,
    mode: SCHEDULE_DEFAULTS.mode,
    teamMemberView: SCHEDULE_DEFAULTS.teamMemberView,
  });

  console.log("Now:", new Date().toString());
  console.log("Target classDate:", classDate.toString());
  console.log("Open at:", openAt.toString());
  console.log("Ready at:", readyAt.toString());
  console.log("Schedule URL:", scheduleUrl);

  // -------------------------------------------------
  // 💤 Sleep until "ready time"
  //
  // If current time is 7:55 PM
  // and readyAt is 7:59 PM
  //
  // msToReady ≈ 240,000 ms
  //
  // Script sleeps for 4 minutes
  // -------------------------------------------------
  if (USE_WAIT_UNTIL_OPEN) {
    const msToReady = msUntilDateTime(readyAt);

    if (msToReady > 0) {
      console.log("Sleeping until ready time (ms):", msToReady);
      await sleep(msToReady);
    }
  }

  // -------------------------------------------------
  // 🖥 Launch Playwright browser
  //
  // In GitHub Actions (CI=true):
  //   headless: true
  //
  // Locally:
  //   headless: false (visible browser)
  // -------------------------------------------------
  console.log("Launching browser...");
  const browser = await chromium.launch({
    headless: process.env.CI ? true : false,
    slowMo: process.env.CI ? 0 : 100,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {

    // -------------------------------------------------
    // 🔐 Login
    // -------------------------------------------------
    console.log("Navigating to login...");
    await page.goto(LOGIN_URL, { waitUntil: "networkidle" });

    await page.fill("#account-username", EMAIL);
    await page.fill('input[type="password"]', PASSWORD);

    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.click('button[type="submit"]'),
    ]);

    console.log("Logged in.");

    // -------------------------------------------------
    // 📅 Open Schedule Page
    // -------------------------------------------------
    console.log("Opening schedule page...");
    await page.goto(scheduleUrl, { waitUntil: "domcontentloaded" });

    // Dismiss cookie banner if present
    await dismissCookieBanner(page);

    // Wait for class tiles to render
    await page.locator('[data-testid="classCell"]').first().waitFor({
      state: "visible",
      timeout: 20000,
    });

    // -------------------------------------------------
    // 📆 Select Correct Day Column
    //
    // Lifetime renders 7 columns:
    // Sunday=0 ... Monday=1 ... Saturday=6
    //
    // TARGET_DAY_INDEX corresponds to TARGET_WEEKDAY
    // -------------------------------------------------
    const days = page.locator("div.calendar > div.day");
    const dayCount = await days.count();

    if (dayCount < 7) {
      throw new Error("Could not find 7 day columns.");
    }

    const targetCol = days.nth(TARGET_DAY_INDEX);

    // -------------------------------------------------
    // 🔎 Find Correct Class Tile
    //
    // Example tile text:
    //
    // 8:00 – 10:00 PM
    // Pickleball Open Play: All Levels
    //
    // MUST_INCLUDE ensures this is the correct session
    // -------------------------------------------------
    const cards = targetCol.locator('[data-testid="classCell"]');
    const cardCount = await cards.count();

    let targetCard = null;

    for (let i = 0; i < cardCount; i++) {
      const text = await cards.nth(i).innerText();

      if (cardMatches(text, MUST_INCLUDE)) {
        targetCard = cards.nth(i);
        console.log("Matched card:\n", text);
        break;
      }
    }

    if (!targetCard) {
      throw new Error("Could not find matching class card.");
    }

    // -------------------------------------------------
    // 🖱 Click Into Class Details BEFORE open
    //
    // This is critical:
    // We want to already be on the details page
    // so we only wait for the Reserve button to appear.
    // -------------------------------------------------
    console.log("Clicking class (entering details page)...");
    const classLink = targetCard.locator('[data-testid="classLink"]').first();

    await Promise.all([
      page.waitForURL(/class-details\.html/i, { timeout: 15000 }),
      classLink.click(),
    ]);

    await dismissCookieBanner(page);

    // -------------------------------------------------
    // ⏳ Wait Until EXACT Open Time
    //
    // If openAt = 8:00:00 PM
    //
    // We sleep until ~7:59:59.800
    // Then spin until 8:00:00
    //
    // This minimizes scheduling jitter.
    // -------------------------------------------------
    console.log("On class details page. Waiting until open time...");

    if (USE_WAIT_UNTIL_OPEN) {
      const msToOpen = msUntilDateTime(openAt);

      if (msToOpen > 0) {
        console.log("Waiting until open (ms):", msToOpen);

        // Sleep until just before open
        if (msToOpen > 400) {
          await sleep(msToOpen - 200);
        }

        // Busy wait final milliseconds
        while (msUntilDateTime(openAt) > 0) {}
      }
    }

    // -------------------------------------------------
    // 🏁 Attempt Reservation
    //
    // clickReserveAndFinish():
    // - Checks for Reserve button
    // - Clicks Reserve
    // - Waits for Finish
    // - Clicks Finish
    // - Retries every 350ms up to 5 minutes
    // -------------------------------------------------
    console.log("Attempting reserve (retry up to 5 minutes)...");
    await clickReserveAndFinish(page);

    console.log("Done.");
    await page.waitForTimeout(1000);

  } finally {
    await browser.close();
  }
}


// =====================================================
// 🧮 Compute Reservation Date & Open Time
// =====================================================

// Example:
// Today = Fri Feb 13 2026
//
// computeTargetClassDate(Monday)
// -> Mon Feb 23 2026 (weekday after today+7)
//
// computeOpenTimeForClass(classDate)
// -> Sun Feb 15 2026 8:00 PM
//
const classDate = computeTargetClassDate(TARGET_WEEKDAY);

const openAt = computeOpenTimeForClass(
  classDate,
  OPEN_TIME.hour,
  OPEN_TIME.minute,
  OPEN_TIME.second
);

// Start the reservation flow
run({ classDate, openAt }).catch((err) => {
  console.error("Error:", err);
  process.exitCode = 1;
});
