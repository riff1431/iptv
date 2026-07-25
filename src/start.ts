import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
// Project-specific hardened attacher — refreshes expired tokens and never
// throws from the client. Replaces the generated `attachSupabaseAuth`.
import { attachSupabaseAuthHardened } from "@/integrations/supabase/auth-attacher.custom";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuthHardened],
  requestMiddleware: [errorMiddleware],
}));
