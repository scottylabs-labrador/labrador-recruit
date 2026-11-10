/**
 * The form builder.
 *
 * #25 exists because a committee director must be able to change their
 * application form without a pull request, a deploy, or asking an engineer —
 * and `docs/product-rules.md` section 7 says that if they cannot, it is a
 * defect in this platform's reason for existing.
 *
 * The two requirements most likely to be got wrong, and therefore the two these
 * tests care most about:
 *
 * - **Preview renders `DynamicFormRenderer`** — the real student component, not
 *   a lookalike. A preview's entire value is that it cannot be wrong, and a
 *   second implementation can.
 * - **The conditional rule is structured data** evaluated by
 *   `evaluateVisibility` — the same function the server validates with. Writing
 *   a second evaluator to drive the preview would mean the director is actively
 *   misled about when a question appears.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { QuestionDefinitionFixture } from "./msw/handlers.ts";
import {
  currentDraft,
  publishCalls,
  setDraft,
  setNextPublish,
  setSession,
} from "./msw/handlers.ts";
import { renderApp } from "./render.tsx";

const DIRECTOR = {
  user: {
    id: "mokafor",
    name: "Miriam Okafor",
    email: "mokafor@andrew.cmu.edu",
    role: "user" as const,
  },
};

const BUILDER = "/admin/forms/form-labrador";

function question(over: Partial<QuestionDefinitionFixture> = {}): QuestionDefinitionFixture {
  return {
    questionKey: "major",
    type: "short_text",
    label: "Your major",
    description: null,
    required: true,
    position: 1,
    config: null,
    visibilityRule: null,
    ...over,
  };
}

beforeEach(() => {
  setSession(DIRECTOR);
});

describe("the three panels", () => {
  it("offers every question type in the toolbox", async () => {
    await renderApp(BUILDER);

    const toolbox = await screen.findByRole("region", { name: /add a question/i });
    // All ten, because a type missing from the toolbox is a type a director
    // cannot use at all — there is no other way to add one.
    for (const label of [
      /short answer/i,
      /long answer/i,
      /multiple choice/i,
      /checkboxes/i,
      /dropdown/i,
      /number/i,
      /link/i,
      /file upload/i,
      /section heading/i,
      /description/i,
    ]) {
      expect(within(toolbox).getByRole("button", { name: label })).toBeDefined();
    }
  });

  it("shows the form's title and the empty canvas", async () => {
    await renderApp(BUILDER);

    expect(await screen.findByDisplayValue("Labrador application")).toBeDefined();
    expect(await screen.findByText(/no questions yet/i)).toBeDefined();
  });
});

describe("building a form", () => {
  it("adds a question from the toolbox and shows it on the canvas", async () => {
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(
      within(await screen.findByRole("region", { name: /add a question/i })).getByRole("button", {
        name: /short answer/i,
      }),
    );

    await waitFor(() => {
      expect(currentDraft().questions).toHaveLength(1);
    });
    expect(currentDraft().questions[0]!.type).toBe("short_text");
    expect(await screen.findByRole("button", { name: "Edit Untitled question" })).toBeDefined();
  });

  it("selects a question and edits its label", async () => {
    setDraft({ questions: [question()] });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: "Edit Your major" }));
    const settings = await screen.findByRole("region", { name: /question settings/i });
    const label = within(settings).getByLabelText(/question text/i);
    await user.clear(label);
    await user.type(label, "Your major or intended major");
    await user.click(within(settings).getByRole("button", { name: /save question/i }));

    await waitFor(() => {
      expect(currentDraft().questions[0]!.label).toBe("Your major or intended major");
    });
  });

  it("toggles required", async () => {
    setDraft({ questions: [question({ required: false })] });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: "Edit Your major" }));
    const settings = await screen.findByRole("region", { name: /question settings/i });
    await user.click(within(settings).getByLabelText(/required/i));
    await user.click(within(settings).getByRole("button", { name: /save question/i }));

    await waitFor(() => {
      expect(currentDraft().questions[0]!.required).toBe(true);
    });
  });

  it("edits the choices on a multiple-choice question", async () => {
    setDraft({
      questions: [
        question({
          questionKey: "year",
          type: "single_select",
          label: "Year",
          config: { choices: ["Junior"] },
        }),
      ],
    });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: "Edit Year" }));
    const settings = await screen.findByRole("region", { name: /question settings/i });
    await user.click(within(settings).getByRole("button", { name: /add a choice/i }));
    const choices = within(settings).getAllByLabelText(/choice \d/i);
    await user.type(choices[1]!, "Senior");
    await user.click(within(settings).getByRole("button", { name: /save question/i }));

    await waitFor(() => {
      expect(currentDraft().questions[0]!.config).toEqual({ choices: ["Junior", "Senior"] });
    });
  });

  it("does not offer a choice editor for a text question", async () => {
    setDraft({ questions: [question()] });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: "Edit Your major" }));

    const settings = await screen.findByRole("region", { name: /question settings/i });
    expect(within(settings).queryByRole("button", { name: /add a choice/i })).toBeNull();
  });

  it("deletes a question", async () => {
    setDraft({ questions: [question()] });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: "Edit Your major" }));
    const settings = await screen.findByRole("region", { name: /question settings/i });
    await user.click(within(settings).getByRole("button", { name: /delete this question/i }));
    await user.click(await screen.findByRole("button", { name: /yes, delete it/i }));

    await waitFor(() => {
      expect(currentDraft().questions).toHaveLength(0);
    });
  });

  it("asks before deleting, because a question takes a while to write", async () => {
    setDraft({ questions: [question()] });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: "Edit Your major" }));
    await user.click(
      within(await screen.findByRole("region", { name: /question settings/i })).getByRole(
        "button",
        { name: /delete this question/i },
      ),
    );

    expect(currentDraft().questions).toHaveLength(1);
  });

  it("duplicates a question, giving the copy its own key", async () => {
    setDraft({ questions: [question()] });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: "Edit Your major" }));
    await user.click(
      within(await screen.findByRole("region", { name: /question settings/i })).getByRole(
        "button",
        { name: /duplicate/i },
      ),
    );

    await waitFor(() => {
      expect(currentDraft().questions).toHaveLength(2);
    });
    // A key is how an answer finds its question, so the copy cannot share one.
    const keys = currentDraft().questions.map((row) => row.questionKey);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("reordering", () => {
  it("moves a question and saves the whole order", async () => {
    setDraft({
      questions: [
        question(),
        question({ questionKey: "essay", label: "Why Labrador?", position: 2 }),
      ],
    });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: /move why labrador\? up/i }));

    await waitFor(() => {
      expect(currentDraft().questions.map((row) => row.questionKey)).toEqual(["essay", "major"]);
    });
  });

  it("can be reordered from the keyboard alone", async () => {
    setDraft({
      questions: [
        question(),
        question({ questionKey: "essay", label: "Why Labrador?", position: 2 }),
      ],
    });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    /*
     * Buttons, not only a drag handle.
     *
     * #25 names `dnd-kit`, and a pointer drag is the nicest way to do this for
     * most people — but a reorder that can *only* be dragged cannot be done at
     * all by somebody not using a pointer, and position decides both the
     * display order and the order visibility rules evaluate in. So the
     * keyboard path is a real control rather than a fallback, and it is the one
     * the tests drive.
     */
    (await screen.findByRole("button", { name: /move why labrador\? up/i })).focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(currentDraft().questions[0]!.questionKey).toBe("essay");
    });
  });

  it("does not offer to move the first question up or the last one down", async () => {
    setDraft({
      questions: [
        question(),
        question({ questionKey: "essay", label: "Why Labrador?", position: 2 }),
      ],
    });
    await renderApp(BUILDER);

    const up = await screen.findByRole("button", { name: /move your major up/i });
    const down = await screen.findByRole("button", { name: /move why labrador\? down/i });
    expect(up).toHaveProperty("disabled", true);
    expect(down).toHaveProperty("disabled", true);
  });
});

