import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Sparkles, Send, Loader2, X, MessageSquarePlus, History, Brain, Check, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ChatMarkdown } from "@/components/nexo/ChatMarkdown";
import { useNexoChat, type ChatMsg } from "@/hooks/useNexoChat";
import { useNexoMemory } from "@/hooks/useNexoMemory";

interface NexoChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * NexoChatPanel — popup FLUTUANTE compacto com a conversa multi-turno do Nexo (NEXO-01).
 *
 * - Balão fixo no canto inferior direito (não ocupa a tela toda), com animação de
 *   entrada/saída (framer-motion). Em telas estreitas, ocupa quase a largura toda.
 * - Usa useNexoChat() para messages/send/loading (histórico efêmero, NEXO-04).
 * - Render seguro via ChatMarkdown (subconjunto de markdown → nós React; SEM
 *   dangerouslySetInnerHTML, anti-XSS T-57-13). Mensagens do usuário ficam em texto puro.
 * - Read-only: nenhum botão dispara mutação no ML; ação concreta é encaminhada ao
 *   fluxo de aprovação (Phase 54), nunca executada daqui.
 */
export function NexoChatPanel({ open, onOpenChange }: NexoChatPanelProps) {
  const {
    messages, send, loading, conversations, openConversation, newConversation,
  } = useNexoChat();
  const { pending, approve, discard } = useNexoMemory();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para a última mensagem / indicador de digitação.
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading, open]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    try {
      await send(text);
    } catch {
      toast.error("Não consegui responder agora. Tente novamente em instantes.");
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia; Shift+Enter quebra linha.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className={cn(
            "fixed bottom-24 right-4 z-50 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-[var(--shadow-glow)]",
            "h-[min(70vh,560px)] w-[min(380px,calc(100vw-2rem))]",
          )}
          role="dialog"
          aria-label="Chat com o Nexo"
        >
          {/* ── Cabeçalho ──────────────────────────────────────────────────── */}
          <div className="flex shrink-0 items-center justify-between border-b bg-muted/30 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4.5 w-4.5 text-primary shrink-0" />
              <span className="text-sm font-semibold">Nexo</span>
              <span className="text-xs text-muted-foreground">· seu consultor</span>
            </div>
            <div className="flex items-center gap-0.5">
              {/* Conversas salvas (Phase 106) — o histórico deixou de ser efêmero */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Conversas anteriores"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <History className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                  <DropdownMenuLabel>Conversas anteriores</DropdownMenuLabel>
                  {conversations.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhuma conversa salva ainda.
                    </div>
                  )}
                  {conversations.map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      onClick={() => void openConversation(c.id)}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="line-clamp-1 text-sm">{c.title || "Sem título"}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(c.updated_at).toLocaleDateString("pt-BR")}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <button
                type="button"
                onClick={newConversation}
                aria-label="Nova conversa"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Fechar"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── Corpo: lista de mensagens ──────────────────────────────────── */}
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-3 px-3 py-3">
              {messages.length === 0 && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Olá, sou o Nexo.</p>
                  <p className="mt-1">
                    Pergunte sobre margem, anúncios, estoque, ads ou reputação. Eu leio seus
                    dados e sugiro o próximo passo — você decide e aprova.
                  </p>
                </div>
              )}

              {messages.map((msg, i) => (
                <ChatBubble key={i} msg={msg} />
              ))}

              {loading && (
                <div className="flex items-center gap-2 self-start text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Nexo está pensando…</span>
                </div>
              )}

              {/* Propostas de memória (Phase 106): nada entra sem o clique do lojista */}
              {pending.map((m) => (
                <div
                  key={m.id}
                  className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Brain className="h-3.5 w-3.5" />
                    O Nexo quer lembrar disso
                  </div>
                  <p className="mt-1.5 font-medium text-foreground">{m.title}</p>
                  <p className="mt-0.5 text-muted-foreground">{m.body}</p>
                  {m.has_numbers && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Contém número — será tratado como pista histórica, nunca como valor atual.
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        void approve(m.id).then(() => toast.success("Memória aprovada."));
                      }}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => {
                        void discard(m.id).then(() => toast("Proposta descartada."));
                      }}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Descartar
                    </Button>
                  </div>
                </div>
              ))}

              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* ── Footer: input + enviar ─────────────────────────────────────── */}
          <div className="shrink-0 border-t p-2.5">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pergunte ao Nexo…"
                rows={1}
                className="min-h-[40px] max-h-28 resize-none text-sm"
                aria-label="Mensagem para o Nexo"
              />
              <Button
                type="button"
                size="icon"
                onClick={handleSend}
                disabled={loading || !input.trim()}
                aria-label="Enviar mensagem"
                className="h-10 w-10 shrink-0"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Bolha de mensagem. Usuário → texto puro (split \n). Nexo → ChatMarkdown (subconjunto
 * seguro de markdown, sem HTML cru — anti-XSS T-57-13).
 */
function ChatBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";
  const text = msg.parts.map((p) => p.text).join("");

  return (
    <div
      className={cn(
        "max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
        isUser
          ? "self-end rounded-br-sm bg-primary text-primary-foreground"
          : "self-start rounded-bl-sm bg-muted text-foreground",
      )}
    >
      {isUser ? (
        <div className="flex flex-col gap-1.5">
          {text.split("\n").map((p, i) => <p key={i}>{p}</p>)}
        </div>
      ) : (
        <ChatMarkdown text={text} />
      )}
    </div>
  );
}
