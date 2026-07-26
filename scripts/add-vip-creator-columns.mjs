import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const supabase = createClient(supabaseUrl, serviceKey);

async function addVipAndCreatorColumns() {
  console.log("=== Updating Supabase Database Schema for VIP & Creator ===");

  // Check if we can execute RPC or alter table via SQL
  const { data: profiles, error: pErr } = await supabase.from("profiles").select("*").limit(5);

  if (pErr) {
    console.error("Profiles error:", pErr);
  } else {
    console.log("Current profiles sample:", profiles);
  }

  // Add SQL query via Supabase RPC or check if exec_sql is available
  const sql = `
    ALTER TABLE public.profiles 
    ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_creator BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT NULL;
  `;

  console.log("SQL to execute:", sql);

  // Attempting to run sql via rpc if exists
  const { error: rpcErr } = await supabase.rpc("exec_sql", { query: sql });
  if (rpcErr) {
    console.log("RPC exec_sql notice (if not enabled, fallback to REST column check):", rpcErr.message);
  } else {
    console.log("✅ Successfully executed SQL schema update!");
  }
}

addVipAndCreatorColumns();
