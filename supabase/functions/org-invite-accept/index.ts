import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { token, mode, password } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: "Token ausente" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(url, service);
    const token_hash = await sha256(token);

    const { data: invite } = await admin
      .from("organization_invites")
      .select("id, organization_id, email, role, expires_at, accepted_at, revoked_at, organizations(name)")
      .eq("token_hash", token_hash)
      .maybeSingle();

    if (!invite) {
      return new Response(JSON.stringify({ ok: false, error: "Convite não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (invite.accepted_at) {
      return new Response(JSON.stringify({ ok: false, error: "Convite já aceito" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (invite.revoked_at) {
      return new Response(JSON.stringify({ ok: false, error: "Convite revogado" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return new Response(JSON.stringify({ ok: false, error: "Convite expirado" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Look up if a user already exists for this email
    const { data: usersList } = await admin.auth.admin.listUsers();
    const existingUser = usersList?.users.find((u: any) => u.email?.toLowerCase() === invite.email.toLowerCase());

    if (mode === "preview") {
      return new Response(JSON.stringify({
        ok: true,
        email: invite.email,
        role: invite.role,
        organization_name: (invite as any).organizations?.name ?? "",
        user_exists: !!existingUser,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACCEPT mode
    let userId: string | null = null;
    let session: any = null;

    if (existingUser) {
      // Caller must be authenticated as that user
      if (!authHeader) {
        return new Response(JSON.stringify({ ok: false, error: "Faça login para aceitar este convite" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: { user: caller } } = await userClient.auth.getUser();
      if (!caller || caller.email?.toLowerCase() !== invite.email.toLowerCase()) {
        return new Response(JSON.stringify({ ok: false, error: "Você precisa estar logado como " + invite.email }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      userId = caller.id;
    } else {
      if (!password || password.length < 8) {
        return new Response(JSON.stringify({ ok: false, error: "Senha mínima de 8 caracteres" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: invite.email,
        password,
        email_confirm: true,
      });
      if (createErr || !created.user) {
        return new Response(JSON.stringify({ ok: false, error: createErr?.message ?? "Erro ao criar usuário" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      userId = created.user.id;

      // Sign the new user in to return a session
      const signInClient = createClient(url, anon);
      const { data: signed } = await signInClient.auth.signInWithPassword({ email: invite.email, password });
      session = signed.session;
    }

    // Add to organization_members (idempotent)
    const { error: memberErr } = await admin
      .from("organization_members")
      .insert({ organization_id: invite.organization_id, user_id: userId!, role: invite.role });
    if (memberErr && !memberErr.message.includes("duplicate")) {
      return new Response(JSON.stringify({ ok: false, error: memberErr.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Se o convite é de owner, transfere a propriedade da org
    if (invite.role === "owner") {
      await admin
        .from("organizations")
        .update({ owner_id: userId })
        .eq("id", invite.organization_id);
    }

    // Mark invite accepted
    await admin
      .from("organization_invites")
      .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
      .eq("id", invite.id);

    await admin.from("audit_log").insert({
      actor_id: userId,
      action: "invite_accepted",
      organization_id: invite.organization_id,
      target_user_id: userId,
      details: { invite_id: invite.id, role: invite.role },
    });

    return new Response(JSON.stringify({ ok: true, organization_id: invite.organization_id, session }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("org-invite-accept error:", err);
    return new Response(JSON.stringify({ ok: false, error: "Erro interno" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});