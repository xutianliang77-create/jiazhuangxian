# PROGRESS_LOG

## Session Handoff Status

### Current Work

P0 medical validation foundation on top of CodeClaw: local SQLite storage, Python image-worker, model-gateway queue/worker skeleton with detector adapter boundaries, config checks, and artifact conventions, medical MCP wrappers, seeded medical knowledge, medical knowledge ingestion, local MCP configuration examples, the first medical Web/API + UI case workflow slice, and a validation medical agent worker with real image QC handoff, detector result persistence, TI-RADS feature persistence, TI-RADS rule calculation persistence, structured report draft persistence, and deterministic safety-review audit persistence.

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
- Added verification-version medical write APIs: `POST /v1/web/medical/patients`, `POST /v1/web/medical/studies`, and `POST /v1/web/medical/images`.
- Medical write APIs reuse `MedicalCaseRepo` and support manual validation registration for patient, study, and ultrasound image records.
- Medical write APIs derive `study.createdBy` from the authenticated Web user by default.
- Medical write APIs return structured errors for disabled medical storage, invalid request bodies, bad foreign-key references, and duplicate SQLite records.
- Added Web server tests for manual patient/study/image registration and invalid image study references.
- Added `services/model-gateway/app/detectors.py` as the first detector adapter boundary.
- Detector worker now selects YOLOv11, RT-DETR, or RF-DETR adapters by `model_name` without changing the HTTP enqueue API or SQLite `model_job` contract.
- YOLOv11 adapter is wired for Ultralytics YOLO with weights from `JZX_YOLOV11_WEIGHTS`.
- RT-DETR adapter is wired for Ultralytics RTDETR with weights from `JZX_RTDETR_WEIGHTS`.
- RF-DETR adapter boundary is reserved with `JZX_RFDETR_WEIGHTS`; runtime implementation remains explicit pending package selection.
- Unconfigured detector jobs still fail clearly with `detector_not_configured`, now including selected adapter, model family, model name/version, and missing environment variables.
- Updated model-gateway documentation with detector adapter configuration examples.
- Added `npm run medical:init-db` for project-local validation storage initialization.
- `medical:init-db` creates/migrates a local SQLite `data.db`, initializes a CodeClaw RAG DB, reports seed counts, and can import the checked-in sample medical knowledge manifest with `--ingest-sample-knowledge`.
- Added tests for default init-db paths and sample-knowledge initialization.
- Updated the medical knowledge ingestion guide with the init-db command.
- Added typed frontend endpoints for `createMedicalPatient`, `createMedicalStudy`, and `createMedicalImage`.
- Added a compact `Manual Case` registration form to the React `MedicalPanel`.
- Manual case registration now creates patient, study, and image records in sequence, then refreshes the medical summary and recent studies list.
- Manual case UI captures validation fields for external patient id, accession number, artifact/file URI, sex, birth year, clinical context, file type, width, and height.
- Added MedicalPanel tests for successful manual registration and registration error handling.
- Extended medical knowledge ingestion to accept Markdown manifest files with YAML front matter.
- Markdown knowledge ingestion now reads `document`, optional `chunk_defaults`, and optional `report_templates` from front matter, then chunks the Markdown body by headings.
- Added `examples/medical-knowledge/acr-tirads-validation.md` as the first Markdown medical knowledge sample.
- Updated the knowledge ingestion guide with Markdown import usage.
- Added medical knowledge embedding backfill service under `src/medical/knowledge/embeddingBackfill.ts`.
- Added `npm run medical:embed` to backfill embeddings for approved medical RAG chunks only.
- `medical:embed` uses the existing CodeClaw OpenAI-compatible embedding client and writes vectors to `rag_chunks.embedding`.
- Added embedding backfill tests using a fake embedding endpoint, including a guard that non-medical RAG chunks are not touched.
- Updated the knowledge ingestion guide with embedding backfill usage and environment variables.
- Added `GET /v1/web/medical/studies/:studyId` for the medical study detail bundle, including patient, study, images, analysis sessions, and agent tasks.
- Added `POST /v1/web/medical/studies/:studyId/analyze` to create a queued validation analysis session from a registered image row.
- The validation analysis API now creates the first fixed medical agent task chain: image QC, nodule detection, TI-RADS feature classification, TI-RADS rule calculation, report draft, and safety review.
- Extended `MedicalCaseRepo.getStudyBundle()` so UI and API callers can read the study's queued/running/completed agent tasks with the rest of the case context.
- Extended the React `MedicalPanel` with selectable recent studies, a compact study detail view, image rows, and a per-image `启动分析` action.
- Added frontend endpoint types and API helpers for study detail bundles, analysis sessions, and agent task records.
- Added `src/medical/agentWorker.ts` as the validation medical agent task worker.
- Added root scripts `npm run medical-agent-worker` and `npm run medical-agent-worker:once`.
- Added `MedicalCaseRepo` support for claiming queued agent tasks, moving tasks to `waiting_model`, completing/failing tasks, blocking downstream queued tasks, and refreshing analysis session status.
- Added `MedicalCaseRepo` support for creating and reading `model_job` rows from the same validation SQLite database.
- The validation medical agent worker now runs synchronous placeholder tasks for image QC, TI-RADS feature classification, TI-RADS calculation, report draft, and safety review.
- `detect_nodules` agent tasks now create a `thyroid.detect_nodules` `model_job`, move to `waiting_model`, and later sync model success/failure back into the agent task chain.
- Updated local MCP setup documentation so Web, medical-agent-worker, model-gateway, and model-worker use the same `JZX_DATA_DB`.
- Added `services/model-gateway/app/config_check.py` to report Python runtime, base packages, detector runtime packages, detector weight env/path/readability, Torch/CUDA availability, and GPU device metadata.
- Added `GET /model/v1/config/check` to the model-gateway HTTP API.
- Added root script `npm run model-gateway:check`.
- Updated model-gateway and MCP setup docs with configuration check usage.
- Added `services/model-gateway/app/artifacts.py` for standardized detector output artifact writing.
- Successful `thyroid.detect_nodules` model-worker runs now write `artifact://model-output/thyroid-detect-nodules/<study>/<image>/<job>/detections.json` and persist the URI to `model_job.artifact_uri`.
- Detection artifact JSON now standardizes schema version, pixel `xyxy` coordinate system, model provenance, detections, warnings, raw output, overlay URI slot, and future model-comparison slots.
- Added `docs/MODEL_ARTIFACT_CONVENTIONS.md` and linked it from `README.md`.
- Added an async medical agent worker entrypoint so `image_qc` can call the Python image-worker HTTP service while preserving the existing synchronous validation path.
- `medical-agent-worker` now calls `/image/v1/image-quality-check` for `image_qc`, writes successful quality metadata back to the `image` row, and returns a structured non-blocking warning when image-worker is unavailable.
- Updated `scripts/medical-agent-worker.ts` to use the async worker and accept `--image-worker-url` / `JZX_IMAGE_WORKER_URL`.
- Updated local MCP setup documentation with the real `image_qc` runtime flow and image-worker fallback behavior.
- Added `MedicalCaseRepo.upsertNodule()` and `listNodulesByStudy()` for detector result persistence.
- When a `thyroid.detect_nodules` model job succeeds, `medical-agent-worker` now writes returned detections into the `nodule` table and includes `persisted_nodules` in the agent task output.
- Added `MedicalCaseRepo.createTiradsFeature()`, `listTiradsFeaturesByStudy()`, `createTiradsResult()`, and `listTiradsResultsByStudy()` for structured TI-RADS storage.
- `calculate_tirads` agent tasks now read persisted structured features, call the existing ACR TI-RADS 2017 rule engine, write `tirads_result`, and return persisted result ids plus evidence rules.
- `classify_tirads_features` agent tasks now persist validation structured feature candidates from task input into `tirads_feature` when candidates are provided, while preserving a clear not-configured warning when no feature model/input exists.
- Added `MedicalCaseRepo.createReport()`, `getReport()`, `listReportsByStudy()`, and active report-template text lookup for report draft storage.
- `draft_report` agent tasks now read persisted nodules and the latest TI-RADS results, render the validation thyroid ultrasound report template, write a `draft` row to `report`, and return structured evidence.
- Report drafts are explicitly AI-assisted validation drafts and always carry `doctor_review_required`; final confirmation remains outside the current no-permissions validation scope.
- Added `MedicalCaseRepo.listActiveSafetyRules()`, `createAuditLog()`, `getAuditLog()`, and `listAuditLogsByStudy()` for deterministic safety review and audit tracking.
- `safety_review` agent tasks now read the latest report draft, active `safety_rules`, image quality metadata, and persisted nodules, then detect final-diagnosis wording, unsupported FNA/follow-up suggestions, low confidence/low quality, missing millimeter calibration, and PHI-pattern risks.
- Safety review results are written to `audit_log` with the agent task id as `trace_id`, while the task output returns `safety_status`, issues, checked rule count, and `doctor_review_required`.

