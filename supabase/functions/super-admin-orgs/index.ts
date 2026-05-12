import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 50);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await anonClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verifica app_role = admin (super admin global)
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();

    if (roleData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Acesso negado: requer super admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "list") {
      const { data: orgs, error } = await adminClient
        .from("organizations")
        .select("id, name, slug, owner_id, created_at, updated_at")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Conta membros por org
      const { data: members } = await adminClient
        .from("organization_members")
        .select("organization_id");
      const memberCounts: Record<string, number> = {};
      (members ?? []).forEach((m: any) => {
        memberCounts[m.organization_id] = (memberCounts[m.organization_id] ?? 0) + 1;
      });

      // Busca emails dos owners
      const ownerIds = [...new Set((orgs ?? []).map((o: any) => o.owner_id))];
      const ownerEmails: Record<string, string> = {};
      for (const id of ownerIds) {
        try {
          const { data } = await adminClient.auth.admin.getUserById(id);
          if (data?.user?.email) ownerEmails[id] = data.user.email;
        } catch { /* skip */ }
      }

      const enriched = (orgs ?? []).map((o: any) => ({
        ...o,
        member_count: memberCounts[o.id] ?? 0,
        owner_email: ownerEmails[o.owner_id] ?? null,
      }));

      return new Response(JSON.stringify({ orgs: enriched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create") {
      const name = (body.name ?? "").toString().trim();
      const ownerEmail = (body.owner_email ?? "").toString().trim().toLowerCase();
      if (!name || name.length < 2) {
        return new Response(JSON.stringify({ error: "Nome inválido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Resolve owner: por email (se enviado) ou usa o caller
      let ownerId = caller.id;
      if (ownerEmail) {
        const { data: usersList } = await adminClient.auth.admin.listUsers();
        const found = usersList?.users.find(
          (u) => (u.email ?? "").toLowerCase() === ownerEmail,
        );
        if (!found) {
          // Convida o usuário por email (envia email de definição de senha)
          const { data: invited, error: inviteErr } =
            await adminClient.auth.admin.inviteUserByEmail(ownerEmail);
          if (inviteErr || !invited?.user) {
            return new Response(
              JSON.stringify({ error: `Falha ao convidar usuário: ${inviteErr?.message ?? "desconhecido"}` }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          ownerId = invited.user.id;
        } else {
          ownerId = found.id;
        }
      }

      let slug = slugify(name);
      if (!slug) slug = `org-${Date.now()}`;
      // Garante slug único
      let suffix = 0;
      while (true) {
        const candidate = suffix === 0 ? slug : `${slug}-${suffix}`;
        const { data: existing } = await adminClient
          .from("organizations")
          .select("id")
          .eq("slug", candidate)
          .maybeSingle();
        if (!existing) {
          slug = candidate;
          break;
        }
        suffix++;
        if (suffix > 100) {
          slug = `${slug}-${Date.now()}`;
          break;
        }
      }

      const { data: newOrg, error: orgErr } = await adminClient
        .from("organizations")
        .insert({ name, slug, owner_id: ownerId })
        .select()
        .single();
      if (orgErr) throw orgErr;

      const { error: memberErr } = await adminClient
        .from("organization_members")
        .insert({ organization_id: newOrg.id, user_id: ownerId, role: "owner" });
      if (memberErr) {
        // Rollback
        await adminClient.from("organizations").delete().eq("id", newOrg.id);
        throw memberErr;
      }

      await adminClient.rpc("insert_audit_log", {
        _actor_id: caller.id,
        _action: "super_admin.org.create",
        _target_user_id: ownerId,
        _details: { org_id: newOrg.id, org_name: name },
      });

      return new Response(JSON.stringify({ org: newOrg }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update") {
      const orgId = body.org_id as string;
      const name = (body.name ?? "").toString().trim();
      if (!orgId || !name) {
        return new Response(JSON.stringify({ error: "Parâmetros inválidos" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await adminClient
        .from("organizations")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", orgId);
      if (error) throw error;

      await adminClient.rpc("insert_audit_log", {
        _actor_id: caller.id,
        _action: "super_admin.org.update",
        _details: { org_id: orgId, name },
      });

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const orgId = body.org_id as string;
      if (!orgId) {
        return new Response(JSON.stringify({ error: "org_id obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await adminClient.from("organizations").delete().eq("id", orgId);
      if (error) throw error;

      await adminClient.rpc("insert_audit_log", {
        _actor_id: caller.id,
        _action: "super_admin.org.delete",
        _details: { org_id: orgId },
      });

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "stats") {
      const [orgsRes, usersRes, membersRes, sellersRes, tokensRes] = await Promise.all([
        adminClient.from("organizations").select("id", { count: "exact", head: true }),
        adminClient.auth.admin.listUsers({ page: 1, perPage: 1 }),
        adminClient.from("organization_members").select("id", { count: "exact", head: true }),
        adminClient.from("sellers").select("id", { count: "exact", head: true }),
        adminClient.from("ml_tokens").select("id", { count: "exact", head: true }),
      ]);

      return new Response(
        JSON.stringify({
          stats: {
            orgs: orgsRes.count ?? 0,
            users: (usersRes.data as any)?.total ?? usersRes.data?.users?.length ?? 0,
            memberships: membersRes.count ?? 0,
            sellers: sellersRes.count ?? 0,
            ml_connections: tokensRes.count ?? 0,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "Ação inválida" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("super-admin-orgs error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});