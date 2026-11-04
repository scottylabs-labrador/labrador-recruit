import type { AnswerMap, QuestionDefinition, QuestionType } from "@recruit/common";
/**
 * The dynamic form renderer.
 *
 * Three surfaces go through this component: the student application, the form
 * builder's preview, and the staff applicant-detail page. A second renderer for
 * any of them would drift, and the preview is the one most likely to mislead
 * the person relying on it most — so these tests cover the props all three use.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DynamicFormRenderer } from "@/components/forms/DynamicFormRenderer";

function q(
  questionKey: string,
  type: QuestionType,
  overrides: Partial<QuestionDefinition> = {},
): QuestionDefinition {
  return {
    questionKey,
    type,
    label: questionKey,
    required: false,
    position: 1,
    config: null,
    visibilityRule: null,
    ...overrides,
  };
}

/**
 * Renders the form with its answers held in state.
 *
 * The renderer is controlled, so a spy that does not feed the new value back
 * leaves every control showing its initial value — typing "2028" into a number
 * field would report `2`, then `0`, then `2`, then `8`, each against an empty
 * box. The real page holds this state for autosave and the revision check, so
 * the harness holds it too, and the spy observes rather than replaces it.
 */
function renderForm(
  questions: QuestionDefinition[],
  initialAnswers: AnswerMap = {},
  props: Partial<React.ComponentProps<typeof DynamicFormRenderer>> = {},
) {
  const onChange = vi.fn();

  function Harness() {
    const [answers, setAnswers] = useState<AnswerMap>(initialAnswers);
    return (
      <DynamicFormRenderer
        questions={questions}
        answers={answers}
        mode="edit"
        onChange={(key, value) => {
          onChange(key, value);
          setAnswers((previous) => ({ ...previous, [key]: value }));
        }}
        {...props}
      />
    );
  }

  return { ...render(<Harness />), onChange };
}

