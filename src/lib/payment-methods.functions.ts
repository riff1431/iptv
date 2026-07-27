import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type TopupMethodKind = Database["public"]["Enums"]["topup_method"];

export interface PaymentMethod {
  id: string;
  code: string;
  label: string;
  description: string | null;
  instructions: string | null;
  kind: TopupMethodKind;
  icon: string | null;
  reference_placeholder: string | null;
  config: Record<string, string>;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const SELECT_COLS =
  "id, code, label, description, instructions, kind, icon, reference_placeholder, config, enabled, sort_order, created_at, updated_at";

const KIND_VALUES = ["bank_transfer", "mobile_money", "cash", "other"] as const;

const upsertInput = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i, "Code must be letters, numbers, dashes, or underscores"),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional().nullable(),
  instructions: z.string().trim().max(2000).optional().nullable(),
  kind: z.enum(KIND_VALUES),
  icon: z.string().trim().max(60).optional().nullable(),
  reference_placeholder: z.string().trim().max(120).optional().nullable(),
  config: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

function normalizeRow(r: any): PaymentMethod {
  return {
    ...r,
    config: (r?.config ?? {}) as Record<string, string>,
  } as PaymentMethod;
}

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not authorized");
}

export const listEnabledPaymentMethods = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentMethod[]> => {
    const { data, error } = await context.supabase
      .from("payment_methods")
      .select(SELECT_COLS)
      .eq("enabled", true)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeRow);
  });

export const listAllPaymentMethods = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentMethod[]> => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("payment_methods")
      .select(SELECT_COLS)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeRow);
  });

export const upsertPaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => upsertInput.parse(d))
  .handler(async ({ data, context }): Promise<PaymentMethod> => {
    await assertAdmin(context);
    const row: Record<string, unknown> = {
      code: data.code,
      label: data.label,
      description: data.description ?? null,
      instructions: data.instructions ?? null,
      kind: data.kind,
      icon: data.icon ?? null,
      reference_placeholder: data.reference_placeholder ?? null,
      config: data.config ?? {},
      enabled: data.enabled ?? true,
      sort_order: data.sort_order ?? 0,
    };

    const table = context.supabase.from("payment_methods") as any;

    if (data.id) {
      const { data: updated, error } = await table
        .update(row)
        .eq("id", data.id)
        .select(SELECT_COLS)
        .single();
      if (error) throw new Error(error.message);
      return normalizeRow(updated);
    }

    const { data: inserted, error } = await table
      .insert({ ...row, created_by: context.userId })
      .select(SELECT_COLS)
      .single();
    if (error) throw new Error(error.message);
    return normalizeRow(inserted);
  });

export const deletePaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("payment_methods").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
