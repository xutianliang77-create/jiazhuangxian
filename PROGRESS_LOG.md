# PROGRESS_LOG

## Session Handoff Status

### Current Work

P0 medical validation foundation on top of CodeClaw: local SQLite storage, Python image-worker, model-gateway queue/worker skeleton, medical MCP wrappers, seeded medical knowledge, medical knowledge ingestion, local MCP configuration examples, and the first medical Web/API slice.

### Completed

- Confirmed the GitHub repository: `https://github.com/xutianliang77-create/jiazhuangxian`.
- Initialized this directory as a fresh project repository and tracked `origin/main`.
- Synced CodeClaw source into the repository root as the working development baseline: `src/`, `packages/`, `web-react/`, `web/`, `scripts/`, `test/`, `docker/`, `examples/`, and `stubs/`.
- Kept `CodeClaw/` as the local original source reference checkout; it is ignored and not committed directly.
- Moved Markdown design documents into `docs/`.
- Created baseline directories for `data/artifacts`, `services/image-worker`, `services/model-gateway`, and `services/model-evaluation`.
- Updated project metadata to `jiazhuangxian` while preserving the compatible `codeclaw` CLI bin alias.
- Excluded the local `CodeClaw/` reference checkout from Vitest, local glob, LSP, and RAG traversal so tests and indexes operate on the root working baseline.
- Aligned baseline tests with the current builtin `radiology` skill, project package name, and default hidden reasoning-stream behavior.
- Added `006_medical_validation_schema.sql` for the verification SQLite schema: patient/study/image, import jobs, analysis sessions, medical agent tasks, model jobs, nodules, TI-RADS outputs, reports, doctor reviews, medical knowledge metadata, report templates, evidence links, safety rules, case knowledge, and medical audit logs.
- Confirmed the verification version does not create production permission/RBAC tables such as `app_user`, `role`, `permission`, `resource_acl`, or `service_account`.
- Added `MedicalCaseRepo` under `src/medical/storage` for the first local data flow: manual/CSV patient import, study creation, ultrasound image registration, analysis session creation, and agent task persistence.
- Added unit tests for the medical schema and repository flow, including foreign-key enforcement for image imports.
- Added the Python `services/image-worker` skeleton with Pydantic schemas and a standard-library HTTP server.
- Added initial image-worker endpoints: `/health`, `/image/v1/parse-dicom`, `/image/v1/deidentify-dicom`, `/image/v1/render-preview`, `/image/v1/preprocess-ultrasound`, `/image/v1/extract-calibration`, `/image/v1/image-quality-check`, and `/image/v1/copy-input`.
- Added artifact URI resolution for `artifact://` paths and structured dependency-missing errors when `pydicom`/Pillow/OpenCV dependencies are unavailable.
- Added image-worker unittest coverage that starts the service, checks artifact path safety, and runs a raster image quality check.
- Added `packages/medical-mcp` as the CodeClaw MCP wrapper package for the medical platform.
- Added MCP tools for `image.ParseDicom`, `image.DeidentifyDicom`, `image.RenderPreview`, `image.PreprocessUltrasound`, `image.ExtractCalibration`, `image.ImageQualityCheck`, `thyroid.ImageQC`, `thyroid.DetectNodules`, `thyroid.ClassifyTiradsFeatures`, and `thyroid.CalculateTirads`.
- Wired `image.*` and `thyroid.ImageQC` to the Python image-worker over HTTP with `JZX_IMAGE_WORKER_URL`.
- Added ACR TI-RADS 2017 rule calculation for `thyroid.CalculateTirads`; detector and feature-classifier tools currently return explicit `model_gateway_not_configured` responses until model-gateway is implemented.
- Added root `npm run medical:mcp` script.
- Added `007_medical_seed_rules_templates.sql` with deterministic seed rows for ACR TI-RADS 2017 rules, Chinese report templates, and medical safety rules.
- Seeded 36 active ACR TI-RADS rows: feature scoring rules, category thresholds, and size-based follow-up/FNA recommendation rules.
- Seeded 3 report templates: thyroid ultrasound draft, TI-RADS explanation, and doctor review summary.
- Seeded 5 safety rules covering final-diagnosis wording, unsupported FNA/follow-up recommendations, low-confidence automation, missing calibration for millimeter measurements, and PHI leakage.
- Added seed-data tests that verify row counts, representative rules, template activation, safety codes, idempotence, and alignment between `thyroid.CalculateTirads` evidence rule codes and DB rows.
- Added the Python `services/model-gateway` skeleton with Pydantic schemas, standard-library HTTP server, and SQLite `model_job` queue store.
- Added model-gateway endpoints: `/health`, `/model/v1/infer/thyroid/detect-nodules`, and `/model/v1/jobs/{job_id}`.
- Added root scripts `npm run image-worker` and `npm run model-gateway`.
- Wired `thyroid.DetectNodules` in `packages/medical-mcp` to call model-gateway and create queued `model_job` records; unreachable gateway errors return structured JSON.
- Added model-gateway unittest coverage for service startup, job enqueue, job query, and queue reopen.
- Added `008_medical_terms_seed.sql` with validation terminology for thyroid nodules, TI-RADS features, FNA, and follow-up.
- Added medical knowledge MCP tools: `medical.GetTiradsRule`, `medical.GetReportTemplate`, and `medical.NormalizeTerm`.
- Added `MedicalKnowledgeStore` for read-only SQLite access to `tirads_rules`, `report_templates`, and `medical_terms`, defaulting to `JZX_DATA_DB` or CodeClaw `~/.codeclaw/data.db`.
- Added tests for knowledge tool happy paths and missing-database structured errors.
- Added model-gateway queue state transitions: claim next queued job, mark running, complete succeeded jobs, and fail running jobs with structured error JSON.
- Added the model-gateway validation worker loop under `services/model-gateway/app/worker.py`.
- Added root scripts `npm run model-worker` and `npm run model-worker:once`.
- Current validation worker does not load YOLOv11/RT-DETR weights yet; it consumes `thyroid.detect_nodules` jobs and marks them `failed` with `detector_not_configured`, preserving the queue contract for the future GPU detector adapter.
- Added model-gateway worker tests for queue claim, completion, unconfigured detector failure, and idle behavior.
- Added `examples/mcp.medical.validation.json` as a project-level CodeClaw MCP config sample for the `medical` MCP server.
- Added `docs/MEDICAL_MCP_SETUP.md` documenting the local validation startup order, `.mcp.json` usage, `image-worker`/`model-gateway` dependency boundary, sample `/mcp call` checks, and common troubleshooting cases.
- Linked the medical MCP setup guide from `README.md`.
- Added a unit test ensuring the MCP config example remains parseable by the existing CodeClaw MCP config loader.
- Added the first medical Web API endpoint: `GET /v1/web/medical/summary`.
- The medical summary API returns storage enabled state, patient/study/image/analysis/nodule/report counts, pending review count, model job status counts, agent task status counts, and recent study rows.
- Added the React `Medical` tab and `MedicalPanel` doctor-workstation skeleton with counts, queue state, recent studies, disabled-storage state, refresh, and retryable error handling.
- Added frontend endpoint types for `MedicalSummary` and `MedicalRecentStudy`.
- Added medical Web/API tests covering disabled storage, authenticated summary responses, wrong-token handling, and MedicalPanel rendering/error states.
- Added a small web-react test setup storage shim so the full frontend test suite has a complete `localStorage` implementation in the current happy-dom environment.
- Added the medical knowledge ingestion service under `src/medical/knowledge`.
- Knowledge ingestion currently accepts approved JSON manifest files, requires `review_status = approved` and `approved_by`, and records failed ingestion jobs for invalid manifests.
- Knowledge ingestion writes document provenance to `medical_documents`, chunk provenance to `medical_chunk_metadata`, optional templates to `report_templates`, and job state to `knowledge_ingestion_job`.
- Knowledge ingestion syncs approved chunks into the existing CodeClaw RAG store via `rag_chunks` and `rag_terms`; it does not create a second RAG implementation.
- Added stale chunk cleanup when a document manifest is re-ingested with fewer chunks.
- Added the root CLI script `npm run medical:ingest`.
- Added `examples/medical-knowledge/acr-tirads-validation.manifest.json` as the first validation manifest sample.
- Added `docs/MEDICAL_KNOWLEDGE_INGESTION.md` and linked it from `README.md`.
- Added unit tests covering successful ingestion, re-ingestion cleanup, rejection of draft documents, failed job tracking, and loading the checked-in manifest.

