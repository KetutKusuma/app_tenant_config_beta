import { test } from "node:test";
import assert from "node:assert/strict";
import { extraSelect, liveWhere, pgErrorMessage } from "./configRows.js";
import { tableFor } from "./services.js";

test("liveWhere: baris terhapus dan baris tanpa tipe config tidak ikut", () => {
  assert.equal(liveWhere({ typeCol: "config_type" }), "deleted_at IS NULL AND config_type IS NOT NULL");
  assert.equal(liveWhere({ typeCol: "workflow_config_type" }), "deleted_at IS NULL AND workflow_config_type IS NOT NULL");
});

test("extraSelect: kosong untuk ATS, jsonb_build_object untuk kolom ekstra", () => {
  assert.equal(extraSelect(tableFor("ats", "tenant_config")!), "");
  assert.equal(extraSelect(tableFor("hris", "tenant_config")!), ", jsonb_build_object('type', type) AS extra");
  assert.equal(extraSelect(tableFor("hris", "workflow_pipeline")!), ", jsonb_build_object('is_active', is_active) AS extra");
});

test("pgErrorMessage: FK dan unique diterjemahkan, error lain null", () => {
  assert.equal(pgErrorMessage({ code: "23503" }, { serviceLabel: "Organization" }), "Tenant belum terdaftar di Organization pada env ini.");
  assert.equal(pgErrorMessage({ code: "23505" }, { serviceLabel: "HRIS" }), "Config ini sudah ada di tujuan.");
  assert.equal(pgErrorMessage(new Error("x"), { serviceLabel: "HRIS" }), null);
  assert.equal(pgErrorMessage(null, { serviceLabel: "HRIS" }), null);
});