describe("conditional visibility", () => {
  it("produces structured data that survives a reload", async () => {
    setDraft({
      questions: [
        question({
          questionKey: "year",
          type: "single_select",
          label: "Year",
          config: { choices: ["Junior", "Senior"] },
        }),
        question({ questionKey: "transferFrom", label: "Which school?", position: 2 }),
      ],
    });
    const user = userEvent.setup();
    const { router } = await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: "Edit Which school?" }));
    const settings = await screen.findByRole("region", { name: /question settings/i });
    await user.click(within(settings).getByLabelText(/only show this question sometimes/i));
    await user.selectOptions(within(settings).getByLabelText(/depends on/i), "year");
    await user.selectOptions(within(settings).getByLabelText(/^when the answer/i), "equals");
    await user.selectOptions(within(settings).getByLabelText(/the value/i), "Junior");
    await user.click(within(settings).getByRole("button", { name: /save question/i }));

    /*
     * The shape is the contract.
     *
     * `question.visibility_rule_json` round-trips through the builder, the
     * renderer and the server's publish check, all reading the same closed
     * union from ADR 0005. A rule the builder writes in its own shape would
     * evaluate differently in the one place that matters.
     */
    await waitFor(() => {
      expect(currentDraft().questions[1]!.visibilityRule).toEqual({
        equals: { questionKey: "year", value: "Junior" },
      });
    });

    // And it comes back. A rule that saves but does not reload is a rule the
    // director cannot edit twice.
    await router.invalidate();
    await user.click(await screen.findByRole("button", { name: "Edit Which school?" }));
    // `findByDisplayValue` on a `<select>` matches the selected option's
    // *text*, which is the question's label - the value is its key.
    expect(
      await within(
        await screen.findByRole("region", { name: /question settings/i }),
      ).findByDisplayValue("Year"),
    ).toBeDefined();
  });

  it("offers only earlier questions to depend on", async () => {
    setDraft({
      questions: [
        question({ questionKey: "first", label: "First" }),
        question({ questionKey: "second", label: "Second", position: 2 }),
        question({ questionKey: "third", label: "Third", position: 3 }),
      ],
    });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: "Edit Second" }));
    const settings = await screen.findByRole("region", { name: /question settings/i });
    await user.click(within(settings).getByLabelText(/only show this question sometimes/i));

    /*
     * The forward reference is prevented rather than reported.
     *
     * `evaluateVisibility` is a single pass in position order, so a rule
     * depending on a later answer can never be satisfied — the question would
     * be permanently hidden and the director would have no idea why. #17
     * refuses it at publish; offering only the earlier questions means it
     * cannot be written in the first place, which is a better place to catch
     * it than an error message.
     */
    const dependsOn = within(settings).getByLabelText(/depends on/i);
    const options = within(dependsOn).getAllByRole("option");
    const values = options.map((option) => option.getAttribute("value"));
    expect(values).toContain("first");
    expect(values).not.toContain("third");
    expect(values).not.toContain("second");
  });

  it("says why when a question has nothing it could depend on", async () => {
    setDraft({ questions: [question()] });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: "Edit Your major" }));
    const settings = await screen.findByRole("region", { name: /question settings/i });

    // The first question on a form has no earlier answer to key off. An empty
    // dropdown with no explanation reads as broken.
    expect(within(settings).getByText(/move it after another question/i)).toBeDefined();
  });
});

