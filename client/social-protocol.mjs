function randomMessageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function messageMetadata({ clientMessageId = randomMessageId(), createdAt = Date.now() } = {}) {
  if (!isNonEmptyString(clientMessageId)) throw new Error("clientMessageId is required");
  if (!Number.isFinite(createdAt)) throw new Error("createdAt must be a finite timestamp");
  return { clientMessageId, createdAt };
}

function requireResource(resource, kind, label) {
  if (!resource || typeof resource !== "object") throw new Error(`${label} resource is required`);
  if (resource.kind !== kind) throw new Error(`${label} resource must be a ${kind} resource`);
  if (!isNonEmptyString(resource.key)) throw new Error(`${label} resource key is required`);
  if (!isNonEmptyString(resource.catalogId)) throw new Error(`${label} catalogId is required`);
  if (!isNonEmptyString(resource.id)) throw new Error(`${label} resource id is required`);
}

function normalizeTargetPeerIds({ targetPeerId, targetPeerIds } = {}) {
  if (targetPeerId != null && targetPeerIds != null) {
    throw new Error("use targetPeerId or targetPeerIds, not both");
  }
  const peers = targetPeerIds ?? (targetPeerId == null ? [] : [targetPeerId]);
  if (!Array.isArray(peers) || peers.some((peerId) => !isNonEmptyString(peerId))) {
    throw new Error("targetPeerIds must be non-empty strings");
  }
  return peers;
}

export function createChatPayload(text, options = {}) {
  if (!isNonEmptyString(text)) throw new Error("chat text is required");
  return {
    kind: "chat",
    text,
    ...messageMetadata(options),
  };
}

export function createEmojiPayload(resource, options = {}) {
  requireResource(resource, "emoji", "emoji");
  return {
    kind: "emoji",
    catalogId: resource.catalogId,
    emojiId: resource.id,
    resourceKey: resource.key,
    ...messageMetadata(options),
  };
}

export function createPhrasePayload(resource, options = {}) {
  requireResource(resource, "phrase", "phrase");
  if (!isNonEmptyString(resource.text)) throw new Error("phrase text is required");
  return {
    kind: "chat",
    text: resource.text,
    catalogId: resource.catalogId,
    phraseId: resource.id,
    resourceKey: resource.key,
    ...messageMetadata(options),
  };
}

export function createReactionPayload(resource, options = {}) {
  requireResource(resource, "reaction", "reaction");
  const targetPeerIds = normalizeTargetPeerIds(options);
  const payload = {
    kind: "reaction",
    catalogId: resource.catalogId,
    reactionId: resource.id,
    resourceKey: resource.key,
    ...messageMetadata(options),
  };
  if (targetPeerIds.length > 0) payload.targetPeerIds = targetPeerIds;
  return payload;
}
