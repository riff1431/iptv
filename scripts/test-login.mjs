import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const anonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5NTA4NzcsImV4cCI6MjEwMDUyNjg3N30.Cxo8t2ZUJjhwuotUNC7Ey51WuCLyjcpagto5PhPJcO0";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const client = createClient(supabaseUrl, anonKey);
const adminClient = createClient(supabaseUrl, serviceKey);

async function testLogin() {
  console.log("=== Testing sign in for demouser@pgx.com ===");

  const email = "demouser@pgx.com";
  const password = "DemoUser123!";

  // Check user details via admin
  const { data: usersData } = await adminClient.auth.admin.listUsers();
  const user = (usersData?.users || []).find((u) => u.email === email);

  console.log("User in Supabase Auth:", {
    id: user?.id,
    email: user?.email,
    email_confirmed_at: user?.email_confirmed_at,
  });

  // Confirm email explicitly via admin
  if (user && !user.email_confirmed_at) {
    console.log("Confirming email explicitly...");
    await adminClient.auth.admin.updateUserById(user.id, {
      email_confirm: true,
    });
  }

  // Set password explicitly via admin
  if (user) {
    console.log("Setting password explicitly via admin...");
    const { error: passErr } = await adminClient.auth.admin.updateUserById(user.id, {
      password: password,
      email_confirm: true,
    });
    if (passErr) console.error("Password update error:", passErr);
  }

  // Attempt sign in with publishable/anon client
  console.log("Attempting signInWithPassword...");
  const { data: authData, error: authErr } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (authErr) {
    console.error("❌ Sign in failed:", authErr.message);
  } else {
    console.log("✅ Sign in SUCCESSFUL!", authData.user?.email, authData.user?.id);
  }
}

testLogin();
