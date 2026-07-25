import { defineTool } from "@lovable.dev/mcp-js";
import { listPublicLounges } from "@/lib/lounges.public.functions";

export default defineTool({
  name: "list_lounges",
  title: "List public lounges",
  description:
    "List all publicly visible, active PGX Sports Lounge lounges with their TVs, matches, entry fees, and viewer counts.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const lounges = await listPublicLounges();
    return {
      content: [{ type: "text", text: JSON.stringify(lounges, null, 2) }],
      structuredContent: { lounges },
    };
  },
});
