import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const supabase = createClient(supabaseUrl, serviceKey);

async function testUserMetadata() {
  console.log("=== Testing Supabase User Metadata Update ===");
  const { data: users, error: uErr } = await supabase.auth.admin.listUsers();
  if (uErr) {
    console.error("List users error:", uErr);
    return;
  }

  if (!users.users || users.users.length === 0) {
    console.log("No users found.");
    return;
  }

  const testUser = users.users[0];
  console.log(`Updating test user ${testUser.email || testUser.id} with VIP & Creator metadata...`);

  const { data: updated, error: updateErr } = await supabase.auth.admin.updateUserById(
    testUser.id,
    {
      user_metadata: {
        ...testUser.user_metadata,
        is_vip: true,
        is_creator: true,
        vip_expires_at: new Date(Date.now() + 365 * 86400 * 1000).toISOString(),
      },
    },
  );

  if (updateErr) {
    console.error("Update error:", updateErr);
  } else {
    console.log("✅ Successfully updated user metadata!", updated.user.user_metadata);
  }
}

testUserMetadata();
