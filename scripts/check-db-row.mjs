import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envFile = readFileSync("./.env", "utf8");
const env = {};
envFile.split("\n").forEach((line) => {
  const [k, v] = line.split("=");
  if (k && v) env[k.trim()] = v.trim().replace(/^"|"$/g, "");
});

process.env.IPTV_ENCRYPTION_KEY = env.IPTV_ENCRYPTION_KEY;

const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const { data: row, error } = await supabaseAdmin
    .from("app_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    console.error("DB error:", error);
    return;
  }

  console.log("App Settings Row in DB:");
  console.log("provider_type:", row.iptv_provider_type);
  console.log("xtream_server_url:", row.iptv_xtream_server_url);
  console.log("xtream_username:", row.iptv_xtream_username);
  console.log("xtream_password_encrypted:", row.iptv_xtream_password_encrypted);

  const { decryptSecret } = await import("../src/lib/iptv-crypto.server.ts");
  const decrypted = decryptSecret(row.iptv_xtream_password_encrypted);
  console.log("Decrypted password:", decrypted);
}

main().catch(console.error);
