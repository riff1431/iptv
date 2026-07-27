import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getVipStatus } from "@/lib/wallet.functions";

export const vipStatusQueryKey = (userId: string | undefined) =>
  ["user", "vip-status", userId] as const;

export function useVipStatus(userId: string | undefined) {
  const getVipStatusFn = useServerFn(getVipStatus);

  return useQuery({
    queryKey: vipStatusQueryKey(userId),
    queryFn: () => getVipStatusFn(),
    enabled: Boolean(userId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
