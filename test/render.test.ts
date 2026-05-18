import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newDynamicParam,
  newEdgeClickId,
  renderTemplate,
  TemplateRenderError,
} from "../src/services/render.js";

test("substitutes [clickid] and [dynamic]", () => {
  const out = renderTemplate({
    templateUrl: "https://example.com/lp?c=[clickid]&d=[dynamic]",
    clickId: "ABC123",
    dynamic: "XYZ789",
    tracker: null,
    forwardedQueryString: "",
  });
  assert.equal(out, "https://example.com/lp?c=ABC123&d=XYZ789");
});

test("substitution is case-insensitive", () => {
  const out = renderTemplate({
    templateUrl: "https://x/?c=[ClickID]&d=[DYNAMIC]",
    clickId: "AAA",
    dynamic: "BBB",
    tracker: null,
    forwardedQueryString: "",
  });
  assert.equal(out, "https://x/?c=AAA&d=BBB");
});

test("substitutes multiple occurrences of the same placeholder", () => {
  const out = renderTemplate({
    templateUrl: "https://x/?a=[clickid]&b=[clickid]",
    clickId: "C",
    dynamic: "D",
    tracker: null,
    forwardedQueryString: "",
  });
  assert.equal(out, "https://x/?a=C&b=C");
});

test("substitutes [tracker] when value is available", () => {
  const out = renderTemplate({
    templateUrl: "https://x/?t=[tracker]",
    clickId: "C",
    dynamic: "D",
    tracker: "tr_val",
    forwardedQueryString: "",
  });
  assert.equal(out, "https://x/?t=tr_val");
});

test("throws when template requires [tracker] but value is null", () => {
  assert.throws(
    () =>
      renderTemplate({
        templateUrl: "https://x/?t=[tracker]",
        clickId: "C",
        dynamic: "D",
        tracker: null,
        forwardedQueryString: "",
      }),
    TemplateRenderError
  );
});

test("does not require [tracker] when template does not contain it", () => {
  const out = renderTemplate({
    templateUrl: "https://x/?c=[clickid]",
    clickId: "C",
    dynamic: "D",
    tracker: null,
    forwardedQueryString: "",
  });
  assert.equal(out, "https://x/?c=C");
});

test("appends forwarded query string with & when URL already has one", () => {
  const out = renderTemplate({
    templateUrl: "https://x/?c=[clickid]",
    clickId: "C",
    dynamic: "D",
    tracker: null,
    forwardedQueryString: "utm=src&u2=v2",
  });
  assert.equal(out, "https://x/?c=C&utm=src&u2=v2");
});

test("appends forwarded query string with ? when URL has no query yet", () => {
  const out = renderTemplate({
    templateUrl: "https://x/lp",
    clickId: "C",
    dynamic: "D",
    tracker: null,
    forwardedQueryString: "utm=src",
  });
  assert.equal(out, "https://x/lp?utm=src");
});

test("omits forwarded query string when empty", () => {
  const out = renderTemplate({
    templateUrl: "https://x/?c=[clickid]",
    clickId: "C",
    dynamic: "D",
    tracker: null,
    forwardedQueryString: "",
  });
  assert.equal(out, "https://x/?c=C");
});

test("newEdgeClickId is prefixed and 18-char body", () => {
  const id = newEdgeClickId();
  assert.match(id, /^edge_[0-9A-Z]{18}$/);
});

test("newDynamicParam is 18 chars from Routy's alphabet", () => {
  const id = newDynamicParam();
  assert.match(id, /^[0-9A-Z]{18}$/);
});
