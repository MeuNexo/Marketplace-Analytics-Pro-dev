import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// DESATIVADA (Phase 47 Go-Live QA) — era um backdoor de reset de senha
// sem autenticacao (verify_jwt=false), nao usado pelo frontend. Neutralizada
// com 410 Gone. Remocao definitiva do endpoint: dashboard Supabase ou
// `supabase functions delete temp-reset-password` (requer SUPABASE_ACCESS_TOKEN).
Deno.serve(() => new Response(
  JSON.stringify({ error: "gone", message: "Endpoint desativado." }),
  { status: 410, headers: { "Content-Type": "application/json" } },
));