### Verification

- `npm run typecheck` passed.
- `npm run typecheck` passed after the medical knowledge ingestion slice.
- `npm test` passed after the medical Web/API slice: 172 files passed, 1 skipped; 1661 tests passed, 3 skipped.
- `npm test` passed after the medical knowledge ingestion slice: 173 files passed, 1 skipped; 1665 tests passed, 3 skipped.
- Targeted medical knowledge ingestion tests passed: `npm test -- --run test/unit/medical/knowledgeIngestion.test.ts`.
- Targeted lint for the new ingestion files passed: `npx eslint src/medical/knowledge/ingestion.ts scripts/medical-ingest.ts test/unit/medical/knowledgeIngestion.test.ts`.
- CLI smoke test passed with a temporary SQLite/RAG DB: `npm run medical:ingest -- --manifest examples/medical-knowledge/acr-tirads-validation.manifest.json --data-db <tmp>/data.db --rag-db <tmp>/rag.db --workspace /Users/xutianliang/Downloads/jiazhuangxian`.
- Targeted MCP config example tests passed: `npm test -- --run test/unit/medical/mcp-config-example.test.ts test/unit/mcp/config.test.ts test/unit/medical/mcp-server.test.ts`.
- Targeted medical Web API tests passed: `npm test -- --run test/unit/channels/web/server.test.ts`.
- Targeted MedicalPanel tests passed: `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx`.
- Full web-react tests passed: `cd web-react && npm test` with 11 files passed and 36 tests passed.
- Targeted storage tests passed: `npm test -- --run test/unit/medical/caseRepo.test.ts test/unit/storage/migrate.test.ts`.
- Targeted medical MCP tests passed: `npm test -- --run test/unit/medical/mcp-server.test.ts test/unit/medical/caseRepo.test.ts`.
- Targeted medical knowledge tests passed: `npm test -- --run test/unit/medical/mcp-server.test.ts test/unit/medical/seed-data.test.ts`.
- Targeted seed tests passed: `npm test -- --run test/unit/medical/seed-data.test.ts test/unit/medical/mcp-server.test.ts test/unit/storage/migrate.test.ts`.
- `python3 -m unittest discover services/image-worker/tests` passed: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed: 5 tests.
- `npm run model-worker:once` passed against an empty temporary queue and returned idle status.
- `git diff --check` passed.
- `npx eslint test/unit/medical/seed-data.test.ts packages/medical-mcp` passed.
- `npx eslint packages/medical-mcp test/unit/medical/mcp-server.test.ts` passed.
- `web-react`: `npm run typecheck` passed.
- `npm run build:web` passed.
- `git diff --cached --check` passed.
- `web-react npm ci` reported 8 npm audit findings in upstream frontend dependencies; no functional failure observed.
- `npm run lint` is currently blocked by two existing unrelated lint findings:
  - `src/reports/renderHtml.ts`: unused `ReportChart` import/type.
  - `test/golden/runner/meta-router.ts`: unnecessary escaped `\-`.
- GitHub push now works with `git -c http.version=HTTP/1.1 push origin main` when the default HTTP path is slow.

### Background Tasks

None.

### Next Session Priorities

1. Add medical Web/API write routes for manual validation patient/study/image registration.
2. Add the first real detector adapter boundary for YOLOv11 / RT-DETR without changing the queue/API contract.
3. Add a validation database initialization command if a project-local medical SQLite DB is preferred over the default `~/.codeclaw/data.db`.
4. Extend knowledge ingestion with PDF/Markdown parsing and embedding backfill once the manifest path is stable.
5. Fix or intentionally suppress the two pre-existing lint findings when lint hygiene becomes the next task.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short --branch
find src packages web-react docs services data -maxdepth 3 -type f | sort
npm test -- --run test/unit/medical/caseRepo.test.ts test/unit/storage/migrate.test.ts
npm test -- --run test/unit/medical/mcp-server.test.ts
npm test -- --run test/unit/medical/seed-data.test.ts
npm test -- --run test/unit/medical/knowledgeIngestion.test.ts
python3 -m unittest discover services/image-worker/tests
python3 -m unittest discover services/model-gateway/tests
```
