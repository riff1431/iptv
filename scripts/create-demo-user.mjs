import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const supabase = createClient(supabaseUrl, serviceKey);

async function createDemoUser() {
  console.log("=== Creating Demo User Account in Supabase ===");

  const email = "demouser@pgx.com";
  const password = "DemoUser123!";
  const displayName = "Demo Viewer";

  // Check if demouser@pgx.com already exists
  const { data: usersData } = await supabase.auth.admin.listUsers();
  const existing = (usersData?.users || []).find((u) => u.email === email);

  let userId = "";

  if (existing) {
    console.log(`Demo user already exists (ID: ${existing.id}). Updating password...`);
    userId = existing.id;
    const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
      password: password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        is_vip: false,
        is_creator: false,
      },
    });
    if (updateErr) {
      console.error("Error updating existing demo user:", updateErr);
      return;
    }
    console.log("✅ Updated password for demouser@pgx.com!");
  } else {
    console.log(`Creating brand new user: ${email}...`);
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        is_vip: false,
        is_creator: false,
      },
    });

    if (createErr) {
      console.error("Error creating demo user:", createErr);
      return;
    }

    userId = newUser.user.id;
    console.log(`✅ Demo user created with ID: ${userId}`);
  }

  // Ensure profile row exists
  const { error: profErr } = await supabase.from("profiles").upsert({
    id: userId,
    display_name: displayName,
  });
  if (profErr) {
    console.error("Error upserting profile:", profErr);
  } else {
    console.log("✅ Upserted profile for Demo Viewer!");
  }

  // Ensure default 'user' role in user_roles
  const { error: roleErr } = await supabase.from("user_roles").upsert(
    { user_id: userId, role: "user" },
    { onConflict: "user_id,role", ignoreDuplicates: true },
  );
  if (roleErr) {
    console.error("Error assigning user role:", roleErr);
  } else {
    console.log("✅ Assigned 'user' role in user_roles!");
  }

  // Credit $100.00 wallet balance in wallets table
  const { data: existingWallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (existingWallet) {
    await supabase
      .from("wallets")
      .update({ balance_cents: 10000 })
      .eq("user_id", userId);
    console.log("✅ Updated PGX Wallet balance to $100.00 (10,000 cents)!");
  } else {
    await supabase.from("wallets").insert({
      user_id: userId,
      balance_cents: 10000,
    });
    console.log("✅ Created PGX Wallet with $100.00 balance (10,000 cents)!");
  }

  console.log("\n==========================================");
  console.log("🎉 DEMO USER CREATED & READY FOR LOGIN:");
  console.log(`📧 Email:    ${email}`);
  console.log(`🔑 Password: ${password}`);
  console.log(`💰 Balance:  $100.00`);
  console.log("==========================================\n");
}

createDemoUser();
