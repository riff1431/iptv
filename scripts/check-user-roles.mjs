import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const supabase = createClient(supabaseUrl, serviceKey);

async function checkUserRoles() {
  console.log("=== Checking Supabase user_roles table ===");
  const { data: roles, error: rErr } = await supabase.from("user_roles").select("*");
  if (rErr) {
    console.error("user_roles error:", rErr);
  } else {
    console.log(`Found ${roles?.length || 0} user_roles rows:`, roles);
  }
}

checkUserRoles();
