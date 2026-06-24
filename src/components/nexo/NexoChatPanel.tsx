import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNexoChat, type ChatMsg } from "@/hooks/useNexoChat";

interface NexoChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * NexoChatPanel — Sheet lateral com a conversa multi-turno do Nexo (NEXO-01).
 *
 * - Usa useNexoChat() para messages/send/loading/error (histórico efêmero, NEXO-04).
 * - Render anti-XSS: o texto de cada mensagem é split por \n em <p> (React escapa);
 *   SEM markdown renderer e SEM injeção de HTML cru (postura da Phase 53, T-57-13).
 * - Read-only: nenhum botão dispara mutação no ML. Ação concreta é encaminhada ao
 *   fluxo de aprovação (Phase 54), nunca executada daqui.
 */
export function NexoChatPanel({ open, onOpenChange }: NexoChatPanelProps) {
  const { messages, send, loading } = useNexoChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para a última mensagem / indicador de digitação.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);

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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md md:max-w-lg"
      >
        {/* ── Cabeçalho ──────────────────────────────────────────────────── */}
        <SheetHeader className="shrink-0 space-y-0 border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
            Nexo
          </SheetTitle>
        </SheetHeader>

        {/* ── Corpo: lista de mensagens ──────────────────────────────────── */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col gap-3 px-4 py-4">
            {messages.length === 0 && (
              <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Olá, sou o Nexo — seu consultor.</p>
                <p className="mt-1">
                  Pergunte sobre margem, anúncios, estoque, ads ou reputação da sua operação.
                  Eu leio seus dados e sugiro o próximo passo — você decide e aprova.
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

            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* ── Footer: input + enviar ─────────────────────────────────────── */}
        <div className="shrink-0 border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte ao Nexo…"
              rows={1}
              className="min-h-[44px] max-h-32 resize-none"
              aria-label="Mensagem para o Nexo"
            />
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={loading || !input.trim()}
              aria-label="Enviar mensagem"
              className="h-11 w-11 shrink-0"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Bolha de mensagem. O texto é renderizado como parágrafos via split("\n") —
 * sem markdown renderer e sem injeção de HTML cru (anti-XSS, T-57-13).
 */
function ChatBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";
  const text = msg.parts.map((p) => p.text).join("");
  const paragraphs = text
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div
      className={cn(
        "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed",
        isUser
          ? "self-end bg-primary text-primary-foreground"
          : "self-start bg-muted text-foreground",
      )}
    >
      <div className="flex flex-col gap-1.5">
        {paragraphs.length > 0
          ? paragraphs.map((p, i) => <p key={i}>{p}</p>)
          : <p>{text}</p>}
      </div>
    </div>
  );
}
