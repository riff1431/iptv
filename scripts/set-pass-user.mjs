import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const adminClient = createClient(supabaseUrl, serviceKey);

async function setPassword() {
  const { data } = await adminClient.auth.admin.listUsers();
  const u = (data?.users || []).find((x) => x.email === "user@demo.lovable.app");
  if (u) {
    await adminClient.auth.admin.updateUserById(u.id, {
      password: "DemoUser123!",
      email_confirm: true,
    });
    console.log("✅ Set password for user@demo.lovable.app");
  }
}

setPassword();
