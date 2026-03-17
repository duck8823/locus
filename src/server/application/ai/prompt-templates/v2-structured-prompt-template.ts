import type { AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import type { PromptTemplate } from "./prompt-template";

export class V2StructuredPromptTemplate implements PromptTemplate {
  readonly templateId = "v2-structured";
  readonly version: string;

  constructor(promptVersion: string) {
    this.version = promptVersion;
  }

  buildSystemInstruction(): string {
    return [
      "# Role",
      `You are Locus, an AI code review assistant (prompt version: ${this.version}).`,
      "Your job is to review semantic changes in a pull request and provide actionable suggestions.",
      "",
      "# Review Guidelines",
      "",
      "## Severity Levels",
      "- **high**: Bugs, security issues, data corruption risks, breaking API contracts",
      "- **medium**: Logic errors, missing edge cases, performance concerns, inconsistent patterns",
      "- **low**: Style improvements, minor refactoring opportunities, documentation gaps",
      "",
      "## Categories",
      "- **semantic**: Issues found in the code changes themselves (logic, correctness, safety)",
      "- **architecture**: Issues related to module boundaries, dependency direction, layer violations",
      "- **business**: Issues related to business requirements, acceptance criteria, or spec compliance",
      "- **general**: Cross-cutting concerns that don't fit other categories",
      "",
      "## Architecture Context",
      "When architecture context is provided, check for:",
      "- Layer boundary violations (e.g., presentation importing infrastructure directly)",
      "- Circular dependencies between modules",
      "- Changes that affect many downstream callers",
      "- Inconsistent dependency direction",
      "",
      "## Business Context",
      "When business context (issues, specs) is provided:",
      "- Verify the changes align with the stated requirements",
      "- Flag any acceptance criteria that may not be met",
      "- Note if the changes exceed the scope of the requirement",
      "",
      "# Output Format",
      "Return **JSON only** with no markdown fences or surrounding text.",
      "",
      "{",
      '  "suggestions": [',
      "    {",
      '      "suggestionId": "unique-kebab-case-id",',
      '      "category": "semantic" | "architecture" | "business" | "general",',
      '      "confidence": "high" | "medium" | "low",',
      '      "headline": "One-line summary of the issue",',
      '      "recommendation": "Specific, actionable suggestion to fix or improve",',
      '      "rationale": ["Reason 1", "Reason 2"]',
      "    }",
      "  ]",
      "}",
      "",
      "# Rules",
      "- Return 1-5 suggestions. Fewer is better if there are few real issues.",
      "- Do not flag purely stylistic issues unless they indicate a real problem.",
      "- Be specific: reference symbol names, file paths, and line numbers when available.",
      "- If no meaningful issues are found, return an empty suggestions array.",
    ].join("\n");
  }

  buildUserMessage(payload: AiSuggestionPayload): string {
    const sections: string[] = [];

    sections.push(`## Review: ${payload.review.title}`);
    sections.push(`Repository: ${payload.review.repositoryName}`);
    sections.push(`Branch: ${payload.review.branchLabel}`);
    sections.push("");

    if (payload.semanticContext.changes.length > 0) {
      sections.push("## Semantic Changes");

      for (const change of payload.semanticContext.changes) {
        const location = change.location ? ` (${change.location})` : "";
        sections.push(
          `- **${change.changeType}** ${change.symbolKind} \`${change.symbolDisplayName}\`${location}`,
        );

        if (change.signatureSummary) {
          sections.push(`  Signature: ${change.signatureSummary}`);
        }

        if (change.bodySummary) {
          sections.push(`  Body: ${change.bodySummary}`);
        }
      }

      if (payload.semanticContext.isTruncated) {
        sections.push(
          `  _(${payload.semanticContext.totalCount - payload.semanticContext.includedCount} more changes not shown)_`,
        );
      }

      sections.push("");
    }

    if (
      payload.architectureContext.upstreamNodes.length > 0 ||
      payload.architectureContext.downstreamNodes.length > 0
    ) {
      sections.push("## Architecture Context");

      if (payload.architectureContext.upstreamNodes.length > 0) {
        sections.push("### Upstream (depends on this)");
        for (const node of payload.architectureContext.upstreamNodes) {
          sections.push(`- ${node.label} (${node.kind})`);
        }
      }

      if (payload.architectureContext.downstreamNodes.length > 0) {
        sections.push("### Downstream (this depends on)");
        for (const node of payload.architectureContext.downstreamNodes) {
          sections.push(`- ${node.label} (${node.kind})`);
        }
      }

      sections.push("");
    }

    if (payload.businessContext.items.length > 0) {
      sections.push("## Business Context");

      for (const item of payload.businessContext.items) {
        const confidence = item.confidence ? ` [${item.confidence}]` : "";
        sections.push(`- **${item.title}**${confidence}`);

        if (item.summary) {
          sections.push(`  ${item.summary}`);
        }
      }

      sections.push("");
    }

    return sections.join("\n");
  }
}
