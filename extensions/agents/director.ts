/**
 * Director agent stub — the orchestrator's own tool shape.
 * Per route.yaml and ADR-0004, the Director has a route-table router +
 * LLM fallback. The actual router logic lives in
 * extensions/orchestrator/director.ts (which this stub re-exports
 * the registration for under the agent module).
 *
 * Phase 2 wires both: this file is a thin re-export so the agent
 * manifest matches route.yaml's `subagents` list (one file per agent).
 */

export { registerDirectorTool as registerDirectorAgent } from "../orchestrator/director.ts"
