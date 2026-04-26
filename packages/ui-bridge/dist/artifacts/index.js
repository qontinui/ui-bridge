'use strict';

// src/artifacts/hash.ts
async function computeHash(data) {
  const canonical = canonicalJson(data);
  const bytes = new TextEncoder().encode(canonical);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    return bufferToHex(hashBuffer);
  }
  try {
    const nodeCrypto = await import('crypto');
    return nodeCrypto.createHash("sha256").update(bytes).digest("hex");
  } catch {
    return fnv1aFallback(canonical);
  }
}
function canonicalJson(value) {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val).sort().reduce((sorted, key) => {
        sorted[key] = val[key];
        return sorted;
      }, {});
    }
    return val;
  });
}
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fnv1aFallback(str) {
  let h1 = 2166136261;
  let h2 = 2166136261;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ ch >>> 8, 16777619);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return hex1 + hex2;
}

// src/artifacts/factory.ts
async function createArtifact(result, source, environment) {
  const now = /* @__PURE__ */ new Date();
  const env = {
    timestamp: now.getTime(),
    sdkVersion: "1.0.0",
    ...environment
  };
  const hashPayload = { result, source, environment: env };
  const artifactId = await computeHash(hashPayload);
  return {
    artifactId,
    source,
    result,
    environment: env,
    createdAt: now.toISOString(),
    immutable: true
  };
}
function captureEnvironment() {
  if (typeof window === "undefined") {
    return { timestamp: Date.now() };
  }
  return {
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    url: window.location.href,
    timestamp: Date.now()
  };
}

// src/artifacts/memory-store.ts
var MemoryArtifactStore = class {
  constructor() {
    this.artifacts = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
  }
  async save(artifact) {
    if (this.artifacts.has(artifact.artifactId)) {
      throw new Error(`Artifact ${artifact.artifactId} already exists (immutable)`);
    }
    this.artifacts.set(artifact.artifactId, artifact);
    this.emit({ type: "artifact:saved", artifactId: artifact.artifactId, timestamp: Date.now() });
  }
  async get(artifactId) {
    return this.artifacts.get(artifactId) ?? null;
  }
  async query(query) {
    let results = Array.from(this.artifacts.values());
    if (query.specId) {
      results = results.filter((a) => a.source.specId === query.specId);
    }
    if (query.contractId) {
      results = results.filter((a) => a.source.contractId === query.contractId);
    }
    if (query.matrixId) {
      results = results.filter((a) => a.source.matrixId === query.matrixId);
    }
    if (query.runId) {
      results = results.filter((a) => a.source.runId === query.runId);
    }
    if (query.dateRange) {
      const from = new Date(query.dateRange.from).getTime();
      const to = new Date(query.dateRange.to).getTime();
      results = results.filter((a) => {
        const ts = new Date(a.createdAt).getTime();
        return ts >= from && ts <= to;
      });
    }
    if (query.passedOnly) {
      results = results.filter((a) => "passed" in a.result && a.result.passed);
    }
    if (query.failedOnly) {
      results = results.filter((a) => "passed" in a.result && !a.result.passed);
    }
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (query.offset) {
      results = results.slice(query.offset);
    }
    if (query.limit) {
      results = results.slice(0, query.limit);
    }
    return results;
  }
  async verify(artifactId) {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return false;
    const hashPayload = {
      result: artifact.result,
      source: artifact.source,
      environment: artifact.environment
    };
    const recomputed = await computeHash(hashPayload);
    const valid = recomputed === artifact.artifactId;
    this.emit({
      type: valid ? "artifact:integrity-passed" : "artifact:integrity-failed",
      artifactId,
      timestamp: Date.now()
    });
    return valid;
  }
  async count() {
    return this.artifacts.size;
  }
  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  off(listener) {
    this.listeners.delete(listener);
  }
  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  clear() {
    this.artifacts.clear();
  }
  getAll() {
    return Array.from(this.artifacts.values());
  }
};
var GLOBAL_KEY = "__uiBridgeArtifactStore";
function getGlobalArtifactStore() {
  const g = globalThis;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new MemoryArtifactStore();
  }
  return g[GLOBAL_KEY];
}
function setGlobalArtifactStore(store) {
  globalThis[GLOBAL_KEY] = store;
}
function resetGlobalArtifactStore() {
  delete globalThis[GLOBAL_KEY];
}

// src/artifacts/ipc-store.ts
function getTauriInvoke() {
  try {
    if (typeof window !== "undefined" && "__TAURI__" in window) {
      const tauri = window.__TAURI__;
      const core = tauri.core;
      if (core && typeof core.invoke === "function") {
        return core.invoke;
      }
    }
  } catch {
  }
  return null;
}
var IpcArtifactStore = class {
  constructor() {
    this.invoke = getTauriInvoke();
    this.fallback = new MemoryArtifactStore();
  }
  async save(artifact) {
    if (this.invoke) {
      await this.invoke("plugin:ui-bridge|save_artifact", { artifact });
    } else {
      await this.fallback.save(artifact);
    }
  }
  async get(artifactId) {
    if (this.invoke) {
      const result = await this.invoke("plugin:ui-bridge|get_artifact", { artifactId });
      return result ?? null;
    }
    return this.fallback.get(artifactId);
  }
  async query(query) {
    if (this.invoke) {
      const result = await this.invoke("plugin:ui-bridge|query_artifacts", { query });
      return result;
    }
    return this.fallback.query(query);
  }
  async verify(artifactId) {
    if (this.invoke) {
      const result = await this.invoke("plugin:ui-bridge|verify_artifact", { artifactId });
      return result;
    }
    return this.fallback.verify(artifactId);
  }
  async count() {
    if (this.invoke) {
      const result = await this.invoke("plugin:ui-bridge|count_artifacts", {});
      return result;
    }
    return this.fallback.count();
  }
  /**
   * Whether this store is using Tauri IPC (true) or in-memory fallback (false).
   */
  get isIpcAvailable() {
    return this.invoke !== null;
  }
};

exports.IpcArtifactStore = IpcArtifactStore;
exports.MemoryArtifactStore = MemoryArtifactStore;
exports.captureEnvironment = captureEnvironment;
exports.computeHash = computeHash;
exports.createArtifact = createArtifact;
exports.getGlobalArtifactStore = getGlobalArtifactStore;
exports.resetGlobalArtifactStore = resetGlobalArtifactStore;
exports.setGlobalArtifactStore = setGlobalArtifactStore;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map