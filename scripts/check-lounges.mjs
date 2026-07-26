import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const supabase = createClient(supabaseUrl, serviceKey);

async function checkLounges() {
  console.log("=== Checking Supabase lounges table ===");
  const { data: lounges, error: lErr } = await supabase.from("lounges").select("*");
  if (lErr) {
    console.error("lounges error:", lErr);
  } else {
    console.log(`Found ${lounges?.length || 0} lounges:`, lounges);
  }
}

checkLounges();
