import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type CreateOrganizationStep = "organizations" | "organization_members" | "organization_plans";

export interface CreateOrganizationError {
  step: CreateOrganizationStep;
  /** true quando repetir só este passo é a recuperação certa (organização já existe). */
  recoverable: boolean;
  message: string;
  /** presente a partir do passo 2, quando a organização já foi criada. */
  organizationId?: string;
}

export type CreateOrganizationResult =
  | { ok: true; organizationId: string }
  | { ok: false; error: CreateOrganizationError };

export interface CreateOrganizationInput {
  nome: string;
  /** Quando ausente, é derivado do nome via `slugify`. */
  slug?: string;
  userId: string;
}

/**
 * Deriva um slug a partir de um nome livre: minúsculas, sem acento, hífens
 * no lugar de espaço/pontuação, sem hífen sobrando nas pontas.
 */
export function slugify(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function newOrganizationId(): string {
  // As três inserções precisam do mesmo id antes de qualquer uma delas
  // terminar, e a policy de bootstrap de organization_members só aceita o
  // self-insert como owner quando a linha de organizations já existe com
  // owner_id = auth.uid(). Gerar o id no cliente evita a armadilha de RLS:
  // logo após o passo 1, o usuário ainda não é membro da organização, então
  // a policy de SELECT de "organizations" não devolveria a linha recém-
  // -criada a um .insert().select().single() — por isso nenhum passo desta
  // função pede a representação de volta, e o id é conhecido de antemão.
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Executa as três inserções que fecham o SEC-09: organizations →
 * organization_members (o autor como owner) → organization_plans (`free`
 * explícito). Cada passo espera o anterior ter sido confirmado — não é uma
 * transação, é a ordem que as policies de RLS já existentes exigem.
 *
 * Recebe o cliente Supabase por parâmetro (em vez de importar o singleton)
 * para poder ser testada com um dublê, isolada da tela.
 */
export async function createOrganization(
  client: SupabaseClient<Database>,
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  const nome = input.nome.trim();
  const slug = (input.slug?.trim() || slugify(input.nome)).trim();
  const organizationId = newOrganizationId();

  const { error: orgError } = await client.from("organizations").insert({
    id: organizationId,
    name: nome,
    slug,
    owner_id: input.userId,
  });

  if (orgError) {
    return {
      ok: false,
      error: {
        step: "organizations",
        recoverable: false,
        message: `Falha ao criar a organização: ${orgError.message}`,
      },
    };
  }

  const { error: memberError } = await client.from("organization_members").insert({
    organization_id: organizationId,
    user_id: input.userId,
    role: "owner",
  });

  if (memberError) {
    return {
      ok: false,
      error: {
        step: "organization_members",
        recoverable: true,
        organizationId,
        message: `A organização foi criada, mas falhou ao registrar você como owner: ${memberError.message}`,
      },
    };
  }

  // Sem esta linha, check_quota lê intervalo nulo como "sem limite" e a
  // organização nasceria com quota ilimitada, em silêncio. free/1440 vai
  // gravado explicitamente, nunca deixado para o default da coluna.
  const { error: planError } = await client.from("organization_plans").insert({
    organization_id: organizationId,
    plan_tier: "free",
    sync_interval_minutes: 1440,
  });

  if (planError) {
    return {
      ok: false,
      error: {
        step: "organization_plans",
        recoverable: true,
        organizationId,
        message: `A organização e o seu acesso como owner já existem — falta só o plano: ${planError.message}`,
      },
    };
  }

  return { ok: true, organizationId };
}
