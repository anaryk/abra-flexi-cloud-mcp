import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError, type Env } from "../../src/config.js";

const base: Env = {
  FLEXIBEE_URL: "https://demo.flexibee.eu",
  FLEXIBEE_COMPANY: "demo",
  FLEXIBEE_USER: "winstrom",
  FLEXIBEE_PASSWORD: "winstrom",
};

describe("loadConfig", () => {
  it("loads a complete, valid configuration", () => {
    const cfg = loadConfig(base);
    expect(cfg).toEqual({
      url: "https://demo.flexibee.eu",
      company: "demo",
      user: "winstrom",
      password: "winstrom",
      rejectUnauthorized: true,
    });
  });

  it("strips a trailing slash from the URL", () => {
    expect(loadConfig({ ...base, FLEXIBEE_URL: "https://demo.flexibee.eu/" }).url).toBe(
      "https://demo.flexibee.eu",
    );
  });

  it("trims surrounding whitespace from values", () => {
    expect(loadConfig({ ...base, FLEXIBEE_COMPANY: "  demo  " }).company).toBe("demo");
  });

  it.each(["FLEXIBEE_URL", "FLEXIBEE_COMPANY", "FLEXIBEE_USER", "FLEXIBEE_PASSWORD"])(
    "throws ConfigError when %s is missing",
    (key) => {
      const env = { ...base };
      delete env[key];
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(key);
    },
  );

  it("throws ConfigError when a required value is blank", () => {
    expect(() => loadConfig({ ...base, FLEXIBEE_USER: "   " })).toThrow(ConfigError);
  });

  it("throws ConfigError for an invalid URL", () => {
    expect(() => loadConfig({ ...base, FLEXIBEE_URL: "not a url" })).toThrow(/not a valid URL/);
  });

  it("defaults rejectUnauthorized to true and honors 'false'", () => {
    expect(loadConfig(base).rejectUnauthorized).toBe(true);
    expect(loadConfig({ ...base, FLEXIBEE_REJECT_UNAUTHORIZED: "false" }).rejectUnauthorized).toBe(
      false,
    );
    expect(loadConfig({ ...base, FLEXIBEE_REJECT_UNAUTHORIZED: "true" }).rejectUnauthorized).toBe(
      true,
    );
  });
});
