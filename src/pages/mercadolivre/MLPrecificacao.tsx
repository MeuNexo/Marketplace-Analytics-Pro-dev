import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { SimuladorPrecificacao } from "@/components/mercadolivre/precificacao/SimuladorPrecificacao";

const TABS = [
  { id: "simulador", label: "Simulador" },
  { id: "analise",   label: "Análise" },
] as const;

type TabId = typeof TABS[number]["id"];

export default function MLPrecificacao() {
  const [tab, setTab] = useState<TabId>("simulador");

  return (
    <div className="space-y-5">
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <MLPageHeader title="Precificação">
          <div className="flex items-center gap-1 rounded-md border bg-card p-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  tab === t.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </MLPageHeader>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {tab === "simulador" && <SimuladorPrecificacao />}
          {tab === "analise" && (
            <div className="py-8 text-center text-muted-foreground">
              Carregando módulo de análise…
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}