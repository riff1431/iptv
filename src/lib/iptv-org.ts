import { useQuery } from "@tanstack/react-query";

export type IptvOrgChannel = {
  id: string;
  name: string;
  alt_names?: string[];
  network?: string | null;
  owners?: string[];
  country: string;
  subdivision?: string | null;
  city?: string | null;
  categories: string[];
  is_nsfw?: boolean;
  launched?: string | null;
  closed?: string | null;
  replaced_by?: string | null;
  website?: string | null;
  logo: string;
};

export type IptvOrgStream = {
  channel: string | null;
  feed?: string | null;
  title?: string;
  url: string;
  referrer?: string | null;
  user_agent?: string | null;
  quality?: string | null;
};

export type IptvOrgMergedChannel = IptvOrgChannel & {
  streamUrl?: string;
  streamQuality?: string | null;
};

const CHANNELS_URL = "https://iptv-org.github.io/api/channels.json";
const STREAMS_URL = "https://iptv-org.github.io/api/streams.json";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return (await res.json()) as T;
}

export function useIptvOrgCatalog() {
  return useQuery({
    queryKey: ["iptv-org", "catalog"],
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 6,
    queryFn: async (): Promise<IptvOrgMergedChannel[]> => {
      const [channels, streams] = await Promise.all([
        fetchJson<IptvOrgChannel[]>(CHANNELS_URL),
        fetchJson<IptvOrgStream[]>(STREAMS_URL),
      ]);
      const streamByChannel = new Map<string, IptvOrgStream>();
      for (const s of streams) {
        if (!s.channel) continue;
        if (!streamByChannel.has(s.channel)) streamByChannel.set(s.channel, s);
      }
      return channels
        .filter((c) => !c.closed && !c.replaced_by)
        .map((c) => {
          const s = streamByChannel.get(c.id);
          return { ...c, streamUrl: s?.url, streamQuality: s?.quality ?? null };
        });
    },
  });
}