describe("preview", () => {
  it("renders the student component, not a lookalike", async () => {
    setDraft({
      questions: [
        question({
          questionKey: "year",
          type: "single_select",
          label: "Year",
          required: true,
          config: { choices: ["Junior", "Senior"] },
        }),
      ],
    });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: /preview/i }));

    /*
     * `single_select` renders as radios in a fieldset, and "required" is in
     * words rather than an asterisk. Both are `QuestionField`'s decisions, so
     * seeing them here is evidence the preview really is the student
     * component — a lookalike would have had to reimplement exactly those
     * choices to pass.
     */
    const group = await screen.findByRole("group", { name: /year/i });
    expect(within(group).getByRole("radio", { name: "Junior" })).toBeDefined();
    expect(await screen.findByText(/\(required\)/i)).toBeDefined();
  });

  it("evaluates a conditional rule the way the student form will", async () => {
    setDraft({
      questions: [
        question({
          questionKey: "year",
          type: "single_select",
          label: "Year",
          config: { choices: ["Junior", "Senior"] },
        }),
        question({
          questionKey: "transferFrom",
          label: "Which school?",
          position: 2,
          visibilityRule: { equals: { questionKey: "year", value: "Junior" } },
        }),
      ],
    });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: /preview/i }));
    expect(screen.queryByLabelText(/which school\?/i)).toBeNull();

    await user.click(await screen.findByRole("radio", { name: "Junior" }));

    // Through `evaluateVisibility`, the same function the server validates
    // with. A second evaluator here would eventually disagree, and the
    // director would be confidently misled.
    expect(await screen.findByLabelText(/which school\?/i)).toBeDefined();
  });

  it("goes back to editing", async () => {
    setDraft({ questions: [question()] });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: /preview/i }));
    await user.click(await screen.findByRole("button", { name: /back to editing/i }));

    expect(await screen.findByRole("region", { name: /add a question/i })).toBeDefined();
  });
});