describe("every question type renders a usable control", () => {
  it("renders short and long text", () => {
    renderForm([
      q("short", "short_text", { label: "Your major", position: 1 }),
      q("long", "long_text", { label: "Why join", position: 2 }),
    ]);

    expect(screen.getByLabelText("Your major")).toBeDefined();
    expect(screen.getByLabelText("Why join")).toBeDefined();
  });

  it("renders a number input that reports a number, not a string", async () => {
    const { onChange } = renderForm([q("year", "number", { label: "Graduation year" })]);

    await userEvent.type(screen.getByLabelText("Graduation year"), "2028");

    // The shared validator refuses a string where a number belongs, on purpose.
    // If the renderer sent "2028" the form would be unsubmittable with no
    // explanation on screen.
    expect(onChange).toHaveBeenLastCalledWith("year", 2028);
  });

  it("renders a url input", () => {
    renderForm([q("github", "url", { label: "GitHub" })]);

    expect(screen.getByLabelText("GitHub")).toBeDefined();
  });

  it("renders single select as radios, so one choice is visibly exclusive", async () => {
    const { onChange } = renderForm([
      q("area", "single_select", { label: "Area", config: { choices: ["Software", "Design"] } }),
    ]);

    await userEvent.click(screen.getByRole("radio", { name: "Design" }));

    expect(onChange).toHaveBeenLastCalledWith("area", "Design");
  });

  it("renders a dropdown as a select", async () => {
    const { onChange } = renderForm([
      q("area", "dropdown", { label: "Area", config: { choices: ["Software", "Design"] } }),
    ]);

    await userEvent.selectOptions(screen.getByLabelText("Area"), "Design");

    expect(onChange).toHaveBeenLastCalledWith("area", "Design");
  });

  it("renders multi select as checkboxes and accumulates choices", async () => {
    const { onChange } = renderForm(
      [q("langs", "multi_select", { label: "Languages", config: { choices: ["Go", "Rust"] } })],
      { langs: ["Go"] },
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "Rust" }));

    expect(onChange).toHaveBeenLastCalledWith("langs", ["Go", "Rust"]);
  });

  it("removes a choice from a multi select when it is unticked", async () => {
    const { onChange } = renderForm(
      [q("langs", "multi_select", { label: "Languages", config: { choices: ["Go", "Rust"] } })],
      { langs: ["Go", "Rust"] },
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "Go" }));

    expect(onChange).toHaveBeenLastCalledWith("langs", ["Rust"]);
  });

  it("withholds a file upload rather than offering a box that does nothing", () => {
    renderForm([q("resume", "file_upload", { label: "Your resume", required: true })]);

    /*
     * #21 owns uploads and is not built yet.
     *
     * A text box here would accept whatever somebody typed and look exactly
     * like a working upload, and the applicant would believe their resume was
     * attached. Saying so plainly is the only honest placeholder - and this
     * test is what stops the default branch quietly turning it into an input.
     */
    expect(screen.getByText(/uploads are not available yet/i)).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders a section heading as a heading, with no control", () => {
    renderForm([q("part-one", "section_heading", { label: "Part one" })]);

    expect(screen.getByRole("heading", { name: "Part one" })).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders static content as text, with no control", () => {
    renderForm([
      q("note", "static_content", { label: "Read this", description: "Some instructions." }),
    ]);

    expect(screen.getByText("Some instructions.")).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("labelling and required state", () => {
  it("associates a real label with every control", () => {
    renderForm([q("major", "short_text", { label: "Your major" })]);

    const input = screen.getByLabelText("Your major");

    // A placeholder is not a label: it disappears exactly when the user needs
    // it, and a screen reader announces nothing.
    expect(input.getAttribute("placeholder")).toBeNull();
  });

  it("marks a required question in text, not by colour alone", () => {
    renderForm([q("major", "short_text", { label: "Your major", required: true })]);

    expect(screen.getByText(/required/i)).toBeDefined();
  });

  it("marks a control as required for assistive technology", () => {
    renderForm([q("major", "short_text", { label: "Your major", required: true })]);

    expect(screen.getByLabelText(/Your major/).getAttribute("aria-required")).toBe("true");
  });

  it("shows help text and associates it with the control", () => {
    renderForm([
      q("major", "short_text", { label: "Your major", description: "As it appears on SIO." }),
    ]);

    const input = screen.getByLabelText(/Your major/);
    const describedBy = input.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    expect(screen.getByText("As it appears on SIO.").id).toBe(describedBy);
  });
});

describe("conditional visibility", () => {
  const questions = [
    q("area", "single_select", {
      label: "Area",
      position: 1,
      config: { choices: ["AI", "Design"] },
    }),
    q("ai-project", "long_text", {
      label: "AI project",
      position: 2,
      visibilityRule: { equals: { questionKey: "area", value: "AI" } },
    }),
  ];

  it("hides a conditional question until its rule is satisfied", () => {
    renderForm(questions, { area: "Design" });

    expect(screen.queryByLabelText("AI project")).toBeNull();
  });

  it("shows a conditional question once its rule is satisfied", () => {
    renderForm(questions, { area: "AI" });

    expect(screen.getByLabelText("AI project")).toBeDefined();
  });

  it("announces that a question appeared, rather than silently inserting it", () => {
    renderForm(questions, { area: "AI" });

    // A question materialising mid-form is invisible to somebody using a screen
    // reader unless the region announces it.
    const region = screen.getByLabelText("AI project").closest("[aria-live]");
    expect(region).not.toBeNull();
  });
});

describe("validation messages", () => {
  it("shows a message for an answer the shared validator rejects", async () => {
    renderForm([q("github", "url", { label: "GitHub" })], { github: "not-a-url" });

    await userEvent.click(screen.getByLabelText("GitHub"));
    await userEvent.tab();

    // Unparseable, so the message is about the shape rather than the scheme.
    expect(screen.getByText(/enter a full link/i)).toBeDefined();
  });

  it("shows the scheme message for a link that parses but is not a transport", async () => {
    renderForm([q("github", "url", { label: "GitHub" })], { github: "javascript:alert(1)" });

    await userEvent.click(screen.getByLabelText("GitHub"));
    await userEvent.tab();

    // A separate case from the one above: `javascript:` parses perfectly well,
    // which is exactly why the allow-list exists rather than a shape check.
    expect(screen.getByText(/must start with http:\/\/ or https:\/\//i)).toBeDefined();
  });

  it("marks an invalid control for assistive technology", async () => {
    renderForm([q("github", "url", { label: "GitHub" })], { github: "not-a-url" });

    await userEvent.click(screen.getByLabelText("GitHub"));
    await userEvent.tab();

    expect(screen.getByLabelText("GitHub").getAttribute("aria-invalid")).toBe("true");
  });

  it("does not show a validation message before the field has been touched", () => {
    renderForm([q("github", "url", { label: "GitHub" })], { github: "not-a-url" });

    // Scolding somebody about a field they have not reached yet is hostile, and
    // on a long form it paints the whole page red before they start.
    expect(screen.queryByText(/enter a full link/i)).toBeNull();
  });

  it("shows a server-reported error immediately, without waiting to be touched", () => {
    renderForm(
      [q("github", "url", { label: "GitHub" })],
      { github: "not-a-url" },
      {
        errors: { github: "That link could not be reached." },
      },
    );

    // A submit attempt already happened, so the applicant has seen the field.
    expect(screen.getByText("That link could not be reached.")).toBeDefined();
  });
});

describe("readonly mode", () => {
  const questions = [
    q("major", "short_text", { label: "Your major", position: 1 }),
    q("langs", "multi_select", {
      label: "Languages",
      position: 2,
      config: { choices: ["Go", "Rust"] },
    }),
  ];
  const answers: AnswerMap = { major: "Computer Science", langs: ["Go", "Rust"] };

  it("renders no form controls at all", () => {
    render(<DynamicFormRenderer questions={questions} answers={answers} mode="readonly" />);

    // A disabled textarea with an essay in it is unreadable, and a reviewer
    // spends longer here than anybody.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("renders the answers as text", () => {
    render(<DynamicFormRenderer questions={questions} answers={answers} mode="readonly" />);

    expect(screen.getByText("Computer Science")).toBeDefined();
    expect(screen.getByText("Go, Rust")).toBeDefined();
  });

  it("says so when a question was left unanswered", () => {
    render(<DynamicFormRenderer questions={questions} answers={{}} mode="readonly" />);

    // Blank space reads as a rendering bug. A reviewer needs to know the
    // applicant chose not to answer.
    expect(screen.getAllByText(/no answer/i).length).toBeGreaterThan(0);
  });

  it("still hides questions the rules hide", () => {
    const conditional = [
      q("area", "single_select", { label: "Area", position: 1, config: { choices: ["AI"] } }),
      q("ai-project", "long_text", {
        label: "AI project",
        position: 2,
        visibilityRule: { equals: { questionKey: "area", value: "AI" } },
      }),
    ];

    render(
      <DynamicFormRenderer
        questions={conditional}
        answers={{ area: "Design", "ai-project": "stale" }}
        mode="readonly"
      />,
    );

    // The applicant changed their mind and the question disappeared. Showing
    // the orphaned text would put something in front of a reviewer that the
    // applicant believes they removed.
    expect(screen.queryByText("stale")).toBeNull();
  });
});

describe("keyboard operability", () => {
  it("reaches every control in form order with Tab alone", async () => {
    renderForm([
      q("a", "short_text", { label: "First", position: 1 }),
      q("b", "long_text", { label: "Second", position: 2 }),
      q("c", "dropdown", { label: "Third", position: 3, config: { choices: ["x"] } }),
    ]);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("First"));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Second"));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Third"));
  });

  it("renders in position order, not array order", () => {
    renderForm([
      q("second", "short_text", { label: "Second", position: 2 }),
      q("first", "short_text", { label: "First", position: 1 }),
    ]);

    const labels = screen.getAllByText(/^(First|Second)$/).map((node) => node.textContent);
    expect(labels).toEqual(["First", "Second"]);
  });
});

describe("a whole form can be completed from the keyboard", () => {
  /*
   * Every answer-carrying type, filled without a pointer.
   *
   * `Tab` order alone is not enough to prove this: a radio group is reached
   * with Tab but *chosen* with the arrow keys, a checkbox with Space, and a
   * select with typing or arrows. A form that can be reached but not completed
   * is a form somebody cannot submit, and this one has a deadline.
   */
  const EVERY_TYPE = [
    q("major", "short_text", { label: "Major", position: 1 }),
    q("essay", "long_text", { label: "Essay", position: 2 }),
    q("year", "single_select", {
      label: "Year",
      position: 3,
      config: { choices: ["Junior", "Senior"] },
    }),
    q("interests", "multi_select", {
      label: "Interests",
      position: 4,
      config: { choices: ["Design", "Infra"] },
    }),
    q("campus", "dropdown", {
      label: "Campus",
      position: 5,
      config: { choices: ["Pittsburgh", "Doha"] },
    }),
    q("graduating", "number", { label: "Graduating", position: 6 }),
    q("github", "url", { label: "GitHub", position: 7 }),
  ];

  it("fills every control without a pointer", async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm(EVERY_TYPE);

    await user.tab();
    await user.keyboard("Statistics");

    await user.tab();
    await user.keyboard("I would like to join.");

    // A radio group: Tab lands on it, an arrow key chooses within it.
    await user.tab();
    await user.keyboard("{ArrowDown}");

    // Checkboxes: each is its own tab stop, and Space toggles.
    await user.tab();
    await user.keyboard(" ");

    // Past the second checkbox, onto the select.
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Campus"));
    /*
     * `selectOptions` rather than an arrow key.
     *
     * jsdom does not implement native `<select>` keyboard navigation, so an
     * arrow key here would prove nothing about a real browser either way. What
     * this asserts is the part jsdom can answer - the select is a genuine tab
     * stop and reports the chosen value - and the end-to-end suite walks a real
     * one in Chromium.
     */
    await user.selectOptions(screen.getByLabelText("Campus"), "Doha");

    await user.tab();
    await user.keyboard("2028");

    await user.tab();
    await user.keyboard("https://github.com/aquinn");

    expect(onChange).toHaveBeenCalledWith("major", "Statistics");
    expect(onChange).toHaveBeenCalledWith("essay", "I would like to join.");
    expect(onChange).toHaveBeenCalledWith("year", "Senior");
    expect(onChange).toHaveBeenCalledWith("interests", ["Design"]);
    expect(onChange).toHaveBeenCalledWith("campus", "Doha");
    expect(onChange).toHaveBeenCalledWith("graduating", 2028);
    expect(onChange).toHaveBeenCalledWith("github", "https://github.com/aquinn");
  });

  it("puts the focus somewhere visible on every control", async () => {
    const user = userEvent.setup();
    renderForm(EVERY_TYPE);

    /*
     * Eight tab stops, counted: two text controls, one radio group (a group
     * with nothing chosen exposes exactly one), two checkboxes, a select, a
     * number and a url. Nine would wrap around to the body and pass for the
     * wrong reason.
     *
     * A control that cannot take focus is one a keyboard user walks straight
     * past without ever learning it was there.
     */
    for (let step = 0; step < 8; step += 1) {
      await user.tab();
      expect(document.activeElement).not.toBe(document.body);
    }
  });
});
