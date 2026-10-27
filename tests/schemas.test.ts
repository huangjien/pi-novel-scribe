/**
 * Tests for the P0 schema validators (extensions/novel/schemas.ts).
 *
 * The schema file is mostly TypeScript interfaces; the runtime surface
 * is `SchemaValidationError` + the four `validate*` guards used by
 * canon.ts and the novel-state loaders.
 */

import { describe, expect, it } from "vitest"
import {
	SchemaValidationError,
	validateEnum,
	validateNonEmpty,
	validateRecord,
	validateStringArray,
} from "../extensions/novel/schemas.ts"

const KINDS = ["character_belief_added", "world_fact_added"] as const

describe("SchemaValidationError", () => {
	it("prefixes the message with the schema path and exposes the path", () => {
		const err = new SchemaValidationError("expected string", "characters/sara/believes")
		expect(err).toBeInstanceOf(Error)
		expect(err.name).toBe("Error")
		expect(err.message).toBe("characters/sara/believes: expected string")
		expect(err.path).toBe("characters/sara/believes")
	})
})

describe("validateNonEmpty", () => {
	it("returns the value for non-empty strings", () => {
		expect(validateNonEmpty("sara", "id")).toBe("sara")
	})

	it("throws for non-strings", () => {
		for (const bad of [42, null, undefined, {}, []]) {
			expect(() => validateNonEmpty(bad, "id")).toThrow(SchemaValidationError)
			expect(() => validateNonEmpty(bad, "id")).toThrow(/id: expected string/)
		}
	})

	it("throws for empty strings", () => {
		expect(() => validateNonEmpty("", "id")).toThrow(SchemaValidationError)
		expect(() => validateNonEmpty("", "id")).toThrow(/id: must not be empty/)
	})
})

describe("validateEnum", () => {
	it("returns the value for allowed members", () => {
		expect(validateEnum("world_fact_added", KINDS, "kind")).toBe("world_fact_added")
	})

	it("throws for non-members, listing the allowed values", () => {
		expect(() => validateEnum("nope", KINDS, "kind")).toThrow(SchemaValidationError)
		expect(() => validateEnum("nope", KINDS, "kind")).toThrow(
			/kind: must be one of character_belief_added, world_fact_added/,
		)
	})

	it("throws for non-strings", () => {
		expect(() => validateEnum(42, KINDS, "kind")).toThrow(SchemaValidationError)
	})
})

describe("validateStringArray", () => {
	it("returns the array for string arrays", () => {
		expect(validateStringArray(["a", "b"], "believes")).toEqual(["a", "b"])
		expect(validateStringArray([], "believes")).toEqual([])
	})

	it("throws for non-arrays", () => {
		expect(() => validateStringArray("a", "believes")).toThrow(SchemaValidationError)
		expect(() => validateStringArray(null, "believes")).toThrow(/expected string\[\]/)
	})

	it("throws for arrays containing non-strings", () => {
		expect(() => validateStringArray(["a", 42], "believes")).toThrow(SchemaValidationError)
		expect(() => validateStringArray(["a", 42], "believes")).toThrow(/expected string\[\]/)
	})
})

describe("validateRecord", () => {
	it("returns the value for plain objects", () => {
		const obj = { believes: ["x"] }
		expect(validateRecord(obj, "payload")).toBe(obj)
	})

	it("throws for null", () => {
		expect(() => validateRecord(null, "payload")).toThrow(SchemaValidationError)
		expect(() => validateRecord(null, "payload")).toThrow(/payload: expected object/)
	})

	it("throws for arrays (not records)", () => {
		expect(() => validateRecord(["a"], "payload")).toThrow(SchemaValidationError)
	})

	it("throws for primitives", () => {
		expect(() => validateRecord("nope", "payload")).toThrow(SchemaValidationError)
		expect(() => validateRecord(7, "payload")).toThrow(SchemaValidationError)
	})
})