### Verification

- `npm run typecheck` passed.
- `npm run typecheck` passed after the medical knowledge ingestion slice.
- `npm run typecheck` passed after the medical Web/API write slice.
- `npm test` passed after the medical Web/API slice: 172 files passed, 1 skipped; 1661 tests passed, 3 skipped.
- `npm test` passed after the medical knowledge ingestion slice: 173 files passed, 1 skipped; 1665 tests passed, 3 skipped.
- `npm test` passed after the medical Web/API write slice: 173 files passed, 1 skipped; 1667 tests passed, 3 skipped.
- Targeted medical Web/API tests passed after write routes: `npm test -- --run test/unit/channels/web/server.test.ts` with 40 tests.
- Targeted lint for the Web/API write files passed: `npx eslint src/channels/web/medicalHandlers.ts src/channels/web/server.ts test/unit/channels/web/server.test.ts`.
- `python3 -m unittest discover services/model-gateway/tests` passed after detector adapter boundary work: 7 tests.
- Targeted init-db tests passed: `npm test -- --run test/unit/medical/initDbCli.test.ts test/unit/medical/knowledgeIngestion.test.ts`.
- Targeted lint for init-db files passed: `npx eslint scripts/medical-init-db.ts test/unit/medical/initDbCli.test.ts`.
- CLI smoke test passed with a temporary SQLite/RAG DB: `npm run medical:init-db -- --data-db <tmp>/data.db --rag-db <tmp>/rag.db --workspace /Users/xutianliang/Downloads/jiazhuangxian --ingest-sample-knowledge`.
- `npm test` passed after init-db work: 174 files passed, 1 skipped; 1669 tests passed, 3 skipped.
- Targeted MedicalPanel tests passed after manual case UI: `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx` with 5 tests.
- Frontend typecheck passed after manual case UI: `cd web-react && npm run typecheck`.
- Full web-react tests passed after manual case UI: `cd web-react && npm test` with 11 files passed and 38 tests passed.
- `npm run build:web` passed after manual case UI; Vite still reports the existing Monaco chunk-size warning.
- Root `npm run typecheck` passed after manual case UI.
- Targeted knowledge ingestion tests passed after Markdown support: `npm test -- --run test/unit/medical/knowledgeIngestion.test.ts test/unit/medical/initDbCli.test.ts` with 7 tests.
- Targeted lint for knowledge ingestion passed after Markdown support: `npx eslint src/medical/knowledge/ingestion.ts test/unit/medical/knowledgeIngestion.test.ts scripts/medical-ingest.ts scripts/medical-init-db.ts`.
- CLI smoke test passed for Markdown ingestion with a temporary SQLite/RAG DB: `npm run medical:ingest -- --manifest examples/medical-knowledge/acr-tirads-validation.md --data-db <tmp>/data.db --rag-db <tmp>/rag.db --workspace /Users/xutianliang/Downloads/jiazhuangxian`.
- `npm test` passed after Markdown ingestion support: 174 files passed, 1 skipped; 1670 tests passed, 3 skipped.
- Targeted embedding backfill tests passed: `npm test -- --run test/unit/medical/embeddingBackfill.test.ts test/unit/medical/knowledgeIngestion.test.ts`.
- `npm test` passed after embedding backfill command: 175 files passed, 1 skipped; 1671 tests passed, 3 skipped.
- Targeted study detail/analysis API tests passed: `npm test -- --run test/unit/medical/caseRepo.test.ts test/unit/channels/web/server.test.ts` with 45 tests.
- Targeted MedicalPanel tests passed after study detail/analysis UI: `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx` with 6 tests.
- Root `npm run typecheck` passed after study detail/analysis UI.
- Frontend typecheck passed after study detail/analysis UI: `cd web-react && npm run typecheck`.
- Full web-react tests passed after study detail/analysis UI: `cd web-react && npm test` with 11 files passed and 39 tests passed.
- Targeted lint passed for modified backend files and modified `web-react` files using each package's ESLint config.
- `npm run build:web` passed after study detail/analysis UI; Vite still reports the existing Monaco chunk-size warning.
- `npm test` passed after study detail/analysis UI: 175 files passed, 1 skipped; 1672 tests passed, 3 skipped.
- `git diff --check` passed after study detail/analysis UI.
- Targeted medical agent worker tests passed: `npm test -- --run test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts` with 6 tests.
- Targeted lint passed for medical agent worker, storage repo, CLI script, and worker tests.
- Root `npm run typecheck` passed after medical agent worker implementation.
- CLI smoke test passed: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `python3 -m unittest discover services/model-gateway/tests` passed after model-gateway config check: 9 tests.
- CLI smoke test passed: `npm run model-gateway:check -- --db <tmp>/data.db` returned degraded JSON with package, weight, and CUDA diagnostics.
- Root `npm run typecheck` passed after model-gateway config check.
- `npm test` passed after model-gateway config check: 176 files passed, 1 skipped; 1674 tests passed, 3 skipped.
- `git diff --check` passed after model-gateway config check.
- `python3 -m unittest discover services/model-gateway/tests` passed after detector artifact conventions: 10 tests.
- Root `npm run typecheck` passed after detector artifact conventions.
- `npm test` passed after detector artifact conventions: 176 files passed, 1 skipped; 1674 tests passed, 3 skipped.
- `git diff --check` passed after detector artifact conventions.
- Targeted medical agent worker/storage tests passed after image QC handoff: `npm test -- --run test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts` with 8 tests.
- Root `npm run typecheck` passed after image QC handoff.
- Targeted lint passed for image QC handoff files: `npx eslint src/medical/agentWorker.ts src/medical/storage/caseRepo.ts scripts/medical-agent-worker.ts test/unit/medical/agentWorker.test.ts`.
- `npm test` passed after image QC handoff: 176 files passed, 1 skipped; 1677 tests passed, 3 skipped.
- `python3 -m unittest discover services/image-worker/tests` passed after image QC handoff: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after image QC handoff: 10 tests.
- CLI smoke test passed after image QC handoff: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after image QC handoff.
- Targeted medical agent worker/storage tests passed after detector persistence: `npm test -- --run test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts` with 10 tests.
- Root `npm run typecheck` passed after detector persistence.
- Targeted lint passed for detector persistence files.
- `npm test` passed after detector persistence: 176 files passed, 1 skipped; 1678 tests passed, 3 skipped.
- `python3 -m unittest discover services/image-worker/tests` passed after detector persistence: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after detector persistence: 10 tests.
- CLI smoke test passed after detector persistence: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after detector persistence.
- Targeted TI-RADS rule path tests passed: `npm test -- --run test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts test/unit/medical/mcp-server.test.ts test/unit/medical/seed-data.test.ts` with 26 tests.
- Root `npm run typecheck` passed after TI-RADS result persistence.
- Targeted lint passed for TI-RADS result persistence files.
- `npm test` passed after TI-RADS result persistence: 176 files passed, 1 skipped; 1680 tests passed, 3 skipped.
- `python3 -m unittest discover services/image-worker/tests` passed after TI-RADS result persistence: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after TI-RADS result persistence: 10 tests.
- CLI smoke test passed after TI-RADS result persistence: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after TI-RADS result persistence.
- Targeted TI-RADS feature persistence tests passed: `npm test -- --run test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts test/unit/medical/mcp-server.test.ts test/unit/medical/seed-data.test.ts` with 27 tests.
- Root `npm run typecheck` passed after TI-RADS feature persistence.
- Targeted lint passed for TI-RADS feature persistence files.
- `npm test` passed after TI-RADS feature persistence: 176 files passed, 1 skipped; 1681 tests passed, 3 skipped.
- `python3 -m unittest discover services/image-worker/tests` passed after TI-RADS feature persistence: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after TI-RADS feature persistence: 10 tests.
- CLI smoke test passed after TI-RADS feature persistence: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after TI-RADS feature persistence.
- Targeted report draft persistence tests passed: `npm test -- --run test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts test/unit/medical/mcp-server.test.ts test/unit/medical/seed-data.test.ts` with 29 tests.
- Root `npm run typecheck` passed after report draft persistence.
- Targeted lint passed for report draft persistence files.
- `npm test` passed after report draft persistence: 176 files passed, 1 skipped; 1683 tests passed, 3 skipped.
- `python3 -m unittest discover services/image-worker/tests` passed after report draft persistence: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after report draft persistence: 10 tests.
- CLI smoke test passed after report draft persistence: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after report draft persistence.
- Targeted safety review audit tests passed: `npm test -- --run test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts test/unit/medical/mcp-server.test.ts test/unit/medical/seed-data.test.ts` with 31 tests.
- Root `npm run typecheck` passed after safety review audit persistence.
- Targeted lint passed for safety review audit persistence files.
- `npm test` passed after safety review audit persistence: 176 files passed, 1 skipped; 1685 tests passed, 3 skipped.
- `python3 -m unittest discover services/image-worker/tests` passed after safety review audit persistence: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after safety review audit persistence: 10 tests.
- CLI smoke test passed after safety review audit persistence: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after safety review audit persistence.
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

1. Replace the remaining validation placeholder outputs with real feature-classifier model, report-generation, and safety-review calls where dependencies are configured.
2. Add UI/API visibility for model-gateway config check results and detector artifacts in the Medical workstation.
3. Add overlay image generation for detector bbox results.
4. Add PDF-to-manifest parsing when representative guideline PDFs are available.
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
