import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const supabase = createClient(supabaseUrl, serviceKey);

async function seed() {
  console.log("=== Seeding Matches & Slots into Supabase DB ===");

  const matchesToInsert = [
    {
      title: "NBA Playoffs: Lakers vs Celtics",
      sport: "Basketball",
      home_label: "Lakers",
      away_label: "Celtics",
      home_score: 104,
      away_score: 98,
      status: "live",
      clock_label: "Q4 02:45",
      period_label: "Q4",
      is_active: true,
      sort_order: 1,
      slot_count: 4,
    },
    {
      title: "Champions League: Real Madrid vs Barcelona",
      sport: "Soccer",
      home_label: "Real Madrid",
      away_label: "Barcelona",
      home_score: 2,
      away_score: 1,
      status: "live",
      clock_label: "78:24",
      period_label: "2nd Half",
      is_active: true,
      sort_order: 2,
      slot_count: 4,
    },
    {
      title: "NHL Live: Maple Leafs vs Bruins",
      sport: "Hockey",
      home_label: "Maple Leafs",
      away_label: "Bruins",
      home_score: 3,
      away_score: 3,
      status: "live",
      clock_label: "P3 12:10",
      period_label: "P3",
      is_active: true,
      sort_order: 3,
      slot_count: 4,
    },
    {
      title: "NFL Sunday: Chiefs vs 49ers",
      sport: "Football",
      home_label: "Chiefs",
      away_label: "49ers",
      home_score: 21,
      away_score: 17,
      status: "live",
      clock_label: "Q3 08:15",
      period_label: "Q3",
      is_active: true,
      sort_order: 4,
      slot_count: 4,
    },
  ];

  const channelIds = ["1537041", "1537043", "1537049", "1537042"];

  for (let i = 0; i < matchesToInsert.length; i++) {
    const matchData = matchesToInsert[i];
    const primaryChannelId = channelIds[i];

    console.log(`Inserting match ${i + 1}: ${matchData.title}...`);
    const { data: insertedMatch, error: matchErr } = await supabase
      .from("matches")
      .insert(matchData)
      .select()
      .single();

    if (matchErr) {
      console.error(`Error inserting match ${matchData.title}:`, matchErr);
      continue;
    }

    console.log(`✅ Match created with ID: ${insertedMatch.id}. Attaching slots...`);

    const slotsToInsert = [
      {
        match_id: insertedMatch.id,
        slot: 1,
        channel_id: primaryChannelId,
        channel_name: `Live Channel ${primaryChannelId}`,
        enabled: true,
      },
      {
        match_id: insertedMatch.id,
        slot: 2,
        channel_id: "1537043",
        channel_name: "Live Channel 1537043",
        enabled: true,
      },
      {
        match_id: insertedMatch.id,
        slot: 3,
        channel_id: "1537049",
        channel_name: "Live Channel 1537049",
        enabled: true,
      },
      {
        match_id: insertedMatch.id,
        slot: 4,
        channel_id: "1537042",
        channel_name: "Live Channel 1537042",
        enabled: true,
      },
    ];

    const { error: slotErr } = await supabase.from("match_slots").insert(slotsToInsert);
    if (slotErr) {
      console.error(`Error attaching slots for match ${insertedMatch.id}:`, slotErr);
    } else {
      console.log(`🎉 Attached 4 channel slots (${primaryChannelId}, 1537043, 1537049, 1537042) to match ${insertedMatch.id}!`);
    }
  }

  console.log("=== Seed script completed successfully! ===");
}

seed();
