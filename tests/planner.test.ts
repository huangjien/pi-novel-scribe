import { describe, expect, it } from "vitest"
import { extractYamlBlock } from "../extensions/agents/planner.ts"

describe("extractYamlBlock", () => {
	it("extracts a simple ```yaml block", () => {
		const raw = "Some prose\n```yaml\nplan:\n  objective: foo\n```\nMore prose"
		expect(extractYamlBlock(raw)).toBe("plan:\n  objective: foo")
	})

	it("extracts a ```yml block too", () => {
		const raw = "```yml\nplan:\n  goal: bar\n```"
		expect(extractYamlBlock(raw)).toBe("plan:\n  goal: bar")
	})

	it("returns null when no fenced block is present", () => {
		expect(extractYamlBlock("just prose, no fence")).toBeNull()
	})

	it("returns null when there are fences but no yaml tag", () => {
		expect(extractYamlBlock("```js\nconst x = 1;\n```")).toBeNull()
	})

	it("handles whitespace around the fence opening", () => {
		const raw = "```  yaml\nplan: a\n```"
		expect(extractYamlBlock(raw)).toBe("plan: a")
	})

	it("matches case-insensitively", () => {
		const raw = "```YAML\nplan: a\n```"
		expect(extractYamlBlock(raw)).toBe("plan: a")
	})

	it("captures only the first fenced block", () => {
		const raw = "```yaml\nfirst: block\n```\n```yaml\nsecond: block\n```"
		expect(extractYamlBlock(raw)).toBe("first: block")
	})
})
