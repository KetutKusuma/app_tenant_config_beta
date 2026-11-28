import test from "node:test";
import assert from "node:assert/strict";
import { prettyValue, sideEditable, isDirty, pickConfigAfterSwitch } from "./compareEdit.ts";

const row = (value: unknown = { a: 1 }): any => ({
  id: "1", tenant_id: "t", group_id: null, config_type: "A", path: "p",
  value, is_default: false, version_token: "v",
});
const entry = (status: string, l: any = row(), r: any = row()): any => ({
  configType: "A", status, changeCount: 0, left: l, right: r,
});

test("prettyValue", () => {
  assert.equal(prettyValue(null), "");
  assert.equal(prettyValue(undefined), "");
  assert.equal(prettyValue({ a: 1 }), '{\n  "a": 1\n}');
});

test("sideEditable", () => {
  assert.equal(sideEditable(entry("beda"), "left", false), true);
  assert.equal(sideEditable(entry("beda"), "left", true), false);
  assert.equal(sideEditable(entry("hanya_kiri", row(), null), "right", false), false);
  assert.equal(sideEditable(entry("ganda"), "left", false), false);
  assert.equal(sideEditable(null, "left", false), false);
});

test("isDirty", () => {
  const r = row();
  assert.equal(isDirty(undefined, r), false);
  assert.equal(isDirty(prettyValue(r.value), r), false);
  assert.equal(isDirty("{}", r), true);
  assert.equal(isDirty("{}", null), false);
});

test("pickConfigAfterSwitch", () => {
  const abc = [{ config_type: "A" }, { config_type: "CANDIDATE_STABLE" }, { config_type: "B" }];
  assert.deepEqual(pickConfigAfterSwitch(abc, "B"), { config: abc[2], missingType: null });
  assert.deepEqual(pickConfigAfterSwitch(abc, "X"), { config: abc[1], missingType: "X" });
  const ab = [{ config_type: "A" }, { config_type: "B" }];
  assert.deepEqual(pickConfigAfterSwitch(ab, "X"), { config: ab[0], missingType: "X" });
  assert.deepEqual(pickConfigAfterSwitch([], "X"), { config: null, missingType: null });
  assert.deepEqual(pickConfigAfterSwitch(abc, ""), { config: abc[1], missingType: null });
  assert.deepEqual(pickConfigAfterSwitch(abc, undefined), { config: abc[1], missingType: null });
});
