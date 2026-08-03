/**
 * Guarda de configuração de build (SEC-10).
 *
 * Pura: recebe o mapa de ambiente já montado pelo chamador (`vite.config.ts`
 * usa `loadEnv` + `process.env`; os testes passam um objeto literal). Nada
 * aqui lê `process.env` diretamente — é isso que torna a função testável sem
 * subir build nem mexer no ambiente do processo de teste.
 *
 * A mensagem de erro é a interface de quem vai ler o log da Vercel: sempre
 * começa com "Build abortado:" e nomeia exatamente o que falta.
 */

const REQUIRED_KEYS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PROJECT_ID",
] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

export type EnvMap = Partial<Record<RequiredKey, string>> & Record<string, string | undefined>;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/**
 * Lança `Error` quando alguma variável obrigatória está ausente, vazia, só
 * de espaços, ou quando a URL e o identificador de projeto do Supabase não
 * são coerentes entre si (host certo, projeto errado). Retorna sem lançar
 * quando tudo está presente e coerente.
 */
export function assertRequiredEnv(env: EnvMap): void {
  const missing = REQUIRED_KEYS.filter((key) => isBlank(env[key]));

  if (missing.length > 0) {
    throw new Error(`Build abortado: variável(is) de ambiente ausente(s): ${missing.join(", ")}`);
  }

  const url = env.VITE_SUPABASE_URL as string;
  const projectId = env.VITE_SUPABASE_PROJECT_ID as string;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`Build abortado: VITE_SUPABASE_URL não é uma URL válida: "${url}"`);
  }

  // Comparação de coerência, não lista de bloqueio: nenhum identificador de
  // projeto Supabase real vive neste arquivo. O primeiro rótulo do host
  // Supabase (`<project-id>.supabase.co`) precisa bater com o identificador
  // declarado separadamente — é o que pega "URL certa, chave de outro projeto".
  const hostProjectLabel = host.split(".")[0];
  if (hostProjectLabel !== projectId) {
    throw new Error(
      `Build abortado: VITE_SUPABASE_URL ("${host}") não corresponde a VITE_SUPABASE_PROJECT_ID ("${projectId}")`,
    );
  }
}
