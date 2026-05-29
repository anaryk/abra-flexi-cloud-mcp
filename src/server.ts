/**
 * Wires the FlexiBee tools into an MCP server.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { FlexiBeeClient } from "./client.js";
import { allTools } from "./tools.js";

export const SERVER_NAME = "abra-flexi-mcp";
export const SERVER_VERSION = "0.1.0";

/** Build an McpServer with all FlexiBee tools registered against the given client. */
export function buildServer(client: FlexiBeeClient): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        annotations: tool.annotations,
        inputSchema: tool.inputShape,
      },
      // The SDK validates args against inputSchema before calling the handler.
      ((args: unknown) =>
        tool.handler(client, args as never) as Promise<CallToolResult>) as never,
    );
  }

  return server;
}
