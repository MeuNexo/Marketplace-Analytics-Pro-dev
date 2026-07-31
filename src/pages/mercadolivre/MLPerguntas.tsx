import { useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { format, parseISO, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  MessageCircleQuestion, Clock, CheckCircle2, AlertTriangle,
  Plug, RefreshCw, MessageSquare, Send,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KPICard } from "@/components/dashboard/KPICard";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { useMLStore } from "@/contexts/MLStoreContext";
import { useMLQuestions } from "@/hooks/useMLQuestions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Daily chart helper ───────────────────────────────────────────────────────

function buildDailyQuestions(rows: Array<{ data_pergunta: string | null; status: string | null }>) {
  const today = new Date();
  const byDay = new Map<string, { total: number; answered: number }>();
  // Initialize last 30 days
  for (let i = 29; i >= 0; i--) {
    const day = format(subDays(today, i), "yyyy-MM-dd");
    byDay.set(day, { total: 0, answered: 0 });
  }
  for (const row of rows) {
    const day = row.data_pergunta?.substring(0, 10);
    if (!day || !byDay.has(day)) continue;
    const cur = byDay.get(day)!;
    cur.total++;
    if (row.status === "ANSWERED") cur.answered++;
  }
  return Array.from(byDay.entries()).map(([date, counts]) => ({
    date: format(parseISO(date), "dd/MM", { locale: ptBR }),
    Total: counts.total,
    Respondidas: counts.answered,
  }));
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function NotConnected() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Plug className="w-16 h-16 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">Mercado Livre não conectado</h2>
        <p className="text-muted-foreground text-sm">Conecte sua conta para acessar as perguntas dos seus anúncios.</p>
        <Button asChild><Link to="/integracoes">Conectar conta</Link></Button>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MLPerguntas() {
  const { stores, selectedStore } = useMLStore();
  const { data: questions = [], isLoading, refetch } = useMLQuestions();

  const connected = stores.length > 0;
  const storeId = selectedStore !== "all" && selectedStore ? selectedStore : stores[0]?.ml_user_id ?? null;

  // ─── Inline reply state (D-04/05/06) ─────────────────────────────────────
  const [answeringId, setAnsweringId] = useState<number | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [replying, setReplying] = useState(false);

  // ─── Derived data ─────────────────────────────────────────────────────────
  const pending = useMemo(() => questions.filter((q) => q.status === "UNANSWERED"), [questions]);
  const answered = useMemo(() => questions.filter((q) => q.status === "ANSWERED"), [questions]);

  const chartData = useMemo(() => buildDailyQuestions(questions), [questions]);

  const summary = useMemo(() => {
    const total = questions.length;
    const pendingCount = pending.length;
    const answeredCount = answered.length;
    const answerRate = total > 0 ? Math.round((answeredCount / total) * 1000) / 10 : 0;
    const gt24h = pending.filter((q) => {
      if (!q.data_pergunta) return false;
      const diff = Date.now() - new Date(q.data_pergunta).getTime();
      return diff > 24 * 60 * 60 * 1000;
    }).length;
    return {
      total_30d: total,
      pending: pendingCount,
      answered: answeredCount,
      answer_rate: answerRate,
      unanswered_gt_24h: gt24h,
    };
  }, [questions, pending, answered]);

  // ─── Reply handler (D-05/06) ──────────────────────────────────────────────
  async function handleSendReply() {
    if (!answeringId || !answerText.trim()) return;
    const row = questions.find((q) => q.question_id === answeringId);
    if (!row) return;

    setReplying(true);
    try {
      const { error } = await supabase.functions.invoke("reply-ml-question", {
        body: {
          question_id: answeringId,
          text: answerText.trim(),
          ml_user_id: row.ml_user_id,
        },
      });
      if (error) throw new Error(error.message ?? "Erro desconhecido");
      toast.success("Resposta enviada com sucesso");
      setAnsweringId(null);
      setAnswerText("");
      setConfirmingId(null);
      await refetch();
    } catch (err: any) {
      toast.error(`Erro ao enviar resposta: ${err.message ?? "Tente novamente"}`);
    } finally {
      setReplying(false);
    }
  }

  function handleCancelReply() {
    setAnsweringId(null);
    setAnswerText("");
    setConfirmingId(null);
  }

  if (!connected) return <NotConnected />;

  const charCount = answerText.length;
  const charLimitOk = charCount > 0 && charCount <= 2000;

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <MLPageHeader title="Perguntas" lastUpdated={null} />
          {summary.pending > 0 && (
            <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 gap-1">
              <AlertTriangle className="w-3 h-3" /> {summary.pending} pendentes
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading}
            onClick={() => refetch()}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Perguntas pendentes"
          value={String(summary.pending)}
          variant="minimal"
          iconClassName={summary.pending === 0 ? "bg-success/10 text-success" : summary.pending <= 5 ? "bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]" : "bg-destructive/10 text-destructive"}
          size="compact"
          icon={<MessageCircleQuestion className="w-4 h-4" />}
          subtitle="Aguardando resposta"
        />
        <KPICard
          title="Taxa de resposta"
          value={`${summary.answer_rate.toFixed(1)}%`}
          variant="minimal"
          iconClassName={summary.answer_rate >= 95 ? "bg-success/10 text-success" : "bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,53%)]"}
          size="compact"
          icon={<CheckCircle2 className="w-4 h-4" />}
          subtitle="Perguntas respondidas"
        />
        <KPICard
          title="Respondidas"
          value={String(summary.answered)}
          variant="minimal"
          iconClassName="bg-success/10 text-success"
          size="compact"
          icon={<Clock className="w-4 h-4" />}
          subtitle="Total respondidas"
        />
        <KPICard
          title="Total de perguntas"
          value={String(summary.total_30d)}
          variant="minimal"
          iconClassName="bg-primary/10 text-primary"
          size="compact"
          icon={<MessageSquare className="w-4 h-4" />}
          subtitle="Na base de dados"
        />
      </div>

      {/* Alert for unanswered > 24h */}
      {summary.unanswered_gt_24h > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-600">
                {summary.unanswered_gt_24h}{" "}
                {summary.unanswered_gt_24h === 1
                  ? "pergunta sem resposta há mais de 24h"
                  : "perguntas sem resposta há mais de 24h"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Perguntas sem resposta prejudicam sua reputação. Responda o quanto antes.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <span className="text-sm font-medium text-foreground">Volume de perguntas — últimos 30 dias</span>
        </div>
        <CardContent className="px-4 pb-2 pt-0">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradAnswered" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
              <YAxis tick={{ fontSize: 10 }} />
              <RechartsTooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
              />
              <Area dataKey="Total" stroke="hsl(var(--accent))" fill="url(#gradTotal)" strokeWidth={2} />
              <Area dataKey="Respondidas" stroke="hsl(var(--success))" fill="url(#gradAnswered)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Questions list */}
      <Card>
        <div className="px-4 pt-4 pb-3">
          <span className="text-sm font-medium text-foreground">Perguntas</span>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <RefreshCw className="w-10 h-10 opacity-30 animate-spin" />
              <p className="text-sm">Carregando perguntas...</p>
            </div>
          ) : questions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <RefreshCw className="w-10 h-10 opacity-30" />
              <p className="text-sm font-medium">Sincronizando perguntas</p>
              <p className="text-xs">Volte em alguns minutos após a primeira sincronização</p>
            </div>
          ) : (
            <Tabs defaultValue="pending">
              <div className="px-6 pt-2 pb-0 border-b border-border">
                <TabsList className="h-9 bg-transparent p-0 gap-4">
                  <TabsTrigger
                    value="pending"
                    className="h-9 px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm"
                  >
                    Pendentes ({pending.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="answered"
                    className="h-9 px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm"
                  >
                    Respondidas ({answered.length})
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="pending" className="mt-0">
                {pending.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                    <CheckCircle2 className="w-10 h-10 opacity-30" />
                    <p className="text-sm">Nenhuma pergunta pendente</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {pending.map((entry) => (
                      <div key={entry.question_id} className="px-6 py-4">
                        <div className="flex items-start justify-between gap-3 mb-1.5">
                          <p className="text-xs text-muted-foreground truncate">{entry.item_title ?? entry.item_id ?? "—"}</p>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {entry.data_pergunta ? format(parseISO(entry.data_pergunta), "dd/MM/yy") : "—"}
                          </span>
                        </div>
                        {/* Buyer text rendered as plain text — no dangerouslySetInnerHTML (T-42-08) */}
                        <p className="text-sm font-medium text-foreground">{entry.texto ?? "—"}</p>

                        {/* Inline reply (D-04) */}
                        {answeringId === entry.question_id ? (
                          <div className="mt-3 space-y-2">
                            <Textarea
                              value={answerText}
                              onChange={(e) => setAnswerText(e.target.value)}
                              placeholder="Digite sua resposta..."
                              className="text-sm resize-none"
                              rows={3}
                              maxLength={2000}
                              autoFocus
                            />
                            <div className="flex items-center justify-between gap-2">
                              {/* Char counter (D-06) */}
                              <span className={`text-xs ${charCount > 2000 ? "text-destructive" : "text-muted-foreground"}`}>
                                {charCount}/2000
                              </span>
                              <div className="flex gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleCancelReply}
                                  disabled={replying}
                                >
                                  Cancelar
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={!charLimitOk || replying}
                                  onClick={() => setConfirmingId(entry.question_id)}
                                >
                                  <Send className="w-3.5 h-3.5 mr-1.5" />
                                  Responder
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 mt-2">
                            <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 text-xs">
                              Aguardando resposta
                            </Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-6 px-2"
                              onClick={() => {
                                setAnsweringId(entry.question_id);
                                setAnswerText("");
                              }}
                            >
                              Responder
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="answered" className="mt-0">
                <div className="divide-y divide-border">
                  {answered.slice(0, 10).map((entry) => (
                    <div key={entry.question_id} className="px-6 py-4">
                      <div className="flex items-start justify-between gap-3 mb-1.5">
                        <p className="text-xs text-muted-foreground truncate">{entry.item_title ?? entry.item_id ?? "—"}</p>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {entry.data_pergunta ? format(parseISO(entry.data_pergunta), "dd/MM/yy") : "—"}
                        </span>
                      </div>
                      {/* Buyer text — plain text only, no dangerouslySetInnerHTML (T-42-08) */}
                      <p className="text-sm font-medium text-foreground">{entry.texto ?? "—"}</p>
                      {entry.resposta && (
                        <p className="text-sm text-muted-foreground mt-1.5 pl-3 border-l-2 border-border">
                          {entry.resposta}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* Confirm dialog (D-05) */}
      <AlertDialog open={confirmingId !== null} onOpenChange={(open) => { if (!open) setConfirmingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar resposta</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. A resposta será enviada ao comprador e não poderá ser editada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmingId(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleSendReply} disabled={replying}>
              {replying ? "Enviando..." : "Enviar resposta"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
