/**
 * Shared LLM output helpers. Extracted so multiple agents (Planner,
 * Critic, etc.) can use the same ```yaml fenced-block parsing.
 */

const YAML_BLOCK_RE = /```\s*(?:yaml|yml)\s*\n([\s\S]*?)```/i

/**
 * Extract the first ```yaml (or ```yml) fenced block from an LLM
 * response. Returns null if no such block is found.
 *
 * Case-insensitive language tag; tolerates whitespace before the
 * tag. Returns the trimmed body of the first match.
 */
export function extractYamlBlock(llmOutput: string): string | null {
	const m = YAML_BLOCK_RE.exec(llmOutput)
	if (!m || m[1] === undefined) return null
	return m[1].trim()
}
