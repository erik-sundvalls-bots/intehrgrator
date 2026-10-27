/**
 * Load a GitHub clinical-model file (.t.json / .adl / .adls / .opt / .oet) and
 * resolve dependent archetypes from the same repo branch — same path as the
 * ehrtslib demo-app AD@git loader.
 */

import {
  ClinicalModelWorkspace,
  isOptXml,
  parseGitHubClinicalModelFileUrl,
  type GitHubTemplateLoadProgress,
} from "ehrtslib/parser/mod.ts";
import { OptXmlSerializer } from "ehrtslib/generation/opt_xml_serializer.ts";
import { buildWebTemplate } from "ehrtslib/serialization/simplified/web_template_builder.ts";
import { generateSkeletonFromOperational } from "../skeleton/generate_skeleton.ts";
import {
  availableOptLanguages,
  availableWebTemplateLanguages,
  buildWebTemplateTermsIndex,
  orderLanguages,
  resolveOptLanguage,
} from "../skeleton/template_terms.ts";
import type { ClinicalModelFileset, SkeletonNode } from "../../types/mod.ts";

const CLINICAL_MODEL_URL_SUFFIX = /\.(t\.json|adl|adls|opt|oet)$/i;

export const DEFAULT_GITHUB_TEMPLATE_URL =
  "https://github.com/Ehrlibs/openEHR-model-examples/blob/main/local/theme-packs/sport-event-details/templates/Accident%20report%20including%20vital%20signs.t.json";

export interface GitHubClinicalModelLoadOptions {
  fetch?: typeof fetch;
  githubToken?: string;
  maxFiles?: number;
  onProgress?: (event: GitHubTemplateLoadProgress) => void;
}

export interface GitHubClinicalModelLoadResult {
  sourceUrl: string;
  rootPath: string;
  filename: string;
  templateId: string;
  /** Self-contained OPT XML for project persistence (no GitHub needed on restore). */
  optXml: string;
  /** Web Template JSON for Source Schema trees. */
  webTemplateJson: string;
  skeleton: SkeletonNode[];
  language: string;
  languages: string[];
  warnings: string[];
  fetched: number;
  /** Full fetched file-set (`.t.json` + ADL/OPT) for Project Bundle round-trip. */
  fileset: ClinicalModelFileset;
}

export function isGitHubClinicalModelUrl(input: string): boolean {
  try {
    const ref = parseGitHubClinicalModelFileUrl(input);
    return CLINICAL_MODEL_URL_SUFFIX.test(ref.path);
  } catch {
    return false;
  }
}

export async function loadGitHubClinicalModel(
  sourceUrl: string,
  options?: GitHubClinicalModelLoadOptions & { language?: string },
): Promise<GitHubClinicalModelLoadResult> {
  const workspace = new ClinicalModelWorkspace();
  const closure = await workspace.loadFromGitHubClinicalModelUrl(sourceUrl, {
    fetch: options?.fetch,
    githubToken: options?.githubToken,
    maxFiles: options?.maxFiles,
    onProgress: options?.onProgress,
  });
  const files = workspace.listFiles().map((file) => ({
    path: file.path,
    content: file.content,
  }));
  const scaffolded = scaffoldWorkspace(workspace, closure.rootPath, options?.language);
  const storedName = (closure.rootPath.split("/").pop() ?? closure.rootPath);
  return {
    sourceUrl,
    rootPath: closure.rootPath,
    filename: storedName,
    fetched: closure.fetched,
    fileset: {
      sourceUrl,
      rootPath: closure.rootPath,
      files,
    },
    ...scaffolded,
    warnings: [...closure.warnings, ...scaffolded.warnings],
  };
}

/** Re-scaffold a stored clinical-model closure (language switch, project restore). */
export function scaffoldClinicalModelFileset(
  fileset: ClinicalModelFileset,
  language?: string,
): Pick<
  GitHubClinicalModelLoadResult,
  "templateId" | "optXml" | "webTemplateJson" | "skeleton" | "language" | "languages" | "warnings"
> {
  const workspace = new ClinicalModelWorkspace();
  workspace.addFiles(fileset.files);
  if (fileset.rootPath) {
    workspace.setGenerationRootPath(fileset.rootPath);
    workspace.setActivePath(fileset.rootPath);
  }
  return scaffoldWorkspace(workspace, fileset.rootPath, language);
}

function scaffoldWorkspace(
  workspace: ClinicalModelWorkspace,
  rootPath: string,
  preferredLanguage?: string,
): Pick<
  GitHubClinicalModelLoadResult,
  "templateId" | "optXml" | "webTemplateJson" | "skeleton" | "language" | "languages" | "warnings"
> {
  const resolved = workspace.resolveOperational();
  const opt = resolved.operationalTemplate;
  const rootFile = rootPath ? workspace.getFile(rootPath) : undefined;
  const optXml = rootFile && isOptXml(rootFile.content)
    ? rootFile.content
    : new OptXmlSerializer().serialize(opt);
  const ontologyLanguage = resolveOptLanguage(opt, preferredLanguage);
  const webTemplate = buildWebTemplate(opt, {
    languages: [ontologyLanguage, ...availableOptLanguages(opt).filter((l) => l !== ontologyLanguage)],
  });
  const generated = generateSkeletonFromOperational(
    opt,
    optXml,
    buildWebTemplateTermsIndex(webTemplate, ontologyLanguage),
    { language: ontologyLanguage },
  );
  const templateId = generated.templateId !== "unknown"
    ? generated.templateId
    : webTemplate.templateId || basename(rootPath);
  const wtLanguages = availableWebTemplateLanguages(webTemplate);
  const languages = orderLanguages(
    preferredLanguage ?? generated.language,
    [...generated.languages, ...wtLanguages],
  );
  const language = preferredLanguage && languages.includes(preferredLanguage)
    ? preferredLanguage
    : (generated.language || languages[0] || "en");
  return {
    templateId,
    optXml,
    webTemplateJson: JSON.stringify(webTemplate),
    skeleton: generated.skeleton,
    language,
    languages,
    warnings: [...resolved.warnings, ...generated.warnings],
  };
}

function basename(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
}
