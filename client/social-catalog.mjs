const CATALOG_VERSION = 1;
const GROUPS = [
  { name: "emojis", kind: "emoji", requiresAsset: true },
  { name: "reactions", kind: "reaction", requiresAsset: true },
  { name: "phrases", kind: "phrase", requiresText: true },
];
const VALID_TARGETING = new Set(["none", "peer", "peers"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStableId(value) {
  return isNonEmptyString(value) && !value.includes(":");
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolveAssetUrl(asset, baseUrl) {
  if (!baseUrl) return asset;
  return new URL(asset, baseUrl).toString();
}

export function normalizeSocialKind(kind) {
  if (kind === "emoji" || kind === "emojis") return "emoji";
  if (kind === "reaction" || kind === "reactions") return "reaction";
  if (kind === "phrase" || kind === "phrases") return "phrase";
  return null;
}

export function createSocialResourceKey({ catalogId, kind, id }) {
  const normalizedKind = normalizeSocialKind(kind);
  if (!isStableId(catalogId)) throw new Error("catalogId is required");
  if (!normalizedKind) throw new Error("valid social resource kind is required");
  if (!isStableId(id)) throw new Error("resource id is required");
  return `${catalogId}:${normalizedKind}:${id}`;
}

export class SocialCatalogRegistry {
  constructor() {
    this.catalogs = new Map();
    this.items = new Map();
    this.signatures = new Map();
    this.conflictedKeys = new Set();
    this.diagnosticEntries = [];
  }

  register(catalog, { baseUrl = null, sourceUrl = baseUrl } = {}) {
    if (!isPlainObject(catalog)) {
      this.addDiagnostic("error", "invalid-catalog", "catalog must be an object", { sourceUrl });
      return [];
    }

    if (catalog.catalogVersion !== CATALOG_VERSION) {
      this.addDiagnostic("error", "unsupported-catalog-version", "catalogVersion must be 1", { sourceUrl });
      return [];
    }

    if (!isStableId(catalog.catalogId)) {
      this.addDiagnostic("error", "invalid-catalog-id", "catalogId must be a non-empty string without ':'", {
        sourceUrl,
      });
      return [];
    }

    if (!isNonEmptyString(catalog.label)) {
      this.addDiagnostic("error", "invalid-catalog-label", "catalog label must be a non-empty string", {
        catalogId: catalog.catalogId,
        sourceUrl,
      });
      return [];
    }

    const metadata = {
      catalogVersion: catalog.catalogVersion,
      catalogId: catalog.catalogId,
      label: catalog.label,
    };
    const metadataSignature = stableStringify(metadata);
    const existingMetadata = this.catalogs.get(catalog.catalogId);
    if (existingMetadata && existingMetadata.signature !== metadataSignature) {
      this.addDiagnostic("error", "conflicting-catalog", "catalogId was already registered with different metadata", {
        catalogId: catalog.catalogId,
        sourceUrl,
      });
      return [];
    }
    if (!existingMetadata) this.catalogs.set(catalog.catalogId, { ...metadata, signature: metadataSignature });

    const accepted = [];
    for (const group of GROUPS) {
      const entries = catalog[group.name];
      if (entries == null) continue;
      if (!Array.isArray(entries)) {
        this.addDiagnostic("error", "invalid-resource-group", `${group.name} must be an array`, {
          catalogId: catalog.catalogId,
          group: group.name,
          sourceUrl,
        });
        continue;
      }
      for (const entry of entries) {
        const resource = this.normalizeResource(catalog, group, entry, { baseUrl, sourceUrl });
        if (!resource) continue;
        const key = resource.key;
        const signature = stableStringify(resource);

        if (this.conflictedKeys.has(key)) {
          this.addDiagnostic("error", "conflicting-resource", "resource was already rejected because of a conflict", {
            key,
            sourceUrl,
          });
          continue;
        }

        const existingSignature = this.signatures.get(key);
        if (existingSignature && existingSignature !== signature) {
          this.items.delete(key);
          this.signatures.delete(key);
          this.conflictedKeys.add(key);
          this.addDiagnostic("error", "conflicting-resource", "same catalog resource has different definitions", {
            key,
            sourceUrl,
          });
          continue;
        }

        if (!existingSignature) {
          this.items.set(key, resource);
          this.signatures.set(key, signature);
          accepted.push(resource);
        }
      }
    }
    return accepted;
  }

  resources(filter = {}) {
    const kind = filter.kind ? normalizeSocialKind(filter.kind) : null;
    return Array.from(this.items.values()).filter((resource) => {
      if (kind && resource.kind !== kind) return false;
      if (filter.catalogId && resource.catalogId !== filter.catalogId) return false;
      return true;
    });
  }

  diagnostics() {
    return this.diagnosticEntries.map((entry) => ({ ...entry, details: clone(entry.details) }));
  }

  get(key) {
    return this.items.get(key) ?? null;
  }

  normalizeResource(catalog, group, entry, { baseUrl, sourceUrl }) {
    if (!isPlainObject(entry)) {
      this.addDiagnostic("error", "invalid-resource", "resource must be an object", {
        catalogId: catalog.catalogId,
        kind: group.kind,
        sourceUrl,
      });
      return null;
    }

    if (!isStableId(entry.id)) {
      this.addDiagnostic("error", "invalid-resource-id", "resource id must be a non-empty string without ':'", {
        catalogId: catalog.catalogId,
        kind: group.kind,
        sourceUrl,
      });
      return null;
    }

    if (!isNonEmptyString(entry.label)) {
      this.addDiagnostic("error", "invalid-resource-label", "resource label must be a non-empty string", {
        catalogId: catalog.catalogId,
        kind: group.kind,
        id: entry.id,
        sourceUrl,
      });
      return null;
    }

    if (group.requiresAsset && !isNonEmptyString(entry.asset)) {
      this.addDiagnostic("error", "invalid-resource-asset", "visual resource asset must be a non-empty string", {
        catalogId: catalog.catalogId,
        kind: group.kind,
        id: entry.id,
        sourceUrl,
      });
      return null;
    }

    if (group.requiresText && !isNonEmptyString(entry.text)) {
      this.addDiagnostic("error", "invalid-resource-text", "phrase text must be a non-empty string", {
        catalogId: catalog.catalogId,
        kind: group.kind,
        id: entry.id,
        sourceUrl,
      });
      return null;
    }

    const targeting = entry.targeting ?? "none";
    if (group.kind === "reaction" && !VALID_TARGETING.has(targeting)) {
      this.addDiagnostic("error", "invalid-resource-targeting", "reaction targeting must be none, peer, or peers", {
        catalogId: catalog.catalogId,
        kind: group.kind,
        id: entry.id,
        sourceUrl,
      });
      return null;
    }

    const resource = {
      key: createSocialResourceKey({ catalogId: catalog.catalogId, kind: group.kind, id: entry.id }),
      catalogId: catalog.catalogId,
      catalogLabel: catalog.label,
      kind: group.kind,
      id: entry.id,
      label: entry.label,
      meta: isPlainObject(entry.meta) ? clone(entry.meta) : {},
    };

    if (group.requiresAsset) {
      resource.assetUrl = resolveAssetUrl(entry.asset, baseUrl);
      if (isNonEmptyString(entry.alt)) resource.alt = entry.alt;
    }
    if (group.kind === "reaction") resource.targeting = targeting;
    if (group.requiresText) resource.text = entry.text;

    return resource;
  }

  addDiagnostic(level, code, message, details = {}) {
    this.diagnosticEntries.push({ level, code, message, details });
  }
}
