import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const supabase = createClient(supabaseUrl, serviceKey);

async function checkAllMatches() {
  console.log("=== Fetching all matches and slots from Supabase ===");
  const { data: matches, error: mErr } = await supabase.from("matches").select("*");
  if (mErr) {
    console.error("Matches error:", mErr);
    return;
  }
  console.log(`Found ${matches?.length || 0} total matches in database.`);

  const { data: slots, error: sErr } = await supabase.from("match_slots").select("*");
  if (sErr) {
    console.error("Slots error:", sErr);
    return;
  }
  console.log(`Found ${slots?.length || 0} total match_slots in database.\n`);

  for (const m of matches || []) {
    const mSlots = (slots || []).filter((s) => s.match_id === m.id);
    console.log(`Match: "${m.title}" (ID: ${m.id})`);
    console.log(`  Slots attached (${mSlots.length}):`);
    for (const s of mSlots) {
      console.log(`    - Slot ${s.slot}: Channel ID "${s.channel_id}", Name "${s.channel_name}", Enabled: ${s.enabled}`);
    }
  }
}

checkAllMatches();
