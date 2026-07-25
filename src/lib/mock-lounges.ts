/**
 * Legacy compatibility shim. Real lounge data now comes from the database
 * via `src/lib/lounges.public.functions.ts`. This file only re-exports the
 * public `Lounge` type alias so any lingering `import type { Lounge }` still
 * resolves. Delete once no consumer imports the type from here.
 */
import type { PublicLounge } from "./lounges.public.functions";

export type Lounge = PublicLounge;
