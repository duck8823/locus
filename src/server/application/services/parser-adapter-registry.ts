import type { ParserAdapter } from "@/server/application/ports/parser-adapter";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

export class ParserAdapterRegistry {
  private readonly adapters: ParserAdapter[] = [];

  register(adapter: ParserAdapter): void {
    this.adapters.push(adapter);
  }

  resolve(file: SourceSnapshot): ParserAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.supports(file)) {
        return adapter;
      }
    }

    return null;
  }

  listAdapters(): readonly ParserAdapter[] {
    return this.adapters;
  }

  toArray(): ParserAdapter[] {
    return [...this.adapters];
  }
}
