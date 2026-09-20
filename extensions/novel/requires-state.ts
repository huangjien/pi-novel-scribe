/**
 * Per-route `requires_state` enforcement. ADR-0004 / route.yaml
 * declares strings like `chapters.next_unapproved`. This module
 * evaluates them against the novel repo.
 *
 * If any `requires_state` is unsatisfied, the LLM-driven dispatch
 * gets a clear "missing preconditions" message; the deterministic
 * fallback (slash command in -p mode) emits a notification.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import * as yaml from "js-yaml"
import { validateTemplateRefs } from "../wiki/context.ts"
import { readCharacterBeliefs } from "./continuity.ts"

export interface RequiresStateCheck {
	readonly requirement: string
	readonly satisfied: boolean
	readonly reason: string
}

export interface RequiresStateReport {
	readonly satisfied: boolean
	readonly checks: readonly RequiresStateCheck[]
	readonly failed: readonly RequiresStateCheck[]
}

const CHECKERS: Record<string, (novelRepo: string) => RequiresStateCheck> = {
	"chapters.next_unapproved": checkChaptersNextUnapproved,
	"chapters.drafted_or_approved": checkChaptersDraftedOrApproved,
	"chapters.reviewed": checkChaptersReviewed,
	"chapters.plan_template_refs": checkChaptersPlanTemplateRefs,
	"workflow.pending_approval": checkWorkflowPendingApproval,
}

export function checkRequiresState(
	novelRepo: string,
	requirements: readonly string[],
): RequiresStateReport {
	const checks: RequiresStateCheck[] = []
	for (const req of requirements) {
		const checker = CHECKERS[req]
		if (!checker) {
			checks.push({
				requirement: req,
				satisfied: false,
				reason: `unknown requirement: "${req}" (not registered in requires-state.ts)`,
			})
			continue
		}
		checks.push(checker(novelRepo))
	}
	const failed = checks.filter((c) => !c.satisfied)
	return {
		satisfied: failed.length === 0,
		checks,
		failed,
	}
}

const CHAPTERS_DIR = "chapters"
const STATUSES = ["approved", "canonized", "drafted"] as const

type ChapterStatus = (typeof STATUSES)[number]

function readChapterStatus(frontmatter: string): ChapterStatus | null {
	for (const line of frontmatter.split("\n")) {
		const colon = line.indexOf(":")
		if (colon === -1) continue
		const key = line.slice(0, colon).trim()
		if (key !== "status") continue
		const value = line.slice(colon + 1).trim()
		if (value === "approved" || value === "canonized" || value === "drafted") {
			return value
		}
		return null
	}
	return null
}

function readFrontmatter(content: string): string | null {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
	if (!m || m[1] === undefined) return null
	return m[1]
}

function findChapterFiles(novelRepo: string): readonly string[] {
	const dir = join(novelRepo, CHAPTERS_DIR)
	if (!existsSync(dir)) return []
	return readdirSync(dir).filter((f) => f.endsWith(".md"))
}

function checkChaptersPlanTemplateRefs(novelRepo: string): RequiresStateCheck {
	const files = findChapterFiles(novelRepo)
	for (const file of files) {
		const path = join(novelRepo, CHAPTERS_DIR, file)
		const raw = readFileSync(path, "utf8")
		const fm = readFrontmatter(raw)
		if (fm === null) continue
		const status = readChapterStatus(fm)
		if (status === "approved" || status === "canonized") continue
		const plan = extractPlanFromFrontmatter(fm)
		if (plan === null || Object.keys(plan).length === 0) {
			return {
				requirement: "chapters.plan_template_refs",
				satisfied: true,
				reason: `${file} has no plan yet — Planner enforces template_refs at creation (Q22)`,
			}
		}
		const check = validateTemplateRefs(plan)
		return {
			requirement: "chapters.plan_template_refs",
			satisfied: check.valid,
			reason: `${file}: ${check.reason}`,
		}
	}
	return {
		requirement: "chapters.plan_template_refs",
		satisfied: true,
		reason: "no writable chapter found — nothing to validate",
	}
}

function extractPlanFromFrontmatter(fm: string): Record<string, unknown> | null {
	try {
		const parsed = yaml.load(fm)
		if (typeof parsed !== "object" || parsed === null) return null
		const plan = (parsed as Record<string, unknown>).plan
		if (typeof plan !== "object" || plan === null) return null
		return plan as Record<string, unknown>
	} catch {
		return null
	}
}

function checkChaptersNextUnapproved(novelRepo: string): RequiresStateCheck {
	const files = findChapterFiles(novelRepo)
	for (const file of files) {
		const path = join(novelRepo, CHAPTERS_DIR, file)
		const raw = readFileSync(path, "utf8")
		const fm = readFrontmatter(raw)
		if (fm === null) continue
		const status = readChapterStatus(fm)
		if (status === null) {
			return {
				requirement: "chapters.next_unapproved",
				satisfied: true,
				reason: `${file} has no status set yet — ready to write`,
			}
		}
		if (status !== "approved" && status !== "canonized") {
			return {
				requirement: "chapters.next_unapproved",
				satisfied: true,
				reason: `chapter ${file} is in status=${status}, available to write`,
			}
		}
	}
	return {
		requirement: "chapters.next_unapproved",
		satisfied: false,
		reason: "all chapters are approved or canonized — nothing to write",
	}
}

function checkChaptersDraftedOrApproved(novelRepo: string): RequiresStateCheck {
	const files = findChapterFiles(novelRepo)
	for (const file of files) {
		const path = join(novelRepo, CHAPTERS_DIR, file)
		const raw = readFileSync(path, "utf8")
		const fm = readFrontmatter(raw)
		if (fm === null) continue
		const status = readChapterStatus(fm)
		if (status === "drafted" || status === "approved") {
			return {
				requirement: "chapters.drafted_or_approved",
				satisfied: true,
				reason: `chapter ${file} is status=${status}`,
			}
		}
	}
	return {
		requirement: "chapters.drafted_or_approved",
		satisfied: false,
		reason: "no chapter in status=drafted or status=approved",
	}
}

function checkChaptersReviewed(novelRepo: string): RequiresStateCheck {
	const dir = join(novelRepo, CHAPTERS_DIR)
	if (!existsSync(dir)) {
		return {
			requirement: "chapters.reviewed",
			satisfied: false,
			reason: "no chapters directory",
		}
	}
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".md")) continue
		const path = join(dir, file)
		const raw = readFileSync(path, "utf8")
		if (!raw.includes("review:")) continue
		if (!raw.includes("reviewedAt")) continue
		return {
			requirement: "chapters.reviewed",
			satisfied: true,
			reason: `chapter ${file} has a review: frontmatter`,
		}
	}
	return {
		requirement: "chapters.reviewed",
		satisfied: false,
		reason: "no chapter has a review: frontmatter field",
	}
}

function checkWorkflowPendingApproval(novelRepo: string): RequiresStateCheck {
	const dir = join(novelRepo, "state", "canon-changes")
	if (!existsSync(dir)) {
		return {
			requirement: "workflow.pending_approval",
			satisfied: false,
			reason: "no canon-changes directory",
		}
	}
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".draft")) continue
		try {
			const raw = readFileSync(join(dir, file), "utf8")
			const parsed: unknown = yaml.load(raw)
			if (typeof parsed === "object" && parsed !== null) {
				const obj = parsed as { status?: unknown }
				if (obj.status === "validated" || obj.status === "draft") {
					return {
						requirement: "workflow.pending_approval",
						satisfied: true,
						reason: `pending draft ${file}`,
					}
				}
			}
		} catch {}
	}
	return {
		requirement: "workflow.pending_approval",
		satisfied: false,
		reason: "no pending canon-changes drafts awaiting approval",
	}
}

void readCharacterBeliefs
