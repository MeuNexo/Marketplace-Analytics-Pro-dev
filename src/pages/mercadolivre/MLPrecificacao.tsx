import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MLPageHeader } from "@/components/mercadolivre/MLPageHeader";
import { SimuladorPrecificacao } from "@/components/mercadolivre/precificacao/SimuladorPrecificacao";

const TABS = [
  { id: "simulador", label: "Simulador" },
] as const;

type TabId = typeof TABS[number]["id"];

export default function MLPrecificacao() {
  const [tab, setTab] = useState<TabId>("simulador");

  return (
    <div className="space-y-6">
      <MLPageHeader title="Precificação" lastUpdated={null}>
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

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {tab === "simulador" && <SimuladorPrecificacao />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}