import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const adminClient = createClient(supabaseUrl, serviceKey);

async function listAll() {
  const { data } = await adminClient.auth.admin.listUsers();
  console.log("Registered users in Supabase:");
  for (const u of data?.users || []) {
    console.log(` - Email: ${u.email} | Confirmed: ${!!u.email_confirmed_at}`);
  }
}

listAll();
