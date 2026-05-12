import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "").slice(0, 50);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const cronSecret = Deno.env.get("CRON_SECRET")!;
    const got = req.headers.get("x-cron-secret");
    if (got !== cronSecret) {
      return new Response(JSON.stringify({ error: "unauthorized", got_len: got?.length ?? 0, exp_len: cronSecret?.length ?? 0 }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const url = Deno.env.get("SUPABASE_URL")!;
    const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, srk);
    const body = await req.json();
    const name = String(body.name).trim();
    const email = String(body.owner_email).trim().toLowerCase();

    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    let user = list?.users.find((u) => (u.email ?? "").toLowerCase() === email);
    let invited = false;
    if (!user) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
      if (error) throw error;
      user = data.user!;
      invited = true;
    }

    let slug = slugify(name) || `org-${Date.now()}`;
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? slug : `${slug}-${i}`;
      const { data: ex } = await admin.from("organizations").select("id").eq("slug", candidate).maybeSingle();
      if (!ex) { slug = candidate; break; }
    }

    const { data: org, error: oerr } = await admin.from("organizations")
      .insert({ name, slug, owner_id: user.id }).select().single();
    if (oerr) throw oerr;
    const { error: merr } = await admin.from("organization_members")
      .insert({ organization_id: org.id, user_id: user.id, role: "owner" });
    if (merr) {
      await admin.from("organizations").delete().eq("id", org.id);
      throw merr;
    }
    return new Response(JSON.stringify({ ok: true, org, user_id: user.id, invited }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});