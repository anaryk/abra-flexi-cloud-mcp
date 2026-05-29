/**
 * Configuration loading and validation for the ABRA Flexi MCP server.
 *
 * All values come from environment variables. There are no defaults — the
 * server fails fast with a clear message when a required variable is missing.
 */

export interface FlexiBeeConfig {
  /** Base URL of the FlexiBee server, without trailing slash, e.g. https://demo.flexibee.eu */
  url: string;
  /** Company identifier — the {company} segment in /c/{company}/... */
  company: string;
  /** HTTP Basic auth username. */
  user: string;
  /** HTTP Basic auth password. */
  password: string;
  /** Whether to reject unauthorized TLS certificates. Defaults to true. */
  rejectUnauthorized: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Source of environment values; injectable for testing. */
export type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(
      `Missing required environment variable ${key}. ` +
        `Set FLEXIBEE_URL, FLEXIBEE_COMPANY, FLEXIBEE_USER and FLEXIBEE_PASSWORD.`,
    );
  }
  return value.trim();
}

/**
 * Build and validate the FlexiBee configuration from environment variables.
 * @throws ConfigError when a required variable is missing or the URL is invalid.
 */
export function loadConfig(env: Env = process.env): FlexiBeeConfig {
  const rawUrl = required(env, "FLEXIBEE_URL");

  let url: string;
  try {
    // Normalize: validate and strip any trailing slash.
    url = new URL(rawUrl).toString().replace(/\/+$/, "");
  } catch {
    throw new ConfigError(`FLEXIBEE_URL is not a valid URL: ${rawUrl}`);
  }

  const rejectRaw = env["FLEXIBEE_REJECT_UNAUTHORIZED"];
  const rejectUnauthorized = rejectRaw === undefined ? true : rejectRaw.trim() !== "false";

  return {
    url,
    company: required(env, "FLEXIBEE_COMPANY"),
    user: required(env, "FLEXIBEE_USER"),
    password: required(env, "FLEXIBEE_PASSWORD"),
    rejectUnauthorized,
  };
}
