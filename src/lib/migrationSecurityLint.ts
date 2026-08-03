// ============================================================================
// migrationSecurityLint.ts — Fase 209 Plano 03, Task 1
// A regressão do critério 5: varredura de TEXTO sobre o histórico de
// migrations que pega a PRÓXIMA migration gerada sem disciplina de
// privilégio, não estas três já consertadas (SEC-07/08 no 209-01).
//
// LIMITE DO LINT — escrito aqui de propósito, porque é o furo que a Task 2
// cobre e não este arquivo: este lint só enxerga o que passou por uma
// migration em `supabase/migrations/`. Objeto criado fora disso — por editor
// de SQL, por `execute_sql` avulso, ou pela plataforma direto no banco — não
// aparece aqui. Foi exatamente assim que `orders_status_reconciliation`
// chegou ao banco sem uma linha em nenhum dos dois repositórios: nenhuma
// migration a criou. Quem cobre esse buraco é a varredura ao vivo do
// catálogo do Postgres (Task 2); as duas juntas, e só as duas juntas, são o
// critério 5.
//
// `lintMigrations` é pura: recebe a lista de arquivos já ordenada por
// versão e a linha de base, devolve os achados e as entradas de linha de
// base que sobraram sem achado correspondente (obsoletas). Quem lê o disco
// é quem chama esta função — normalmente o teste — nunca ela mesma. É o que
// permite testar os casos difíceis com pares de SQL sintéticos, sem
// fabricar migrations de mentira no repositório.
//
// Duas classes reconhecidas, e só duas:
//
// - `tabela_sem_rls` — `CREATE TABLE` em `public` (com ou sem
//   `IF NOT EXISTS`) sem um `ENABLE ROW LEVEL SECURITY` correspondente no
//   ESTADO FINAL da sequência de arquivos. Um `DISABLE` posterior sem
//   religamento reabre o achado — a análise é do estado final, não da
//   existência de uma linha em algum lugar do histórico.
// - `definer_sem_revoke` — `CREATE FUNCTION` ou `CREATE OR REPLACE FUNCTION`
//   em `public` com `SECURITY DEFINER` sem um `REVOKE` mencionando aquele
//   NOME em qualquer arquivo (mesmo ou posterior). Casar por nome, e não por
//   assinatura completa, é deliberado: exigir assinatura idêntica entre o
//   `CREATE` e o `REVOKE` produziria falso negativo toda vez que o `REVOKE`
//   fosse escrito com um tipo grafado diferente — e falso negativo é o único
//   erro que este portão não pode cometer. Falso positivo custa uma linha na
//   linha de base; falso negativo custa três meses, que é literalmente o
//   que custou desta vez (`can_member_access_route` executável por PUBLIC).
//
// Comentários de SQL são removidos antes de qualquer casamento — uma linha
// começando por `--` que mencione uma tabela, um `REVOKE` ou um `ENABLE` não
// cria nem conserta nada. Sem essa remoção o lint se auto-satisfaz: um
// comentário explicando o que NÃO foi revogado contaria como revogação.
// ============================================================================

export type MigrationSecurityLintClasse = "tabela_sem_rls" | "definer_sem_revoke";

export interface ArquivoMigration {
  /** Nome do arquivo de migration (ex.: "20260803230657_sec07_....sql") */
  nome: string;
  /** Conteúdo SQL bruto do arquivo */
  sql: string;
}

export interface Achado {
  classe: MigrationSecurityLintClasse;
  objeto: string;
}

export interface BaselineEntry {
  classe: MigrationSecurityLintClasse;
  /** Nome do objeto (tabela ou função) em public, sem o prefixo de schema */
  objeto: string;
  /** Motivo por que este achado herdado é aceito — nunca vazio */
  motivo: string;
}

export interface ResultadoLint {
  achados: Achado[];
  baselineObsoleta: BaselineEntry[];
}

// ----------------------------------------------------------------------------
// Remoção de comentários de linha (`-- ...` até o fim da linha). Deliberado
// não tratar comentários de bloco (`/* ... */`): o histórico real deste repo
// não os usa, e um lint textual não precisa de mais poder de parsing do que
// o histórico exige.
// ----------------------------------------------------------------------------
function removerComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

const IDENTIFICADOR = "[A-Za-z_][A-Za-z0-9_]*";

const TABELA_CREATE_RE = new RegExp(
  `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?public\\.(${IDENTIFICADOR})`,
  "gi",
);

const TABELA_RLS_RE = new RegExp(
  `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?public\\.(${IDENTIFICADOR})\\s+(ENABLE|DISABLE)\\s+ROW\\s+LEVEL\\s+SECURITY`,
  "gi",
);

const FUNCAO_CREATE_RE = new RegExp(
  `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.(${IDENTIFICADOR})\\s*\\(`,
  "gi",
);

// Fim do cabeçalho da função — onde o corpo começa (`AS $$` / `AS $tag$`).
// `SECURITY DEFINER` sempre aparece antes disso, junto de LANGUAGE/STABLE/SET.
const CORPO_INICIO_RE = /AS\s+\$[A-Za-z_]*\$/i;
const TAMANHO_MAXIMO_CABECALHO = 3000;
const TAMANHO_FALLBACK_CABECALHO = 800;

