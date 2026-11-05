/**
 * "You are not on the recommended version" popup for the GitHub Pages web app.
 *
 * The bleeding-edge build lives at the site root and every release also
 * freezes an immutable copy under `/vX.Y(.Z)/`. `versions.json` (see
 * `scripts/pages_site.ts`) names one of those frozen tags as `recommended` — the
 * version end users should stick to for production mapping work. This module decides
 * whether the current page is on that recommended tag and, if not, shows a dialog
 * linking to it (plus the bleeding-edge root, the tutorial, and the end-user README).
 *
 * Pure decision helpers are exported separately from the DOM-touching orchestrator so
 * the logic is unit-testable without a browser.
 */

import { detectLocale } from "../blockly/i18n/locale.ts";
import { chrome, formatMessage } from "../ui/chrome_i18n.ts";

export const VERSIONS_MANIFEST_FILENAME = "versions.json";
export const RECOMMENDED_POPUP_DISMISS_STORAGE_KEY = "intehr-dismiss-recommended-version";

/** GitHub Pages sites are served from a `*.github.io` host; nothing else should popup. */
export function isGithubPagesHost(hostname: string): boolean {
  return /\.github\.io$/i.test(hostname);
}

/**
 * Pull a frozen release tag (e.g. `v0.7.5`) out of a Pages URL path, or `null` when the
 * path is the bleeding-edge root (or any other non-versioned path, e.g. local dev).
 */
export function extractVersionTagFromPath(pathname: string): string | null {
  const TAG_RE = /^v\d+(\.\d+){0,2}$/;
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return null;
  // Try the last segment directly (directory URL), then the one before it
  // (file URL, e.g. `.../v0.7.5/index.html` or a subpage within a release).
  const last = segments[segments.length - 1];
  if (TAG_RE.test(last)) return last;
  const secondLast = segments[segments.length - 2];
  return secondLast && TAG_RE.test(secondLast) ? secondLast : null;
}

/**
 * URL of `versions.json` relative to the current page: one directory up from a frozen
 * `/vX.Y/` release page (where the manifest does not live), or alongside the page for
 * the bleeding-edge root.
 */
export function resolveVersionsManifestUrl(href: string, currentTag: string | null): string {
  const relative = currentTag ? `../${VERSIONS_MANIFEST_FILENAME}` : `./${VERSIONS_MANIFEST_FILENAME}`;
  return new URL(relative, href).href;
}

/** The bleeding-edge (site root) URL, derived from the manifest URL. */
export function bleedingEdgeUrlFromManifestUrl(manifestUrl: string): string {
  return new URL(".", manifestUrl).href;
}

/** The frozen recommended-release URL, derived from the manifest URL. */
export function recommendedUrlFromManifestUrl(manifestUrl: string, recommendedTag: string): string {
  return new URL(`${recommendedTag}/`, manifestUrl).href;
}

/** Pure decision: should the "not on recommended version" popup appear right now? */
export function shouldShowRecommendedPopup(input: {
  isGithubPages: boolean;
  currentTag: string | null;
  recommended?: string;
  dismissedFor?: string | null;
}): boolean {
  if (!input.isGithubPages) return false;
  if (!input.recommended) return false;
  if (input.currentTag === input.recommended) return false;
  if (input.dismissedFor && input.dismissedFor === input.recommended) return false;
  return true;
}

/** Text shown in the popup body for the current deployment. */
export function recommendedPopupMessage(currentTag: string | null, recommendedTag: string): string {
  return currentTag
    ? `You are using intEHRgrator ${currentTag}, which is not the recommended end-user version (${recommendedTag}).`
    : `You are using the bleeding-edge build (updated on every change to main), not the recommended stable version (${recommendedTag}).`;
}

export interface RecommendedVersionPopupDialogEls {
  dialog: HTMLDialogElement;
  message: HTMLElement;
  recommendedLink: HTMLAnchorElement;
  bleedingEdgeLink: HTMLAnchorElement;
  tutorialLink: HTMLAnchorElement;
  readmeLink: HTMLAnchorElement;
  dismissButton: HTMLButtonElement;
  dontShowAgainCheckbox?: HTMLInputElement | null;
}

export interface RecommendedVersionPopupOptions {
  tutorialUrl: string;
  readmeUrl: string;
  storage?: Storage;
  location?: Pick<Location, "hostname" | "pathname" | "href">;
  fetchImpl?: typeof fetch;
}

interface VersionsManifestLike {
  versions?: string[];
  recommended?: string;
}

/** Fetch the versions manifest, decide, and show the popup if warranted. Safe to call unconditionally on boot. */
export async function maybeShowRecommendedVersionPopup(
  els: RecommendedVersionPopupDialogEls,
  opts: RecommendedVersionPopupOptions,
): Promise<void> {
  const loc = opts.location ?? location;
  if (!isGithubPagesHost(loc.hostname)) return;

  const currentTag = extractVersionTagFromPath(loc.pathname);
  const manifestUrl = resolveVersionsManifestUrl(loc.href, currentTag);

  let manifest: VersionsManifestLike;
  try {
    const res = await (opts.fetchImpl ?? fetch)(manifestUrl, { cache: "no-store" });
    if (!res.ok) return;
    manifest = await res.json();
  } catch {
    // Fetch failures (offline, blocked, manifest missing) should never block boot.
    return;
  }

  const storage = opts.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  const dismissedFor = storage?.getItem(RECOMMENDED_POPUP_DISMISS_STORAGE_KEY) ?? null;

  if (
    !shouldShowRecommendedPopup({
      isGithubPages: true,
      currentTag,
      recommended: manifest.recommended,
      dismissedFor,
    })
  ) {
    return;
  }

  const recommendedTag = manifest.recommended!;
  const messages = chrome(detectLocale());
  els.message.textContent = currentTag
    ? formatMessage(messages.recommendedFrozen, { current: currentTag, recommended: recommendedTag })
    : formatMessage(messages.recommendedBleeding, { recommended: recommendedTag });
  els.recommendedLink.href = recommendedUrlFromManifestUrl(manifestUrl, recommendedTag);
  els.recommendedLink.textContent = formatMessage(messages.goToRecommended, { tag: recommendedTag });
  els.bleedingEdgeLink.href = bleedingEdgeUrlFromManifestUrl(manifestUrl);
  els.tutorialLink.href = opts.tutorialUrl;
  els.readmeLink.href = opts.readmeUrl;

  els.dismissButton.addEventListener(
    "click",
    () => {
      if (storage && els.dontShowAgainCheckbox?.checked) {
        storage.setItem(RECOMMENDED_POPUP_DISMISS_STORAGE_KEY, recommendedTag);
      }
      els.dialog.close();
    },
    { once: true },
  );

  els.dialog.showModal();
}
