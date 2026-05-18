import { customAlphabet } from "nanoid";

// Matches Routy's Nanoid.Alphabets.UppercaseLettersAndDigits, size 18.
const NANOID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const nanoid18 = customAlphabet(NANOID_ALPHABET, 18);

export function newEdgeClickId(): string {
  return `edge_${nanoid18()}`;
}

export function newDynamicParam(): string {
  return nanoid18();
}

export interface RenderInput {
  templateUrl: string;
  clickId: string;
  dynamic: string;
  tracker: string | null;
  forwardedQueryString: string;
}

export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateRenderError";
  }
}

// Substitute placeholders in templateUrl and append any forwarded query params.
// Mirrors the substitution order in Routy's RedirectRequestHandler.GenerateLink.
export function renderTemplate(input: RenderInput): string {
  let url = input.templateUrl;

  url = replaceAllCi(url, "[clickid]", input.clickId);
  url = replaceAllCi(url, "[dynamic]", input.dynamic);

  if (containsCi(url, "[tracker]")) {
    if (input.tracker === null) {
      throw new TemplateRenderError(
        "Template requires [tracker] but no cached tracker value is available"
      );
    }
    url = replaceAllCi(url, "[tracker]", input.tracker);
  }

  if (input.forwardedQueryString.length > 0) {
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}${input.forwardedQueryString}`;
  }

  return url;
}

function replaceAllCi(haystack: string, needle: string, replacement: string): string {
  const re = new RegExp(escapeRegex(needle), "gi");
  return haystack.replace(re, replacement);
}

function containsCi(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
