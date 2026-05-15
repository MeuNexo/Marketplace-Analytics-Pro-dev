/**
 * Brazilian state → region mapping for ICMS interestadual rules.
 *
 * Para Lucro Real, quando UF destino ≠ UF origem:
 *   - Origem em SP/RJ/MG/RS/SC/PR e destino em SP/RJ/MG/RS/SC/PR (exceto ES) → 12%
 *   - Demais combinações (destino N/NE/CO/ES) → 7%
 */

export type Region = "N" | "NE" | "CO" | "SE" | "S";

export const UF_REGION: Record<string, Region> = {
  // Norte
  AC: "N", AP: "N", AM: "N", PA: "N", RO: "N", RR: "N", TO: "N",
  // Nordeste
  AL: "NE", BA: "NE", CE: "NE", MA: "NE", PB: "NE", PE: "NE", PI: "NE", RN: "NE", SE: "NE",
  // Centro-Oeste
  DF: "CO", GO: "CO", MT: "CO", MS: "CO",
  // Sudeste
  ES: "SE", MG: "SE", RJ: "SE", SP: "SE",
  // Sul
  PR: "S", RS: "S", SC: "S",
};

/** Returns true if the destination should use the lower 7% interstate ICMS rate. */
export function isReducedInterstateDest(uf: string | null | undefined): boolean {
  if (!uf) return false;
  if (uf === "ES") return true;
  const r = UF_REGION[uf];
  return r === "N" || r === "NE" || r === "CO";
}

export const UF_LIST = Object.keys(UF_REGION).sort();