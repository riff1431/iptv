import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminServer } from "@/lib/admin-guard";

export interface AdminQuickDare {
  id: string;
  label: string;
  icon: string;
  price_cents: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const SELECT_COLS = "id, label, icon, price_cents, sort_order, is_active, created_at, updated_at";

/** List every dare (active + inactive) for the admin console. */
export const listQuickDaresForAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .handler(async ({ context }): Promise<AdminQuickDare[]> => {
    const { data, error } = await context.supabase
      .from("quick_dares")
      .select(SELECT_COLS)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminQuickDare[];
  });

const dareInput = z.object({
  label: z.string().trim().min(1).max(120),
  icon: z.string().trim().min(1).max(40),
  price_cents: z.number().int().min(0).max(10_000_000),
  sort_order: z.number().int().min(0).max(100_000).optional(),
  is_active: z.boolean().optional(),
});

export const createQuickDare = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((data: unknown) => dareInput.parse(data))
  .handler(async ({ data, context }): Promise<AdminQuickDare> => {
    // Default sort_order = max + 10 so new items land at the bottom.
    let sortOrder = data.sort_order;
    if (sortOrder === undefined) {
      const { data: maxRow } = await context.supabase
        .from("quick_dares")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      sortOrder = (maxRow?.sort_order ?? 0) + 10;
    }

    const { data: row, error } = await context.supabase
      .from("quick_dares")
      .insert({
        label: data.label,
        icon: data.icon,
        price_cents: data.price_cents,
        sort_order: sortOrder,
        is_active: data.is_active ?? true,
      })
      .select(SELECT_COLS)
      .single();
    if (error) throw new Error(error.message);
    return row as AdminQuickDare;
  });

const updateInput = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(120).optional(),
  icon: z.string().trim().min(1).max(40).optional(),
  price_cents: z.number().int().min(0).max(10_000_000).optional(),
  sort_order: z.number().int().min(0).max(100_000).optional(),
  is_active: z.boolean().optional(),
});

export const updateQuickDare = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((data: unknown) => updateInput.parse(data))
  .handler(async ({ data, context }): Promise<AdminQuickDare> => {
    const { id, ...patch } = data;
    if (Object.keys(patch).length === 0) {
      throw new Error("Nothing to update");
    }
    const { data: row, error } = await context.supabase
      .from("quick_dares")
      .update(patch)
      .eq("id", id)
      .select(SELECT_COLS)
      .single();
    if (error) throw new Error(error.message);
    return row as AdminQuickDare;
  });

const deleteInput = z.object({ id: z.string().uuid() });

export const deleteQuickDare = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((data: unknown) => deleteInput.parse(data))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { error } = await context.supabase.from("quick_dares").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });

const reorderInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
});

/** Reorder the dares by rewriting sort_order in the order of the supplied ids. */
export const reorderQuickDares = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((data: unknown) => reorderInput.parse(data))
  .handler(async ({ data, context }): Promise<AdminQuickDare[]> => {
    // Space out sort_order values by 10 so future single-row moves fit between.
    await Promise.all(
      data.ids.map((id, index) =>
        context.supabase
          .from("quick_dares")
          .update({ sort_order: (index + 1) * 10 })
          .eq("id", id),
      ),
    );
    const { data: rows, error } = await context.supabase
      .from("quick_dares")
      .select(SELECT_COLS)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as AdminQuickDare[];
  });
