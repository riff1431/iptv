import { defineTool } from "@lovable.dev/mcp-js";
import { listPublicMatches } from "@/lib/matches.public.functions";

export default defineTool({
  name: "list_matches",
  title: "List public matches",
  description:
    "List all active PGX standalone matches with scores, status, and channel slots.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const matches = await listPublicMatches();
    return {
      content: [{ type: "text", text: JSON.stringify(matches, null, 2) }],
      structuredContent: { matches },
    };
  },
});
