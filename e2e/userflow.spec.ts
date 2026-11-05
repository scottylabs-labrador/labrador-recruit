import { expect, test } from "@playwright/test";

import { API_URL } from "./config.ts";
import {
  alice,
  closeCycleDeadline,
  resetDb,
  seedAlice,
  seedOpenCycle,
  sessionCookie,
} from "./db.ts";

test.beforeEach(async () => {
  await resetDb();
});

test("a guest reads what is recruiting and is sent to sign in", async ({ page }) => {
  await seedOpenCycle();

  // The root path redirects, so this also asserts that `/recruit` is the one
  // canonical landing page rather than a second copy of it.
  await page.goto("/");
  await expect(page).toHaveURL(/\/recruit$/);

  await expect(page.getByRole("heading", { name: "End To End Recruitment" })).toBeVisible();

  const committee = page.getByRole("article", { name: /labrador/i });
  await expect(committee).toBeVisible();
  await expect(committee.getByText(/product teams building for the CMU community/i)).toBeVisible();

  await page.getByRole("link", { name: "Sign in to apply" }).click();
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole("button", { name: "Sign in with your Andrew ID" })).toBeVisible();
});

test("the landing page says nothing is recruiting when nothing is", async ({ page }) => {
  // No seed at all, against a real empty database. This is the between-seasons
  // state, and it must read as an explanation rather than as a broken page.
  await page.goto("/recruit");

  await expect(
    page.getByRole("heading", { name: /applications are not open right now/i }),
  ).toBeVisible();
  await expect(page.getByText(/no committees are recruiting/i)).toBeVisible();
});

test("an unauthenticated visitor to the applicant surface keeps their destination", async ({
  page,
}) => {
  await seedOpenCycle();

  await page.goto("/app/dashboard");

  // The guard is a navigation courtesy rather than the security boundary - the
  // endpoints refuse on their own - but losing the destination here would
  // silently break every link into the applicant surface.
  await expect(page).toHaveURL(/\/signin\?redirect=%2Fapp%2Fdashboard$/);
  await expect(page.getByText("/app/dashboard")).toBeVisible();
});

test("the API reports liveness", async ({ request }) => {
  // Absolute, because Playwright's `baseURL` is the interface. A relative path
  // here hits the web server, which answers every unknown path with index.html
  // for client-side routing - so the failure is a JSON parse error rather than
  // a 404, which is a confusing way to learn you asked the wrong host.
  const res = await request.get(`${API_URL}/v1/health`);

  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok" });
});

test("a signed-in applicant sees their dashboard against the real stack", async ({
  page,
  context,
}) => {
  await seedOpenCycle();
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);

  await page.goto("/app/dashboard");

  /*
   * The first authenticated path through the real stack.
   *
   * Everything below `/app` was covered only in jsdom with a mocked API, which
   * cannot catch a cookie that is not sent, a CORS rule that drops
   * credentials, or an endpoint the browser calls differently than the mock.
   */
  await expect(page.getByRole("heading", { name: /hello, alice/i })).toBeVisible();
  await expect(page.getByText(/end to end recruitment/i).first()).toBeVisible();
  await expect(page.getByText(/have not started an application/i)).toBeVisible();
});

test("an applicant can start an application end to end", async ({ page, context }) => {
  await seedOpenCycle();
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);

  await page.goto("/app/committees");
  const labrador = page.getByRole("article", { name: /labrador/i });
  await labrador.getByRole("button", { name: /^apply to labrador$/i }).click();

  // The row is created by the API, read back by the next request, and the card
  // changes because of what the server said - not because the click succeeded.
  await expect(labrador.getByText(/already applied/i)).toBeVisible();

  await page.goto("/app/dashboard");
  await expect(page.getByText(/0 of 1 application submitted/i)).toBeVisible();
});

