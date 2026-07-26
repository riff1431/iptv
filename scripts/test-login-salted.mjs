import { createClient } from "@supabase/supabase-js";
import { saltPassword } from "../src/lib/auth-salt.ts";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const anonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5NTA4NzcsImV4cCI6MjEwMDUyNjg3N30.Cxo8t2ZUJjhwuotUNC7Ey51WuCLyjcpagto5PhPJcO0";

const client = createClient(supabaseUrl, anonKey);

async function testFrontendLoginFlow() {
  console.log("=== Testing Exact Frontend Login Flow ===");

  const userTypedEmail = "demouser@pgx.com";
  const userTypedPassword = "DemoUser123!";

  const salted = saltPassword(userTypedPassword);

  const { data, error } = await client.auth.signInWithPassword({
    email: userTypedEmail,
    password: salted,
  });

  if (error) {
    console.error("❌ Sign in failed:", error.message);
  } else {
    console.log("🎉 SUCCESS! Frontend Login Flow Passed Perfectly!", data.user.email);
  }
}

testFrontendLoginFlow();