const SECURITY_DEFINER_RE = /SECURITY\s+DEFINER/i;

// Só conta como REVOKE de privilégio um comando que começa com REVOKE
// seguido imediatamente de ALL ou EXECUTE — isso é o que exclui, por
// desenho, um "REVOKE" que apareça dentro de uma string qualquer (ex.: o
// nome de uma policy "Owners and admins can revoke invites"), que não tem
// ALL/EXECUTE logo depois.
const REVOKE_BLOCO_RE = /\bREVOKE\s+(?:ALL|EXECUTE)\b[\s\S]*?;/gi;
const IDENTIFICADOR_CHAMADA_RE = new RegExp(`\\b(${IDENTIFICADOR})\\s*\\(`, "g");

interface EventoTabela {
  pos: number;
  tipo: "create" | "enable" | "disable";
  objeto: string;
}

export function lintMigrations(arquivos: ArquivoMigration[], baseline: BaselineEntry[]): ResultadoLint {
  const tabelasCriadas = new Set<string>();
  const tabelaRlsLigada = new Map<string, boolean>();

  const funcoesDefiner = new Set<string>();
  const funcoesRevogadas = new Set<string>();

  for (const arquivo of arquivos) {
    const texto = removerComentarios(arquivo.sql);

    // --- tabelas: eventos ordenados por posição DENTRO do arquivo, para que
    // "criada e RLS ligada no mesmo arquivo" resolva corretamente mesmo
    // quando o ENABLE vem antes do CREATE no texto (não deveria acontecer em
    // SQL válido, mas a ordenação por posição é robusta de qualquer forma).
    const eventos: EventoTabela[] = [];

    for (const m of texto.matchAll(TABELA_CREATE_RE)) {
      eventos.push({ pos: m.index ?? 0, tipo: "create", objeto: m[1] });
    }
    for (const m of texto.matchAll(TABELA_RLS_RE)) {
      eventos.push({
        pos: m.index ?? 0,
        tipo: m[2].toUpperCase() === "ENABLE" ? "enable" : "disable",
        objeto: m[1],
      });
    }
    eventos.sort((a, b) => a.pos - b.pos);

    for (const evento of eventos) {
      if (evento.tipo === "create") {
        tabelasCriadas.add(evento.objeto);
        if (!tabelaRlsLigada.has(evento.objeto)) {
          tabelaRlsLigada.set(evento.objeto, false);
        }
      } else if (evento.tipo === "enable") {
        tabelaRlsLigada.set(evento.objeto, true);
      } else {
        tabelaRlsLigada.set(evento.objeto, false);
      }
    }

    // --- funções SECURITY DEFINER
    for (const m of texto.matchAll(FUNCAO_CREATE_RE)) {
      const nome = m[1];
      const inicioResto = (m.index ?? 0) + m[0].length;
      const resto = texto.slice(inicioResto, inicioResto + TAMANHO_MAXIMO_CABECALHO);
      const corpoMatch = CORPO_INICIO_RE.exec(resto);
      const cabecalho = corpoMatch ? resto.slice(0, corpoMatch.index) : resto.slice(0, TAMANHO_FALLBACK_CABECALHO);
      if (SECURITY_DEFINER_RE.test(cabecalho)) {
        funcoesDefiner.add(nome);
      }
    }

    // --- REVOKE mencionando função por nome, em qualquer arquivo (mesmo ou
    // posterior à criação — quem decide isso é o laço externo por ordem de
    // `arquivos`, e a revogação vale para o histórico inteiro).
    for (const m of texto.matchAll(REVOKE_BLOCO_RE)) {
      const bloco = m[0];
      for (const chamada of bloco.matchAll(IDENTIFICADOR_CHAMADA_RE)) {
        funcoesRevogadas.add(chamada[1]);
      }
    }
  }

  const achados: Achado[] = [];

  for (const tabela of tabelasCriadas) {
    if (!tabelaRlsLigada.get(tabela)) {
      achados.push({ classe: "tabela_sem_rls", objeto: tabela });
    }
  }

  for (const funcao of funcoesDefiner) {
    if (!funcoesRevogadas.has(funcao)) {
      achados.push({ classe: "definer_sem_revoke", objeto: funcao });
    }
  }

  const chave = (classe: MigrationSecurityLintClasse, objeto: string) => `${classe}:${objeto}`;
  const baselineChaves = new Set(baseline.map((b) => chave(b.classe, b.objeto)));
  const achadosChaves = new Set(achados.map((a) => chave(a.classe, a.objeto)));

  const achadosForaDaBaseline = achados.filter((a) => !baselineChaves.has(chave(a.classe, a.objeto)));
  const baselineObsoleta = baseline.filter((b) => !achadosChaves.has(chave(b.classe, b.objeto)));

  return { achados: achadosForaDaBaseline, baselineObsoleta };
}
