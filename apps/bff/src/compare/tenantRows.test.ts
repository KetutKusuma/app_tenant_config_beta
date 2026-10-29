import { test } from "node:test";
import assert from "node:assert/strict";
import { tenantWhere } from "./tenantRows.js";

test("GLOBAL_DEFAULT memakai tenant_id IS NULL", () => {
  assert.equal(tenantWhere("GLOBAL_DEFAULT"), "tenant_id IS NULL");
});
test("tenant biasa memakai perbandingan sama dengan", () => {
  assert.equal(tenantWhere("019f-a"), "tenant_id = '019f-a'");
});
test("kutip tunggal di-escape", () => {
  assert.equal(tenantWhere("a'b"), "tenant_id = 'a''b'");
});
