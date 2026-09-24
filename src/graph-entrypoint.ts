/**
 * LangGraph platform entrypoint — a compiled agent for `langgraph dev` /
 * LangGraph Studio (langgraph.json references `./src/graph-entrypoint.ts:agent`).
 */
import { buildChampionsAgent } from "./agent.js";

export const agent = buildChampionsAgent();
