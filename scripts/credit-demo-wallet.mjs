import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const supabase = createClient(supabaseUrl, serviceKey);

async function creditDemoWallet() {
  console.log("=== Crediting $100.00 to Demo User Wallet via wallet_transactions ===");

  const { data: usersData } = await supabase.auth.admin.listUsers();
  const demoUser = (usersData?.users || []).find((u) => u.email === "demouser@pgx.com");

  if (!demoUser) {
    console.error("demouser@pgx.com not found!");
    return;
  }

  const userId = demoUser.id;
  console.log(`Demo User ID: ${userId}`);

  // Insert a $100.00 credit row in wallet_transactions
  const { data: tx, error: txErr } = await supabase
    .from("wallet_transactions")
    .insert({
      user_id: userId,
      type: "credit",
      amount_cents: 10000,
      memo: "Initial Demo Welcome Credit ($100.00)",
    })
    .select()
    .single();

  if (txErr) {
    console.error("Error inserting wallet transaction:", txErr);
  } else {
    console.log("✅ Inserted $100.00 credit transaction:", tx);
  }

  // Also update balance_cents in wallets table
  await supabase.from("wallets").upsert({
    user_id: userId,
    balance_cents: 10000,
  });

  // Check RPC balance calculation
  const { data: rpcBal, error: rpcErr } = await supabase.rpc("wallet_balance_cents", {
    _user_id: userId,
  });

  if (rpcErr) {
    console.error("RPC balance error:", rpcErr);
  } else {
    console.log(`🎉 RPC Calculated Wallet Balance: ${rpcBal} cents ($${(rpcBal / 100).toFixed(2)})`);
  }
}

creditDemoWallet();
