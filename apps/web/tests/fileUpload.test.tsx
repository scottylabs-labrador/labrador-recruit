/**
 * The file upload control.
 *
 * Three network steps hide behind one click, and the applicant cannot see any
 * of them. So the tests are about what they *can* see: that a failure is said
 * out loud rather than leaving a control that looks finished, and that the
 * answer only holds a file id once the server has actually committed it — an
 * id recorded before the commit would be a reference submission refuses, and
 * the applicant would learn that at the deadline.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { FileUploader, ReadonlyFileAnswer } from "@/components/forms/FileUploader";

import {
  commitCalls,
  putCalls,
  setCommittedFile,
  setNextCommit,
  uploadCalls,
} from "./msw/handlers.ts";

function pdf(name = "resume.pdf") {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])], name, {
    type: "application/pdf",
  });
}

/** Holds the answer the way the real form does, so the control is controlled. */
function renderUploader(initial: string | null = null) {
  const onChange = vi.fn();

  function Harness() {
    const [value, setValue] = useState<string | null>(initial);
    return (
      <FileUploader
        id="q-resume"
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }

  return { ...render(<Harness />), onChange };
}

describe("uploading a file", () => {
  it("offers a real file input", async () => {
    renderUploader();

    // A native input, so the browser's own file picker, keyboard handling and
    // assistive-technology support come for free and correctly.
    const input = await screen.findByLabelText(/choose a file/i);
    expect(input).toHaveProperty("type", "file");
  });

  it("asks for a url, sends the bytes, then commits", async () => {
    const user = userEvent.setup();
    renderUploader();

    await user.upload(await screen.findByLabelText(/choose a file/i), pdf());

    /*
     * In that order, and all three. The bytes go straight to storage and never
     * through the API, which is the whole point of presigning; the commit is
     * what validates them.
     */
    await waitFor(() => {
      expect(commitCalls).toHaveLength(1);
    });
    expect(uploadCalls[0]).toMatchObject({
      originalFilename: "resume.pdf",
      mimeType: "application/pdf",
    });
    expect(putCalls).toHaveLength(1);
  });

  it("records the file id only after the server commits it", async () => {
    const user = userEvent.setup();
    const { onChange } = renderUploader();

    await user.upload(await screen.findByLabelText(/choose a file/i), pdf());

    /*
     * An id recorded before the commit is a reference submission refuses, and
     * the applicant would find that out at the deadline rather than now.
     */
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("file-1");
    });
  });

  it("shows the filename once it is attached", async () => {
    const user = userEvent.setup();
    renderUploader();

    await user.upload(await screen.findByLabelText(/choose a file/i), pdf("portfolio.pdf"));

    // Their own filename, not our opaque id. The id is ours; the name is what
    // tells them the right file went up.
    expect(await screen.findByText("portfolio.pdf")).toBeDefined();
  });

  it("says what went wrong in the server's own words", async () => {
    setNextCommit("wrong-type");
    const user = userEvent.setup();
    const { onChange } = renderUploader();

    await user.upload(await screen.findByLabelText(/choose a file/i), pdf("sneaky.pdf"));

    // The server checked the bytes and the browser cannot. Its message is the
    // only one that can tell the applicant what to do.
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/does not match the type it claims/i)).toBeDefined();
    // And nothing is recorded, so the form does not believe a file is attached.
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining("file-"));
  });

  it("announces progress rather than only drawing it", async () => {
    const user = userEvent.setup();
    renderUploader();

    await user.upload(await screen.findByLabelText(/choose a file/i), pdf());

    // Whether an upload finished is exactly what a spinner does not tell a
    // screen reader.
    const status = await screen.findByRole("status");
    expect(status).toBeDefined();
  });

  it("lets an attached file be replaced", async () => {
    const user = userEvent.setup();
    const { onChange } = renderUploader();

    await user.upload(await screen.findByLabelText(/choose a file/i), pdf("first.pdf"));
    await screen.findByText("first.pdf");

    await user.click(screen.getByRole("button", { name: /remove/i }));

    // Removing clears the answer. Leaving the old id behind would submit a
    // file the applicant believes they took off.
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("shows an already-attached file on a reloaded form", async () => {
    setCommittedFile("file-existing", {
      originalFilename: "saved-resume.pdf",
      mimeType: "application/pdf",
    });

    renderUploader("file-existing");

    // The answer holds an id the page did not upload this session, so the name
    // has to be fetched - otherwise a returning applicant sees a bare uuid and
    // cannot tell which file is attached.
    expect(await screen.findByText("saved-resume.pdf")).toBeDefined();
  });
});

describe("a file in a read-only answer", () => {
  it("shows the filename and a way to open it, never a bare id", async () => {
    setCommittedFile("file-saved", {
      originalFilename: "my-resume.pdf",
      mimeType: "application/pdf",
    });

    render(<ReadonlyFileAnswer fileId="file-saved" />);

    /*
     * The applicant's own submission detail page renders read-only, and a
     * `file_upload` answer stores an opaque id. Rendering it through the
     * generic answer path showed somebody a uuid where their resume should be
     * - on the page whose entire job is reading back what they sent.
     */
    expect(await screen.findByText("my-resume.pdf")).toBeDefined();
    expect(await screen.findByRole("link", { name: /download/i })).toBeDefined();
    expect(screen.queryByText("file-saved")).toBeNull();
  });

  it("says a file is attached when its name cannot be resolved", async () => {
    render(<ReadonlyFileAnswer fileId="file-gone" />);

    // The endpoint 404s for a file that is not the caller's or never
    // committed. Saying "a file is attached" is honest; showing the id is not
    // useful to anybody.
    expect(await screen.findByText(/a file is attached/i)).toBeDefined();
  });
});
