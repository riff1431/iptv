import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import type { Database } from "@/integrations/supabase/types";

function supabaseForUser(ctx: ToolContext) {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "wallet_balance",
  title: "Get wallet balance",
  description:
    "Return the signed-in user's PGX wallet balance in cents, plus totals and recent transactions.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();
    if (!userId) {
      return { content: [{ type: "text", text: "Missing user id" }], isError: true };
    }
    const [balance, recent] = await Promise.all([
      supabase.rpc("wallet_balance_cents", { _user_id: userId }),
      supabase
        .from("wallet_transactions")
        .select("id, type, amount_cents, memo, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (balance.error) {
      return { content: [{ type: "text", text: balance.error.message }], isError: true };
    }
    const result = {
      balanceCents: Number(balance.data ?? 0),
      recent: recent.data ?? [],
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
