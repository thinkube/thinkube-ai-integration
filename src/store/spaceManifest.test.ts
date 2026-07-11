/**
 * space.yaml — the space card (TEP-14): configuration, never a name.
 * Parsing + validation refuse loudly with the card named.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeRemote, parseSpaceCard } from "./spaceManifest";

test("a repo card parses with a normalized remote", () => {
  const c = parseSpaceCard(
    `repo:\n  remote: https://github.com/thinkube/thinkube-control.git\norgs: [cmxela]\n`,
    "x/space.yaml",
  );
  assert.deepEqual(c, {
    orgs: ["cmxela"],
    repo: { remote: "github.com/thinkube/thinkube-control" },
  });
});

test("a project card has no repo section", () => {
  assert.deepEqual(parseSpaceCard(`orgs: [cmxela]\n`, "p/space.yaml"), {
    orgs: ["cmxela"],
  });
});

test("normalizeRemote: https / ssh / scp-style / .git / host case all converge", () => {
  const want = "github.com/thinkube/thinkube-control";
  for (const raw of [
    "https://github.com/thinkube/thinkube-control.git",
    "https://GitHub.com/thinkube/thinkube-control",
    "ssh://git@github.com/thinkube/thinkube-control.git",
    "git@github.com:thinkube/thinkube-control.git",
    "git@GITHUB.COM:thinkube/thinkube-control",
    "github.com/thinkube/thinkube-control/",
  ]) {
    assert.equal(normalizeRemote(raw), want, raw);
  }
  // Path case is PRESERVED — a real mismatch must surface, not be papered over.
  assert.equal(
    normalizeRemote("git@github.com:Thinkube/X.git"),
    "github.com/Thinkube/X",
  );
});

test("refusals name the card: bad orgs, empty remote, non-mapping", () => {
  const cases: Array<[string, RegExp]> = [
    [`orgs: "cmxela"\n`, /`orgs` must be a list/],
    [`orgs: [a b]\n`, /single path segments/],
    [`orgs: [x, x]\n`, /unique/],
    [`orgs: []\nrepo: {}\n`, /`repo.remote` is required/],
    [`- just\n- a list\n`, /must be a YAML mapping/],
  ];
  for (const [card, re] of cases) {
    assert.throws(
      () => parseSpaceCard(card, "the/offending/space.yaml"),
      (e: Error) =>
        re.test(e.message) && e.message.startsWith("the/offending/space.yaml:"),
      card,
    );
  }
});
