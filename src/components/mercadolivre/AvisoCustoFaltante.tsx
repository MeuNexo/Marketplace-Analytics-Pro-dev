// ============================================================================
// AvisoCustoFaltante — Fase 213, Plano 05 (AV-03)
//
// Uma faixa de texto que diz quantos anúncios do que está na tela estão sem
// custo cadastrado — e, portanto, com margem INDEFINIDA.
//
// Existe porque a ausência de dado também é uma mudança de régua: a tela que
// mostra um traço célula a célula sem contar os traços deixa o operador achar
// que faltou um dado pontual quando, numa organização sem custo nenhum, nenhuma
// margem daquela tela pode ser considerada. É a mesma disciplina de
// `AdsOrigemNota`, aplicada à ausência em vez de à origem.
//
// A margem de quem não tem custo é indefinida — não é zero e não é negativa.
// Essa distinção é o ponto: zero convida a "está no empate", negativa convida a
// "está no prejuízo", e as duas leituras são invenção.
//
// Componente PURO de apresentação: sem hook de dado, sem leitura de banco, sem
// estado. A contagem chega pronta de `contarSemCusto`.
// ============================================================================

import { AlertCircle, AlertTriangle } from "lucide-react";
import { avisoCustoObrigatorio, type ContagemCusto } from "@/lib/custoFaltante";

const num = (v: number) => v.toLocaleString("pt-BR");
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export interface AvisoCustoFaltanteProps {
  /** Contagem já apurada sobre o conjunto EXIBIDO (ver `contarSemCusto`). */
  contagem: ContagemCusto;
  /** Rota para cadastrar custo. Sem ela, nenhum link é renderizado. */
  destinoCadastro?: string;
  /** Como chamar as linhas contadas, no plural. Padrão: "anúncios". */
  substantivoPlural?: string;
  className?: string;
}

export function AvisoCustoFaltante({
  contagem,
  destinoCadastro,
  substantivoPlural = "anúncios",
  className,
}: AvisoCustoFaltanteProps) {
  // Zero faltantes (ou conjunto vazio) → nada na tela. O aviso só existe para
  // relatar ausência real; ruído permanente vira ruído ignorado.
  if (!avisoCustoObrigatorio(contagem)) return null;

  const { semCusto, total, pctSemCusto, todosSemCusto } = contagem;

  // Tom mais forte quando o conjunto INTEIRO está sem custo: aí não é um aviso
  // sobre algumas células, é o aviso de que a tela toda não pode ser lida.
  const cls = todosSemCusto
    ? "border-destructive/30 bg-destructive/5 text-destructive"
    : "border-amber-500/20 bg-amber-500/5 text-amber-700";

  const Icon = todosSemCusto ? AlertTriangle : AlertCircle;

  return (
    <div
      role={todosSemCusto ? "alert" : "status"}
      className={[
        "rounded-xl border p-3 flex items-start gap-2.5 text-xs",
        cls,
        className ?? "",
      ]
        .join(" ")
        .trim()}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="space-y-0.5">
        {todosSemCusto ? (
          <>
            <p className="font-medium">
              Nenhum dos {num(total)} {substantivoPlural} exibidos tem custo cadastrado
            </p>
            <p>
              Sem CMV não existe margem: <strong>nenhuma margem desta tela pode ser considerada</strong>.
              Os valores de margem aparecem como <span className="tabular-nums">—</span> porque são
              indefinidos — não zero, não negativos: desconhecidos.
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">
              {num(semCusto)} de {num(total)} {substantivoPlural} exibidos estão sem custo cadastrado
              {pctSemCusto != null ? ` (${pct(pctSemCusto)})` : ""}
            </p>
            <p>
              A margem desses {substantivoPlural} é <strong>indefinida</strong> — não é zero e não é
              negativa: é desconhecida. Eles aparecem com{" "}
              <span className="tabular-nums">—</span> e não entram em nenhuma conclusão de
              rentabilidade.
            </p>
          </>
        )}
        {destinoCadastro && (
          <p>
            <a href={destinoCadastro} className="underline font-medium">
              Cadastrar custos →
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
