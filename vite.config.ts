import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { assertRequiredEnv } from "./src/lib/requiredEnv";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // A Vercel injeta as variáveis do painel diretamente no processo, e elas
  // podem não existir como arquivo `.env` no momento do build — por isso
  // `process.env` é mesclado por cima de `loadEnv`, não o contrário.
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };

  // SEC-10: aborta a resolução da configuração (e portanto `vite build`,
  // com código de saída diferente de zero) se a configuração do projeto
  // Supabase certo não estiver presente e coerente. Vale também para
  // `vite dev` — deliberado: o `.env` local já tem os valores, então nunca
  // atrapalha, e quem não tiver `.env` descobre no primeiro comando.
  assertRequiredEnv(env);

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            "react-vendor": ["react", "react-dom", "react-router-dom"],
            supabase: ["@supabase/supabase-js"],
            charts: ["recharts"],
            motion: ["framer-motion"],
            query: ["@tanstack/react-query"],
            dates: ["date-fns"],
          },
        },
      },
    },
  };
});