test("an applicant answers both forms, reviews and submits", async ({ page, context }) => {
  await seedOpenCycle();
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);

  await page.goto("/app/committees");
  await page
    .getByRole("article", { name: /labrador/i })
    .getByRole("button", { name: /^apply to labrador$/i })
    .click();
  await expect(page.getByText(/already applied/i)).toBeVisible();

  // The shared questions, answered once.
  await page.goto("/app/apply/common");
  await page.getByLabel(/your major/i).fill("Computer Science");
  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  // Then the committee's own.
  await page.goto("/app/apply/labrador");
  await page.getByLabel(/why labrador/i).fill("Because of the people.");
  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  /*
   * The review page reads both back from the server, not from anything the
   * browser kept. If an autosave had silently failed, this is where it would
   * show as a missing required answer rather than as a submit that fails.
   */
  await page.goto("/app/review");
  await expect(page.getByText("Computer Science")).toBeVisible();
  await expect(page.getByText("Because of the people.")).toBeVisible();

  await page.getByRole("button", { name: /submit my application/i }).click();

  // The confirmation comes from the server's answer to the submit, never from
  // the click.
  await expect(page.getByText(/your application has been submitted/i)).toBeVisible();

  // And it is final: the shared answers are locked and the committee
  // application is no longer editable.
  await page.goto("/app/apply/common");
  await expect(page.getByText(/can no longer be changed/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /save draft/i })).toBeHidden();

  await page.goto("/app/submissions");
  await expect(page.getByRole("row", { name: /labrador/i }).getByText("Submitted")).toBeVisible();
});

test("the deadline is enforced by the server, not the browser", async ({ page, context }) => {
  const seeded = await seedOpenCycle();
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);

  await page.goto("/app/committees");
  await page
    .getByRole("article", { name: /labrador/i })
    .getByRole("button", { name: /^apply to labrador$/i })
    .click();
  await expect(page.getByText(/already applied/i)).toBeVisible();

  await page.goto("/app/apply/labrador");
  await page.getByLabel(/why labrador/i).fill("Because of the people.");
  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  await page.goto("/app/apply/common");
  await page.getByLabel(/your major/i).fill("Computer Science");
  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  // The deadline passes while the review page is open. The browser's copy of
  // the cycle still says it is open, which is exactly the situation in which a
  // client-side check would wave the submission through.
  await closeCycleDeadline(seeded.cycleId);

  await page.goto("/app/review");
  await page.getByRole("button", { name: /submit my application/i }).click();

  // The server's own refusal, word for word, so this cannot pass on some other
  // element that happens to contain "deadline".
  await expect(page.getByText("The deadline for this recruitment cycle has passed.")).toBeVisible();
  await expect(page.getByText(/your application has been submitted/i)).toBeHidden();
});

test("every applicant page fits a phone without sideways scrolling", async ({ page, context }) => {
  await seedOpenCycle();
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);
  // An iPhone SE, which is about as narrow as a current phone gets.
  await page.setViewportSize({ width: 375, height: 667 });

  await page.goto("/app/committees");
  await page
    .getByRole("article", { name: /labrador/i })
    .getByRole("button", { name: /^apply to labrador$/i })
    .click();
  await expect(page.getByText(/already applied/i)).toBeVisible();

  for (const path of [
    "/recruit",
    "/signin",
    "/app/dashboard",
    "/app/committees",
    "/app/apply/common",
    "/app/apply/labrador",
    "/app/review",
    "/app/submissions",
    "/app/profile",
  ]) {
    await page.goto(path);
    // Waits for the page to settle, so this measures the rendered page rather
    // than a skeleton.
    await expect(page.getByRole("heading").first()).toBeVisible();

    /*
     * `document` typed here rather than by adding "dom" to the root tsconfig.
     *
     * This callback runs in the browser, but the same config checks the server,
     * and widening its lib would let server code reference `document` and
     * compile. A local type for the two properties this needs keeps the
     * narrower setting everywhere else.
     */
    const overflow = await page.evaluate(() => {
      const root = (
        globalThis as unknown as {
          document: { documentElement: { scrollWidth: number; clientWidth: number } };
        }
      ).document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });

    /*
     * A page that scrolls sideways on a phone is a page where buttons sit off
     * the edge, and most applicants will do this on a phone. A one-pixel
     * tolerance absorbs subpixel rounding in the layout engine; anything more
     * is content that does not fit.
     */
    expect(overflow, `${path} scrolls sideways on a 375px viewport`).toBeLessThanOrEqual(1);
  }
});

