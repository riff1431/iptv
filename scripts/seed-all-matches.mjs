import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const supabase = createClient(supabaseUrl, serviceKey);

async function attachChannelsToAllMatches() {
  console.log("=== Attaching IPTV Channels to ALL Matches in Supabase ===");

  const { data: matches, error: mErr } = await supabase.from("matches").select("*");
  if (mErr) {
    console.error("Matches fetch error:", mErr);
    return;
  }

  const defaultChannels = [
    { channel_id: "1537041", channel_name: "Channel 1537041 (Sports Central)" },
    { channel_id: "1537043", channel_name: "Channel 1537043 (Game On)" },
    { channel_id: "1537049", channel_name: "Channel 1537049 (Elite Hub)" },
    { channel_id: "1537042", channel_name: "Channel 1537042 (Fan Zone)" },
  ];

  for (const match of matches || []) {
    console.log(`Processing match "${match.title}" (${match.id})...`);

    // Check existing slots
    const { data: existingSlots } = await supabase
      .from("match_slots")
      .select("*")
      .eq("match_id", match.id);

    if (!existingSlots || existingSlots.length === 0) {
      console.log(`  Adding 4 channel slots to "${match.title}"...`);
      const slotsToInsert = defaultChannels.map((c, idx) => ({
        match_id: match.id,
        slot: idx + 1,
        channel_id: c.channel_id,
        channel_name: c.channel_name,
        enabled: true,
      }));

      const { error: slotErr } = await supabase.from("match_slots").insert(slotsToInsert);
      if (slotErr) {
        console.error(`  Error inserting slots for ${match.title}:`, slotErr);
      } else {
        console.log(`  ✅ Added 4 channel slots to "${match.title}"!`);
      }
    } else {
      console.log(`  Updating existing ${existingSlots.length} slots for "${match.title}"...`);
      for (let idx = 0; idx < 4; idx++) {
        const c = defaultChannels[idx];
        const existing = existingSlots.find((s) => s.slot === idx + 1);

        if (existing) {
          await supabase
            .from("match_slots")
            .update({
              channel_id: c.channel_id,
              channel_name: c.channel_name,
              enabled: true,
            })
            .eq("id", existing.id);
        } else {
          await supabase.from("match_slots").insert({
            match_id: match.id,
            slot: idx + 1,
            channel_id: c.channel_id,
            channel_name: c.channel_name,
            enabled: true,
          });
        }
      }
      console.log(`  ✅ Updated 4 slots for "${match.title}"!`);
    }
  }

  console.log("=== Finished updating all match slots in Supabase! ===");
}

attachChannelsToAllMatches();
