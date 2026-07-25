import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listLoungesTool from "./tools/list-lounges";
import listMatchesTool from "./tools/list-matches";
import walletBalanceTool from "./tools/wallet-balance";
import myProfileTool from "./tools/my-profile";

// The OAuth issuer MUST be the direct Supabase host. On publish, SUPABASE_URL is
// rewritten to the `.lovable.cloud` proxy, which mcp-js rejects (RFC 8414
// issuer mismatch). The project ref is the only Supabase value that survives
// publish unchanged.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "pgx-sports-lounge-mcp",
  title: "PGX Sports Lounge MCP",
  version: "0.1.0",
  instructions:
    "Tools for PGX Sports Lounge. Use `list_lounges` and `list_matches` to browse live sports lounges and matches. Use `my_profile` and `wallet_balance` to read the signed-in user's PGX profile and wallet.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listLoungesTool, listMatchesTool, walletBalanceTool, myProfileTool],
});
