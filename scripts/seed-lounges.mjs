import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bnltgjpsukijtogclrhf.supabase.co";
const serviceKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHRnanBzdWtpanRvZ2NscmhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDk1MDg3NywiZXhwIjoyMTAwNTI2ODc3fQ.0_vDa3Clz2zZ7Vv3sDIhnLFoPWniMgRZAH2WMyRdvRc";

const supabase = createClient(supabaseUrl, serviceKey);

async function seedLounges() {
  console.log("=== Seeding Real Lounges & Creator Lobbies into Supabase DB ===");

  const loungesToInsert = [
    // Regular Lobbies
    {
      name: "Sports Central",
      slug: "sports-central",
      tagline: "All your favorite games live",
      entry_fee_cents: 500,
      is_active: true,
      is_featured: true,
      is_private: false,
      vibe: "flagship",
    },
    {
      name: "Game On Arena",
      slug: "game-on-arena",
      tagline: "Non-stop sports action",
      entry_fee_cents: 500,
      is_active: true,
      is_featured: true,
      is_private: false,
      vibe: "themed",
    },
    {
      name: "Elite Sports Hub",
      slug: "elite-sports-hub",
      tagline: "Top leagues. All in one place",
      entry_fee_cents: 500,
      is_active: true,
      is_featured: true,
      is_private: false,
      vibe: "flagship",
    },
    {
      name: "Fan Zone",
      slug: "fan-zone",
      tagline: "4 games. 1 epic view.",
      entry_fee_cents: 500,
      is_active: true,
      is_featured: false,
      is_private: false,
      vibe: "free",
    },

    // Creator Lobbies
    {
      name: "SophiaL_Xo's Lounge",
      slug: "sophial-xo-lounge",
      tagline: "Chill vibes & big plays",
      entry_fee_cents: 1000,
      is_active: true,
      is_featured: true,
      is_private: false,
      vibe: "themed",
    },
    {
      name: "LunaLove's Arena",
      slug: "lunalove-arena",
      tagline: "Let's talk & watch",
      entry_fee_cents: 1000,
      is_active: true,
      is_featured: true,
      is_private: false,
      vibe: "themed",
    },
    {
      name: "NinaRose's Sports Night",
      slug: "ninarose-sports-night",
      tagline: "Good games, great company",
      entry_fee_cents: 1000,
      is_active: true,
      is_featured: true,
      is_private: false,
      vibe: "themed",
    },
    {
      name: "VioletXX Livezone",
      slug: "violetxx-livezone",
      tagline: "Chat. React. Enjoy.",
      entry_fee_cents: 1000,
      is_active: true,
      is_featured: false,
      is_private: false,
      vibe: "themed",
    },
  ];

  for (const lData of loungesToInsert) {
    console.log(`Inserting lounge "${lData.name}"...`);
    const { data: inserted, error: lErr } = await supabase
      .from("lounges")
      .insert(lData)
      .select()
      .single();

    if (lErr) {
      console.error(`Error inserting lounge "${lData.name}":`, lErr);
      continue;
    }

    console.log(`✅ Lounge inserted! ID: ${inserted.id}`);

    // Attach 4 TVs to each lounge
    const tvsToInsert = [
      {
        lounge_id: inserted.id,
        slot: 1,
        display_name: "TV 1 - Main Stream",
        connection_type: "xtream",
        selected_channel_id: "1537041",
        selected_channel_name: "Live Channel 1537041",
        enabled: true,
        status: "online",
      },
      {
        lounge_id: inserted.id,
        slot: 2,
        display_name: "TV 2 - Secondary",
        connection_type: "xtream",
        selected_channel_id: "1537043",
        selected_channel_name: "Live Channel 1537043",
        enabled: true,
        status: "online",
      },
      {
        lounge_id: inserted.id,
        slot: 3,
        display_name: "TV 3 - Multiview",
        connection_type: "xtream",
        selected_channel_id: "1537049",
        selected_channel_name: "Live Channel 1537049",
        enabled: true,
        status: "online",
      },
      {
        lounge_id: inserted.id,
        slot: 4,
        display_name: "TV 4 - Highlights",
        connection_type: "xtream",
        selected_channel_id: "1537042",
        selected_channel_name: "Live Channel 1537042",
        enabled: true,
        status: "online",
      },
    ];

    const { error: tvErr } = await supabase.from("tvs").insert(tvsToInsert);
    if (tvErr) {
      console.error(`Error inserting TVs for lounge ${inserted.id}:`, tvErr);
    } else {
      console.log(`  🎉 Attached 4 TVs with IPTV channels to lounge ${inserted.name}!`);
    }
  }

  console.log("=== Seed lounges finished successfully! ===");
}

seedLounges();
