/**
 * Web research fallback (provenance "WEB").
 *
 * The deterministic Dex/Meta engine is authoritative. This tool exists only
 * for data the engine does not hold — e.g. usage/"threats" meta — and it is
 * deliberately scoped to dependable sources. Every result carries its source
 * URL and is labeled WEB provenance so it is never mistaken for DEX/ENGINE
 * fact.
 */
import { tool } from "langchain";
import { TavilySearch } from "@langchain/tavily";
import { z } from "zod";

export interface ThreatSource {
  name: string;
  domain: string;
  description: string;
}

/** Dependable go-to sources for Champions competitive meta. */
export const THREAT_SOURCES: ThreatSource[] = [
  { name: "Pikalytics", domain: "pikalytics.com", description: "Usage statistics and moveset spreads." },
  { name: "MunchStats", domain: "munchstats.com", description: "Ranked-ladder meta aggregation and matchup data." },
  { name: "Limitless TCG", domain: "play.limitlesstcg.com", description: "Tournament results, team sheets, and usage." },
  { name: "Smogon", domain: "smogon.com", description: "Competitive analysis and strategy dex." },
  { name: "Bulbapedia", domain: "bulbapedia.bulbagarden.net", description: "Canonical game data." },
  { name: "Serebii", domain: "serebii.net", description: "Canonical game data and event coverage." },
  { name: "Pokémon HOME", domain: "news.pokemon-home.com", description: "Official Regulation Set announcements." },
];

const DEFAULT_DOMAINS = THREAT_SOURCES.map((s) => s.domain);

export const webSearchTool = tool(
  async (args: { query: string; domains?: string[]; maxResults?: number }) => {
    if (!process.env.TAVILY_API_KEY) {
      return JSON.stringify({
        provenance: "WEB",
        error:
          "Web research is not configured (TAVILY_API_KEY missing). The deterministic Dex/Meta tools are authoritative; set TAVILY_API_KEY to enable this fallback.",
      });
    }
    try {
      const search = new TavilySearch({
        maxResults: args.maxResults ?? 5,
        includeDomains: args.domains && args.domains.length > 0 ? args.domains : DEFAULT_DOMAINS,
        searchDepth: "basic",
      });
      const raw = await search.invoke({ query: args.query });
      const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as { results?: unknown };
      return JSON.stringify({
        provenance: "WEB",
        note: "Unverified external data — cite the source; never present as DEX/ENGINE fact.",
        query: args.query,
        retrievedAt: new Date().toISOString(),
        results: parsed?.results ?? parsed,
      });
    } catch (e) {
      return JSON.stringify({ provenance: "WEB", error: (e as Error).message });
    }
  },
  {
    name: "web_search",
    description: `Web research fallback for data the deterministic engine does not provide (e.g. usage/"threats" meta). Searches only dependable sources by default: ${THREAT_SOURCES.map(
      (s) => `${s.name} (${s.domain})`,
    ).join(", ")}. Returns WEB-provenance results with source URLs — cite the source; never treat them as deterministic DEX/ENGINE facts.`,
    schema: z.object({
      query: z.string().describe("Search query, e.g. 'Annihilape usage stats Regulation M-C'."),
      domains: z.array(z.string()).optional().describe("Domains to restrict to; defaults to the dependable Champions meta sources."),
      maxResults: z.number().int().min(1).max(10).optional(),
    }),
  },
);
