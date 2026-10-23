import type { ImportSuggestionsReport, ProjectBundle, TestResult } from "../types/mod.ts";
import type { SlotLease } from "./leases.ts";
import type { ProductStackRow } from "./inspect.ts";

export interface AgentSnapshot {
  revision: string;
  templateId: string;
  projectId: string;
  appliedSlots: number;
  loops: number;
  unmappedMandatory: number;
  statusMessage: string;
  testOk: boolean | null;
  activeAgents?: number;
  unmappedMandatorySlotIds?: string[];
  sheetNames?: string[];
  productStack?: ProductStackRow[];
  leases?: SlotLease[];
  /** Agent writes refused because the person edited those slots during the agent's lease (newest last). */
  humanWins?: HumanWinsNotice[];
  exampleCount?: number;
  activeExample?: string | null;
  constraintWarningCount?: number;
}

export interface HumanWinsNotice {
  seq: number;
  agentId: string;
  agent: string;
  slotIds: string[];
  at: number;
}

export interface AgentMutationResult {
  revision: string;
  report?: ImportSuggestionsReport;
  testResult?: TestResult | null;
  error?: string;
}

export interface MapSlotRequest {
  slotId: string;
  path: string;
  format?: string;
}

export interface LoadBundleRequest {
  bundle: ProjectBundle;
  revision?: string;
}

export interface BlocklyReplaceRequest {
  blocklyState: unknown;
  revision?: string;
}
