export type RequirementContextProviderKey = "github" | "confluence" | "jira";

export interface RequirementContextCapabilityFlags {
  supportsIssueLinks: boolean;
  supportsSpecPages: boolean;
  supportsTaskTickets: boolean;
  supportsLiveFetch: boolean;
  supportsCandidateInference: boolean;
}

const capabilityByProvider: Record<
  RequirementContextProviderKey,
  RequirementContextCapabilityFlags
> = {
  github: {
    supportsIssueLinks: true,
    supportsSpecPages: false,
    supportsTaskTickets: false,
    supportsLiveFetch: true,
    supportsCandidateInference: true,
  },
  confluence: {
    supportsIssueLinks: false,
    supportsSpecPages: true,
    supportsTaskTickets: false,
    supportsLiveFetch: false,
    supportsCandidateInference: false,
  },
  jira: {
    supportsIssueLinks: true,
    supportsSpecPages: false,
    supportsTaskTickets: true,
    supportsLiveFetch: false,
    supportsCandidateInference: false,
  },
};

export function resolveRequirementContextCapabilityFlags(
  provider: RequirementContextProviderKey,
): RequirementContextCapabilityFlags {
  return {
    ...capabilityByProvider[provider],
  };
}
