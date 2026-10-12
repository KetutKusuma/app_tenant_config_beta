---
name: tenant-configuration
description: Master architectural guide, syntax specification, database schema reference, validation rules, migration workflows, and operational cookbook for multi-tenant configurations in the Jobseeker Applicant Tracking System (ATS). Use whenever analyzing, creating, updating, migrating, debugging, or validating tenant configurations (e.g. APPLICANT_STABLE, CANDIDATE_STABLE, VACANCY_STABLE, RECRUITMENT_PROCESS_STABLE, WORKFLOW_PIPELINE) across Neon PostgreSQL, Redis Streams, and local preset files.
---

# Tenant Configuration Skill & Architectural Specification

> **Target Systems:** Jobseeker ATS Ecosystem, Tenant Studio Beta, Neon PostgreSQL Database, Redis Streams Event Architecture, and Local Presets Synchronization Pipeline.  
> **Version:** 2.4.0 (Production Core Specification)  
> **Audience:** AI Coding Agents, Software Architects, Senior Backend Engineers, and Platform Operators.

---

## Table of Contents
1. [Executive Overview & Architectural Philosophy](#1-executive-overview--architectural-philosophy)
2. [Hierarchical Resolution & Inheritance Model](#2-hierarchical-resolution--inheritance-model)
3. [Database Schema & Storage Architecture](#3-database-schema--storage-architecture)
   - [3.1 Table: tenant_studio.tenant_configurations](#31-table-tenant_studiotenant_configurations)
   - [3.2 Table: tenant_studio.tenant_config_histories (Audit Trail)](#32-table-tenant_studiotenant_config_histories-audit-trail)
   - [3.3 Workflow Pipeline Schema (public.pipeline_workflow_configurations)](#33-workflow-pipeline-schema-publicpipeline_workflow_configurations)
   - [3.4 Database Connection & Neon Pooling Guidelines](#34-database-connection--neon-pooling-guidelines)
4. [Configuration Types & Domain Taxonomy](#4-configuration-types--domain-taxonomy)
   - [4.1 APPLICANT_STABLE](#41-applicant_stable)
   - [4.2 CANDIDATE_STABLE](#42-candidate_stable)
   - [4.3 VACANCY_STABLE](#43-vacancy_stable)
   - [4.4 RECRUITMENT_PROCESS_STABLE](#44-recruitment_process_stable)
   - [4.5 WORKFLOW_PIPELINE](#45-workflow_pipeline)
5. [Comprehensive JSON Schema & Grammar Specification](#5-comprehensive-json-schema--grammar-specification)
   - [5.1 Root Level Structure](#51-root-level-structure)
   - [5.2 The views Array: Core Specification](#52-the-views-array-core-specification)
     - [5.2.1 view (Identifier)](#521-view-identifier)
     - [5.2.2 path (JMESPath & Dot Projection)](#522-path-jmespath--dot-projection)
     - [5.2.3 type (Type System)](#523-type-type-system)
     - [5.2.4 label and Internationalization (i18n)](#524-label-and-internationalization-i18n)
     - [5.2.5 filterable (Filter Engine Specification)](#525-filterable-filter-engine-specification)
     - [5.2.6 sortable (Sorting Specification)](#526-sortable-sorting-specification)
     - [5.2.7 searchable (Full-Text Search Engine)](#527-searchable-full-text-search-engine)
     - [5.2.8 resolvePaths (Entity Relation Resolution)](#528-resolvepaths-entity-relation-resolution)
     - [5.2.9 resolveDecrypted (PII & KMS Decryption)](#529-resolvedecrypted-pii--kms-decryption)
     - [5.2.10 isFile (Document & Attachment Handling)](#5210-isfile-document--attachment-handling)
     - [5.2.11 uiConfig & renderType (Presentation Metadata)](#5211-uiconfig--rendertype-presentation-metadata)
     - [5.2.12 permissions & RBAC Field Masking](#5212-permissions--rbac-field-masking)
   - [5.3 The customData Dynamic Field Specification](#53-the-customdata-dynamic-field-specification)
   - [5.4 The rules & Business Logic Validation Engine](#54-the-rules--business-logic-validation-engine)
6. [Critical Guardrails & Fatal Runtime Traps](#6-critical-guardrails--fatal-runtime-traps)
   - [6.1 Trap #1: isFile with resolvePaths (The 500 UUID Fatal Error)](#61-trap-1-isfile-with-resolvepaths-the-500-uuid-fatal-error)
   - [6.2 Trap #2: Duplicate View Keys](#62-trap-2-duplicate-view-keys)
   - [6.3 Trap #3: Custom Data Misalignment](#63-trap-3-custom-data-misalignment)
   - [6.4 Trap #4: Missing Path Projections](#64-trap-4-missing-path-projections)
   - [6.5 Trap #5: Operator & Type Mismatch](#65-trap-5-operator--type-mismatch)
   - [6.6 Trap #6: Unindexed FTS Search Paths](#66-trap-6-unindexed-fts-search-paths)
7. [Full Production Reference Configurations](#7-full-production-reference-configurations)
   - [7.1 Complete Reference: APPLICANT_STABLE](#71-complete-reference-applicant_stable)
   - [7.2 Complete Reference: CANDIDATE_STABLE](#72-complete-reference-candidate_stable)
   - [7.3 Complete Reference: VACANCY_STABLE](#73-complete-reference-vacancy_stable)
   - [7.4 Complete Reference: WORKFLOW_PIPELINE](#74-complete-reference-workflow_pipeline)
8. [Developer & AI Agent Operational Cookbook](#8-developer--ai-agent-operational-cookbook)
   - [Recipe 1: Safe Field Addition & View Mapping](#recipe-1-safe-field-addition--view-mapping)
   - [Recipe 2: Implementing PII Decryption Safely](#recipe-2-implementing-pii-decryption-safely)
   - [Recipe 3: Adding File Attachments Without Runtime Crash](#recipe-3-adding-file-attachments-without-runtime-crash)
   - [Recipe 4: Pre-flight Verification & Linting via CLI/API](#recipe-4-pre-flight-verification--linting-via-cliapi)
   - [Recipe 5: Local Presets Sync (Push/Pull with Backup)](#recipe-5-local-presets-sync-pushpull-with-backup)
   - [Recipe 6: Point-in-Time Audit Rollback & History Recovery](#recipe-6-point-in-time-audit-rollback--history-recovery)
9. [Automated Verification Checklist for AI Agents](#9-automated-verification-checklist-for-ai-agents)

---

## 1. Executive Overview & Architectural Philosophy

### 1.1 The Multi-Tenant Dynamic Schema Paradigm
In an enterprise B2B Applicant Tracking System (ATS), diverse enterprise clients (tenants) enforce radically different recruitment processes, data privacy requirements, candidate screening criteria, and custom metadata fields.
- **Tenant A (e.g. Retail Enterprise / Indomaret):** Demands high-volume hiring with physical height, weight, uniform size, branch outlet assignment, and automated screening tests.
- **Tenant B (e.g. Tech Unicorn / Fintech):** Demands GitHub portfolio links, coding test scores, stock option bands, remote work eligibility, and strict encryption on candidate compensation.

If the ATS relied on static relational columns (`ALTER TABLE applicants ADD COLUMN uniform_size VARCHAR`), the relational database would rapidly devolve into thousands of sparse columns, locking tables during migrations and breaking backward compatibility.

### 1.2 The Solution: JSONB Configuration-Driven Metadata
Instead of hardcoding database schemas, Jobseeker ATS implements a **dynamic metadata layer** known as `tenant_configuration`.
Every tenant possesses one or more JSON configuration objects stored in PostgreSQL `JSONB` columns and broadcasted over Redis Streams.
The backend application and frontend single-page application (SPA) interpret this configuration at runtime to:
1. Render dynamic form inputs, filters, and tabular views.
2. Resolve foreign relationships (e.g., mapping `stage_id` UUID to the human-readable stage name).
3. Securely decrypt sensitive Personally Identifiable Information (PII) on-demand using AWS KMS or Vault keys.
4. Execute declarative server-side validation rules before persisting candidate applications.
5. Provide high-performance full-text search indexing on specified JSON paths.

```
+-----------------------------------------------------------------------------------+
|                              Jobseeker ATS Ecosystem                              |
+-----------------------------------------------------------------------------------+
                                          |
                +-------------------------+-------------------------+
                |                                                   |
      [Neon PostgreSQL]                                    [Local Presets Engine]
   tenant_studio.tenant_configurations                   test_redis_stream/stable/*.json
   tenant_studio.tenant_config_histories                            |
                |                                                   |
                +-------------------------+-------------------------+
                                          |
                            [BFF Sync & Validator API]
                            POST /api/validator/check
                            POST /api/sync/apply
                                          |
                        +-----------------+-----------------+
                        |                                   |
              [Tenant Studio UI]                   [ATS Core Microservices]
              - Monaco JSON Editor                 - Candidate Service
              - Split Diff Viewer                  - Applicant Service
              - Pre-flight Linter                  - Workflow Engine
```

---

## 2. Hierarchical Resolution & Inheritance Model

To prevent configuration duplication while allowing granular overrides, Jobseeker ATS employs a 3-tier hierarchical resolution waterfall:

```
[Level 1: Tenant + Specific Group Override]
     (tenant_id = 'uuid', group_id = 'group-uuid')
                       |
                       v  (If not found, fallback to)
[Level 2: Tenant Default Configuration]
     (tenant_id = 'uuid', group_id IS NULL or is_default = TRUE)
                       |
                       v  (If not found, fallback to)
[Level 3: Global System Preset (Fallback Base)]
     (tenant_id IS NULL, is_default = TRUE)
```

### Resolution Rules:
1. **Tenant Group Level (Highest Specificity):**
   If a client operates multiple regional subsidiaries (e.g. Indomaret Group -> Head Office vs. Regional Warehouse), a configuration with matching `tenant_id` AND `group_id` takes absolute precedence.
2. **Tenant Default Level:**
   If no group-specific config exists, the query falls back to the tenant's base configuration (`tenant_id = :tenant_id AND (group_id IS NULL OR is_default = true)`).
3. **Global System Default:**
   If a newly onboarded tenant has not yet created a specific config, the system loads the system-wide baseline template (`tenant_id IS NULL AND is_default = true`).
4. **Cache & Event Layer:**
   When a configuration is saved or modified in `tenant_studio.tenant_configurations`, an event is emitted into Redis Stream (`redis_stream_tenant_config_events`). Worker nodes flush local LRU caches within 100 milliseconds.

---

## 3. Database Schema & Storage Architecture

### 3.1 Table: `tenant_studio.tenant_configurations`
Stores the currently active version of each configuration.

```sql
CREATE SCHEMA IF NOT EXISTS tenant_studio;

CREATE TABLE tenant_studio.tenant_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64),
    group_id VARCHAR(64),
    config_type VARCHAR(64) NOT NULL,
    path VARCHAR(255),
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

-- Indexes for ultra-fast hierarchical resolution
CREATE INDEX idx_tenant_configs_lookup 
    ON tenant_studio.tenant_configurations (tenant_id, config_type, group_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_tenant_configs_default 
    ON tenant_studio.tenant_configurations (tenant_id, is_default)
    WHERE deleted_at IS NULL;

-- JSONB GIN index for deep JMESPath & attribute queries
CREATE INDEX idx_tenant_configs_gin_value 
    ON tenant_studio.tenant_configurations USING gin (value jsonb_path_ops);
```

### 3.2 Table: `tenant_studio.tenant_config_histories` (Audit Trail)
Every mutation (create, update, soft-delete, restore) triggers an immutable audit snapshot in this table. This guarantees zero data loss and allows instantaneous point-in-time rollbacks.

```sql
CREATE TABLE tenant_studio.tenant_config_histories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES tenant_studio.tenant_configurations(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64),
    group_id VARCHAR(64),
    config_type VARCHAR(64) NOT NULL,
    path VARCHAR(255),
    config_value JSONB NOT NULL,
    version INT NOT NULL DEFAULT 1,
    change_summary VARCHAR(255) NOT NULL,
    author_name VARCHAR(100) NOT NULL DEFAULT 'System',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Fast lookup for audit trail drawer and version diff
CREATE INDEX idx_config_histories_config_ver 
    ON tenant_studio.tenant_config_histories (config_id, version DESC);
```

### 3.3 Workflow Pipeline Schema (`public.pipeline_workflow_configurations`)
The recruitment pipeline workflow represents the sequential hiring stages (e.g. Sourcing -> HR Screening -> Technical Test -> User Interview -> Offering -> Hired).
While stage definitions live in `public.pipeline_workflow_configurations`, the `APPLICANT_STABLE` configuration references these stages inside `views` and `rules`.

```sql
CREATE TABLE public.pipeline_workflow_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(64) NOT NULL,
    pipeline_name VARCHAR(100) NOT NULL,
    stages JSONB NOT NULL DEFAULT '[]'::jsonb,
    transitions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3.4 Database Connection & Neon Pooling Guidelines
When connecting to Neon PostgreSQL from microservices or the BFF:
1. **Direct Connection (DDL & Migrations):** Use port `5432` without pooler for table definitions and migrations.
2. **Pooled Connection (Transaction Mode):** Use port `6543` with PgBouncer (`neon-pooler`) for application read/write traffic.
3. **SSL Mode:** Neon requires `sslmode=require` or `ssl=true`. In local development or internal networks where cert verification is disabled, ensure `rejectUnauthorized: false` is configured securely.

---

## 4. Configuration Types & Domain Taxonomy

Jobseeker ATS standardizes on key configuration types identified by uppercase snake_case strings:

| Config Type | Domain Context | Primary Responsibilities |
| :--- | :--- | :--- |
| `APPLICANT_STABLE` | Application Flow & Tracking | Form fields submitted by candidate, stage movements, interview schedule, candidate-job link. |
| `CANDIDATE_STABLE` | Candidate Talent Pool | Master profile, CV/resume storage, identity numbers (NIK/KTP), contact info, education, experience history. |
| `VACANCY_STABLE` | Job Openings & Job Requisitions | Department, job title, hiring manager, required skills, salary range, recruitment quota, job portal publish flags. |
| `RECRUITMENT_PROCESS_STABLE`| Evaluation & Assessment | Scorecards, interviewer notes, assessment test results, background checks, medical checks. |
| `WORKFLOW_PIPELINE` | Automated Pipeline Engine | Automated email triggers on stage entry, stage gating conditions, rejection reasons, SLA timers. |

---

## 5. Comprehensive JSON Schema & Grammar Specification

### 5.1 Root Level Structure
A production tenant configuration document adheres to this top-level specification:

```json
{
  "$schema": "https://schema.jobseeker.company/v2/tenant-config.json",
  "version": "2.4.0",
  "name": "INDOMARET_RETAIL_APPLICANT_STABLE",
  "entity": "applicant",
  "description": "Production configuration for Indomaret retail store crew recruitment pipeline",
  "meta": {
    "module": "ATS_CORE",
    "lastAudit": "2026-10-11T20:00:00Z",
    "author": "Architecture Team"
  },
  "views": [],
  "customData": {},
  "rules": {},
  "filterable": {},
  "sortable": {},
  "searchable": {}
}
```

---

### 5.2 The `views` Array: Core Specification
The `views` array is the most critical element of the entire configuration. Each entry represents a projected data column, UI field, filter anchor, or encrypted relation.

```
+-------------------------------------------------------------------------+
|                                View Item                                |
+-------------------------------------------------------------------------+
| view            : Unique column identifier (e.g. "candidate_email")     |
| path            : JMESPath projection (e.g. "candidate.profile.email")  |
| type            : Data type (TEXT, NUMBER, DATE, JSONB, etc.)           |
| label           : Human readable label / i18n mapping                   |
| filterable      : Boolean or filter operator descriptor                 |
| sortable        : Boolean or sort directive                             |
| searchable      : Boolean or full-text search indexing descriptor       |
| resolvePaths    : Foreign entity resolver array                         |
| resolveDecrypted: PII KMS decryption resolver array                     |
| isFile          : Boolean flag indicating attachment / S3 URL           |
| uiConfig        : Presentation formatting metadata                      |
| permissions     : RBAC & masking security rules                         |
+-------------------------------------------------------------------------+
```

#### 5.2.1 `view` (Identifier)
- **Type:** `string` (Required, Non-empty, Unique)
- **Constraint:** Must match `^[a-zA-Z0-9_]+$`.
- **Purpose:** Acts as the primary programmatic key for UI table columns, API JSON outputs, and customData cross-referencing.
- **Rule:** Two views with the same `view` key in the same config will cause UI table collision and validation failure!

#### 5.2.2 `path` (JMESPath & Dot Projection)
- **Type:** `string` (Required)
- **Syntax:** Dot-separated path or JMESPath expression projecting the raw database record into the view field.
- **Examples:**
  - Standard field: `"candidate.full_name"`
  - Nested custom field: `"custom_data.uniform_size"`
  - Array extraction: `"experience[0].company_name"`
  - Multi-path fallback: `"candidate.mobile_phone || candidate.phone"`

#### 5.2.3 `type` (Type System)
- **Supported Values:**
  - `TEXT`: Single-line alphanumeric string.
  - `TEXTAREA`: Multi-line rich or plain text.
  - `NUMBER`: Integer or floating-point numerical value.
  - `BOOLEAN`: Strict `true` or `false`.
  - `DATE`: ISO 8601 calendar date (`YYYY-MM-DD`).
  - `TIMESTAMP`: ISO 8601 date-time (`YYYY-MM-DDTHH:mm:ss.sssZ`).
  - `CURRENCY`: Financial numerical amount with currency code.
  - `JSONB`: Structured nested JSON payload.
  - `ARRAY_STRING`: List of strings (e.g. tags, skills).
  - `UUID`: Valid RFC 4122 UUID string.

#### 5.2.4 `label` and Internationalization (`i18n`)
Supports multi-language UI rendering:
```json
{
  "view": "years_of_experience",
  "path": "candidate.experience_years",
  "type": "NUMBER",
  "label": "Pengalaman Kerja (Tahun)",
  "i18n": {
    "id": "Pengalaman Kerja (Tahun)",
    "en": "Years of Experience"
  }
}
```

#### 5.2.5 `filterable` (Filter Engine Specification)
Controls how backend SQL queries build dynamic `WHERE` clauses and how frontend UI displays search filters.
- **Boolean Form:** `"filterable": true` (Enables default equality filter).
- **Advanced Object Form:**
```json
{
  "filterable": {
    "enabled": true,
    "operators": ["eq", "ne", "in", "contains", "between", "gt", "gte", "lt", "lte", "null", "not_null"],
    "controlType": "multi-select",
    "dataSource": "/api/v1/lookups/applicant-stages",
    "placeholder": "Pilih tahapan..."
  }
}
```

#### 5.2.6 `sortable` (Sorting Specification)
Controls backend SQL `ORDER BY` and UI header sorting indicators:
```json
{
  "sortable": {
    "enabled": true,
    "defaultDirection": "DESC",
    "nulls": "LAST"
  }
}
```

#### 5.2.7 `searchable` (Full-Text Search Engine)
Instructs the ATS search worker to index this path into PostgreSQL FTS or Elasticsearch:
```json
{
  "searchable": {
    "enabled": true,
    "weight": "A",
    "fuzzy": true,
    "minChars": 3
  }
}
```

#### 5.2.8 `resolvePaths` (Entity Relation Resolution)
In ATS database architecture, tables store foreign keys as UUIDs (e.g., `stage_id = "019fa680-855c-..."`, `user_id = "019fa682-..."`).
The `resolvePaths` directive instructs the backend query engine to join and resolve these IDs into full human-readable entity objects before delivering JSON to the client.

```json
{
  "view": "recruitment_stage",
  "path": "applicant.current_stage_id",
  "type": "UUID",
  "label": "Tahapan Saat Ini",
  "resolvePaths": [
    {
      "sourceField": "applicant.current_stage_id",
      "targetEntity": "vacancy_stages",
      "targetKey": "id",
      "projectedField": "stage_name",
      "as": "stage_details"
    }
  ]
}
```

#### 5.2.9 `resolveDecrypted` (PII & KMS Decryption)
Sensitive Personally Identifiable Information (PII) such as KTP (National Identity Number), Tax ID (NPWP), Bank Account, and Base Salary are encrypted at rest in the database using envelope encryption (AES-256-GCM).
The `resolveDecrypted` directive declares that this field requires runtime KMS decryption, authorized by caller RBAC tokens:

```json
{
  "view": "candidate_ktp_number",
  "path": "candidate.encrypted_ktp",
  "type": "TEXT",
  "label": "Nomor KTP / NIK",
  "resolveDecrypted": [
    {
      "sourceField": "candidate.encrypted_ktp",
      "kmsKeyAlias": "alias/ats-pii-encryption",
      "algorithm": "AES_256_GCM",
      "masking": {
        "enabled": true,
        "maskPattern": "######********####",
        "rolesAllowedFull": ["HR_SUPER_ADMIN", "COMPLIANCE_OFFICER"]
      }
    }
  ]
}
```

#### 5.2.10 `isFile` (Document & Attachment Handling)
Specifies that the field stores a file identifier or storage URI (e.g. S3 key, GCS path, or temporary upload ID).
The ATS backend interprets `isFile: true` to generate time-limited signed download URLs with virus-scanning verification:

```json
{
  "view": "candidate_cv",
  "path": "candidate.attachments.resume_file_id",
  "type": "TEXT",
  "label": "Curriculum Vitae",
  "isFile": true,
  "fileConfig": {
    "allowedMimeTypes": ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    "maxSizeMb": 10,
    "signedUrlTtlSeconds": 3600
  }
}
```

> [!CAUTION]
> **FATAL ARCHITECTURAL RULE:**  
> Never combine `isFile: true` with `resolvePaths`! Doing so triggers runtime fatal SQL exceptions. See [Section 6.1](#61-trap-1-isfile-with-resolvepaths-the-500-uuid-fatal-error).

#### 5.2.11 `uiConfig` & `renderType` (Presentation Metadata)
Instructs the frontend UI how to style and present the data:
- `badge`: Renders a colored status pill.
- `avatar`: Renders candidate profile picture or initials circle.
- `currency`: Formats numerical value to `Rp 12.500.000` or `$ 5,000`.
- `date_relative`: Displays "2 hari yang lalu" or "Baru saja".
- `tag_list`: Displays chips for skills or tags.

```json
{
  "uiConfig": {
    "renderType": "badge",
    "badgeVariants": {
      "APPLIED": "blue",
      "SCREENING": "amber",
      "INTERVIEW": "indigo",
      "OFFERED": "cyan",
      "HIRED": "emerald",
      "REJECTED": "rose"
    }
  }
}
```

#### 5.2.12 `permissions` & RBAC Field Masking
Enforces granular field-level security at the presentation and API layer:
```json
{
  "permissions": {
    "viewRoles": ["HR_ADMIN", "RECRUITER", "HIRING_MANAGER"],
    "editRoles": ["HR_ADMIN"],
    "maskedFor": ["HIRING_MANAGER"]
  }
}
```

---

### 5.3 The `customData` Dynamic Field Specification
The `customData` object provides declarative form schema for dynamic candidate application questionnaires, branch specific requirements, or tenant custom fields.

```json
{
  "customData": {
    "version": "1.0",
    "fields": [
      {
        "key": "uniform_size",
        "label": "Ukuran Seragam Kerja",
        "type": "SELECT",
        "required": true,
        "options": [
          { "label": "Ukuran S", "value": "S" },
          { "label": "Ukuran M", "value": "M" },
          { "label": "Ukuran L", "value": "L" },
          { "label": "Ukuran XL", "value": "XL" },
          { "label": "Ukuran XXL", "value": "XXL" }
        ],
        "defaultValue": "M",
        "validation": {
          "regex": "^(S|M|L|XL|XXL)$"
        }
      },
      {
        "key": "has_driving_license",
        "label": "Memiliki SIM C Aktif?",
        "type": "BOOLEAN",
        "required": true,
        "defaultValue": false
      }
    ]
  }
}
```

> [!IMPORTANT]
> **Alignment Requirement:**  
> Every field declared in `customData.fields` MUST also have a corresponding view entry in `views` with `view = customData.field.key` and `path = "custom_data." + key` so that it can be displayed, sorted, and filtered!

---

### 5.4 The `rules` & Business Logic Validation Engine
The `rules` block defines server-side pre-flight integrity constraints evaluated whenever an applicant submits data or an HR officer moves a candidate between stages:

```json
{
  "rules": {
    "requiredFields": [
      "candidate_name",
      "candidate_email",
      "candidate_phone",
      "candidate_cv"
    ],
    "conditionalRules": [
      {
        "ruleId": "RULE_REQUIRE_SIM_IF_DRIVER",
        "description": "Jika posisi adalah Delivery Driver, maka SIM C wajib disertakan",
        "condition": {
          "field": "vacancy.job_role",
          "operator": "eq",
          "value": "DELIVERY_DRIVER"
        },
        "then": {
          "required": ["custom_data.driving_license_number", "custom_data.driving_license_file"]
        }
      }
    ],
    "numericalBounds": [
      {
        "field": "candidate.age",
        "min": 18,
        "max": 45,
        "errorMessage": "Pelamar harus berusia antara 18 hingga 45 tahun."
      }
    ]
  }
}
```

---

## 6. Critical Guardrails & Fatal Runtime Traps

### 6.1 Trap #1: `isFile` with `resolvePaths` (The 500 UUID Fatal Error)
This is the single most dangerous configuration bug in the Jobseeker ATS codebase:

```json
// FATAL FLAW - DO NOT COPY!
{
  "view": "candidate_cv",
  "path": "candidate.attachments.cv_document",
  "type": "TEXT",
  "isFile": true,
  "resolvePaths": [
    {
      "sourceField": "candidate.attachments.cv_document",
      "targetEntity": "file_assets",
      "targetKey": "id"
    }
  ]
}
```

#### Why it fails catastrophically:
1. When `isFile: true` is set, the ATS file streamer expects the raw path to point directly to a storage bucket identifier (e.g. `s3://ats-uploads/cvs/doc-1234.pdf` or an S3 file key).
2. Concurrently, the entity relation resolution engine intercepts `resolvePaths` and generates a relational SQL query: `SELECT * FROM file_assets WHERE id = :sourceValue::uuid`.
3. Because the storage path is a string containing slashes or alphanumeric hashes, PostgreSQL throws:  
   `ERROR: invalid input syntax for type uuid: "s3://ats-uploads/cvs/doc-1234.pdf" (SQLSTATE 22P02)`
4. The backend throws an unhandled HTTP 500 error, immediately crashing applicant submission forms and candidate profile pages across the tenant!

#### The Guardrail Linter Rule:
```typescript
if (v.isFile && v.resolvePaths && v.resolvePaths.length > 0) {
  throw new Error(
    `FATAL: Ditemukan 'resolvePaths' pada isFile view '${v.view}'. ` +
    `Ini memicu runtime error '500 invalid input syntax for type uuid' di ATS!`
  );
}
```

---

### 6.2 Trap #2: Duplicate View Keys
If two view items define identical `view` names (e.g. two items named `"applicant_status"`):
- The frontend React table key mapping encounters duplicate keys, causing React rendering loops or disappearing table columns.
- The GraphQL/REST API produces ambiguous payloads where the latter view silently overwrites the former.
- **Linter Rule:** Maintain a `Set<string>` of seen view identifiers during validation.

---

### 6.3 Trap #3: Custom Data Misalignment
Declaring a custom field in `customData.fields` (e.g. `uniform_size`) without adding a matching view entry in `views` results in an invisible data field:
- Candidates can fill the field in application forms.
- Data is saved in PostgreSQL `JSONB`.
- BUT recruiters CANNOT see, filter, sort, or export the column in the ATS candidate table!
- **Linter Rule:** Verify that every `customData.fields[i].key` exists in `views.map(v => v.view)`.

---

### 6.4 Trap #4: Missing Path Projections
Every view item MUST specify a `path` property. A view without a path causes the UI to render empty blank cells or crash on `null.property` dereference during JMESPath evaluation.

---

### 6.5 Trap #5: Operator & Type Mismatch
Configuring `"operators": ["contains"]` on a field with `type: "NUMBER"` or `type: "UUID"` will cause PostgreSQL syntax errors when building SQL `LIKE '%val%'` queries on non-textual database columns.

---

### 6.6 Trap #6: Unindexed FTS Search Paths
Configuring `"searchable": true` on deep JSONB paths without a corresponding GIN index on PostgreSQL will cause table-scan CPU exhaustion when searching across millions of applicant records.

---

## 7. Full Production Reference Configurations

### 7.1 Complete Reference: `APPLICANT_STABLE`
```json
{
  "$schema": "https://schema.jobseeker.company/v2/tenant-config.json",
  "version": "2.4.0",
  "name": "PRODUCTION_RETAIL_APPLICANT_STABLE",
  "entity": "applicant",
  "description": "Standard production configuration for retail recruitment with custom store data and guardrail validation",
  "meta": {
    "module": "APPLICANT_MANAGEMENT",
    "environment": "PRODUCTION",
    "updatedAt": "2026-10-11T20:30:00Z"
  },
  "views": [
    {
      "view": "applicant_id",
      "path": "id",
      "type": "UUID",
      "label": "ID Lamaran",
      "filterable": { "enabled": true, "operators": ["eq", "in"] },
      "sortable": { "enabled": true },
      "searchable": false
    },
    {
      "view": "applicant_code",
      "path": "application_number",
      "type": "TEXT",
      "label": "Nomor Registrasi",
      "filterable": { "enabled": true, "operators": ["eq", "contains"] },
      "sortable": { "enabled": true },
      "searchable": { "enabled": true, "weight": "A" }
    },
    {
      "view": "candidate_name",
      "path": "candidate.full_name",
      "type": "TEXT",
      "label": "Nama Lengkap",
      "filterable": { "enabled": true, "operators": ["contains", "eq"] },
      "sortable": { "enabled": true, "defaultDirection": "ASC" },
      "searchable": { "enabled": true, "weight": "A", "fuzzy": true }
    },
    {
      "view": "candidate_email",
      "path": "candidate.email",
      "type": "TEXT",
      "label": "Email",
      "filterable": { "enabled": true, "operators": ["eq", "contains"] },
      "sortable": { "enabled": true },
      "searchable": { "enabled": true, "weight": "B" }
    },
    {
      "view": "candidate_phone",
      "path": "candidate.phone_number",
      "type": "TEXT",
      "label": "Nomor WhatsApp / HP",
      "filterable": { "enabled": true, "operators": ["eq", "contains"] },
      "sortable": false,
      "searchable": { "enabled": true, "weight": "B" }
    },
    {
      "view": "applied_vacancy",
      "path": "vacancy_id",
      "type": "UUID",
      "label": "Posisi Lowongan",
      "filterable": { "enabled": true, "operators": ["eq", "in"], "controlType": "select" },
      "sortable": { "enabled": true },
      "resolvePaths": [
        {
          "sourceField": "vacancy_id",
          "targetEntity": "vacancies",
          "targetKey": "id",
          "projectedField": "title",
          "as": "vacancy_title"
        }
      ]
    },
    {
      "view": "recruitment_stage",
      "path": "current_stage_id",
      "type": "UUID",
      "label": "Tahap Rekrutmen",
      "filterable": { "enabled": true, "operators": ["eq", "in"], "controlType": "multi-select" },
      "sortable": { "enabled": true },
      "resolvePaths": [
        {
          "sourceField": "current_stage_id",
          "targetEntity": "pipeline_stages",
          "targetKey": "id",
          "projectedField": "name",
          "as": "stage_name"
        }
      ],
      "uiConfig": {
        "renderType": "badge",
        "badgeVariants": {
          "Screening": "blue",
          "Interview HR": "amber",
          "Interview User": "indigo",
          "Offering": "cyan",
          "Accepted": "emerald",
          "Rejected": "rose"
        }
      }
    },
    {
      "view": "candidate_cv",
      "path": "candidate.attachments.cv_s3_key",
      "type": "TEXT",
      "label": "Curriculum Vitae",
      "isFile": true,
      "fileConfig": {
        "maxSizeMb": 10,
        "allowedMimeTypes": ["application/pdf"]
      }
    },
    {
      "view": "candidate_ktp",
      "path": "candidate.encrypted_nik",
      "type": "TEXT",
      "label": "Nomor KTP / NIK",
      "resolveDecrypted": [
        {
          "sourceField": "candidate.encrypted_nik",
          "kmsKeyAlias": "alias/ats-production-pii",
          "algorithm": "AES_256_GCM",
          "masking": {
            "enabled": true,
            "maskPattern": "######********####"
          }
        }
      ]
    },
    {
      "view": "uniform_size",
      "path": "custom_data.uniform_size",
      "type": "TEXT",
      "label": "Ukuran Seragam",
      "filterable": { "enabled": true, "operators": ["eq", "in"] },
      "sortable": { "enabled": true }
    },
    {
      "view": "has_driving_license",
      "path": "custom_data.has_driving_license",
      "type": "BOOLEAN",
      "label": "Memiliki SIM C",
      "filterable": { "enabled": true, "operators": ["eq"] },
      "sortable": { "enabled": true }
    },
    {
      "view": "applied_at",
      "path": "created_at",
      "type": "TIMESTAMP",
      "label": "Tanggal Melamar",
      "filterable": { "enabled": true, "operators": ["between", "gte", "lte"] },
      "sortable": { "enabled": true, "defaultDirection": "DESC" },
      "uiConfig": { "renderType": "date_relative" }
    }
  ],
  "customData": {
    "version": "1.0",
    "fields": [
      {
        "key": "uniform_size",
        "label": "Ukuran Seragam",
        "type": "SELECT",
        "required": true,
        "options": [
          { "label": "S", "value": "S" },
          { "label": "M", "value": "M" },
          { "label": "L", "value": "L" },
          { "label": "XL", "value": "XL" }
        ],
        "defaultValue": "M"
      },
      {
        "key": "has_driving_license",
        "label": "Memiliki SIM C",
        "type": "BOOLEAN",
        "required": true,
        "defaultValue": false
      }
    ]
  },
  "rules": {
    "requiredFields": [
      "candidate_name",
      "candidate_email",
      "candidate_phone",
      "candidate_cv"
    ],
    "conditionalRules": [
      {
        "ruleId": "RULE_DRIVER_LICENSE",
        "condition": {
          "field": "applied_vacancy.title",
          "operator": "contains",
          "value": "Driver"
        },
        "then": {
          "required": ["custom_data.has_driving_license"]
        }
      }
    ]
  }
}
```

---

### 7.2 Complete Reference: `CANDIDATE_STABLE`
```json
{
  "$schema": "https://schema.jobseeker.company/v2/tenant-config.json",
  "version": "2.4.0",
  "name": "PRODUCTION_CANDIDATE_STABLE",
  "entity": "candidate",
  "description": "Master talent pool candidate profile configuration with PII masking and resume parsing",
  "meta": {
    "module": "TALENT_POOL",
    "environment": "PRODUCTION"
  },
  "views": [
    {
      "view": "candidate_id",
      "path": "id",
      "type": "UUID",
      "label": "Candidate ID",
      "filterable": { "enabled": true, "operators": ["eq", "in"] },
      "sortable": false
    },
    {
      "view": "full_name",
      "path": "profile.full_name",
      "type": "TEXT",
      "label": "Nama Lengkap",
      "filterable": { "enabled": true, "operators": ["contains", "eq"] },
      "sortable": { "enabled": true, "defaultDirection": "ASC" },
      "searchable": { "enabled": true, "weight": "A" }
    },
    {
      "view": "primary_email",
      "path": "profile.email",
      "type": "TEXT",
      "label": "Email Utama",
      "filterable": { "enabled": true, "operators": ["eq", "contains"] },
      "sortable": { "enabled": true },
      "searchable": { "enabled": true, "weight": "B" }
    },
    {
      "view": "encrypted_nik",
      "path": "profile.encrypted_nik",
      "type": "TEXT",
      "label": "Nomor KTP (NIK)",
      "resolveDecrypted": [
        {
          "sourceField": "profile.encrypted_nik",
          "kmsKeyAlias": "alias/ats-production-pii",
          "algorithm": "AES_256_GCM",
          "masking": { "enabled": true, "maskPattern": "######********####" }
        }
      ]
    },
    {
      "view": "resume_file",
      "path": "profile.documents.resume_s3_uri",
      "type": "TEXT",
      "label": "Resume File",
      "isFile": true,
      "fileConfig": { "maxSizeMb": 15, "allowedMimeTypes": ["application/pdf"] }
    },
    {
      "view": "total_experience_years",
      "path": "profile.summary.total_experience_years",
      "type": "NUMBER",
      "label": "Total Pengalaman (Tahun)",
      "filterable": { "enabled": true, "operators": ["gte", "lte", "between"] },
      "sortable": { "enabled": true }
    },
    {
      "view": "last_education_degree",
      "path": "profile.education.highest_degree",
      "type": "TEXT",
      "label": "Pendidikan Terakhir",
      "filterable": { "enabled": true, "operators": ["eq", "in"] },
      "sortable": { "enabled": true }
    },
    {
      "view": "expected_salary",
      "path": "profile.career_preferences.expected_salary",
      "type": "CURRENCY",
      "label": "Ekspektasi Gaji",
      "filterable": { "enabled": true, "operators": ["gte", "lte", "between"] },
      "sortable": { "enabled": true },
      "resolveDecrypted": [
        {
          "sourceField": "profile.career_preferences.expected_salary",
          "kmsKeyAlias": "alias/ats-production-salary",
          "algorithm": "AES_256_GCM"
        }
      ]
    }
  ],
  "customData": {
    "version": "1.0",
    "fields": []
  },
  "rules": {
    "requiredFields": ["full_name", "primary_email", "resume_file"]
  }
}
```

---

### 7.3 Complete Reference: `VACANCY_STABLE`
```json
{
  "$schema": "https://schema.jobseeker.company/v2/tenant-config.json",
  "version": "2.4.0",
  "name": "PRODUCTION_VACANCY_STABLE",
  "entity": "vacancy",
  "description": "Job openings and vacancy management configuration",
  "views": [
    {
      "view": "vacancy_id",
      "path": "id",
      "type": "UUID",
      "label": "ID Lowongan",
      "filterable": { "enabled": true, "operators": ["eq", "in"] }
    },
    {
      "view": "job_title",
      "path": "title",
      "type": "TEXT",
      "label": "Judul Pekerjaan",
      "filterable": { "enabled": true, "operators": ["contains", "eq"] },
      "sortable": { "enabled": true, "defaultDirection": "ASC" },
      "searchable": { "enabled": true, "weight": "A" }
    },
    {
      "view": "department_name",
      "path": "department_id",
      "type": "UUID",
      "label": "Departemen",
      "filterable": { "enabled": true, "operators": ["eq", "in"] },
      "resolvePaths": [
        {
          "sourceField": "department_id",
          "targetEntity": "departments",
          "targetKey": "id",
          "projectedField": "name",
          "as": "dept_details"
        }
      ]
    },
    {
      "view": "hiring_quota",
      "path": "target_headcount",
      "type": "NUMBER",
      "label": "Target Rekrutmen",
      "sortable": { "enabled": true }
    },
    {
      "view": "vacancy_status",
      "path": "status",
      "type": "TEXT",
      "label": "Status Lowongan",
      "filterable": { "enabled": true, "operators": ["eq", "in"] },
      "uiConfig": {
        "renderType": "badge",
        "badgeVariants": {
          "DRAFT": "slate",
          "PUBLISHED": "emerald",
          "PAUSED": "amber",
          "CLOSED": "rose"
        }
      }
    }
  ],
  "customData": { "version": "1.0", "fields": [] },
  "rules": {
    "requiredFields": ["job_title", "department_name", "hiring_quota"]
  }
}
```

---

### 7.4 Complete Reference: `WORKFLOW_PIPELINE`
```json
{
  "$schema": "https://schema.jobseeker.company/v2/tenant-config.json",
  "version": "2.4.0",
  "name": "PRODUCTION_WORKFLOW_PIPELINE",
  "entity": "workflow_pipeline",
  "description": "Recruitment pipeline state machine with triggers and automated notifications",
  "pipeline": {
    "name": "STANDARD_HIRING_PIPELINE",
    "stages": [
      { "id": "STAGE_APPLIED", "name": "Applied", "category": "SOURCING", "order": 1 },
      { "id": "STAGE_SCREENING", "name": "Administrative Screening", "category": "SCREENING", "order": 2 },
      { "id": "STAGE_INTERVIEW_HR", "name": "HR Interview", "category": "INTERVIEW", "order": 3 },
      { "id": "STAGE_INTERVIEW_USER", "name": "User Interview", "category": "INTERVIEW", "order": 4 },
      { "id": "STAGE_OFFERING", "name": "Job Offering", "category": "OFFERING", "order": 5 },
      { "id": "STAGE_HIRED", "name": "Hired", "category": "COMPLETED", "order": 6 },
      { "id": "STAGE_REJECTED", "name": "Rejected", "category": "TERMINATED", "order": 7 }
    ],
    "transitions": [
      {
        "from": "STAGE_APPLIED",
        "to": "STAGE_SCREENING",
        "allowedRoles": ["HR_ADMIN", "RECRUITER"]
      },
      {
        "from": "STAGE_SCREENING",
        "to": "STAGE_INTERVIEW_HR",
        "requiredScorecard": "HR_INITIAL_SCREENING"
      },
      {
        "from": "*",
        "to": "STAGE_REJECTED",
        "requiresReason": true,
        "actions": [
          {
            "type": "SEND_EMAIL_NOTIFICATION",
            "template": "REJECTION_POLITE_TEMPLATE",
            "delayMinutes": 120
          }
        ]
      }
    ]
  }
}
```

---

## 8. Developer & AI Agent Operational Cookbook

### Recipe 1: Safe Field Addition & View Mapping
**Objective:** Add a new candidate screening field (e.g. `willing_to_relocate`).
1. **Define in `customData.fields`:**
   ```json
   {
     "key": "willing_to_relocate",
     "label": "Bersedia Ditempatkan di Luar Kota?",
     "type": "BOOLEAN",
     "required": true,
     "defaultValue": false
   }
   ```
2. **Add matching entry in `views`:**
   ```json
   {
     "view": "willing_to_relocate",
     "path": "custom_data.willing_to_relocate",
     "type": "BOOLEAN",
     "label": "Bersedia Relokasi",
     "filterable": { "enabled": true, "operators": ["eq"] },
     "sortable": { "enabled": true }
   }
   ```
3. Run Pre-flight validator via `POST /api/validator/check`.
4. Commit changes with a descriptive summary: `"Add willing_to_relocate custom field and view mapping"`.

---

### Recipe 2: Implementing PII Decryption Safely
**Objective:** Expose candidate bank account number for onboarding payroll without storing plain-text.
1. Ensure the backend database stores ciphertext in `encrypted_bank_account`.
2. Configure view with `resolveDecrypted`:
   ```json
   {
     "view": "payroll_bank_account",
     "path": "onboarding.encrypted_bank_account",
     "type": "TEXT",
     "label": "Nomor Rekening Payroll",
     "resolveDecrypted": [
       {
         "sourceField": "onboarding.encrypted_bank_account",
         "kmsKeyAlias": "alias/ats-payroll-kms",
         "algorithm": "AES_256_GCM",
         "masking": {
           "enabled": true,
           "maskPattern": "******####",
           "rolesAllowedFull": ["FINANCE_SUPER_ADMIN"]
         }
       }
     ]
   }
   ```

---

### Recipe 3: Adding File Attachments Without Runtime Crash
**Objective:** Add a portfolio file attachment without triggering the fatal 500 UUID bug.
- **DO THIS:**
  ```json
  {
    "view": "candidate_portfolio",
    "path": "candidate.attachments.portfolio_url",
    "type": "TEXT",
    "label": "Berkas Portofolio",
    "isFile": true
  }
  ```
- **NEVER DO THIS:**
  ```json
  {
    "view": "candidate_portfolio",
    "path": "candidate.attachments.portfolio_url",
    "isFile": true,
    "resolvePaths": [{ "sourceField": "candidate.attachments.portfolio_url", ... }] // CRASH!
  }
  ```

---

### Recipe 4: Pre-flight Verification & Linting via CLI/API
Run the automated validator endpoint before writing to database or merging Git presets:

```bash
curl -X POST http://localhost:4000/api/validator/check \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "views": [
        { "view": "cv_doc", "path": "cv_s3", "isFile": true, "resolvePaths": [{"id": 1}] }
      ]
    }
  }'
```

**Expected Linter Response:**
```json
{
  "isValid": false,
  "issues": [
    {
      "severity": "error",
      "path": "views[0] (cv_doc)",
      "message": "Ditemukan 'resolvePaths' pada isFile view 'cv_doc'. Ini memicu runtime error '500 invalid input syntax for type uuid' di ATS!"
    }
  ]
}
```

---

### Recipe 5: Local Presets Sync (Push/Pull with Backup)
The Tenant Studio BFF maintains synchronization between disk preset files (`/Users/.../test_redis_stream/stable/*.json`) and the live Neon database:
1. **Safety Backup:** Every write to a local disk preset automatically creates a timestamped `.bak` backup file.
2. **Pull from DB to Local:**
   Fetches `tenant_studio.tenant_configurations` and writes updated JSON to the designated disk directory.
3. **Push from Local to DB:**
   Reads local disk JSON, parses and executes pre-flight validation, and writes to `tenant_studio.tenant_configurations` while creating a new version entry in `tenant_studio.tenant_config_histories`.

---

### Recipe 6: Point-in-Time Audit Rollback & History Recovery
If a misconfiguration is committed to production:
1. Query audit snapshots:
   ```sql
   SELECT id, version, change_summary, author_name, created_at 
   FROM tenant_studio.tenant_config_histories 
   WHERE config_id = 'target-config-uuid' 
   ORDER BY version DESC;
   ```
2. Retrieve the known-good version (e.g. `version = 5`).
3. Restore by writing the previous snapshot's `config_value` back into `tenant_studio.tenant_configurations` with summary: `"Rollback to version 5"`.

---

## 9. Automated Verification Checklist for AI Agents

Whenever an AI coding assistant is tasked with creating, editing, refactoring, or reviewing a `tenant_configuration`, it **MUST** perform this systematic 10-point audit:

- [ ] **1. Valid JSON Syntax:** Validated with `JSON.parse` with zero trailing commas or malformed quotes.
- [ ] **2. 2-Space Standard Indentation:** Formatted cleanly with `JSON.stringify(config, null, 2)`.
- [ ] **3. Array Views Validation:** Every element in `views` possesses a non-empty `view` and a valid `path`.
- [ ] **4. Unique View Keys:** No duplicate `view` identifiers exist across the entire `views` array.
- [ ] **5. Critical ATS Guardrail:** Zero occurrences of `isFile: true` combined with `resolvePaths`!
- [ ] **6. CustomData Alignment:** Every key declared in `customData.fields` has a corresponding view in `views`.
- [ ] **7. Type & Operator Concordance:** Filter operators align with field data types (e.g. no `contains` on numbers or UUIDs).
- [ ] **8. PII Masking & Decryption:** Sensitive identification and financial fields declare `resolveDecrypted`.
- [ ] **9. Audit History Snapshot:** Changes committed to Neon PostgreSQL record a descriptive `change_summary`.
- [ ] **10. Redis Stream Event Broadcast:** Verification that config updates publish an invalidation event to worker nodes.

---
*End of Tenant Configuration Skill & Architectural Specification.*
