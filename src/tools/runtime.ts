/**
 * Runtime access helpers shared by all agent tools.
 *
 * The user identity namespaces the durable set store; the thread id namespaces
 * thread-scoped staging (proposals, search results, evidence).
 */
import type { ToolRunnableConfig } from "@langchain/core/tools";
import type { BaseStore } from "@langchain/langgraph";

export function getUserId(runtime: ToolRunnableConfig): string {
  const ctx = runtime.context as { userId?: string } | undefined;
  const fromConfig = runtime.configurable?.userId as string | undefined;
  return ctx?.userId ?? fromConfig ?? "default";
}

export function getThreadId(runtime: ToolRunnableConfig): string {
  return (runtime.configurable?.thread_id as string | undefined) ?? "default";
}

export function getStore(runtime: ToolRunnableConfig): BaseStore | null {
  return (runtime as { store?: BaseStore | null }).store ?? null;
}