describe("publishing", () => {
  it("warns that publishing freezes the version", async () => {
    setDraft({ questions: [question()] });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: /^publish/i }));

    // Irreversible, and the applicant-facing consequence is what matters:
    // this version is what people answer against and cannot be edited after.
    expect(await screen.findByText(/cannot be changed/i)).toBeDefined();
    expect(publishCalls).toEqual([]);
  });

  it("publishes once confirmed", async () => {
    setDraft({ questions: [question()] });
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: /^publish/i }));
    await user.click(await screen.findByRole("button", { name: /yes, publish it/i }));

    await waitFor(() => {
      expect(publishCalls).toEqual(["form-labrador"]);
    });
    // By role, because the header legitimately says "not yet published" while
    // a draft is open and that matches the same words.
    const status = await screen.findByRole("status");
    expect(within(status).getByText(/applicants now see this version/i)).toBeDefined();
  });

  it("gives a question editor no publish affordance at all", async () => {
    setDraft({ questions: [question()], canPublish: false });
    await renderApp(BUILDER);

    await screen.findByRole("button", { name: "Edit Your major" });

    /*
     * Withheld from `canPublish`, which the server computes from the same
     * ability its publish route gates on — not guessed from a role the client
     * was never told. Hiding the button is a courtesy; the route refuses an
     * editor anyway, and there is a server test for that.
     */
    expect(screen.queryByRole("button", { name: /^publish/i })).toBeNull();
  });

  it("names the offending question when the server refuses the rules", async () => {
    setDraft({ questions: [question()] });
    setNextPublish("rules");
    const user = userEvent.setup();
    await renderApp(BUILDER);

    await user.click(await screen.findByRole("button", { name: /^publish/i }));
    await user.click(await screen.findByRole("button", { name: /yes, publish it/i }));

    // The server checks the whole set at publish and its message names the
    // question. "Could not publish" would send a director hunting through
    // forty of them.
    const problem = await screen.findByRole("alert");
    // A button, because each problem links to the question it is about -
    // "could not publish" would send a director hunting through forty of them.
    const link = within(problem).getByRole("button", { name: /transferFrom/ });
    expect(link.textContent).toMatch(/comes later/i);
  });
});

describe("the form's own details", () => {
  it("renames the form", async () => {
    const user = userEvent.setup();
    await renderApp(BUILDER);

    const title = await screen.findByDisplayValue("Labrador application");
    await user.clear(title);
    await user.type(title, "Labrador — Spring 2027");
    await user.tab();

    await waitFor(() => {
      expect(currentDraft().title).toBe("Labrador — Spring 2027");
    });
  });

  it("says which version is being edited", async () => {
    setDraft({ version: 3 });
    await renderApp(BUILDER);

    // A director editing version 3 should know versions 1 and 2 are out there
    // being answered, and that this draft is not live yet.
    expect(await screen.findByText(/version 3/i)).toBeDefined();
    expect(await screen.findByText(/not yet published/i)).toBeDefined();
  });
});
