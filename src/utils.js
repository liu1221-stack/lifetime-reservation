import {
  RESERVE_RETRY_MS,
  RESERVE_MAX_WAIT_MS,
} from "./constants.js";


export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function msUntilDateTime(targetDate, nowMs = Date.now()) {
  return targetDate.getTime() - nowMs;
}

export function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---------- date math ----------

// Sun=0 Mon=1 ... Sat=6
export function nextWeekdayOnOrAfter(baseDate, weekday) {
  const date = new Date(baseDate);
  const diff = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return date;
}

/**
 * RULE:
 * Target class date = weekday AFTER (today + 7 days)
 * Example: if today is Sun Feb 22 -> base is Sun Mar 1 -> next Monday is Mar 2.
 */
export function computeTargetClassDate(targetWeekday, now = new Date()) {
  const base = new Date(now);
  base.setDate(base.getDate() + 7);
  return nextWeekdayOnOrAfter(base, targetWeekday);
}

export function computeOpenTimeForClass(classDate, hour, minute, second) {
  const openAt = new Date(classDate);

  openAt.setDate(openAt.getDate() - 8);

  openAt.setHours(hour, minute, second, 0);
  return openAt;
}

// ---------- schedule URL + matching ----------

export function buildScheduleUrl({
  clubPath = "https://my.lifetime.life/clubs/va/fairfax/classes.html",
  selectedDate,
  location = "Fairfax",
  interest = "Pickleball Open Play",
  mode = "week",
  teamMemberView = true,
}) {
  if (!selectedDate) {
    throw new Error("buildScheduleUrl requires selectedDate (YYYY-MM-DD)");
  }

  const params = new URLSearchParams();

  if (teamMemberView) params.set("teamMemberView", "true");
  params.set("mode", mode);
  params.set("selectedDate", selectedDate);
  params.set("interest", interest);
  params.set("location", location);

  return `${clubPath}?${params.toString()}`;
}


export function cardMatches(cardText, mustInclude) {
  return mustInclude.every((s) => cardText.includes(s));
}

export function withinWindow(
  now,
  openAt,
  earlyMs = 2 * 60 * 1000,
  lateMs = 5 * 60 * 1000
) {
  const t = now.getTime();
  const o = openAt.getTime();
  return t >= o - earlyMs && t <= o + lateMs;
}

export async function clickReserveAndFinish(page) {
  const reserveBtn = page.getByRole("button", { name: /^Reserve$/i });
  const finishBtn = page.getByRole("button", { name: /^Finish$/i });
  const waitlistBtn = page.getByRole("button", { name: /waitlist/i });

  const start = Date.now();

  while (Date.now() - start < RESERVE_MAX_WAIT_MS) {
    if (await reserveBtn.isVisible().catch(() => false)) {
      console.log("Reserve visible. Clicking Reserve...");
      await reserveBtn.click();

      console.log("Waiting for Finish...");
      await finishBtn.waitFor({ state: "visible", timeout: 15000 });
      await finishBtn.click();

      console.log("Finish clicked. Reservation complete.");
      return;
    }

    if (await waitlistBtn.isVisible().catch(() => false)) {
      console.log("Class is waitlisted. Stopping retries.");
      return;
    }

    await sleep(RESERVE_RETRY_MS);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  }

  throw new Error("Timed out (5 minutes) waiting for Reserve button.");
}

export async function dismissCookieBanner(page) {
  const acceptBtn = page.getByRole("button", { name: /accept all/i });
  try {
    await acceptBtn.waitFor({ state: "visible", timeout: 6000 });
    console.log("Cookie banner detected. Clicking Accept All...");
    await acceptBtn.click();
    await sleep(400);
  } catch {
    console.log("No cookie banner.");
  }
}