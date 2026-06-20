import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// DESATIVADA (Phase 47 Go-Live QA) — funcao de debug (probe de mapeamento
// Tiny), nao usada pelo frontend. Neutralizada com 410 Gone. Remocao
// definitiva: dashboard Supabase ou `supabase functions delete probe-tiny-map`.
Deno.serve(() => new Response(
  JSON.stringify({ error: "gone", message: "Endpoint de debug desativado." }),
  { status: 410, headers: { "Content-Type": "application/json" } },
));