test("a long form with every question type fits a phone", async ({ page, context }) => {
  await seedOpenCycle({ everyQuestionType: true });
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);
  await page.setViewportSize({ width: 375, height: 667 });

  await page.goto("/app/apply/common");
  await expect(page.getByLabel("Your major")).toBeVisible();

  // Every type is present, including the two that carry no answer.
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.getByText(/not evaluated by any model/i)).toBeVisible();
  // A real file input now that #21 is built, not the placeholder it replaced.
  await expect(page.getByLabel("Choose a file")).toBeVisible();
  await expect(page.getByText(/PDF, PNG or JPEG, up to 10MB/i)).toBeVisible();

  const overflow = await page.evaluate(() => {
    const root = (
      globalThis as unknown as {
        document: { documentElement: { scrollWidth: number; clientWidth: number } };
      }
    ).document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });

  // A long form is where overflow shows up: a wide select, a long label, or a
  // radio group that will not wrap.
  expect(overflow, "the long form scrolls sideways on a 375px viewport").toBeLessThanOrEqual(1);
});

test("every control on a long form can be completed by keyboard in a real browser", async ({
  page,
  context,
}) => {
  await seedOpenCycle({ everyQuestionType: true });
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);

  await page.goto("/app/apply/common");
  await expect(page.getByLabel("Your major")).toBeVisible();

  await page.getByLabel("Your major").focus();
  await page.keyboard.type("Statistics");

  await page.keyboard.press("Tab");
  await page.keyboard.type("Because of the people.");

  // A radio group is reached with Tab and chosen with an arrow key.
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");

  // Each checkbox is its own stop; Space toggles.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");

  /*
   * The select, by keyboard, in Chromium.
   *
   * Type-to-select rather than ArrowDown: headless Chromium opens the native
   * popup on an arrow key instead of moving the selection, so an arrow
   * assertion would be testing the harness. Typing the option's first letters
   * is the platform behaviour that a keyboard user actually relies on, and it
   * only works at all because this is a real `<select>` - the whole reason
   * `QuestionField` uses native elements rather than a custom listbox.
   */
  const campus = page.getByLabel("Campus");
  await campus.focus();
  /*
   * Empty to start, not pre-selected on the first option.
   *
   * A required dropbox that arrives showing "Pittsburgh" looks answered, so
   * somebody scrolls past it and submits an answer they never gave. Worth
   * asserting rather than assuming.
   */
  await expect(campus).toHaveValue("");
  await page.keyboard.type("Doha");
  await expect(campus).toHaveValue("Doha");

  await page.getByLabel("Graduating year").focus();
  await page.keyboard.type("2028");

  await page.getByLabel("GitHub profile").focus();
  await page.keyboard.type("https://github.com/alice");

  // Saved from the keyboard too, and the server is what confirms it.
  await page.getByRole("button", { name: /save draft/i }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Saved /)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Your major")).toHaveValue("Statistics");
  await expect(page.getByLabel("Graduating year")).toHaveValue("2028");
});

test("a file uploads, commits, and survives a reload", async ({ page, context }) => {
  await seedOpenCycle({ everyQuestionType: true });
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);

  await page.goto("/app/apply/common");
  await expect(page.getByLabel("Choose a file")).toBeVisible();

  /*
   * The whole three-step flow in a real browser.
   *
   * Presign, a genuine PUT to the storage URL, then commit — none of which the
   * jsdom tests exercise against a real server, and the PUT in particular is
   * the step that cannot be mocked honestly: it goes to an origin that is not
   * the API.
   */
  await page.getByLabel("Choose a file").setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    // A minimal but genuine PDF header, because commit sniffs the magic bytes
    // and a file of zeroes is correctly refused.
    buffer: Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(512)]),
  });

  await expect(page.getByText("resume.pdf")).toBeVisible();
  await expect(page.getByText("File attached.")).toBeVisible();

  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  await page.reload();

  /*
   * The filename after a reload is the real assertion.
   *
   * The answer stores an opaque file id, so the name has to come back from the
   * download endpoint. If that is broken, a returning applicant sees a bare
   * uuid and cannot tell which file is attached — or whether one is.
   */
  await expect(page.getByText("resume.pdf")).toBeVisible();
});

test("the browser cannot fetch an upload without a signature", async ({ page, context }) => {
  await seedOpenCycle({ everyQuestionType: true });
  await seedAlice();
  await context.addCookies([await sessionCookie(alice.sessionToken)]);

  await page.goto("/app/apply/common");
  await page.getByLabel("Choose a file").setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(512)]),
  });
  await expect(page.getByText("File attached.")).toBeVisible();

  // A signed-in session is not enough. The object key is not a capability, so
  // storage refuses a request carrying no signature even from the owner's own
  // authenticated browser.
  const denied = await page.request.get(`${API_URL}/__local-storage/get?key=uploads/alice/any`);

  expect(denied.status()).toBe(403);
});
