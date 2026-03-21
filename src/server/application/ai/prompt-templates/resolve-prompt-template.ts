import type { PromptTemplate } from "./prompt-template";
import { V1BasicPromptTemplate } from "./v1-basic-prompt-template";
import { V2StructuredPromptTemplate } from "./v2-structured-prompt-template";

export function resolvePromptTemplate(promptVersion: string): PromptTemplate {
  if (promptVersion.startsWith("v2") || promptVersion.startsWith("structured")) {
    return new V2StructuredPromptTemplate(promptVersion);
  }

  return new V1BasicPromptTemplate(promptVersion);
}
