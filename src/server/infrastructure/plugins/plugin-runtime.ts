import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isCodeHostPlugin,
  validatePluginActivationResult,
  validatePluginManifest,
  type CodeHostPlugin,
  type ProviderAgnosticPullRequestSnapshotProvider,
  type PluginActivationResult,
  type PluginCapabilityBinding,
  type PluginRuntimeLogger,
  type PullRequestSourceRef,
  type PullRequestSourceProvider,
} from "@/server/application/plugins/plugin-sdk";

export type PluginLoadStatus = "active" | "disabled" | "skipped";

export interface PluginLoadRecord {
  pluginId: string;
  source: string;
  status: PluginLoadStatus;
  reason: string;
}

export interface PluginStatusRecord {
  pluginId: string;
  status: Exclude<PluginLoadStatus, "skipped">;
  reason: string | null;
}

export interface PluginRuntimeOptions {
  importModule?: (specifier: string) => Promise<unknown>;
  logger?: PluginRuntimeLogger;
  shouldDisableOnCapabilityError?: (error: unknown) => boolean;
}

interface LoadedPluginState {
  pluginId: string;
  deactivate?: PluginActivationResult["deactivate"];
  capabilities: PluginCapabilityBinding[];
  abortController: AbortController;
  status: "active" | "disabled";
  reason: string | null;
}

interface PullRequestCapabilityRegistration {
  pluginId: string;
  implementation: ProviderAgnosticPullRequestSnapshotProvider;
}

const noopLogger: PluginRuntimeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

async function importModule(specifier: string): Promise<unknown> {
  return import(specifier);
}

function toFileUrlPath(filePath: string, baseDir: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
  return pathToFileURL(absolutePath).href;
}

function resolvePluginFromModule(moduleExport: unknown): CodeHostPlugin | null {
  if (isCodeHostPlugin(moduleExport)) {
    return moduleExport;
  }

  if (!moduleExport || typeof moduleExport !== "object") {
    return null;
  }

  const record = moduleExport as Record<string, unknown>;

  if (isCodeHostPlugin(record.default)) {
    return record.default;
  }

  if (isCodeHostPlugin(record.plugin)) {
    return record.plugin;
  }

  return null;
}

export class PluginCapabilityUnavailableError extends Error {
  constructor(
    readonly capability: "pull-request-snapshot-provider",
    readonly provider: PullRequestSourceProvider,
  ) {
    super(`No plugin capability registered for ${capability}:${provider}`);
    this.name = "PluginCapabilityUnavailableError";
  }
}

export class PluginRuntime {
  private readonly moduleImporter: (specifier: string) => Promise<unknown>;
  private readonly logger: PluginRuntimeLogger;
  private readonly shouldDisableOnCapabilityError: (error: unknown) => boolean;
  private readonly plugins = new Map<string, LoadedPluginState>();
  private readonly pullRequestCapabilityByProvider = new Map<
    PullRequestSourceProvider,
    PullRequestCapabilityRegistration
  >();

  constructor(options: PluginRuntimeOptions = {}) {
    this.moduleImporter = options.importModule ?? importModule;
    this.logger = options.logger ?? noopLogger;
    this.shouldDisableOnCapabilityError =
      options.shouldDisableOnCapabilityError ??
      ((error: unknown) => {
        if (error instanceof Error && error.name === "PullRequestProviderAuthError") {
          return false;
        }

        return true;
      });
  }

  async loadFromModulePaths(input: {
    modulePaths: string[];
    baseDir?: string;
  }): Promise<PluginLoadRecord[]> {
    const baseDir = input.baseDir ?? process.cwd();
    const records: PluginLoadRecord[] = [];

    for (const modulePath of input.modulePaths) {
      const specifier = toFileUrlPath(modulePath, baseDir);
      const loaded = await this.loadModule({
        source: modulePath,
        specifier,
      });
      records.push(loaded);
    }

    return records;
  }

  async loadModule(input: {
    source: string;
    specifier: string;
  }): Promise<PluginLoadRecord> {
    let moduleExport: unknown;

    try {
      moduleExport = await this.moduleImporter(input.specifier);
    } catch (error) {
      this.logger.error("Plugin module import failed", {
        source: input.source,
        specifier: input.specifier,
        error,
      });

      return {
        pluginId: input.source,
        source: input.source,
        status: "disabled",
        reason: "module_import_failed",
      };
    }

    const plugin = resolvePluginFromModule(moduleExport);

    if (!plugin) {
      return {
        pluginId: input.source,
        source: input.source,
        status: "disabled",
        reason: "plugin_export_not_found",
      };
    }

    return this.loadPlugin({ plugin, source: input.source });
  }

