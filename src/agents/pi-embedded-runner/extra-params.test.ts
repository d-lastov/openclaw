import { describe, it, expect } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveModelAuthProfile } from "./extra-params.js";

describe("resolveModelAuthProfile", () => {
  it("returns authProfile from model config with full key", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-6": {
              authProfile: "openrouter:only-opus",
            },
          },
        },
      },
    } as OpenClawConfig;

    const result = resolveModelAuthProfile({
      cfg,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });
    expect(result).toBe("openrouter:only-opus");
  });

  it("returns authProfile from model config with model-only key", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "claude-opus-4-6": {
              authProfile: "custom-profile",
            },
          },
        },
      },
    } as OpenClawConfig;

    const result = resolveModelAuthProfile({
      cfg,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });
    expect(result).toBe("custom-profile");
  });

  it("prefers full key over model-only key", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-6": {
              authProfile: "full-key-profile",
            },
            "claude-opus-4-6": {
              authProfile: "model-only-profile",
            },
          },
        },
      },
    } as OpenClawConfig;

    const result = resolveModelAuthProfile({
      cfg,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });
    expect(result).toBe("full-key-profile");
  });

  it("returns undefined when no authProfile configured", () => {
    const cfg = {
      agents: { defaults: { models: {} } },
    } as OpenClawConfig;

    const result = resolveModelAuthProfile({
      cfg,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when model config has no authProfile", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-6": {
              alias: "opus",
            },
          },
        },
      },
    } as OpenClawConfig;

    const result = resolveModelAuthProfile({
      cfg,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when cfg is undefined", () => {
    const result = resolveModelAuthProfile({
      cfg: undefined,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });
    expect(result).toBeUndefined();
  });

  it("trims whitespace from authProfile", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-6": {
              authProfile: "  trimmed-profile  ",
            },
          },
        },
      },
    } as OpenClawConfig;

    const result = resolveModelAuthProfile({
      cfg,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });
    expect(result).toBe("trimmed-profile");
  });

  it("skips empty authProfile after trim", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-6": {
              authProfile: "   ",
            },
            "claude-opus-4-6": {
              authProfile: "fallback-profile",
            },
          },
        },
      },
    } as OpenClawConfig;

    const result = resolveModelAuthProfile({
      cfg,
      provider: "anthropic",
      modelId: "claude-opus-4-6",
    });
    expect(result).toBe("fallback-profile");
  });
});
