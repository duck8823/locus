// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollapsibleDetails } from "./collapsible-details";

describe("CollapsibleDetails component", () => {
  it("renders summary text", () => {
    render(
      <CollapsibleDetails summary="Test Summary">
        <p>Content</p>
      </CollapsibleDetails>,
    );

    expect(screen.getByText("Test Summary")).toBeDefined();
  });

  it("renders children content", () => {
    render(
      <CollapsibleDetails summary="Summary" defaultOpen>
        <p>Inner content</p>
      </CollapsibleDetails>,
    );

    expect(screen.getByText("Inner content")).toBeDefined();
  });
});
