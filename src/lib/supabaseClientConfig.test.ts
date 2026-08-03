import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Lê o arquivo do disco em vez de importar o módulo: o que importa aqui é o
// texto-fonte, não o comportamento em runtime (import.meta.env não existe
// fora do bundler). É este teste, e não a edição manual, que sustenta a
// limpeza no tempo — se a plataforma Lovable regenerar o arquivo com o valor
// de reserva de volta, este teste fica vermelho no mesmo dia.
const __dirname = dirname(fileURLToPath(import.meta.url));
const clientFilePath = resolve(__dirname, "../integrations/supabase/client.ts");
const content = readFileSync(clientFilePath, "utf-8");

describe("src/integrations/supabase/client.ts — sem valor de reserva (SEC-10)", () => {
  it("não tem coalescência (??) sobre a leitura de VITE_SUPABASE_URL", () => {
    expect(content).not.toMatch(/VITE_SUPABASE_URL\s*\?\?/);
  });

  it("não tem coalescência (??) sobre a leitura de VITE_SUPABASE_PUBLISHABLE_KEY", () => {
    expect(content).not.toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY\s*\?\?/);
  });

  it("não tem identificador de projeto Supabase escrito à mão (sequência longa de letras minúsculas em host .supabase.co)", () => {
    expect(content).not.toMatch(/[a-z]{15,}\.supabase\.co/);
  });

  it("não tem chave JWT anônima escrita à mão", () => {
    expect(content).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  });

  it("continua lendo as duas variáveis diretamente de import.meta.env", () => {
    expect(content).toMatch(/import\.meta\.env\.VITE_SUPABASE_URL/);
    expect(content).toMatch(/import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY/);
  });
});
