// Renders the cloaked HTML response per CONTRACT.md §7.
// Mirrors RedirectResponseWriter.WriteActionResult (HideUrlReferrer branch).
export function cloakedHtml(renderedUrl: string): string {
  const safe = htmlAttrEscape(renderedUrl);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="referrer" content="no-referrer" />
    <meta http-equiv="refresh" content="0;URL='${safe}'" />
  </head>
  <body></body>
</html>`;
}

function htmlAttrEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
