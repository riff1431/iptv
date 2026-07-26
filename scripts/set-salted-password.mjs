import { createClient } from "@supabase/supabase-js";
import { saltPassword } from "../src/lib/auth-salt.ts";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const adminClient = createClient(supabaseUrl, serviceKey);

async function setSaltedPassword() {
  const plainPass = "DemoUser123!";
  const saltedPass = saltPassword(plainPass);

  console.log(`Setting salted password for demouser@pgx.com...`);
  console.log(`Plain: "${plainPass}" -> Salted: "${saltedPass}"`);

  const { data } = await adminClient.auth.admin.listUsers();
  const u = (data?.users || []).find((x) => x.email === "demouser@pgx.com");

  if (u) {
    const { error } = await adminClient.auth.admin.updateUserById(u.id, {
      password: saltedPass,
      email_confirm: true,
    });
    if (error) {
      console.error("Error setting password:", error);
    } else {
      console.log("✅ Successfully updated password for demouser@pgx.com with salt!");
    }
  } else {
    console.error("User demouser@pgx.com not found!");
  }
}

setSaltedPassword();
