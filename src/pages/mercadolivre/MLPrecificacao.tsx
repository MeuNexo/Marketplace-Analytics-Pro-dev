import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SimuladorPrecificacao } from "@/components/mercadolivre/precificacao/SimuladorPrecificacao";
import { AnaliseDashboard } from "@/components/mercadolivre/analise/AnaliseDashboard";
// RE-05: a margem teórica do catálogo mudou de endereço. Ela vivia em
// `/anuncios`, mas responde "se eu vender por X, quanto sobra" — pergunta de
// precificação, não de operação de catálogo. Ver o cabeçalho do componente.
import { MargemTeoricaCatalogo } from "@/components/mercadolivre/precificacao/MargemTeoricaCatalogo";

const TABS = [
  { id: "simulador", label: "Simulador" },
  { id: "analise",   label: "Análise" },
  { id: "margem",    label: "Margem Teórica" },
] as const;

type TabId = typeof TABS[number]["id"];

export default function MLPrecificacao() {
  const [tab, setTab] = useState<TabId>("simulador");

  return (
    <div className="space-y-5">
      <div className="sticky -top-4 md:-top-6 lg:-top-8 z-20 -mx-4 md:-mx-6 lg:-mx-8 -mt-4 md:-mt-6 lg:-mt-8 px-4 md:px-6 lg:px-8 pb-4 pt-4 bg-background/95 backdrop-blur-sm border-b border-border/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 min-w-0">
          <MLPageHeader title="Precificação" lastUpdated={null} />
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
            <TabsList className="h-8">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="text-xs px-3 h-7">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
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
          {tab === "analise" && <AnaliseDashboard />}
          {tab === "margem" && <MargemTeoricaCatalogo />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}