  async loadPlugin(input: {
    plugin: CodeHostPlugin;
    source: string;
  }): Promise<PluginLoadRecord> {
    const manifestIssues = validatePluginManifest(input.plugin.manifest);

    if (manifestIssues.length > 0) {
      this.logger.warn("Plugin manifest validation failed", {
        source: input.source,
        pluginId: input.plugin.manifest.pluginId,
        issues: manifestIssues,
      });

      return {
        pluginId: input.plugin.manifest.pluginId,
        source: input.source,
        status: "disabled",
        reason: "manifest_validation_failed",
      };
    }

    const pluginId = input.plugin.manifest.pluginId;

    if (this.plugins.has(pluginId)) {
      return {
        pluginId,
        source: input.source,
        status: "skipped",
        reason: "plugin_id_already_registered",
      };
    }

    const abortController = new AbortController();
    let activationResult: PluginActivationResult;

    try {
      activationResult = await input.plugin.activate({
        signal: abortController.signal,
        logger: this.logger,
      });
    } catch (error) {
      this.logger.error("Plugin activation failed", {
        source: input.source,
        pluginId,
        error,
      });

      return {
        pluginId,
        source: input.source,
        status: "disabled",
        reason: "activation_failed",
      };
    }

    const activationIssues = validatePluginActivationResult({
      manifest: input.plugin.manifest,
      result: activationResult,
    });

    if (activationIssues.length > 0) {
      abortController.abort();
      await this.safeDeactivate(activationResult.deactivate);
      this.logger.warn("Plugin activation result validation failed", {
        source: input.source,
        pluginId,
        issues: activationIssues,
      });

      return {
        pluginId,
        source: input.source,
        status: "disabled",
        reason: "activation_validation_failed",
      };
    }

    const conflict = this.findCapabilityConflict(activationResult.capabilities);

    if (conflict) {
      abortController.abort();
      await this.safeDeactivate(activationResult.deactivate);

      return {
        pluginId,
        source: input.source,
        status: "skipped",
        reason: conflict,
      };
    }

    this.plugins.set(pluginId, {
      pluginId,
      deactivate: activationResult.deactivate,
      capabilities: activationResult.capabilities,
      abortController,
      status: "active",
      reason: null,
    });

    for (const capability of activationResult.capabilities) {
      if (capability.kind === "pull-request-snapshot-provider") {
        this.pullRequestCapabilityByProvider.set(capability.provider, {
          pluginId,
          implementation: capability.implementation,
        });
      }
    }

    return {
      pluginId,
      source: input.source,
      status: "active",
      reason: "loaded",
    };
  }

  listPluginStatuses(): PluginStatusRecord[] {
    return Array.from(this.plugins.values()).map((plugin) => ({
      pluginId: plugin.pluginId,
      status: plugin.status,
      reason: plugin.reason,
    }));
  }

  createPullRequestSnapshotProvider(): ProviderAgnosticPullRequestSnapshotProvider {
    return {
      fetchPullRequestSnapshots: async (input: {
        reviewId: string;
        source: PullRequestSourceRef;
        accessToken?: string | null;
      }) => {
        const registration = this.pullRequestCapabilityByProvider.get(input.source.provider);

        if (!registration) {
          throw new PluginCapabilityUnavailableError(
            "pull-request-snapshot-provider",
            input.source.provider,
          );
        }

        try {
          return await registration.implementation.fetchPullRequestSnapshots(input);
        } catch (error) {
          if (this.shouldDisableOnCapabilityError(error)) {
            await this.disablePlugin(registration.pluginId, {
              reason: `capability_execution_failed:${input.source.provider}`,
              error,
            });
          }

          throw error;
        }
      },
    };
  }

  private async disablePlugin(
    pluginId: string,
    input: {
      reason: string;
      error?: unknown;
    },
  ): Promise<void> {
    const pluginState = this.plugins.get(pluginId);

    if (!pluginState || pluginState.status === "disabled") {
      return;
    }

    pluginState.status = "disabled";
    pluginState.reason = input.reason;
    pluginState.abortController.abort();

    for (const [provider, registration] of this.pullRequestCapabilityByProvider.entries()) {
      if (registration.pluginId === pluginId) {
        this.pullRequestCapabilityByProvider.delete(provider);
      }
    }

    await this.safeDeactivate(pluginState.deactivate);

    this.logger.warn("Plugin disabled", {
      pluginId,
      reason: input.reason,
      error: input.error,
    });
  }

  private async safeDeactivate(deactivate: PluginActivationResult["deactivate"]): Promise<void> {
    if (!deactivate) {
      return;
    }

    try {
      await deactivate();
    } catch (error) {
      this.logger.warn("Plugin deactivate hook failed", {
        error,
      });
    }
  }

  private findCapabilityConflict(capabilities: PluginCapabilityBinding[]): string | null {
    for (const capability of capabilities) {
      if (capability.kind === "pull-request-snapshot-provider") {
        if (this.pullRequestCapabilityByProvider.has(capability.provider)) {
          return `capability_already_registered:pull-request-snapshot-provider:${capability.provider}`;
        }
      }
    }

    return null;
  }
}
