# PROGRESS_LOG

## Session Handoff Status

### Current Work

P0 medical validation foundation on top of CodeClaw: local SQLite storage, Python image-worker, model-gateway queue/worker skeleton with detector adapter boundaries, remote RTX 5090 GPU runtime setup scripts, config checks, artifact conventions and overlay generation, medical MCP wrappers, seeded medical knowledge, medical knowledge ingestion, first-version thyroid guideline knowledge base, approved medical RAG evidence search, public thyroid ultrasound dataset bootstrap, TN3K mask-to-bbox detection annotation conversion, cleaned official TN5000 detection conversion, YOLO11m strict detector training, RF-DETR-Medium主检测模型决策, local MCP configuration examples, the first medical Web/API + UI case workflow slice, and a validation medical agent worker with real image QC handoff, detector result persistence, TI-RADS feature persistence, TI-RADS rule calculation persistence, structured report draft persistence, deterministic safety-review audit persistence, study-detail result visualization, doctor review confirmation, model-gateway/artifact visibility plus overlay preview, doctor-side nodule bbox revision with numeric and overlay drag workflows, report text editing, and visible review/audit change traces in the doctor workstation.

### Latest Update - 2026-05-13 TI-RADS Prefill v2

- Upgraded heuristic TI-RADS auto-prefill from geometry defaults to `tirads-prefill-heuristic-v2`.
- `measure_nodules` model jobs now carry the latest segmentation contour when available, so measurement output and downstream feature prefill can use mask/boundary context instead of only bbox geometry.
- model-gateway static measurement now emits `tirads_prefill_metrics` with boundary compactness/fill-ratio and optional local grayscale texture cues from image + mask.
- `classify_tirads_features` now builds low-confidence TI-RADS candidates from segmentation, measurement, texture, and boundary cues:
  - composition from cystic/anechoic texture fraction when available, otherwise conservative solid default;
  - echogenicity from local grayscale ratio when available;
  - shape from mask/bbox measurement dimensions;
  - margin from contour compactness/fill-ratio, while bbox fallback remains low-confidence;
  - echogenic foci from bright-pixel fraction when available.
- The safety boundary is unchanged: v2 prefill still persists `requiresReview=true`, writes `prefill_evidence`, and `calculate_tirads` remains gated until doctor confirmation.

### Latest Update - 2026-05-13 Report Editor Productization

- Strengthened the medical report editor product workflow:
  - report row now displays report version, editable/read-only state, evidence fingerprint, evidence lock status, latest review action, and update time;
  - evidence panel displays fixed evidence count, source labels, and fingerprint;
  - saved structured editor metadata now records evidence lock, evidence count/sources/fingerprint, base report id, and base report update time;
  - confirmed reports show a read-only pending-archive notice;
  - archived reports are read-only in UI and protected by backend state guards.
- Tightened report review state transitions:
  - only `draft` and `pending_review` reports can be approved/revised/rejected;
  - only `confirmed` reports can be archived;
  - archived reports cannot be directly revised through the Web API or storage repository.
- Updated `docs/TECHNICAL_DESIGN.md`, `docs/DEVELOPMENT_PLAN.md`, and `docs/UI_DESIGN.md` to match the implemented validation-version report editor workflow.

### Latest Update - 2026-05-11 GPU E2E

- Completed one real RTX 5090 GPU E2E smoke on TN5000 image `000016`.
- Remote `model-gateway:check --strict` returned `ready` with RF-DETR, YOLOv11, RT-DETR, SAM2 static/video, and nnU-Net Tight ROI available.
- RF-DETR-Medium primary detection succeeded with bbox `[312.55, 93.54, 539.81, 217.30]` and confidence `0.8938`.
- YOLO11m comparator succeeded with bbox `[314.01, 92.88, 539.33, 222.87]`; comparison IoU was `0.9443` and status `matched`.
- nnU-Net Tight ROI segmentation succeeded without bbox fallback and wrote mask artifact `mask_nodule_1.png`.
- Mask measurement succeeded with `229 px x 130 px`, validation spacing `0.1 mm/px`, and `22.9 mm x 13.0 mm`.
- Wrote the validation report to `docs/GPU_E2E_VALIDATION_20260511.md` and copied preview assets to `docs/assets/gpu-e2e-20260511/`.
- Pulled raw model artifacts locally under `data/artifacts/gpu-e2e-20260511/`; these remain local runtime artifacts and are not intended for Git.
- Added 5090 AI server mode: `medical-agent-worker` can now enqueue detect/segment/measure tasks through `JZX_REMOTE_MODEL_GATEWAY_URL`, persist a local shadow `model_job`, poll `/model/v1/jobs/{job_id}`, and sync remote output back into local SQLite for UI/report/audit flows.
- Added `scripts/start-5090-ai-server.sh` and `docs/REMOTE_5090_AI_SERVER.md` for starting 5090 gateway/worker with the verified RF-DETR, YOLO11m, RT-DETR, nnU-Net, and SAM2 defaults.
- Added remote artifact proxy support: 5090 `model-gateway` serves `GET /model/v1/artifacts?uri=artifact://...`, and Mac Web `GET /v1/web/medical/artifacts` now fetches and caches missing remote overlay/mask/JSON artifacts through `JZX_REMOTE_MODEL_GATEWAY_URL`.
- Changed the 5090 server default queue DB to `data/artifacts/model-gateway/model-gateway.db` so remote model jobs do not depend on Mac-local `study/image` foreign-key rows.
- Completed one Mac doctor-workstation UI smoke against the 5090 AI server: Web-created case `UI-SMOKE-5090-ACC2`, remote RF-DETR detection, nnU-Net tight ROI segmentation, mask measurement, report draft, safety review, artifact proxy preview, overlay display, model evidence panel, and structured report editor all rendered successfully.
- Wrote smoke documentation to `docs/UI_SMOKE_5090_REMOTE_ARTIFACT_20260511.md`; local runtime evidence is under `data/artifacts/ui-smoke-5090-20260511-174233/`.
- Correction after re-checking `TECHNICAL_DESIGN.md`: the smoke validates detection, segmentation, measurement, artifact proxy, and doctor-workstation display, but not the full TI-RADS/Qwen report loop. The successful smoke DB has empty `tirads_feature` and `tirads_result` tables because `TiradsFeatureAgent` returned `model_status=not_configured`; Qwen3.6 main-report validation must wait until structured TI-RADS features and rule results exist.
- Added the validation-version doctor structured TI-RADS feature entry path: `POST /v1/web/medical/nodules/:id/tirads-features` validates ACR feature enums, auto-fills size from the latest measurement when available, persists `tirads_feature`, audits `medical.tirads_feature.submit`, and queues `calculate_tirads -> draft_report -> safety_review`. The Medical Workstation now exposes selects for composition, echogenicity, shape, margin, and echogenic foci on each nodule row.
- Real-demo report-generation policy adjusted after Qwen validation: current 5090 LM Studio had `qwen/qwen3.6-35b-a3b` loaded with `loaded_context_length=4096`; provider calls reached the endpoint but spent output budget in `reasoning_content`, leaving final JSON content empty. For live demos, run the image/model/measurement/TI-RADS/rule/template evidence chain first, then manually load Qwen before the main-report LLM stage.
- Added a Medical Workstation real-demo notice in the Reports area and per template-generated report, explicitly telling the operator to manually load `qwen/qwen3.6-35b-a3b` on the 5090 before running `draft_report / safety_review`. The UI also makes clear that unloaded-Qwen mode still preserves rules, knowledge evidence, segmentation, measurement, and a structured template draft.
- Compact provider prompt packaging was added for the future Qwen report stage: full evidence remains persisted in `report.evidence_json`, while the provider receives only the summarized facts and top guideline snippets needed to draft the report.
- Current LM Studio check after operator unload: `qwen/qwen3.6-35b-a3b` state is `not-loaded`; keep it unloaded until the real-demo主报告阶段需要手动加载。

### Latest Update - 2026-05-12 Doctor Workbench + Final Validation Dataset

- Completed the first full doctor-workbench batch-processing lane in `web-react/src/components/panels/MedicalPanel.tsx`.
- Medical queue now supports:
  - queue stage classification from backend summary (`waiting_tirads_confirmation`, `pending_report_review`, `ready_archive`, `analysis_in_progress`, `analysis_failed`, `report_rejected`, `archived`);
  - queue filtering in the workstation;
  - auto-open first study when switching into a non-empty queue;
  - next/previous queue navigation;
  - auto-advance to the next case after TI-RADS confirmation, report confirmation, or archive when the current case leaves the active queue;
  - keyboard shortcuts: `Alt+Up`, `Alt+Down`, `Alt+Enter`, `Alt+Shift+Enter`;
  - top-level `Batch Queue` action bar;
  - empty-queue state with a recommended next queue and one-click switch.
- Report editor/product workflow was strengthened:
  - structured sections now persist through report review actions;
  - `revise` keeps report status at `pending_review` instead of incorrectly confirming;
  - inline review history, fixed evidence notice, and clearer action affordances were added.
- Added no-op / de-dup handling for repeated doctor bbox revision and repeated TI-RADS feature submission so the system does not keep creating duplicate rerun tasks or duplicate reports.
- Added heuristic TI-RADS auto-prefill v1:
  - `classify_tirads_features` can generate low-confidence structured candidates from existing bbox/measurement context;
  - candidates persist as `requiresReview=true`;
  - rule calculation is hard-gated until the doctor confirms the structured TI-RADS features.
- Organized a local final-validation case sample under:
  - `data/artifacts/datasets/final-validation-local-thyroid-case-001/`
  - Includes static deidentified PNGs, review overlays, Labelme polygon JSON, static US DICOM, multi-frame US DICOM, SR DICOM, clinical DOCX evidence, and a structured `metadata/case.json`.
- Current final-validation local case organization is intended for final validation only and should not be mixed into training or tuning splits without explicit review.
- Added a static final-validation runner:
  - `npm run medical:final-validation:static`
  - Script: `scripts/medical-final-validation-static.ts`
  - It reads `metadata/case.json`, stages deidentified static images into `artifact://model-ready/final-validation/...`, can optionally upload them to the remote 5090 `model-gateway`, creates the fixed validation analysis chain, and writes `summary.json` plus `SUMMARY.md` under `data/artifacts/reports/<case_id>/static-e2e-<timestamp>/`.
- Added remote artifact upload support on the 5090 `model-gateway`:
  - `POST /model/v1/artifacts/upload?uri=artifact://...`
  - This lets the Mac-side final-validation runner push local final-validation static images into the remote artifact root before GPU inference.
- Verified the new static final-validation runner in `--prepare-only` mode against `final-validation-local-thyroid-case-001`; report skeleton output was written successfully.
- Corrected the final-validation dataset target to `data/artifacts/datasets/fangdai-thyroid-ultrasound-images/`.
  - Local locked snapshot currently contains 298 images, even though the upstream dataset card describes 900 images; this mismatch is already documented in `metadata/download_summary.json`.
  - Class counts are FTC=100, MTC=99, PTC=99.
  - The dataset has class-folder labels but no bbox/mask annotations, so it is suitable for external static image robustness/subtype-classification validation, not detection/segmentation/TI-RADS metric validation.
  - `npm run medical:final-validation:static -- --dataset-root data/artifacts/datasets/fangdai-thyroid-ultrasound-images --prepare-only` now stages all 298 images under `artifact://model-ready/final-validation/fangdai-thyroid-ultrasound-images/...` and writes per-image class labels plus source paths into the generated summary.
- Added persistent final-validation result storage for later review:
  - Migration `009_final_validation_results.sql` creates `final_validation_run` and `final_validation_image_result`.
  - Each validation run now stores dataset id/root, pipeline mode, remote gateway URL, report artifact URIs, summary JSON, and status.
  - Each image result stores dataset image id, class label, source path, staged artifact, detection/measurement/TI-RADS/report/safety JSON, model artifact URIs, task events, status, and `review_status`.
  - The static final-validation runner writes both file reports and DB rows.
  - Verified a 5090 FangDai per-class smoke run: validation run `01KREJTHRDYFVW0283WD16BAAZ`, 3/3 images succeeded, DB rows are `review_status=unreviewed` for later review.

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
- Extended `MedicalCaseRepo.getStudyBundle()` and the medical study-detail API bundle to include `nodules`, `tiradsFeatures`, `tiradsResults`, `reports`, and `auditLogs`.
- Extended the React `MedicalPanel` study detail view with AI result rows, TI-RADS category/score/recommendation display, report draft preview, and safety audit issue display.
- Added `MedicalCaseRepo.reviewReport()`, `getDoctorReview()`, and `listDoctorReviewsByStudy()` for validation-version doctor review persistence.
- Added `POST /v1/web/medical/reports/:reportId/review` so the doctor workstation can confirm or reject draft reports without introducing RBAC.
- Confirming a report now writes `report.final_text`, `confirmed_by`, `confirmed_at`, a `doctor_review` row, and a `medical.report.approve` audit log; rejecting writes `doctor_review`, report status `rejected`, and audit.
- Extended `MedicalPanel` report cards with `确认报告` and `驳回` actions and a Doctor Reviews section.
- Added `MedicalCaseRepo.listModelJobsByStudy()` and extended study detail bundles with `modelJobs`, including detector `artifactUri` values.
- Added `GET /v1/web/medical/model-gateway/check` as a Web-authenticated proxy for model-gateway `/model/v1/config/check`, returning reachable/error status without requiring medical storage.
- Extended `MedicalPanel` with a Model Gateway status block and a study-detail Model Jobs section that displays model job status, model name/version, attempts, and detection artifact URI.
- Model-worker now generates `overlay.png` beside detector `detections.json` when `return_overlay=true` and the source image is a readable raster artifact.
- Detector artifact JSON now records `artifacts.overlay_image`; overlay generation failures are non-blocking and appear as `overlay_unavailable:*` warnings.
- Added Pillow to model-gateway requirements because overlay rendering needs raster image read/write support.
- Extended the MedicalPanel model-job view to show both detection JSON and overlay artifact URIs.
- Added `GET /v1/web/medical/artifacts?uri=<artifact-uri>` to serve authenticated medical artifact previews from the configured artifact root with path traversal protection and a validation size limit.
- MedicalPanel now renders overlay thumbnails directly from authenticated artifact preview URLs while still showing the original artifact URI for provenance.
- Added `MedicalCaseRepo.reviseNodule()` and `getNodule()` for doctor-side nodule bbox correction in the validation workflow.
- Added `POST /v1/web/medical/nodules/:noduleId/revise` to update a nodule bbox/location/status, mark the source as `doctor`, return the refreshed study bundle, and write a `medical.nodule.revise` audit log with before/after snapshots.
- MedicalPanel nodule cards now include a compact numeric `bbox xyxy` editor and save action, then refresh the detail bundle and audit log view after a doctor correction.
- Updated the medical MCP setup guide so the local validation workflow includes doctor-side nodule bbox revision before final report review.
- Added `src/medical/knowledge/search.ts` to search approved medical RAG chunks with `medical_documents` and `medical_chunk_metadata` provenance, filtering out unapproved knowledge.
- Added MCP tool `medical.SearchGuideline` for evidence-pack retrieval from CodeClaw `rag_chunks` plus medical metadata.
- Added `POST /v1/web/medical/knowledge/search` so the doctor workstation can query approved guideline evidence through the Web API.
- Added a `知识证据` panel to MedicalPanel that displays evidence text, document source/version, section, score, and source line provenance.
- Updated the medical MCP example and knowledge documentation with `JZX_RAG_DB`, the evidence search API, and the `medical.SearchGuideline` call.
- Added `examples/medical-knowledge/thyroid-guidelines-v1.manifest.json` as the first-version thyroid knowledge base with ACR TI-RADS 2017, ATA 2015, EU-TIRADS 2017, C-TIRADS reference boundary, cross-guideline conflict policy, and report evidence safety constraints.
- Changed `medical:init-db --ingest-sample-knowledge` to default to the first-version thyroid guideline knowledge base while keeping the older ACR validation sample available for focused ingestion tests.
- Updated medical knowledge ingestion and MCP setup documentation so local validation initialization now creates the guideline evidence pack in SQLite and CodeClaw RAG by default.
- Added an Overlay Revision workspace in MedicalPanel that displays detector overlay images, lets doctors select a nodule, drag a new bbox on the overlay, and save it through the existing `POST /v1/web/medical/nodules/:noduleId/revise` endpoint.
- Enhanced the report card with editable report text and optional review comments before confirm/reject, using the existing report review endpoint.
- Enhanced doctor review and safety audit rendering so report status/text changes and bbox before/after changes are visible in the workstation.
- Downloaded TN3K to `data/artifacts/datasets/tn3k/raw/TN3K.rar`, extracted it to `data/artifacts/datasets/tn3k/processed/datasets/tn3k`, and preserved local metadata/labels plus sha256 checksums.
- Downloaded the public Sample-of-UD-TN GitHub sample to `data/artifacts/datasets/ud-tn-sample/raw/Sample-of-UD-TN-master` for smoke testing.
- Added `examples/datasets/thyroid-ultrasound-public.manifest.json` as the tracked dataset source/status manifest for TN3K, Sample-of-UD-TN, TN5000, ThyroidXL, ThyUS2Path, Stanford Thyroid Cine-clip, AHU heterogeneous ultrasound, and DDTI.
- Added `docs/PUBLIC_THYROID_ULTRASOUND_DATASETS.md` documenting downloaded paths, access blockers, and recommended model-development use.
- Marked all not-yet-downloaded public datasets as explicit TODO items with priority, blocker, target path, and next action in both the dataset manifest and public dataset documentation.
- Added `data/artifacts/datasets/.gitkeep` and updated `data/README.md` so the local dataset artifact directory is explicit while real data stays out of Git.
- Added `scripts/setup-remote-5090-gpu.sh` for remote RTX 5090 setup: create a Python 3.12 virtualenv, install CUDA PyTorch from the CUDA 12.8 wheel index, install model-gateway GPU requirements, verify CUDA visibility, and run the model-gateway config check.
- Added `scripts/check-remote-5090-gpu.sh` for repeatable remote GPU diagnostics covering `nvidia-smi`, Python packages, Torch CUDA, devices, and model-gateway readiness.
- Added `services/model-gateway/requirements-gpu.txt` for the YOLOv11/RT-DETR detector runtime and updated base model-gateway requirements with numpy, OpenCV, and Pillow 12 compatibility.
- Enhanced `services/model-gateway/app/config_check.py` so config reports now include `nvidia-smi`, NVIDIA driver/CUDA summary, Torch CUDA runtime version, GPU memory, and device capability.
- Added `docs/GPU_INFERENCE_SETUP.md` and linked it from README/model-gateway docs as the remote 5090 setup guide.
- Configured the remote 5090 host `beelink@100.110.127.117`: cloned the repository to `~/jiazhuangxian`, created `.venv-model-gateway-gpu`, installed `torch==2.11.0+cu128`, `torchvision==0.26.0+cu128`, `torchaudio==2.11.0+cu128`, `opencv-python`, `pydantic`, and `ultralytics==8.4.48`.
- Updated the remote GPU setup script and documentation with a `--torch-find-links` / `--torch-version` path because the remote host timed out on the default `download.pytorch.org` wheel download, while `https://mirrors.aliyun.com/pytorch-wheels/cu128/` worked for the verified 5090 setup.
- Added `scripts/tn5000_voc_to_detection.py` and `npm run datasets:tn5000:clean-detection` to convert the official TN5000 VOC archive into a cleaned strict detector dataset.
- TN5000 cleaning excludes the 2 XML/image dimension mismatches (`002589`, `004092`) and the 1 out-of-bounds bbox sample (`003813`) instead of silently clipping invalid medical annotations.
- Exact duplicate TN5000 image hashes are merged into one image row with multiple bboxes, because the duplicated frame often carries a different nodule box; this avoids cross-split leakage without losing valid multi-nodule annotations.
- Cleaned TN5000 localization training uses collapsed class mode (`0=thyroid_nodule`) while preserving the XML diagnosis label only as stratification metadata.
- Cleaned TN5000 detection output was generated on the 5090 host and synced locally under `data/artifacts/datasets/tn5000/derived/detection-clean/`.
- Cleaned TN5000 strict detector dataset contains 4,871 unique images, 4,997 boxes, and 119 images with multiple boxes.
- Cleaned TN5000 fixed 80/20 split uses seed `20260510`: train 3,897 images / 3,999 boxes and validation 974 images / 998 boxes, with benign/malignant stratification preserved.
- Extended `scripts/train_tn3k_yolo.py` so the existing YOLO training path supports multi-box manifest rows from TN5000 while remaining compatible with the earlier TN3K single-box manifest.
- Prepared the YOLO dataset on the 5090 host under `data/artifacts/model-training/tn5000-yolo/datasets/tn5000-clean-yolo11m-80-20-e150-i896-b16-target90/`.
- Remote YOLO11m run `tn5000-clean-yolo11m-80-20-e150-i896-b16-target90` completed with early stopping at epoch 79 after 0.868 hours.
- The TN5000 YOLO11m run met the 90% target: final summary `metrics/mAP50(B)=0.95886`, precision `0.95133`, recall `0.92385`, and mAP50-95 `0.62583`.
- Ultralytics final validation of `best.pt` reported precision `0.929`, recall `0.923`, mAP50 `0.967`, and mAP50-95 `0.639`.
- Best TN5000 YOLO11m detector weights remain on the 5090 host at `/home/beelink/jiazhuangxian/runs/detect/data/artifacts/model-training/tn5000-yolo/runs/tn5000-clean-yolo11m-80-20-e150-i896-b16-target90/weights/best.pt`.
- Synced lightweight training artifacts locally under `data/artifacts/model-training/tn5000-yolo/`: summary JSON, `results.csv`, `results.png`, PR curve, confusion matrix, and normalized confusion matrix.
- Added `docs/TN5000_YOLO11M_TRAINING_REPORT_20260510.md` as the written training report covering TN5000 cleaning, 80/20 split, YOLO11m method, hyperparameters, training command, metrics, result interpretation, and embedded training charts.
- Copied the 4 TN5000 YOLO11m report images into `docs/assets/tn5000-yolo11m-20260510/` and updated the report image links to local docs assets so Markdown previews can render them reliably.

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
- Targeted study detail result-view tests passed: `npm test -- --run test/unit/medical/caseRepo.test.ts test/unit/channels/web/server.test.ts` with 50 tests.
- Targeted MedicalPanel result-view test passed: `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx` with 6 tests.
- Root `npm run typecheck` and frontend `cd web-react && npm run typecheck` passed after study detail result visualization.
- Targeted lint passed for the modified storage, Web API, endpoint, and MedicalPanel files.
- Full web-react tests passed after study detail result visualization: `cd web-react && npm test` with 11 files passed and 39 tests passed.
- `npm run build:web` passed after study detail result visualization; Vite still reports the existing Monaco chunk-size warning.
- `npm test` passed after study detail result visualization: 176 files passed, 1 skipped; 1685 tests passed, 3 skipped.
- `python3 -m unittest discover services/image-worker/tests` passed after study detail result visualization: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after study detail result visualization: 10 tests.
- CLI smoke test passed after study detail result visualization: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after study detail result visualization.
- Targeted doctor review tests passed: `npm test -- --run test/unit/medical/caseRepo.test.ts test/unit/channels/web/server.test.ts` with 52 tests.
- Targeted MedicalPanel doctor review test passed: `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx` with 7 tests.
- Root `npm run typecheck` and frontend `cd web-react && npm run typecheck` passed after doctor review confirmation.
- Targeted lint passed for the modified storage, Web API, endpoint, and MedicalPanel files after doctor review confirmation.
- Full web-react tests passed after doctor review confirmation: `cd web-react && npm test` with 11 files passed and 40 tests passed.
- `npm run build:web` passed after doctor review confirmation; Vite still reports the existing Monaco chunk-size warning.
- `python3 -m unittest discover services/image-worker/tests` passed after doctor review confirmation: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after doctor review confirmation: 10 tests.
- CLI smoke test passed after doctor review confirmation: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after doctor review confirmation.
- Full `npm test` was attempted after doctor review confirmation, but currently times out in unrelated `test/query-engine.test.ts` `/fix` orchestration cases; targeted medical/Web/frontend checks passed.
- Targeted model-gateway visibility tests passed: `npm test -- --run test/unit/medical/caseRepo.test.ts test/unit/channels/web/server.test.ts` with 54 tests.
- Targeted MedicalPanel model-gateway/artifact visibility test passed: `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx` with 7 tests.
- Root `npm run typecheck` and frontend `cd web-react && npm run typecheck` passed after model-gateway/artifact visibility.
- Targeted lint passed for the modified storage, Web API, endpoint, and MedicalPanel files after model-gateway/artifact visibility.
- Full web-react tests passed after model-gateway/artifact visibility: `cd web-react && npm test` with 11 files passed and 40 tests passed.
- `npm run build:web` passed after model-gateway/artifact visibility; Vite still reports the existing Monaco chunk-size warning.
- `python3 -m unittest discover services/image-worker/tests` passed after model-gateway/artifact visibility: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after model-gateway/artifact visibility: 10 tests.
- CLI smoke test passed after model-gateway/artifact visibility: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after model-gateway/artifact visibility.
- `python3 -m unittest discover services/model-gateway/tests` passed after detector overlay generation: 10 tests.
- Targeted MedicalPanel overlay URI test passed: `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx` with 7 tests.
- Frontend `cd web-react && npm run typecheck` and root `npm run typecheck` passed after detector overlay generation.
- Targeted medical Web/API tests passed after detector overlay generation: `npm test -- --run test/unit/medical/caseRepo.test.ts test/unit/channels/web/server.test.ts` with 54 tests.
- Targeted lint passed for modified MedicalPanel files after detector overlay generation.
- Targeted doctor bbox revision tests passed: `npm test -- --run test/unit/medical/caseRepo.test.ts test/unit/channels/web/server.test.ts` with 57 tests.
- Targeted MedicalPanel bbox revision test passed: `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx` with 8 tests.
- Root `npm run typecheck` and frontend `cd web-react && npm run typecheck` passed after doctor bbox revision.
- Targeted lint passed for the doctor bbox revision storage, Web API, endpoint, and MedicalPanel files.
- Full web-react tests passed after doctor bbox revision: `cd web-react && npm test` with 11 files passed and 41 tests passed.
- `npm run build:web` passed after doctor bbox revision; Vite still reports the existing Monaco chunk-size warning.
- `python3 -m unittest discover services/image-worker/tests` passed after doctor bbox revision: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after doctor bbox revision: 10 tests.
- CLI smoke test passed after doctor bbox revision: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after doctor bbox revision.
- Targeted medical knowledge search tests passed: `npm test -- --run test/unit/medical/knowledgeSearch.test.ts test/unit/medical/mcp-server.test.ts test/unit/medical/mcp-config-example.test.ts test/unit/channels/web/server.test.ts` with 62 tests.
- Targeted MedicalPanel knowledge evidence test passed: `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx` with 9 tests.
- Root `npm run typecheck` and frontend `cd web-react && npm run typecheck` passed after medical evidence search.
- Targeted lint passed for medical knowledge search, Web API, MCP, endpoint, and MedicalPanel files.
- Full web-react tests passed after medical evidence search: `cd web-react && npm test` with 11 files passed and 42 tests passed.
- `npm run build:web` passed after medical evidence search; Vite still reports the existing Monaco chunk-size warning.
- `python3 -m unittest discover services/image-worker/tests` passed after medical evidence search: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after medical evidence search: 10 tests.
- CLI smoke test passed after medical evidence search: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after medical evidence search.
- Full web-react tests passed after detector overlay generation: `cd web-react && npm test` with 11 files passed and 40 tests passed.
- `npm run build:web` passed after detector overlay generation; Vite still reports the existing Monaco chunk-size warning.
- `python3 -m unittest discover services/image-worker/tests` passed after detector overlay generation: 3 tests.
- CLI smoke test passed after detector overlay generation: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after detector overlay generation.
- Targeted medical artifact preview route tests passed: `npm test -- --run test/unit/channels/web/server.test.ts test/unit/medical/caseRepo.test.ts` with 55 tests.
- Targeted MedicalPanel overlay preview test passed: `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx` with 7 tests.
- Root `npm run typecheck` and frontend `cd web-react && npm run typecheck` passed after overlay preview route.
- Targeted lint passed for the modified Web API, frontend endpoint, and MedicalPanel files after overlay preview route.
- Full web-react tests passed after overlay preview route: `cd web-react && npm test` with 11 files passed and 40 tests passed.
- `npm run build:web` passed after overlay preview route; Vite still reports the existing Monaco chunk-size warning.
- `python3 -m unittest discover services/image-worker/tests` passed after overlay preview route: 3 tests.
- `python3 -m unittest discover services/model-gateway/tests` passed after overlay preview route: 10 tests.
- CLI smoke test passed after overlay preview route: `npm run medical-agent-worker:once -- --data-db <tmp>/data.db` returned idle JSON after migrating a temporary DB.
- `git diff --check` passed after overlay preview route.
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
- JSON validation passed for `examples/medical-knowledge/thyroid-guidelines-v1.manifest.json`.
- Targeted knowledge tests passed after the first-version KB: `npm test -- --run test/unit/medical/knowledgeIngestion.test.ts test/unit/medical/initDbCli.test.ts test/unit/medical/knowledgeSearch.test.ts` with 10 tests.
- Root `npm run typecheck` passed after the first-version KB.
- Targeted lint passed for the changed init-db and medical knowledge tests: `npx eslint scripts/medical-init-db.ts test/unit/medical/knowledgeIngestion.test.ts test/unit/medical/initDbCli.test.ts`.
- CLI smoke test passed after the first-version KB: `npm run medical:init-db -- --data-db <tmp>/data.db --rag-db <tmp>/rag.db --workspace /Users/xutianliang/Downloads/jiazhuangxian --ingest-sample-knowledge` wrote 13 chunks and 2 templates.
- Medical knowledge search smoke test passed after the first-version KB: query `TR5 FNA 1.0 cm` returned `medical/doc-thyroid-guidelines-v1/acr-tirads-size-actions` from a temporary SQLite/RAG pair.
- `git diff --check` passed after the first-version KB.
- GitHub push succeeded after retry: `41c9c5c Add first thyroid knowledge base` reached `origin/main`.
- Targeted MedicalPanel tests passed after workstation enhancement: `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx` with 10 tests.
- Frontend typecheck passed after workstation enhancement: `cd web-react && npm run typecheck`.
- Root `npm run typecheck` passed after workstation enhancement.
- Targeted frontend lint passed after workstation enhancement: `cd web-react && npx eslint src/components/panels/MedicalPanel.tsx src/components/panels/MedicalPanel.test.tsx`.
- Full web-react tests passed after workstation enhancement: `cd web-react && npm test` with 11 files and 43 tests.
- `npm run build:web` passed after workstation enhancement; Vite still reports the existing Monaco chunk-size warning.
- `git diff --check` passed after workstation enhancement.
- TN3K archive sha256 verified: `407fe2b4992e83b037621214aaaa39d86072e03d4ee3765f3c68d06e546e4ad4`.
- TN3K extraction verified with 2,879 train/validation images, 2,879 train/validation masks, 614 test images, and 614 test masks.
- Sample-of-UD-TN local fetch verified with 27 files including 26 JPG images.
- JSON validation passed for `examples/datasets/thyroid-ultrasound-public.manifest.json`.
- `git diff --check` passed after public dataset bootstrap.
- Shell syntax validation passed for `scripts/setup-remote-5090-gpu.sh` and `scripts/check-remote-5090-gpu.sh`.
- `python3 -m unittest discover services/model-gateway/tests` passed after GPU config-check enhancement: 12 tests.
- `npm run model-gateway:check` passed locally in degraded mode, correctly reporting no `nvidia-smi`, no Torch, and no detector runtime on the Mac development host.
- `git diff --check` passed after remote GPU setup scripts and config-check enhancement.
- Remote GPU check passed on `beelink@100.110.127.117`: Torch `2.11.0+cu128`, CUDA runtime `12.8`, `cuda_available=true`, RTX 5090 detected with capability `12.0` and ~32 GB VRAM.
- Remote model-gateway config check now reports base runtime packages and Ultralytics ready, but detector readiness remains `degraded` because `JZX_YOLOV11_WEIGHTS` and `JZX_RTDETR_WEIGHTS` are not configured yet.
- Installed a user-local Node.js 22 runtime on the remote 5090 host under `~/.local/node/node-v22.9.0-linux-x64` and ran `npm ci --registry=https://registry.npmmirror.com`.
- Remote `npm ci` installed dependencies and built the React frontend, but exposed that `src/reports/` and `test/unit/reports/` were accidentally ignored by the broad `.gitignore` `reports/` rule and therefore missing from the remote clone.
- Fixed the ignore rule to `/reports/` so generated root reports remain ignored while source/test report modules are tracked.
- Added the previously ignored `src/reports/` report product modules and `test/unit/reports/` tests to the repository.
- Local `npm run build` passed after restoring tracked report source files.
- Local targeted report/dashboard tests passed after restoring tracked report files: `npm test -- --run test/unit/reports test/unit/dashboards` with 11 files and 45 tests.
- `web-react npm ci` reported 8 npm audit findings in upstream frontend dependencies; no functional failure observed.
- `npm run lint` is currently blocked by two existing unrelated lint findings:
  - `src/reports/renderHtml.ts`: unused `ReportChart` import/type.
  - `test/golden/runner/meta-router.ts`: unnecessary escaped `\-`.
- GitHub push now works with `git -c http.version=HTTP/1.1 push origin main` when the default HTTP path is slow.
- Remote medical SQLite/RAG initialization passed on the 5090 host with 4 medical documents, 36 TI-RADS rules, 5 report templates, 5 safety rules, 10 terms, and 13 ingested RAG chunks.
- Remote `npm run build` passed on the 5090 host after updating it to commit `0452cb6`; the only build warning was the existing Monaco/Vite chunk-size warning.
- Downloaded Ultralytics `yolo11n.pt` locally because the remote host's GitHub download stalled, copied it to `data/artifacts/model-weights/yolo/yolo11n.pt`, and used it only as a generic GPU smoke weight, not as a thyroid-specialized detector.
- Remote `npm run model-gateway:check -- --strict` passed with Torch `2.11.0+cu128`, CUDA available, RTX 5090 detected, and `ready_detectors=["yolov11"]` when `JZX_YOLOV11_WEIGHTS` points to the generic smoke weight.
- Remote end-to-end model-gateway/model-worker smoke passed for job `mj_198b1bb5c92a40969dca00dfa45d2fb1`, writing `detections.json` and `overlay.png` under `data/artifacts/model-output/thyroid-detect-nodules/REMOTE_GPU_SMOKE_20260509214227_STUDY/REMOTE_GPU_SMOKE_20260509214227_IMAGE/`.
- Added explicit detector device control with `JZX_MODEL_DEVICE`, passed through to Ultralytics `predict(device=...)`, and exposed it in model-gateway config reports.
- `python3 -m unittest discover services/model-gateway/tests` passed after adding explicit detector device control: 13 tests.
- `npm run model-gateway:check` passed locally in degraded mode after adding explicit detector device reporting, correctly showing `runtime.inference_device.effective="auto"` on the Mac development host.
- `git diff --check` passed after adding explicit detector device control.
- Synchronized commit `9969e7f` to the remote 5090 host via git bundle because remote GitHub connectivity remained unreliable.
- Remote `JZX_MODEL_DEVICE=0 npm run model-gateway:check -- --strict` passed and reported `runtime.inference_device.effective="0"` with `ready_detectors=["yolov11"]`.
- Remote explicit-GPU end-to-end smoke passed for job `mj_4a0d4aaa4dee4077aeba1840b60ae242`; worker output included `model.device="0"` and wrote both `detections.json` and `overlay.png` under `data/artifacts/model-output/thyroid-detect-nodules/REMOTE_GPU_DEVICE0_20260509214944_STUDY/REMOTE_GPU_DEVICE0_20260509214944_IMAGE/`.
- Added `scripts/tn3k_mask_to_bbox.py` and `npm run datasets:tn3k:bbox` to convert TN3K segmentation masks into detection annotations.
- TN3K mask-to-bbox conversion now writes YOLO labels/data.yaml, COCO trainval/test JSON, split JSONL manifests, and a summary under `data/artifacts/datasets/tn3k/derived/detection/`.
- Full local TN3K conversion passed: 3,493 images converted, 0 skipped, 0 missing classification labels; split counts are 2,879 trainval and 614 test bboxes.
- Added unit tests for TN3K mask-to-bbox conversion covering YOLO label math, COCO bbox output, JSONL manifest output, and empty-mask skipping.
- Updated `docs/PUBLIC_THYROID_ULTRASOUND_DATASETS.md` and `examples/datasets/thyroid-ultrasound-public.manifest.json` with the derived detection output paths and counts.
- Added `scripts/train_tn3k_yolo.py` and `npm run datasets:tn3k:train-yolo` for YOLOv11 training on the TN3K mask-derived detection manifest.
- The TN3K YOLO training script now creates a deterministic stratified 80/20 split from all 3,493 samples, preserving benign/malignant proportions.
- Local prepare-only split check passed: train 2,794 samples and validation 699 samples, with train labels 1,826 benign / 968 malignant and validation labels 457 benign / 242 malignant.
- The YOLOv11 training acceptance gate is `metrics/mAP50(B) >= 0.93`; training summaries record `target_met` so runs below 93% are visibly rejected.
- Remote 5090 host downloaded TN3K directly from the Hugging Face mirror, verified sha256 `407fe2b4992e83b037621214aaaa39d86072e03d4ee3765f3c68d06e546e4ad4`, installed RAR5-compatible `unrar`, extracted the archive, and regenerated 3,493 mask-derived detection boxes.
- Fixed TN3K YOLO training dataset materialization so duplicated TN3K source filenames from `trainval` and `test` are written as unique `<source_split>_<image_id>` training files instead of overwriting each other.
- `python3 -m unittest discover test/unit/scripts` passed after the TN3K training filename-collision fix: 5 tests.
- Local corrected prepare-only materialization verified 2,794 train images/labels and 699 validation images/labels on disk, matching the split summary exactly.
- Added YOLO training augmentation knobs for medical-image tuning: `mosaic`, `scale`, `translate`, `hsv_h/s/v`, `erasing`, and `auto_augment`.
- Remote YOLO11m baseline run `tn3k-yolo11m-80-20-e120-i768-b16-fixed` was stopped at epoch 71 because it plateaued below target; best validation `metrics/mAP50(B)` was 0.89110 at epoch 53, so the 0.93 acceptance target was not met.
- Remote tuned run `tn3k-yolo11m-80-20-e100-i896-b12-medaug` started with `imgsz=896`, `batch=12`, `mosaic=0`, weaker color/scale augmentation, and the same 0.93 mAP50 target.
- Remote tuned run `tn3k-yolo11m-80-20-e100-i896-b12-medaug` was stopped at epoch 33 after plateauing far below target; best validation `metrics/mAP50(B)` was 0.81093 at epoch 32.
- Remote YOLO11l high-resolution run `tn3k-yolo11l-80-20-e150-i1024-b8-mildaug` was stopped after early plateau; best validation `metrics/mAP50(B)` was 0.80896 at epoch 30, so increasing model size/resolution did not solve the gap.
- Added `scripts/hf_thyroid_dataset_inventory.py` and `npm run datasets:hf-thyroid:inventory` to inventory Hugging Face thyroid datasets, respect gated datasets, download public candidates, and write `inventory.json`/`evaluation.md` under `data/artifacts/datasets/hf-thyroid/`.
- Remote 5090 downloaded and evaluated public Hugging Face datasets: TN5000 cropped classification (`Johnyquest7/TN5000-thyroid-nodule-classification`, 5,000 images), BTX24 thyroid cancer ultrasound classification (3,115 parquet images), and ROCOv2 thyroid (131 image-text rows). `FangDai/Thyroid_Ultrasound_Images` and `hunglc007/ThyroidXL` remain blocked by Hugging Face gated access.
- Added `scripts/build_thyroid_detection_manifest.py` and `npm run datasets:thyroid:combined-manifest` to build explicit strict or auxiliary manifests with fixed training/validation splits.
- Added fixed-split support to `scripts/train_tn3k_yolo.py` via `--fixed-split-field`, with unit coverage, so validation can remain true detector data while optional auxiliary data is restricted to train.
- Built a mixed TN3K+TN5000-cropped auxiliary manifest on the 5090 host with 8,493 total samples, 7,794 train samples, and 699 validation samples. Validation contained only TN3K true mask-derived bboxes.
- Remote mixed TN3K+TN5000-cropped YOLO11m run `thyroid-combined-yolo11m-tn3kval-e120-i896-b16-cropaux` was stopped at epoch 3 because validation mAP50 collapsed from 0.49218 to 0.14708, proving 224x224 cropped classification samples should not be mixed directly into detector training as full-image pseudo bboxes.
- Added `scripts/build_btx24_pseudo_detection_manifest.py` and `npm run datasets:btx24:pseudo-detection` for semi-supervised pseudo-label experiments, but stopped the full BTX24 pseudo-label route after confirming the data-standard concern: pseudo-labeled classification data must not enter the detector training set until it passes the same acquisition/crop/annotation standard.
- Current detector-training data standard is now strict: only original or near-original thyroid ultrasound frames with true segmentation masks or true bbox annotations are accepted for YOLO detector training/validation. Cropped classification datasets remain classification or external-validation resources, not detector-training data.
- Official Figshare TN5000 detection archive was manually downloaded locally, transferred to the 5090 host, sha256-verified as `35f2e2f53261b4fd956e6ea8ea63e710780431a776e8148951d2bcee97272684`, and extracted under `~/jiazhuangxian/data/artifacts/datasets/tn5000/raw/extracted/TN5000_forReview/TN5000_forReview/`.
- Extracted TN5000 detection data is true VOC-style detection material: 5,000 JPG images, 5,000 XML annotations, and official split files with train 3,500, val 500, and test 1,000 samples.
- Added `scripts/evaluate_tn5000_voc.py`, `npm run datasets:tn5000:evaluate`, and unit coverage for TN5000 VOC archive quality checks.
- TN5000 evaluation artifacts were generated on the 5090 host and synced locally under `data/artifacts/datasets/tn5000/derived/evaluation/`.
- TN5000 evaluation found that the archive is structurally complete but not clean enough to use naively: 5,000 images, 5,000 XML files, 4,999 valid boxes, 2 XML/image dimension mismatches, 1 out-of-bounds bbox, 1 image with no valid box after validation, 119 exact duplicate-image hash groups, and 65 duplicate-image groups crossing train/val/test splits.
- TN5000 class labels are diagnosis labels from XML `<object><name>`: `0=benign`, `1=malignant`; this allows two-class detection experiments, but localization-only YOLO training should collapse both labels to a single nodule class.
- `python3 -m py_compile scripts/tn5000_voc_to_detection.py scripts/train_tn3k_yolo.py scripts/evaluate_tn5000_voc.py` passed after the TN5000 cleaning/training script changes.
- `python3 -m unittest discover test/unit/scripts` passed after the TN5000 cleaning/training script changes: 11 tests.
- `git diff --check` passed after the TN5000 cleaning/training script changes.
- Remote 5090 training process check confirmed no `train_tn3k_yolo.py` process remained after YOLO11m training completed.
- Markdown image references in `docs/TN5000_YOLO11M_TRAINING_REPORT_20260510.md` point to checked-in docs assets under `docs/assets/tn5000-yolo11m-20260510/`.
- Extended `scripts/train_tn3k_yolo.py` to support both YOLO and Ultralytics RT-DETR via `--model-family yolo|rtdetr`, including optimizer and learning-rate controls for transformer detector experiments.
- Added `scripts/train_rfdetr_detector.py` to convert the same TN5000 fixed split into RF-DETR COCO layout and train RF-DETR detector variants; local unit coverage now validates COCO conversion, default RF-DETR resolutions, target metric aliases, and `metrics.csv` parsing.
- RT-DETR-L was trained on the same TN5000 cleaned 80/20 split. It reached target at epoch 4, and the saved best checkpoint validated at `mAP50=0.91289`, `mAP50-95=0.57849`, `precision=0.89959`, `recall=0.86473`; training became unstable afterward with NaN losses, so RT-DETR remains a research comparator rather than a production default.
- RF-DETR-Medium was trained on the same TN5000 cleaned 80/20 split after switching to the checkpoint-native 576 resolution. It was manually stopped after stable target-exceeding validation through epoch 5; best observed metrics were `mAP50=0.97141`, `mAP50-95=0.64611`, `precision=0.93922`, `recall=0.95992`, with `ema_mAP50=0.97515`.
- Added `docs/TN5000_DETECTOR_MODEL_COMPARISON_20260510.md` and comparison charts under `docs/assets/tn5000-detector-comparison-20260510/`.
- Current detector conclusion: use RF-DETR-Medium as the validation demo's primary detector, keep YOLO11m as the comparator and engineering fallback, and keep RT-DETR-L out of the default inference path until NaN stability is resolved.
- Updated `docs/TN5000_DETECTOR_MODEL_COMPARISON_20260510.md`, `docs/TECHNICAL_DESIGN.md`, `docs/MODEL_ARTIFACT_CONVENTIONS.md`, and `docs/PUBLIC_THYROID_ULTRASOUND_DATASETS.md` with the new detector decision: RF-DETR-Medium primary, YOLO11m comparator, main LLM/Qwen3.6 for structured result evaluation.
- `python3 -m py_compile scripts/train_tn3k_yolo.py scripts/train_rfdetr_detector.py scripts/tn5000_voc_to_detection.py scripts/evaluate_tn5000_voc.py` passed after RT-DETR/RF-DETR training script updates.
- `python3 -m unittest discover test/unit/scripts` passed after RT-DETR/RF-DETR updates: 15 tests.
- Implemented RF-DETR-Medium as the model-gateway default primary detector; `DetectNodulesRequest.model` now defaults to `rf-detr-medium-thyroid-detector`, and missing-model jobs select the RF-DETR adapter.
- Implemented the RF-DETR runtime adapter with `rfdetr.RFDETRMedium(pretrain_weights=..., num_classes=1, resolution=576)` and `predict()` formatting into the standard nodule bbox schema.
- Added automatic YOLO11m comparator execution when the primary detector is RF-DETR, with IoU matching, `matched` / `primary_only` / `comparator_only` / `conflict` consensus states, and a pending Qwen3.6 `llm_evaluation` pack.
- `detections.json` now includes `llm_evaluation`, and detector jobs with comparison output also write `comparison.json` with schema `thyroid.detector.comparison.v1`.
- Updated `services/model-gateway/requirements-gpu.txt`, `scripts/setup-remote-5090-gpu.sh`, `services/model-gateway/README.md`, and `docs/MODEL_ARTIFACT_CONVENTIONS.md` to reflect RF-DETR-Medium primary + YOLO11m comparator.
- Remote 5090 real smoke passed with RF-DETR-Medium primary weights and YOLO11m comparator weights: 1 RF-DETR nodule, 1 YOLO nodule, consensus `matched`, and `llm_evaluation.overall_assessment=consistent`.
- `python3 -m unittest discover services/model-gateway/tests` passed locally and on the remote 5090 after the RF-DETR primary / YOLO comparator implementation: 15 tests.
- Remote 5090 queued model-gateway smoke passed using SQLite `model_job` + worker: job `mj_6ce1e0ad45c54fe3b6af8e58a4d3cd56` wrote `detections.json`, `comparison.json`, and `overlay.png` under `artifact://model-output/thyroid-detect-nodules/REMOTE_DUAL_SMOKE/TN5000_000001/`; consensus was `matched` with 1 RF-DETR primary detection and 1 YOLO comparator detection.
- Remote 5090 queued model-gateway smoke was rerun after worker output URI enrichment: job `mj_d3caf85b3b8e4cb598952a4bc4b247d5` wrote `model_job.output_json.artifacts.model_comparison_json=artifact://model-output/thyroid-detect-nodules/REMOTE_DUAL_SMOKE_2/TN5000_000002/mj_d3caf85b3b8e4cb598952a4bc4b247d5/comparison.json` and `overlay.png`; consensus stayed `matched`.
- Doctor workstation Model Jobs now display the `comparison.json` artifact URI, RF-DETR/YOLO consensus counts, pending Qwen3.6 `llm_evaluation` status, overall assessment, doctor review focus, and the no-bbox-mutation LLM constraint.
- `npm run typecheck` passed in `web-react` after the doctor workstation detector-comparison UI update.
- `npm test -- --run src/components/panels/MedicalPanel.test.tsx` passed after adding RF-DETR/YOLO comparison and Qwen3.6 evaluation assertions: 10 tests.
- Medical agent worker now has an optional CodeClaw provider evaluation path: when `JZX_MEDICAL_LLM_EVALUATION=1` or `--enable-llm-evaluation` is enabled, completed detector jobs with `llm_evaluation` are sent to the selected provider, recommended Qwen3.6 through a local vLLM/OpenAI-compatible endpoint.
- The provider evaluation prompt is constrained to structured detector output, IoU comparison, model metadata, and the pending evaluation pack; it explicitly forbids adding, deleting, or moving bbox coordinates.
- Provider evaluation results are stored in the completed detector agent task output under `result.llm_provider_evaluation` and persisted to `audit_log` as `medical.detector.llm_evaluation`.
- `scripts/medical-agent-worker.ts` now supports `JZX_MEDICAL_LLM_PROVIDER=<provider-instance>`, `--enable-llm-evaluation`, and `--llm-provider <provider-instance>` while keeping the default validation flow provider-free.
- Updated `docs/MEDICAL_MCP_SETUP.md` and `docs/TECHNICAL_DESIGN.md` to state the model split: Qwen3.6 remains the main report/structured-evaluation model through CodeClaw provider; MedGemma is a medical review assistant and does not replace Qwen3.6.
- Verified the remote 5090 host's existing Qwen3.6 model storage: LM Studio metadata lives under `~/.lmstudio/hub/models/qwen`, while actual GGUF weights live under `/data/models/lmstudio-community/...`.
- Created the remote project model entry directory `~/jiazhuangxian/data/llm` with symlinks to the existing Qwen3.6 GGUF directories so the project has a stable model path without duplicating 20-48 GB model files.
- Confirmed remote LM Studio OpenAI-compatible service is running at `http://127.0.0.1:1234/v1` and lists `qwen/qwen3.6-35b-a3b`, `qwen/qwen3.6-27b`, `unsloth/qwen3.6-27b`, `medgemma-1.5-4b-it`, and embedding models.
- Configured remote CodeClaw provider files under `/home/beelink/.codeclaw/` with `lmstudio:qwen36-35b-a3b` as the default provider, `lmstudio:qwen36-27b` as a candidate, and `lmstudio:medgemma-review` for future review assistance.
- Confirmed `qwen/qwen3.6-35b-a3b` can produce a valid JSON response through LM Studio, while the current LM Studio API fails to load `qwen/qwen3.6-27b` and `unsloth/qwen3.6-27b`; 27B remains a model-runtime follow-up, not the active fallback.
- Confirmed CodeClaw `streamProviderResponse()` with `lmstudio:qwen36-35b-a3b` returns clean final JSON content and does not leak Qwen reasoning text into the medical result.
- Confirmed remote CodeClaw `doctor` passes under Node 22.9.0; remote `/usr/bin/node` is Node 18 and cannot load the current `better-sqlite3` binary, so medical worker commands on the 5090 host must prepend `/home/beelink/.local/node/node-v22.9.0-linux-x64/bin` to `PATH`.
- Ran a real remote `medical-agent-worker` provider-evaluation smoke against `lmstudio:qwen36-35b-a3b`: detector output with bbox `[120,160,260,310]` produced `llm_provider_evaluation.status=reviewed`, `overall_assessment=consistent`, `bbox_policy=must_not_modify_bbox`, and audit log `01KR7MA4YDY55BGCJBE10XPBXX`.
- Added `docs/LLM_PROVIDER_SETUP_5090.md` documenting the 5090 Qwen3.6 provider setup, `data/llm` model-entry symlinks, CodeClaw provider config, Node 22 runtime requirement, smoke results, and follow-up tasks.
- Extended `draft_report` in the async medical agent worker to reuse the same CodeClaw Qwen3.6 provider path for controlled report drafting when `llmProvider` is configured.
- The report provider prompt receives only the report template, structured TI-RADS/nodule results, evidence rules, and safety constraints; it is instructed not to invent findings, measurements, categories, recommendations, or final diagnoses.
- Synchronous/offline `draft_report` behavior remains deterministic template generation, so the validation workflow still works without any LLM provider.
- Provider-generated report drafts are persisted as normal `report` rows with status `draft`, still require doctor review, and write `medical.report.llm_draft` audit logs when the provider returns parseable JSON.
- Synced the provider-backed `draft_report` implementation to the remote 5090 host and ran a real LM Studio Qwen3.6-35B-A3B report smoke against `data/artifacts/medical-report-provider-smoke-20260510/data.db`.
- Remote report smoke succeeded for task `draft_report`: provider `lmstudio:qwen36-35b-a3b` returned `llm_provider_report.status=drafted`, created report `01KR7N32W0MHJYVE3EE39GM1V7` with status `draft`, `structured.generator=llm_provider_structured_report`, and audit log `01KR7N32W130XHR403NYPC8VCK` with action `medical.report.llm_draft`.
- Remote SQLite verification confirmed the persisted report keeps the doctor review notice and the audit log records the Qwen3.6 provider provenance.
- Updated `docs/LLM_PROVIDER_SETUP_5090.md` with the provider-backed `draft_report` smoke evidence and changed the next LLM work from report drafting to safety-review/doctor-suggestion expansion.
- Added a separate optional MedGemma medical-review provider path to `medical-agent-worker`; it uses `medicalReviewProvider` instead of reusing the Qwen3.6 `llmProvider`, so MedGemma cannot replace the main report model.
- `scripts/medical-agent-worker.ts` now accepts `JZX_MEDICAL_REVIEW=1`, `JZX_MEDICAL_REVIEW_PROVIDER=<provider-instance>`, `--enable-medical-review`, and `--medical-review-provider <provider-instance>`.
- MedGemma report review receives only the report draft, structured TI-RADS/nodule results, evidence rules, and review constraints; it is instructed not to rewrite the main report, change bbox, invent findings, or give a final diagnosis.
- MedGemma review results are persisted under `report.structured_json.medical_review_assistant`, returned in worker output as `medical_review_assistant`, and audited as `medical.report.medgemma_review`.
- Updated `docs/MEDICAL_MCP_SETUP.md`, `docs/TECHNICAL_DESIGN.md`, and `docs/LLM_PROVIDER_SETUP_5090.md` with the Qwen3.6 main provider plus MedGemma auxiliary review configuration.
- Fixed the report-generation evidence gap: `draft_report` now queries the structured `tirads_rules` knowledge table before writing a report, then uses the configured medical RAG DB to retrieve approved guideline chunks.
- Report evidence now persists as an evidence pack in `report.evidence_json`, including original `tirads_result` references, `tirads_rule` rows, and `medical_guideline` RAG chunks with document/chunk provenance.
- `report.structured_json.knowledge_evidence` now records `tirads_rule_count`, missing rule codes, guideline chunk count, RAG searches, and knowledge warnings so the doctor workstation can show why a report statement was or was not evidence-backed.
- Qwen3.6 report drafting and MedGemma review prompts now receive the same rules/RAG evidence pack and are explicitly constrained to use it for TI-RADS, follow-up, FNA, and safety-boundary statements.
- `scripts/medical-agent-worker.ts` now accepts `JZX_RAG_DB`, `JZX_MEDICAL_KNOWLEDGE_TOP_K`, `--rag-db`, and `--knowledge-top-k` so smoke runs and deployment can point report generation at the correct CodeClaw RAG SQLite DB.
- Updated `docs/MEDICAL_MCP_SETUP.md`, `docs/TECHNICAL_DESIGN.md`, and `docs/LLM_PROVIDER_SETUP_5090.md` to document the report-time knowledge lookup flow.
- Split MedGemma auxiliary review into the `safety_review` stage as well as inline `draft_report`, so the 5090 host can run Qwen3.6 and MedGemma serially with only one large model loaded at a time.
- `safety_review` now reuses the latest persisted report, safety rules, compact nodule summary, compact `tirads_rule` evidence, and compact RAG evidence to write `report.structured_json.medical_review_assistant` and `medical.report.medgemma_review`.
- Normalized MedGemma review outputs so `doctor_review_focus`, `suggested_edits`, `warnings`, and `limitations` are arrays even when the model returns a single string.
- Remote 5090 serial smoke succeeded after manual model switching: Qwen3.6 generated report `01KR7R1ZDZR4NTNZ9MF3TK2P2G` with `structured.generator=llm_provider_structured_report`, `tirads_rule_count=2`, `guideline_chunk_count=5`, and audit `01KR7R1ZE04YBFQ81H2DH6HS2E`; then `medgemma-4b-it` reviewed the same report through `safety_review`, returned `medical_review_assistant.status=reviewed`, and wrote audit `01KR7RQX6AJX8QTX4NXJRMS8FQ`.
- Copied the real RF-DETR/YOLO detector smoke artifacts for `TN5000_000002` into `data/artifacts/reports/tn5000-demo-000002/`, including `original.jpg`, `overlay.png`, `detections.json`, and `comparison.json`.
- Added `data/artifacts/reports/tn5000-demo-000002/image_detection_segmentation_measurement.md` with embedded original/overlay images, RF-DETR primary bbox, YOLO comparator bbox, IoU agreement, pixel measurements, and an explicit note that segmentation mask output was not generated by this detector-only smoke.
- Extended `data/artifacts/reports/tn5000-demo-000002/image_detection_segmentation_measurement.md` with a detection-only AI report draft and a traceable report-evidence section, including what the current detector artifact can and cannot support clinically.
- Local compile for real-run verification passed: `npm run typecheck` and `npm run build` completed successfully, producing `dist/cli.js`, `dist/public/`, and `dist/public-react/`.
- Started the built CodeClaw Web SPA locally with `node dist/cli.js web --port=7180 --host=127.0.0.1`; GET `/` returns the React app HTML.
- Stopped the local CodeClaw Web SPA after user verification; port `7180` is no longer listening.
- Rechecked implementation against `docs/TECHNICAL_DESIGN.md`: before MED-312/MED-313 the validation build had 6 default `agent_task` steps (`image_qc`, `detect_nodules`, `classify_tirads_features`, `calculate_tirads`, `draft_report`, `safety_review`) executed by `medical-agent-worker`; the full design still called for 9 named medical Agent roles, with `CaseCoordinatorAgent`, `SegmentationAgent`, and `MeasurementAgent` not yet implemented as default executable steps.
- Compliance check passed for current implemented scope: `npm run typecheck`, `npm test -- --run test/unit/medical/agentWorker.test.ts test/unit/medical/mcp-server.test.ts test/unit/channels/web/server.test.ts`, `python3 -m unittest discover services/model-gateway/tests`, and `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx` all passed.
- Implemented MED-312 validation chain: `thyroid.SegmentNodule` MCP now forwards to model-gateway `/model/v1/infer/thyroid/segment-nodule`, which queues `thyroid.segment_nodule`; model-worker writes `segmentation.json` plus `mask_nodule_<index>.png`, and `medical-agent-worker` persists `nodule.mask_uri`.
- Implemented MED-313 validation chain: `thyroid.MeasureNodule` MCP now forwards to model-gateway `/model/v1/infer/thyroid/measure-nodule`, which queues `thyroid.measure_nodule`; model-worker writes `measurements.json`, and `medical-agent-worker` persists rows into `measurement`.
- Updated the default medical analysis chain from 6 to 8 executable steps by adding `SegmentationAgent/segment_nodules` and `MeasurementAgent/measure_nodules` between detection and TI-RADS feature classification.
- Segmentation is intentionally validation-safe: without a real segmentation model it uses a clearly labeled `bbox_fallback` rectangular mask with `requires_doctor_review=true`; measurement only writes millimeter fields when `PixelSpacing` is available, otherwise it keeps mm fields null and returns pixel measurements plus warnings.
- Updated `docs/TECHNICAL_DESIGN.md`, `docs/MEDICAL_MCP_SETUP.md`, `docs/MODEL_ARTIFACT_CONVENTIONS.md`, `docs/DEVELOPMENT_PLAN.md`, and `services/model-gateway/README.md` for the new segmentation/measurement flow and artifact schemas.
- Verification after MED-312/MED-313 passed: `npm run typecheck`, `npm run build`, `npm test -- --run test/unit/medical/caseRepo.test.ts test/unit/medical/agentWorker.test.ts test/unit/medical/mcp-server.test.ts test/unit/channels/web/server.test.ts`, `python3 -m unittest discover services/model-gateway/tests`, `cd web-react && npm test -- --run src/components/panels/MedicalPanel.test.tsx`, targeted ESLint, and `git diff --check`.
- `npm run typecheck` passed after the medical provider evaluation integration.
- `npm test -- --run test/unit/medical/agentWorker.test.ts` passed after adding the Qwen3.6 provider-evaluation test: 9 tests.
- `npm run typecheck` passed after adding Qwen3.6 provider-backed `draft_report` generation.
- `npm test -- --run test/unit/medical/agentWorker.test.ts` passed after adding the provider-backed report draft test: 10 tests.
- `npm run typecheck` passed after adding the MedGemma auxiliary medical-review provider path.
- `npm test -- --run test/unit/medical/agentWorker.test.ts` passed after adding the MedGemma auxiliary review test: 11 tests.
- `npm run typecheck` passed after adding report-time rules/RAG knowledge evidence lookup.
- `npm test -- --run test/unit/medical/agentWorker.test.ts` passed after adding the report-time knowledge evidence test: 12 tests.
- `npx eslint src/medical/agentWorker.ts src/medical/storage/caseRepo.ts scripts/medical-agent-worker.ts test/unit/medical/agentWorker.test.ts` passed after the report-time knowledge evidence change.
- `npm run typecheck` passed after adding serial `safety_review` MedGemma review and normalization.
- `npm test -- --run test/unit/medical/agentWorker.test.ts` passed after adding serial `safety_review` MedGemma review and normalization: 12 tests.
- `npx eslint src/medical/agentWorker.ts src/medical/storage/caseRepo.ts scripts/medical-agent-worker.ts test/unit/medical/agentWorker.test.ts` passed after serial review changes.
- `npm test -- --run src/components/panels/MedicalPanel.test.tsx` passed after the provider-evaluation integration: 10 tests.
- Added `docs/SEGMENTATION_MODEL_INTEGRATION_PLAN.md` for the real Swin U-Net / U-Net / MedSAM segmentation-weight integration plan. The plan keeps CodeClaw/MCP/model-gateway as the execution path, recommends MedSAM bbox prompt as the first real-mask adapter, requires project-trained U-Net/nnU-Net and Swin U-Net weights for thyroid ultrasound, defines model directories under `data/models/segmentation`, and specifies adapter selection, artifact schema, measurement linkage, 5090 deployment, tests, and acceptance metrics.
- Updated `docs/DEVELOPMENT_PLAN.md` and `docs/TECHNICAL_DESIGN.md` to point MED-312/313 follow-up work at the new segmentation integration plan.
- Extended the segmentation integration plan for ultrasound video segmentation and measurement. The new design adds `thyroid.SegmentVideoNodule` and `thyroid.MeasureVideoNodule`, recommends MedSAM2/SAM2 video predictor for cine loop mask propagation, defines `video_segmentation.json` and `video_measurement.json`, and specifies key-frame prompt, track IDs, per-frame masks, selected max-long-axis frame, temporal stability metrics, and doctor-workstation video overlay requirements.
- Updated `docs/TECHNICAL_DESIGN.md`, `docs/DEVELOPMENT_PLAN.md`, `docs/MODEL_ARTIFACT_CONVENTIONS.md`, `docs/MEDICAL_MCP_SETUP.md`, and `services/model-gateway/README.md` so video segmentation/measurement is visible in the main technical design, task list, artifact contract, planned MCP calls, and model-gateway route plan.
- Implemented the validation video segmentation/measurement shell: `thyroid.SegmentVideoNodule` and `thyroid.MeasureVideoNodule` are now exposed by the medical MCP server, forwarded to model-gateway, stored as `thyroid.segment_video_nodule` / `thyroid.measure_video_nodule` jobs, and consumed by `model-worker`.
- Added video model-gateway schemas, queue helpers, HTTP routes, worker handlers, and artifact writers for `thyroid.video_segmentation.output.v1` and `thyroid.video_measurement.output.v1`.
- Current video segmentation is intentionally validation-safe: without MedSAM2/SAM2 weights it only emits `video_bbox_prompt_fallback` masks on the prompt frame, marks them for doctor review, and writes explicit warnings rather than pretending to run temporal propagation.
- Current video measurement reads `video_segmentation.json`, measures mask/contour/bbox geometry, selects the key measurement frame by policy, writes `video_measurement.json`, and only outputs millimeter fields when PixelSpacing is supplied.
- Updated `docs/DEVELOPMENT_PLAN.md`, `docs/TECHNICAL_DESIGN.md`, and `services/model-gateway/README.md` from planned video routes to implemented validation-shell status.
- Verification after the video shell passed: `python3 -m unittest services/model-gateway/tests/test_gateway.py` ran 19 tests, `npm test -- --run test/unit/medical/mcp-server.test.ts` ran 16 tests, `npm run typecheck` passed, `python3 -m compileall -q services/model-gateway/app` passed, and `git diff --check` passed.
- Implemented the MED-312V-C adapter shell for real MedSAM2/SAM2 video segmentation. `run_segment_video_job` now detects `medsam2`/`sam2` model names, checks `JZX_MEDSAM2_WEIGHTS` or `JZX_SAM2_WEIGHTS`, `JZX_MEDSAM2_CONFIG` or `JZX_SAM2_VIDEO_CONFIG`, verifies the optional `sam2` package, and calls SAM2 `build_sam2_video_predictor` when configured.
- The SAM2 adapter uses bbox prompts through `add_new_points_or_box`, iterates `propagate_in_video`, converts mask logits into bbox/contour/confidence frames, and writes normal `video_segmentation.json` artifacts through the existing worker path.
- Added model-gateway config-check reporting for `video_segmenters` and `ready_video_segmenters`, plus README/setup-script notes for the MedSAM2/SAM2 environment variables and optional official SAM2 package install.
- Verification after the SAM2 adapter shell passed: `python3 -m unittest services/model-gateway/tests/test_gateway.py` ran 21 tests and `python3 -m compileall -q services/model-gateway/app` passed.
- Installed `sam2==1.1.0` into the remote 5090 `.venv-model-gateway-gpu` environment after GitHub source install failed from network timeouts. Verified `sam2.build_sam.build_sam2_video_predictor` exists, Torch `2.11.0+cu128` sees the RTX 5090, and model-gateway config check reports `sam2` installed under `video_segmenters`.
- Copied the packaged SAM2 config to `/home/beelink/jiazhuangxian/data/models/segmentation/medsam2/sam2.1_hiera_t.yaml`. Config check with `JZX_MEDSAM2_CONFIG` now recognizes the config path; the only remaining blocker for real video propagation is the actual MedSAM2/SAM2 checkpoint file via `JZX_MEDSAM2_WEIGHTS` or `JZX_SAM2_WEIGHTS`.
- Remote fallback-disabled video segmentation smoke succeeded with `tracks=[]` and warnings `sam2_weights_env_missing:JZX_MEDSAM2_WEIGHTS|JZX_SAM2_WEIGHTS` plus `video_segmentation_model_unavailable:fallback_disabled`, confirming the 5090 runtime will not generate fake video masks when weights are absent.

### Background Tasks

None.

### Blocking Issues

None.

### Next Session Priorities

1. Add confidence-threshold calibration and per-image false-positive/false-negative review reports for the RF-DETR primary and YOLO comparator detectors.
2. Decide whether detector validation should remain TN5000-only for the first demo or add a second cross-dataset evaluation against TN3K to estimate external generalization.
3. Decide whether to keep the verification LLM path on LM Studio GGUF or switch to HF-format Qwen3.6 under `data/llm` with vLLM.
4. Fix or re-download the Qwen3.6-27B runtime so it can be used as a lower-memory fallback.
5. Add doctor-workstation rendering for `report.structured_json.medical_review_assistant` and evidence-backed review warnings.
6. Extend provider/model support to doctor-facing modification suggestions.
7. Implement MED-312A/MED-312B from `docs/SEGMENTATION_MODEL_INTEGRATION_PLAN.md`: refactor `segmentation.py` into `SegmenterAdapter` adapters, then connect MedSAM bbox-prompt inference with fallback disabled for validation runs.
8. Put the MedSAM2/SAM2 checkpoint under `/home/beelink/jiazhuangxian/data/models/segmentation/medsam2/`, set `JZX_MEDSAM2_WEIGHTS`, and run a real `thyroid.segment_video_nodule` smoke with fallback disabled.
9. Add doctor-workstation rendering for `measurement` rows, mask artifact preview, and explicit missing-PixelSpacing calibration warnings.
10. Replace the remaining validation placeholder outputs with real feature-classifier model calls where dependencies are configured.
11. Add PDF-to-manifest parsing when representative guideline PDFs are available.
12. Add batch case queue workflows for multi-case review, filtering, and bulk state transitions.
13. Fix or intentionally suppress the two pre-existing lint findings when lint hygiene becomes the next task.

### Previous Resume Checklist

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
python3 -m unittest discover test/unit/scripts
```

## 📌 SESSION HANDOFF STATUS

### Current Work: Static Segmentation Chain + TN3K U-Net Weight Path

- Added real static segmentation adapter routing in `services/model-gateway/app/segmentation.py`: model names containing `medsam` use a `segment-anything`/MedSAM bbox-prompt adapter, model names containing `unet` use a TorchScript U-Net adapter, and the existing `bbox_fallback` remains as an explicit validation fallback only.
- Added model-gateway config reporting for static segmenters. `model-gateway:check` now reports `segmenters`, `ready_segmenters`, MedSAM weight status via `JZX_MEDSAM_WEIGHTS`, and U-Net TorchScript status via `JZX_UNET_SEGMENTER_WEIGHTS`.
- Added `scripts/train_tn3k_unet.py` and `npm run datasets:tn3k:train-unet`. The script uses TN3K `trainval-image`/`trainval-mask`, fixed-seed 80/20 split, BCE+Dice loss, metrics CSV, `summary.json`, `best_state.pt`, and `best_torchscript.pt`.
- Installed `segment-anything` in the 5090 `.venv-model-gateway-gpu` environment.
- Remote 5090 verification passed: `python -m unittest services/model-gateway/tests/test_gateway.py` ran 23 tests OK; `python -m py_compile scripts/train_tn3k_unet.py services/model-gateway/app/segmentation.py services/model-gateway/app/config_check.py` passed.
- Local verification passed: `python3 -m unittest services/model-gateway/tests/test_gateway.py` ran 23 tests OK, `npm run typecheck` passed, `python3 -m compileall -q services/model-gateway/app scripts/train_tn3k_unet.py` passed, and `git diff --check` passed.
- Formal full TN3K training command was attempted on 5090 but failed immediately with CUDA OOM because LM Studio is occupying ~29.8GB GPU memory (`/home/beelink/.lmstudio/.internal/utils/node`, PID `3291476`). No long-running training process remains.
- Trained a small CPU validation U-Net weight for static-chain testing only: `/home/beelink/jiazhuangxian/data/models/segmentation/tn3k-unet-chain-validation/best_torchscript.pt`, best validation Dice `0.493969` on a 64-sample smoke split. This is not the final clinical validation weight.
- Static chain was run end-to-end on 5090 using the validation U-Net weight with fallback disabled: `thyroid.segment_nodule` produced `artifact://model-output/thyroid-segment-nodule/STATIC_CHAIN_VALIDATION/0000/mj_8584bf49db0a4619b97f5b3779059066/segmentation.json`, mask `mask_nodule_1.png`, then `thyroid.measure_nodule` produced `artifact://model-output/thyroid-measure-nodule/STATIC_CHAIN_VALIDATION/0000/mj_7d11dc98bdeb4d13acc49f45f327f947/measurements.json`. Measurement source was `mask`; example long axis `24.9mm`, short axis `16.9mm`, area `260.76mm2`.

### Background Tasks

None.

### Blocking Issues

- Full 80/20 TN3K U-Net training on GPU is blocked until the LM Studio GPU process is stopped or unloaded. Current GPU processes observed on 5090: `gnome-remote-desktop-daemon` ~504MB, `rustdesk` ~519MB, LM Studio node PID `3291476` ~29818MB.
- MedSAM static adapter is implemented but not ready until a SAM/MedSAM checkpoint is placed under `data/models/segmentation` and `JZX_MEDSAM_WEIGHTS` is set. The current complete static-chain validation used the TorchScript U-Net adapter instead.

### Next Session Priorities

1. Stop/unload LM Studio or ask the user to switch off the loaded LLM, then rerun full GPU training:
   `python scripts/train_tn3k_unet.py --epochs 30 --batch-size 16 --image-size 256 --base-channels 32 --num-workers 4 --out-dir data/models/segmentation/tn3k-unet-v1`
2. After full training, set `JZX_UNET_SEGMENTER_WEIGHTS=$PWD/data/models/segmentation/tn3k-unet-v1/best_torchscript.pt` and rerun the static `SegmentNodule -> MeasureNodule` validation with fallback disabled.
3. Add a compact training report artifact for TN3K U-Net v1 with loss/Dice/IoU table and artifact paths.
4. Download or provide a MedSAM/SAM checkpoint, set `JZX_MEDSAM_WEIGHTS`, and run a separate MedSAM bbox-prompt smoke so the two static segmenter routes can be compared.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short --branch
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
python3 -m unittest services/model-gateway/tests/test_gateway.py
npm run typecheck
python3 -m compileall -q services/model-gateway/app scripts/train_tn3k_unet.py
```

## 📌 SESSION HANDOFF STATUS

### Current Work: TN3K U-Net v1 Training Completed

- User released LM Studio GPU memory on the 5090 host. Confirmed available GPU state: RTX 5090 with about `1467/32607 MiB` used before training; only remote desktop and RustDesk remained.
- First full training attempt reached epoch 1 but failed at epoch 2 because TorchScript export moved traced parameters to CPU and left the live model in a mixed device state. Fixed the root cause in `scripts/train_tn3k_unet.py` by deep-copying the model for TorchScript export and keeping the live model on the training device.
- Completed full TN3K U-Net v1 training on 5090:
  - Data root: `/home/beelink/jiazhuangxian/data/artifacts/datasets/tn3k/processed/datasets/tn3k`
  - Total paired samples: `2879`
  - Split: seeded `2303 train / 576 validation`
  - Command: `python scripts/train_tn3k_unet.py --epochs 30 --batch-size 16 --image-size 256 --base-channels 32 --num-workers 4 --out-dir data/models/segmentation/tn3k-unet-v1`
  - Device: CUDA
  - Duration: `188.401s`
  - Best epoch: `15`
  - Best validation Dice: `0.705510`
  - Best validation IoU: `0.576197`
  - State dict: `/home/beelink/jiazhuangxian/data/models/segmentation/tn3k-unet-v1/best_state.pt`
  - TorchScript: `/home/beelink/jiazhuangxian/data/models/segmentation/tn3k-unet-v1/best_torchscript.pt`
  - Metrics: `/home/beelink/jiazhuangxian/data/models/segmentation/tn3k-unet-v1/metrics.csv`
  - Summary: `/home/beelink/jiazhuangxian/data/models/segmentation/tn3k-unet-v1/summary.json`
- Ran model-gateway config check with `JZX_UNET_SEGMENTER_WEIGHTS=$PWD/data/models/segmentation/tn3k-unet-v1/best_torchscript.pt`; it reports `ready_segmenters=["unet"]`. MedSAM remains `not_ready` because `JZX_MEDSAM_WEIGHTS` has not been provided yet.
- Ran static chain with fallback disabled using `tn3k-unet-v1`:
  - `thyroid.segment_nodule` artifact: `artifact://model-output/thyroid-segment-nodule/STATIC_CHAIN_V1/0000/mj_b24c75fe234245df96c1825f5443300b/segmentation.json`
  - Mask artifact: `artifact://model-output/thyroid-segment-nodule/STATIC_CHAIN_V1/0000/mj_b24c75fe234245df96c1825f5443300b/mask_nodule_1.png`
  - Segmentation bbox: `[61.0, 42.0, 289.0, 188.0]`
  - Segmentation confidence: `0.8437`
  - `thyroid.measure_nodule` artifact: `artifact://model-output/thyroid-measure-nodule/STATIC_CHAIN_V1/0000/mj_6cf6584602f84da58a771e018352b6bb/measurements.json`
  - Measurement source: `mask`
  - Example measurement: long axis `22.8mm`, short axis `14.6mm`, area `195.11mm2`, aspect ratio `1.5616`
- Verification after the training-script fix passed: `python3 -m py_compile scripts/train_tn3k_unet.py`, remote `python -m py_compile scripts/train_tn3k_unet.py`, local `python3 -m unittest services/model-gateway/tests/test_gateway.py` ran 23 tests OK, and `git diff --check` passed.
- Added the formal training report `docs/TN3K_UNET_SEGMENTATION_TRAINING_REPORT_20260510.md`, with local assets under `docs/assets/tn3k-unet-v1/`: `summary.json`, `metrics.csv`, `metrics_curve.svg`, sample source image, ground-truth mask, predicted mask, overlay image, segmentation JSON, and measurement JSON.

### Background Tasks

None.

### Blocking Issues

- `tn3k-unet-v1` is a validation baseline, not a final clinical-grade segmentation model. Dice `0.7055` is enough to prove the static chain and produce real masks, but a production-quality model should move next to nnU-Net/Swin U-Net/MedSAM comparison, stronger augmentation, LR scheduling, and external validation.
- MedSAM static adapter is implemented but still awaits a SAM/MedSAM checkpoint via `JZX_MEDSAM_WEIGHTS`.

### Next Session Priorities

1. Run a second segmentation training experiment with LR scheduling/augmentation, or move to nnU-Net/Swin U-Net for better Dice.
2. Wire `JZX_UNET_SEGMENTER_WEIGHTS` into the normal 5090 model-worker startup environment so doctor-workstation jobs use `tn3k-unet-v1` by default.
3. Provide/download MedSAM checkpoint and run MedSAM bbox-prompt comparison against U-Net.
4. Add the U-Net training report to any higher-level project status index if needed.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short --branch
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && cat data/models/segmentation/tn3k-unet-v1/summary.json'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 8 data/models/segmentation/tn3k-unet-v1/metrics.csv'
python3 -m unittest services/model-gateway/tests/test_gateway.py
npm run typecheck
```

## 📌 SESSION HANDOFF STATUS

### Current Work: Enhanced U-Net v2, nnU-Net Prep, Swin U-Net Entry

- Extended `scripts/train_tn3k_unet.py` while preserving the original default small U-Net behavior. New options include `--model residual_attention`, `--augment`, `--scheduler cosine`, `--threshold-sweep`, `--early-stopping-patience`, `--dropout`, and `--min-lr`.
- Fixed the enhanced training summary so threshold-sweep checkpoints report the best-threshold IoU and threshold, not only the fixed 0.5 threshold metrics.
- Trained enhanced U-Net v2 on the 5090:
  - Command: `python scripts/train_tn3k_unet.py --epochs 60 --batch-size 8 --image-size 256 --base-channels 24 --model residual_attention --dropout 0.08 --augment --scheduler cosine --threshold-sweep --early-stopping-patience 15 --num-workers 4 --out-dir data/models/segmentation/tn3k-unet-v2`
  - Data split: `2303 train / 576 validation`
  - Best epoch: `45`
  - Best validation Dice: `0.781792`
  - Best validation IoU: `0.675132`
  - Best threshold: `0.35`
  - Duration: `412.852s`
  - Weights: `/home/beelink/jiazhuangxian/data/models/segmentation/tn3k-unet-v2/best_state.pt` and `/home/beelink/jiazhuangxian/data/models/segmentation/tn3k-unet-v2/best_torchscript.pt`
  - Improvement over v1: Dice `+0.076282`, IoU `+0.098935`
- Ran static chain with fallback disabled using U-Net v2:
  - `JZX_UNET_SEGMENTER_WEIGHTS=$PWD/data/models/segmentation/tn3k-unet-v2/best_torchscript.pt`
  - `JZX_UNET_SEGMENTER_THRESHOLD=0.35`
  - Segmentation artifact: `artifact://model-output/thyroid-segment-nodule/STATIC_CHAIN_V2/0000/mj_64a43bacd1844f24b82fc0974174dfc7/segmentation.json`
  - Measurement artifact: `artifact://model-output/thyroid-measure-nodule/STATIC_CHAIN_V2/0000/mj_33a3356b516844c792106efbfc026f28/measurements.json`
  - Example bbox `[91.0, 53.0, 226.0, 182.0]`, confidence `0.7954`, long axis `13.5mm`, short axis `12.9mm`, area `78.76mm2`.
- Added `scripts/prepare_tn3k_nnunet.py` and package script `datasets:tn3k:prepare-nnunet`.
- Prepared nnU-Net v2 dataset on 5090:
  - Raw dataset: `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_raw/Dataset501_TN3KThyroid`
  - imagesTr/labelsTr: `2303`
  - imagesTs/labelsTs: `576`
  - `nnUNetv2_plan_and_preprocess -d 501 --verify_dataset_integrity` completed successfully.
  - Plans: `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_preprocessed/Dataset501_TN3KThyroid/nnUNetPlans.json`
- Added `scripts/train_tn3k_swin_unet.py` and package script `datasets:tn3k:train-swin-unet`.
- Installed remote dependencies in `.venv-model-gateway-gpu`: `nnunetv2`, `timm`, `segmentation-models-pytorch`.
- Fixed Swin U-Net `--encoder-weights none` handling so it does not try to download from Hugging Face.
- Swin U-Net smoke passed on 5090 with `--max-samples 16 --epochs 1 --batch-size 1 --encoder-weights none`; output wrote to `data/models/segmentation/tn3k-swin-unet-smoke`.
- Added `docs/TN3K_SEGMENTATION_NEXT_ROUND_20260510.md` and local assets under `docs/assets/tn3k-unet-v2/`.

### Background Tasks

None.

### Blocking Issues

- nnU-Net full training was not started because the default trainer is long-running. The dataset is ready and preprocessed; start manually when the 5090 can be dedicated to it.
- Swin U-Net full training was not started; only smoke test completed. Pretrained Swin weights require either internet/Hugging Face access or a local cache. Offline mode works with `--encoder-weights none`.

### Next Session Priorities

1. Switch model-worker default static segmentation to `tn3k-unet-v2/best_torchscript.pt` with threshold `0.35`.
2. Start nnU-Net training:
   `nnUNetv2_train 501 2d 0`
3. Start Swin U-Net full training:
   `python scripts/train_tn3k_swin_unet.py --epochs 40 --batch-size 4 --image-size 224 --encoder-weights none --out-dir data/models/segmentation/tn3k-swin-unet-v1`
4. Build a three-model comparison report: U-Net v2 vs nnU-Net vs Swin U-Net.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short --branch
python3 -m py_compile scripts/train_tn3k_unet.py scripts/prepare_tn3k_nnunet.py scripts/train_tn3k_swin_unet.py
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && cat data/models/segmentation/tn3k-unet-v2/summary.json'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && source .venv-model-gateway-gpu/bin/activate && export nnUNet_raw=$PWD/data/nnunet/nnUNet_raw && export nnUNet_preprocessed=$PWD/data/nnunet/nnUNet_preprocessed && export nnUNet_results=$PWD/data/nnunet/nnUNet_results && ls data/nnunet/nnUNet_preprocessed/Dataset501_TN3KThyroid/nnUNetPlans.json'
npm run typecheck
git diff --check
```

## 📌 SESSION HANDOFF STATUS

### Current Work: nnU-Net Training Toward Dice 0.95 Target

- User set the target Dice to `0.95`. Treat this as the segmentation model acceptance target, not as guaranteed for the current short run.
- Started nnU-Net 2D 100 epoch experiment on 5090:
  - PID: `3547766`
  - Log: `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-2d-100epochs/train.log`
  - PID file: `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-2d-100epochs/train.pid`
  - Command: `nnUNetv2_train 501 2d 0 -tr nnUNetTrainer_100epochs`
  - Env: `nnUNet_raw=$PWD/data/nnunet/nnUNet_raw`, `nnUNet_preprocessed=$PWD/data/nnunet/nnUNet_preprocessed`, `nnUNet_results=$PWD/data/nnunet/nnUNet_results`
  - GPU usage during run: about `6088 MiB` plus remote desktop/RustDesk overhead.
- nnU-Net selected fold 0 with `1842 training / 461 validation cases`.
- Early training signal:
  - Epoch 0 pseudo Dice `0.5662`
  - Epoch 5 pseudo Dice `0.7601`
  - Epoch 9 pseudo Dice `0.8009`
  - Epoch 13 pseudo Dice `0.8053`
  - At last check, training was entering epoch 14 and still running.
- Note: nnU-Net log reports "pseudo dice"; final model comparison should use exported validation metrics/predictions, not just early pseudo dice.

### Background Tasks

- Remote nnU-Net training is running on 5090 as PID `3547766`.

### Blocking Issues

- None for the running nnU-Net experiment.
- Reaching Dice `0.95` likely requires more than this 100 epoch fold-0 probe: longer training, all 5 folds, postprocessing, ensemble, maybe ResEnc presets, and possible data/label cleaning.

### Next Session Priorities

1. Check nnU-Net training status and final metrics:
   `tail -n 200 /home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-2d-100epochs/train.log`
2. If 100 epochs is promising but below target, continue/launch longer training with `nnUNetTrainer_250epochs` or `nnUNetTrainer_500epochs`.
3. Train all 5 folds if single-fold results approach the target, then run nnU-Net ensemble/postprocessing.
4. Produce a formal nnU-Net training report and compare against U-Net v2.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ps -p $(cat data/models/segmentation/nnunet-tn3k-2d-100epochs/train.pid) -o pid,etime,stat,cmd'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 200 data/models/segmentation/nnunet-tn3k-2d-100epochs/train.log'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: Tight ROI Fold2 Training

- Dataset503 Tight ROI fold-1 100 epoch training completed.
- Fold-1 command:
  `nnUNetv2_train 503 2d 1 -tr nnUNetTrainer_100epochs`
- Fold-1 result directory:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_1`
- Fold-1 final checkpoint validation:
  - Mean Validation Dice: `0.8737099959703017`
  - Mean Validation IoU: `0.7861898688971785`
  - median Dice: `0.8991651952231196`
  - min Dice: `0.19548435776887804`
  - max Dice: `0.9746236863271962`
  - cases below Dice `0.80`: `58`
  - cases below Dice `0.85`: `103`
  - cases below Dice `0.90`: `234`
- Fold-1 training metrics:
  - best pseudo Dice: `0.8863` at epoch `69`
  - best EMA pseudo Dice: `0.8809` at epoch `98`
- Fold-1 `checkpoint_best` revalidation:
  - Mean Validation Dice: `0.8743562312201778`
  - Mean Validation IoU: `0.7871213482443401`
  - median Dice: `0.8996433348194383`
  - min Dice: `0.2038629208040688`
  - max Dice: `0.9753987037979164`
  - cases below Dice `0.80`: `55`
  - cases below Dice `0.85`: `104`
  - cases below Dice `0.90`: `231`
- Decision:
  - Fold-1 `checkpoint_best.pth` is slightly better than final checkpoint and should be used as the fold-1 reference.
  - Fold-1 is lower than fold-0 but still comparable enough to continue the 5-fold ensemble path.

### Fold2 Training

- Started Dataset503 Tight ROI fold-2 100 epoch training.
- Command:
  `nnUNetv2_train 503 2d 2 -tr nnUNetTrainer_100epochs`
- PID:
  `3974682`
- Wrapper log:
  `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-fold2/train.log`
- nnU-Net log:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_2/training_log_2026_5_10_18_22_50.txt`
- Early observed fold-2 metrics:
  - epoch `0`: pseudo Dice `0.8163`
  - epoch `1`: pseudo Dice `0.8352`
  - latest EMA pseudo Dice at epoch `1`: `0.8182`
  - NaN observed: `false`
- GPU:
  - fold-2 training uses about `5.9GB` VRAM.
  - old Dataset501 PID may still appear in `nvidia-smi` as `[Not Found]`; it has not blocked training.

### Background Tasks

- Remote Dataset503 Tight ROI fold-2 100 epoch training is running on 5090 as PID `3974682`.

### Blocking Issues

- None for the running fold-2 job.
- Dice target `0.95` is still not reached; current best single fold is Dataset503 fold-0 final checkpoint Dice `0.8832810582350146`.
- The current strategy remains 5-fold ensemble plus low-Dice case review/label quality analysis.

### Next Session Priorities

1. Continue monitoring fold-2 until 100 epochs.
2. Validate fold-2 final and `checkpoint_best` summaries, then decide whether to start fold-3.
3. After folds `0-4` complete, run nnU-Net ensemble/postprocessing and compare against single-fold Dice.
4. If ensemble remains below `0.90`, inspect repeated low-Dice cases across folds before adding more model variants.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ps -p $(cat data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-fold2/train.pid) -o pid,etime,%cpu,%mem,stat,cmd'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 160 data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_2/training_log_2026_5_10_18_22_50.txt'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: Tight ROI Fold3 Training

- Dataset503 Tight ROI fold-2 100 epoch training completed.
- Fold-2 command:
  `nnUNetv2_train 503 2d 2 -tr nnUNetTrainer_100epochs`
- Fold-2 result directory:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_2`
- Fold-2 training metrics:
  - best pseudo Dice: `0.8895` at epoch `53`
  - latest/final pseudo Dice: `0.8776` at epoch `99`
  - best EMA pseudo Dice: `0.8844` at epoch `54`
- Fold-2 final checkpoint validation:
  - Mean Validation Dice: `0.8799450504645445`
  - Mean Validation IoU: `0.7932611863024467`
  - median Dice: `0.8983727620110772`
  - min Dice: `0.39901512988866683`
  - max Dice: `0.9763304666978518`
  - cases below Dice `0.80`: `53`
  - cases below Dice `0.85`: `106`
  - cases below Dice `0.90`: `234`
- Fold-2 `checkpoint_best` revalidation:
  - Mean Validation Dice: `0.884120991648977`
  - Mean Validation IoU: `0.7990325653521477`
  - median Dice: `0.9002091354151813`
  - min Dice: `0.45249296969155917`
  - max Dice: `0.9760153568485076`
  - cases below Dice `0.80`: `47`
  - cases below Dice `0.85`: `91`
  - cases below Dice `0.90`: `230`
- Decision:
  - Fold-2 `checkpoint_best.pth` is better than final checkpoint and should be used as the fold-2 reference.
  - Fold-2 is currently the strongest single fold among completed folds.
  - Continue 5-fold ensemble path.

### Fold3 Training

- Started Dataset503 Tight ROI fold-3 100 epoch training.
- Command:
  `nnUNetv2_train 503 2d 3 -tr nnUNetTrainer_100epochs`
- PID:
  `4023168`
- Wrapper log:
  `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-fold3/train.log`
- nnU-Net log:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_3/training_log_2026_5_10_18_56_02.txt`
- Early observed fold-3 metrics:
  - epoch `0`: pseudo Dice `0.8019`
  - epoch `1`: pseudo Dice `0.8432`
  - epoch `2`: pseudo Dice `0.8526`
  - latest EMA pseudo Dice at epoch `2`: `0.8107`
  - NaN observed: `false`
- GPU:
  - fold-3 training uses about `5.9GB` VRAM.
  - old Dataset501 PID may still appear in `nvidia-smi` as `[Not Found]`; it has not blocked training.

### Background Tasks

- Remote Dataset503 Tight ROI fold-3 100 epoch training is running on 5090 as PID `4023168`.

### Blocking Issues

- None for the running fold-3 job.
- Dice target `0.95` is still not reached by any single fold.
- Current best single-fold validation is Dataset503 fold-2 `checkpoint_best.pth` with Mean Dice `0.884120991648977`.

### Next Session Priorities

1. Continue monitoring fold-3 until 100 epochs.
2. Validate fold-3 final and `checkpoint_best` summaries, then start fold-4 if comparable.
3. After folds `0-4` complete, run nnU-Net ensemble/postprocessing and compare against single-fold Dice.
4. Inspect repeated low-Dice validation cases across folds if ensemble remains below `0.90`.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ps -p $(cat data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-fold3/train.pid) -o pid,etime,%cpu,%mem,stat,cmd'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 160 data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_3/training_log_2026_5_10_18_56_02.txt'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: nnU-Net 100 Epoch Result

- Completed the nnU-Net 2D fold-0 100 epoch experiment on the 5090 host.
- Command run:
  `nnUNetv2_train 501 2d 0 -tr nnUNetTrainer_100epochs`
- Result directory:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0`
- Checkpoints:
  - `checkpoint_best.pth`
  - `checkpoint_final.pth`
- Training log:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0/training_log_2026_5_10_13_47_59.txt`
- Validation outputs:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0/validation/`
- Key metrics from log:
  - Best single-epoch pseudo Dice observed: `0.8642` at epoch 90.
  - Best EMA pseudo Dice: `0.8444` at epoch 99.
  - Final Mean Validation Dice: `0.8119929891563971`.
- Interpretation:
  - nnU-Net 100 epoch fold-0 is stronger than U-Net v2 (`0.781792`) but still far below the user target `0.95`.
  - This is not enough to select as the final main segmentation model.
  - Reaching `0.95` likely requires a different training strategy: longer nnU-Net training, 5-fold ensemble, postprocessing, ResEnc presets, ROI/crop dataset, and label-quality review.
- Current 5090 GPU status after training:
  - nnU-Net training process exited.
  - LM Studio is running again and using about `24058 MiB` GPU memory as `/home/beelink/.lmstudio/.internal/utils/node`.

### Background Tasks

None.

### Blocking Issues

- Further GPU training is blocked or risky while LM Studio occupies about 24GB VRAM.
- The `0.95` target cannot be reached by the completed 100 epoch fold-0 nnU-Net run.

### Next Session Priorities

1. Ask user to free 5090 GPU memory again, or confirm it is acceptable to stop LM Studio before longer training.
2. Start the next high-target nnU-Net path:
   - `nnUNetTrainer_500epochs` for fold 0, or
   - all 5 folds with `nnUNetTrainer_250epochs`/`500epochs` followed by ensemble and postprocessing.
3. Build an ROI/crop dataset from existing masks and train nnU-Net on nodule-centered crops to reduce background and improve boundary Dice.
4. Inspect low-Dice validation cases from nnU-Net predictions to identify label noise, very small nodules, and image-quality outliers.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 120 data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0/training_log_2026_5_10_13_47_59.txt'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ls -lh data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0/checkpoint_best.pth'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: nnU-Net 500 Epoch Warm-Start Training

- Started a longer nnU-Net 2D fold-0 experiment on the 5090 host.
- Goal:
  - Push segmentation Dice beyond the completed 100 epoch result.
  - User target remains Dice `0.95`.
  - This run is still a single-fold experiment; it is not the final 5-fold/ensemble path yet.
- Warm-start checkpoint:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0/checkpoint_best.pth`
- Command:
  `nnUNetv2_train 501 2d 0 -tr nnUNetTrainer_500epochs -pretrained_weights /home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0/checkpoint_best.pth`
- Wrapper log:
  `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-2d-500epochs-warmstart/train.log`
- nnU-Net result directory:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_500epochs__nnUNetPlans__2d/fold_0`
- nnU-Net training log:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_500epochs__nnUNetPlans__2d/fold_0/training_log_2026_5_10_14_26_36.txt`
- Startup verification:
  - Process started as PID `3602880`.
  - GPU process detected and using about `6GB` VRAM shortly after startup.
  - Training entered normal epoch logging.
  - Early observed metrics:
    - Epoch 0 pseudo Dice: `0.829`
    - Epoch 1 pseudo Dice: `0.8287`
    - Epoch 2 pseudo Dice: `0.8252`

### Background Tasks

- Remote nnU-Net 500 epoch warm-start training is running on 5090 as PID `3602880`.

### Blocking Issues

- None for this running training job.
- This experiment may still fall short of Dice `0.95`; if so, the next practical options are ROI/crop nnU-Net, 5-fold ensemble/postprocessing, and label-quality review.

### Next Session Priorities

1. Monitor the 500 epoch warm-start run and capture best pseudo Dice/checkpoints.
2. If the single-fold result reaches or approaches `0.90`, run all 5 folds and nnU-Net ensemble/postprocessing.
3. If it remains below `0.90`, prepare a nodule-centered ROI/crop dataset and train a crop-specific segmentation model.
4. Export the best checkpoint into the model-gateway static segmentation chain once it beats the current U-Net v2 baseline.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ps -p $(cat data/models/segmentation/nnunet-tn3k-2d-500epochs-warmstart/train.pid) -o pid,etime,%cpu,%mem,stat,cmd'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 160 data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_500epochs__nnUNetPlans__2d/fold_0/training_log_2026_5_10_14_26_36.txt'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: nnU-Net 500 Epoch Warm-Start Monitoring

- Continued monitoring the remote 500 epoch warm-start run.
- Process remains alive as PID `3602880`.
- GPU memory usage remains about `6GB`.
- No `NaN` detected in the training log.
- Latest observed status:
  - latest epoch: `20`
  - latest pseudo Dice: `0.8206`
  - best epoch so far: `5`
  - best pseudo Dice so far: `0.8397`
  - recent pseudo Dice values: `16:0.8322`, `17:0.8283`, `18:0.8199`, `19:0.8324`, `20:0.8206`
- Interpretation:
  - The job is healthy and should continue.
  - It is too early to judge final performance.
  - Current early metrics do not yet justify starting 5-fold training in parallel.

### Background Tasks

- Remote nnU-Net 500 epoch warm-start training is still running on 5090 as PID `3602880`.

### Blocking Issues

- None for the running job.

### Next Session Priorities

1. Continue monitoring until at least epoch `100-150` before deciding whether the 500 epoch path is promising.
2. If pseudo Dice rises above `0.88-0.90`, prepare all-fold training and ensemble.
3. If pseudo Dice plateaus below `0.86`, switch effort to ROI/crop nnU-Net and label-quality analysis instead of spending more GPU time on full-frame single-fold training.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ps -p $(cat data/models/segmentation/nnunet-tn3k-2d-500epochs-warmstart/train.pid) -o pid,etime,%cpu,%mem,stat,cmd'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && .venv-model-gateway-gpu/bin/python - <<'"'"'PY'"'"'
from pathlib import Path
import re
log = Path("data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_500epochs__nnUNetPlans__2d/fold_0/training_log_2026_5_10_14_26_36.txt")
text = log.read_text(errors="ignore")
current_epoch = None
records = []
for line in text.splitlines():
    m = re.search(r"Epoch (\d+)", line)
    if m:
        current_epoch = int(m.group(1))
    m = re.search(r"Pseudo dice \[np\.float32\(([-0-9.]+)\)\]", line)
    if m and current_epoch is not None:
        records.append((current_epoch, float(m.group(1))))
if records:
    best = max(records, key=lambda x: x[1])
    latest = records[-1]
    print(f"latest_epoch={latest[0]}")
    print(f"latest_pseudo_dice={latest[1]:.4f}")
    print(f"best_epoch={best[0]}")
    print(f"best_pseudo_dice={best[1]:.4f}")
    print("last5=" + ",".join(f"{e}:{d:.4f}" for e, d in records[-5:]))
print("has_nan=", "nan" in text.lower())
PY'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: nnU-Net 500 Epoch Warm-Start Continued

- Continued monitoring the remote 500 epoch warm-start run.
- Process remains alive as PID `3602880`.
- GPU memory usage remains about `6GB`.
- No `NaN` detected in the training log.
- Latest observed status:
  - latest epoch: `51`
  - latest pseudo Dice: `0.8480`
  - best epoch so far: `31`
  - best pseudo Dice so far: `0.8556`
  - recent pseudo Dice values: `47:0.8236`, `48:0.8309`, `49:0.8243`, `50:0.8290`, `51:0.8480`
- Interpretation:
  - The job is healthy and should continue.
  - The run is improving beyond the first early checkpoint, but has not yet shown a path toward Dice `0.90+`.
  - Do not start 5-fold training yet; wait for at least epoch `100-150`.

### Background Tasks

- Remote nnU-Net 500 epoch warm-start training is still running on 5090 as PID `3602880`.

### Blocking Issues

- None for the running job.

### Next Session Priorities

1. Monitor until at least epoch `100-150`.
2. If best pseudo Dice approaches `0.88-0.90`, continue to full 500 epochs and then consider all-fold training.
3. If it stays around `0.84-0.86`, prepare ROI/crop nnU-Net and label-quality review as the next higher-yield route.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ps -p $(cat data/models/segmentation/nnunet-tn3k-2d-500epochs-warmstart/train.pid) -o pid,etime,%cpu,%mem,stat,cmd'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 120 data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_500epochs__nnUNetPlans__2d/fold_0/training_log_2026_5_10_14_26_36.txt'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: Switched From Full-Frame nnU-Net to ROI nnU-Net

- Monitored full-frame Dataset501 500 epoch warm-start until epoch `101`.
- Full-frame run plateaued:
  - latest epoch: `101`
  - latest pseudo Dice: `0.8451`
  - best epoch: `31`
  - best pseudo Dice: `0.8556`
  - no `NaN`
- Stopped full-frame run because it was unlikely to reach the user target Dice `0.95` and was not improving by epoch `100+`.
- Full-frame checkpoints were preserved:
  - `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_500epochs__nnUNetPlans__2d/fold_0/checkpoint_best.pth`
  - `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset501_TN3KThyroid/nnUNetTrainer_500epochs__nnUNetPlans__2d/fold_0/checkpoint_latest.pth`

### ROI Dataset502 Preparation

- Added local script:
  `/Users/xutianliang/Downloads/jiazhuangxian/scripts/prepare_tn3k_roi_nnunet.py`
- Added local unit test:
  `/Users/xutianliang/Downloads/jiazhuangxian/test/unit/scripts/test_prepare_tn3k_roi_nnunet.py`
- Local checks passed:
  - `python3 -m py_compile scripts/prepare_tn3k_roi_nnunet.py test/unit/scripts/test_prepare_tn3k_roi_nnunet.py`
  - `python3 test/unit/scripts/test_prepare_tn3k_roi_nnunet.py`
  - `git diff --check`
- Synced script to 5090 and generated ROI raw dataset:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_raw/Dataset502_TN3KThyroidROI`
- Dataset502 details:
  - total paired samples: `2879`
  - total ROI samples: `2879`
  - skipped empty masks: `0`
  - train samples: `2303`
  - validation samples: `576`
  - output size: `384`
  - margin ratio: `0.35`
  - min crop size: `96`
- Completed nnU-Net plan/preprocess:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_preprocessed/Dataset502_TN3KThyroidROI`
- Dataset502 plan:
  - 2D patch size: `384x384`
  - batch size: `22`

### ROI Training

- Started Dataset502 ROI nnU-Net 2D fold-0 100 epoch training.
- Command:
  `nnUNetv2_train 502 2d 0 -tr nnUNetTrainer_100epochs`
- PID:
  `3665132`
- Wrapper log:
  `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-2d-100epochs/train.log`
- nnU-Net log:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset502_TN3KThyroidROI/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0/training_log_2026_5_10_14_57_33.txt`
- Early observed metrics:
  - epoch `0`: pseudo Dice `0.7663`
  - epoch `3`: pseudo Dice `0.8400`
  - epoch `7`: pseudo Dice `0.8525`
  - epoch `10`: pseudo Dice `0.8625`
  - epoch `15`: pseudo Dice `0.8647`
  - epoch `17`: pseudo Dice `0.8682`
  - latest observed epoch `18`: pseudo Dice `0.8626`
- Interpretation:
  - ROI/crop route has already exceeded the full-frame best pseudo Dice `0.8556`.
  - This is currently the strongest segmentation route and should continue to 100 epochs.

### Background Tasks

- Remote Dataset502 ROI nnU-Net 100 epoch training is running on 5090 as PID `3665132`.

### Blocking Issues

- None for the running ROI job.
- The old Dataset501 CUDA context may still appear in `nvidia-smi` as PID `[Not Found]`, but current free VRAM is enough and the ROI job is running normally.

### Next Session Priorities

1. Let ROI Dataset502 100 epoch training finish and capture final validation Dice.
2. If ROI Dice reaches or approaches `0.90`, start 5-fold ROI training and ensemble/postprocessing.
3. If ROI Dice plateaus below `0.90`, inspect low-Dice validation masks and tune ROI margin/output size, then consider ResEnc presets.
4. Export the best ROI checkpoint into the model-gateway segmentation adapter only after final validation confirms it beats U-Net v2 and full-frame nnU-Net.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ps -p $(cat data/models/segmentation/nnunet-tn3k-roi-2d-100epochs/train.pid) -o pid,etime,%cpu,%mem,stat,cmd'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 160 data/nnunet/nnUNet_results/Dataset502_TN3KThyroidROI/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0/training_log_2026_5_10_14_57_33.txt'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: ROI nnU-Net Completed, ResEnc ROI Running

- Completed Dataset502 ROI nnU-Net 2D fold-0 100 epoch training.
- Default ROI command:
  `nnUNetv2_train 502 2d 0 -tr nnUNetTrainer_100epochs`
- Default ROI result directory:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset502_TN3KThyroidROI/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0`
- Default ROI final result:
  - best pseudo Dice during training: `0.8847` at epoch `70`
  - best EMA pseudo Dice: `0.8786` at epoch `83`
  - final Mean Validation Dice: `0.870746139219734`
  - final Mean Validation IoU: `0.782674395520519`
  - checkpoint files:
    - `checkpoint_best.pth`
    - `checkpoint_final.pth`
- Validation distribution from `validation/summary.json`:
  - validation cases: `461`
  - min Dice: `0.22582602460146725`
  - median Dice: `0.8986679923885279`
  - max Dice: `0.9768751878407969`
  - cases below Dice `0.70`: `28`
  - cases below Dice `0.80`: `57`
  - cases below Dice `0.85`: `93`
- Postprocessing check:
  - Ran `nnUNetv2_determine_postprocessing`.
  - Result: removing all but the largest foreground region did not improve results.
- Worst-case overlay artifacts:
  - remote: `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-2d-100epochs/worst_cases_overlay.png`
  - local: `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-roi-nnunet/worst_cases_overlay.png`
  - local manifest: `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-roi-nnunet/worst_cases.json`
- Interpretation:
  - ROI/crop improves over full-frame nnU-Net, but single fold is still below the `0.90` decision threshold and far below target `0.95`.
  - Median Dice is near `0.90`, but low-Dice outliers drag down the mean. Worst cases show large label/model disagreements, adjacent-structure confusion, and likely hard multi-object/label-quality cases.
  - Do not start 5-fold default ROI yet; first test stronger architecture and inspect/clean low-Dice cases.

### ResEnc ROI Experiment

- Planned and preprocessed Dataset502 with `ResEncUNetPlanner`.
- ResEnc plans:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_preprocessed/Dataset502_TN3KThyroidROI/nnUNetResEncPlans.json`
- ResEnc architecture:
  `dynamic_network_architectures.architectures.unet.ResidualEncoderUNet`
- Started ResEnc ROI 2D fold-0 100 epoch training.
- Command:
  `nnUNetv2_train 502 2d 0 -p nnUNetResEncPlans -tr nnUNetTrainer_100epochs`
- PID:
  `3738034`
- Wrapper log:
  `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-resenc-2d-100epochs/train.log`
- nnU-Net log:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset502_TN3KThyroidROI/nnUNetTrainer_100epochs__nnUNetResEncPlans__2d/fold_0/training_log_2026_5_10_15_33_22.txt`
- Early observed metrics:
  - epoch `0`: pseudo Dice `0.7540`
  - epoch `2`: pseudo Dice `0.8265`
  - epoch `5`: pseudo Dice `0.8528`
  - epoch `8`: pseudo Dice `0.8556`
  - latest observed epoch `10`: pseudo Dice `0.8590`
- GPU:
  - current ResEnc training uses about `8.9GB` VRAM.
  - old Dataset501 PID may still appear in `nvidia-smi` as `[Not Found]`, but ResEnc training is running normally.

### Background Tasks

- Remote Dataset502 ROI ResEnc 100 epoch training is running on 5090 as PID `3738034`.

### Blocking Issues

- None for the running ResEnc job.
- Default ROI nnU-Net did not meet the `0.90` threshold; do not promote it as the main model yet.

### Next Session Priorities

1. Monitor ResEnc ROI training through epoch `50-100`.
2. If ResEnc final Mean Validation Dice exceeds `0.90`, consider all-fold ResEnc training and ensemble.
3. If ResEnc remains around `0.87-0.89`, prioritize low-Dice case review, label-quality audit, and ROI crop parameter tuning.
4. Only export a model into the model-gateway segmentation adapter after final validation materially beats the default ROI result.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ps -p $(cat data/models/segmentation/nnunet-tn3k-roi-resenc-2d-100epochs/train.pid) -o pid,etime,%cpu,%mem,stat,cmd'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 160 data/nnunet/nnUNet_results/Dataset502_TN3KThyroidROI/nnUNetTrainer_100epochs__nnUNetResEncPlans__2d/fold_0/training_log_2026_5_10_15_33_22.txt'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: Tight ROI nnU-Net Training Started

- ResEnc ROI fold-0 100 epoch training completed.
- ResEnc final result:
  - final Mean Validation Dice: `0.867891361020278`
  - final Mean Validation IoU: `0.7795937470556832`
  - best pseudo Dice during training: `0.8830`
  - best EMA pseudo Dice: `0.8761`
- Revalidated `checkpoint_best` for default ROI and ResEnc ROI:
  - default ROI `checkpoint_best` Mean Validation Dice: `0.8704282127080187`
  - ResEnc ROI `checkpoint_best` Mean Validation Dice: `0.8666019915708923`
- Decision:
  - ResEnc did not beat default ROI.
  - Tightening ROI crop is more promising than continuing ResEnc or starting 5-fold immediately.

### Dataset503 Tight ROI

- Generated tighter ROI dataset:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_raw/Dataset503_TN3KThyroidROITight`
- Dataset503 parameters:
  - output size: `384`
  - margin ratio: `0.15`
  - min crop size: `80`
  - total paired samples: `2879`
  - total ROI samples: `2879`
  - skipped empty masks: `0`
  - train samples: `2303`
  - validation samples: `576`
- Completed Dataset503 nnU-Net plan/preprocess:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_preprocessed/Dataset503_TN3KThyroidROITight/nnUNetPlans.json`
- Dataset503 plan:
  - 2D patch size: `384x384`
  - batch size: `22`

### Tight ROI Training

- Started Dataset503 Tight ROI nnU-Net 2D fold-0 100 epoch training.
- Command:
  `nnUNetv2_train 503 2d 0 -tr nnUNetTrainer_100epochs`
- PID:
  `3841426`
- Wrapper log:
  `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs/train.log`
- nnU-Net log:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0/training_log_2026_5_10_16_31_59.txt`
- Early observed metrics:
  - epoch `0`: pseudo Dice `0.8205`
  - epoch `2`: pseudo Dice `0.8552`
  - epoch `7`: pseudo Dice `0.8769`
  - epoch `10`: pseudo Dice `0.8786`
  - epoch `11`: pseudo Dice `0.8820`
  - epoch `15`: pseudo Dice `0.8878`
  - latest observed epoch `17`: pseudo Dice `0.8781`
- Interpretation:
  - Tight ROI is the strongest route so far by early pseudo Dice.
  - It already exceeds the previous best single-model training pseudo Dice (`0.8847`) by epoch `15`.
  - Let it complete 100 epochs before deciding on 5-fold or further crop tuning.

### Background Tasks

- Remote Dataset503 Tight ROI nnU-Net 100 epoch training is running on 5090 as PID `3841426`.

### Blocking Issues

- None for the running Tight ROI job.

### Next Session Priorities

1. Continue monitoring Dataset503 Tight ROI through 100 epochs.
2. Compare final Mean Validation Dice against Dataset502 default ROI (`0.870746`) and ResEnc ROI (`0.867891`).
3. If final Dice reaches or approaches `0.90`, start Tight ROI 5-fold training and ensemble.
4. If it remains below `0.90`, inspect Dataset503 low-Dice cases and test another ROI crop variant or label-quality filtering.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ps -p $(cat data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs/train.pid) -o pid,etime,%cpu,%mem,stat,cmd'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 160 data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0/training_log_2026_5_10_16_31_59.txt'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: Tight ROI Fold1 Training

- Dataset503 Tight ROI fold-0 100 epoch training completed.
- Fold-0 command:
  `nnUNetv2_train 503 2d 0 -tr nnUNetTrainer_100epochs`
- Fold-0 result directory:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_0`
- Fold-0 final checkpoint validation:
  - Mean Validation Dice: `0.8832810582350146`
  - Mean Validation IoU: `0.7986289274678482`
  - median Dice: `0.9023288312966977`
  - min Dice: `0.3813112153400469`
  - max Dice: `0.9792437093804586`
  - cases below Dice `0.70`: `21`
  - cases below Dice `0.80`: `44`
  - cases below Dice `0.85`: `91`
  - cases below Dice `0.90`: `219`
- Fold-0 training metrics:
  - best pseudo Dice: `0.8903` at epoch `43`
  - best EMA pseudo Dice: `0.8867` at epoch `81`
- Fold-0 `checkpoint_best` revalidation:
  - Mean Validation Dice: `0.8821236478941908`
  - This is slightly lower than final checkpoint, so use `checkpoint_final.pth` as fold-0 reference for now.
- Decision:
  - Dataset503 Tight ROI is the best route so far.
  - Because fold-0 mean Dice is close to `0.90` and median Dice is above `0.90`, started Tight ROI fold-1 to move toward 5-fold ensemble.

### Fold1 Training

- Started Dataset503 Tight ROI fold-1 100 epoch training.
- Command:
  `nnUNetv2_train 503 2d 1 -tr nnUNetTrainer_100epochs`
- PID:
  `3927428`
- Wrapper log:
  `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-fold1/train.log`
- nnU-Net log:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_1/training_log_2026_5_10_17_50_41.txt`
- Early observed fold-1 metrics:
  - epoch `0`: pseudo Dice `0.8158`
  - epoch `1`: pseudo Dice `0.8381`
  - epoch `5`: pseudo Dice `0.8695`
  - epoch `9`: pseudo Dice `0.8737`
  - latest observed epoch `17`: pseudo Dice `0.8739`
- GPU:
  - fold-1 training uses about `5.9GB` VRAM.
  - old Dataset501 PID may still appear in `nvidia-smi` as `[Not Found]`; it has not blocked training.

### Background Tasks

- Remote Dataset503 Tight ROI fold-1 100 epoch training is running on 5090 as PID `3927428`.

### Blocking Issues

- None for the running fold-1 job.
- Dice target `0.95` is still not reached; current realistic next step is 5-fold ensemble plus low-Dice case review.

### Next Session Priorities

1. Let fold-1 reach 100 epochs and collect final validation Dice.
2. If fold-1 is comparable to fold-0, continue folds `2-4` and then run ensemble/postprocessing.
3. If fold-1 underperforms sharply, inspect fold-specific validation distribution before spending time on all folds.
4. Keep tracking whether low-Dice outliers are label quality, multi-object labels, or crop/context failures.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ps -p $(cat data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-fold1/train.pid) -o pid,etime,%cpu,%mem,stat,cmd'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 160 data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_1/training_log_2026_5_10_17_50_41.txt'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: Tight ROI Fold4 Training

- Dataset503 Tight ROI fold-3 100 epoch training completed.
- Fold-3 command:
  `nnUNetv2_train 503 2d 3 -tr nnUNetTrainer_100epochs`
- Fold-3 result directory:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_3`
- Fold-3 training metrics:
  - best pseudo Dice: `0.8901` at epoch `53`
  - final pseudo Dice: `0.8814` at epoch `99`
  - best EMA pseudo Dice: `0.8843` at epoch `95`
- Fold-3 final checkpoint validation:
  - Mean Validation Dice: `0.8775917129870318`
  - Mean Validation IoU: `0.7910136280881602`
  - median Dice: `0.9016280227327647`
  - min Dice: `0.39092207934937906`
  - max Dice: `0.9760194784313125`
  - cases below Dice `0.80`: `60`
  - cases below Dice `0.85`: `101`
  - cases below Dice `0.90`: `219`
- Fold-3 `checkpoint_best` revalidation:
  - Mean Validation Dice: `0.8791797065669592`
  - Mean Validation IoU: `0.7929131053001645`
  - median Dice: `0.902452629697976`
  - min Dice: `0.3808830805949297`
  - max Dice: `0.9754229467856045`
  - cases below Dice `0.80`: `58`
  - cases below Dice `0.85`: `99`
  - cases below Dice `0.90`: `223`
- Decision:
  - Fold-3 `checkpoint_best.pth` is slightly better than final checkpoint and should be used as the fold-3 reference.
  - Fold-3 is comparable to the completed folds, so continue the 5-fold ensemble path.

### Fold4 Training

- Started Dataset503 Tight ROI fold-4 100 epoch training.
- Command:
  `nnUNetv2_train 503 2d 4 -tr nnUNetTrainer_100epochs`
- PID:
  `4072981`
- Wrapper log:
  `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-fold4/train.log`
- nnU-Net log:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_4/training_log_2026_5_10_19_30_15.txt`
- Early observed fold-4 metrics:
  - epoch `0`: pseudo Dice `0.8090`
  - epoch `1`: pseudo Dice `0.8479`
  - latest EMA pseudo Dice at epoch `1`: `0.8129`
  - NaN observed: `false`
- GPU:
  - fold-4 training uses about `5.9GB` VRAM.
  - old Dataset501 PID may still appear in `nvidia-smi` as `[Not Found]`; it has not blocked training.

### Current Completed Fold References

- Fold-0 reference: final checkpoint, Mean Dice `0.8832810582350146`.
- Fold-1 reference: `checkpoint_best.pth`, Mean Dice `0.8743562312201778`.
- Fold-2 reference: `checkpoint_best.pth`, Mean Dice `0.884120991648977`.
- Fold-3 reference: `checkpoint_best.pth`, Mean Dice `0.8791797065669592`.
- Fold-4 reference: pending.

### Background Tasks

- Remote Dataset503 Tight ROI fold-4 100 epoch training is running on 5090 as PID `4072981`.

### Blocking Issues

- None for the running fold-4 job.
- Dice target `0.95` is still not reached by any single fold.
- Current best single-fold validation is Dataset503 fold-2 `checkpoint_best.pth` with Mean Dice `0.884120991648977`.

### Next Session Priorities

1. Continue monitoring fold-4 until 100 epochs.
2. Validate fold-4 final and `checkpoint_best` summaries.
3. After fold-4 completes, run nnU-Net 5-fold ensemble/postprocessing.
4. Compare 5-fold ensemble against the best single fold and inspect repeated low-Dice cases if ensemble remains below `0.90`.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && ps -p $(cat data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-fold4/train.pid) -o pid,etime,%cpu,%mem,stat,cmd'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && tail -n 160 data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_4/training_log_2026_5_10_19_30_15.txt'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
```

## 📌 SESSION HANDOFF STATUS

### Current Work: Tight ROI 5-Fold Ensemble Completed

- Dataset503 Tight ROI fold-4 100 epoch training completed.
- Fold-4 command:
  `nnUNetv2_train 503 2d 4 -tr nnUNetTrainer_100epochs`
- Fold-4 result directory:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results/Dataset503_TN3KThyroidROITight/nnUNetTrainer_100epochs__nnUNetPlans__2d/fold_4`
- Fold-4 training metrics:
  - best pseudo Dice: `0.8903` at epoch `74`
  - final pseudo Dice: `0.8874` at epoch `99`
  - best EMA pseudo Dice: `0.8862` at epoch `76`
- Fold-4 final checkpoint validation:
  - Mean Validation Dice: `0.878436862416928`
  - Mean Validation IoU: `0.7917881265404859`
  - median Dice: `0.8983341869576666`
  - min Dice: `0.21841696144920353`
  - max Dice: `0.9750922049441786`
  - cases below Dice `0.80`: `45`
  - cases below Dice `0.85`: `100`
  - cases below Dice `0.90`: `235`
- Fold-4 `checkpoint_best` revalidation:
  - Mean Validation Dice: `0.8784472704844455`
  - This is only slightly better than final checkpoint, but should be used as the fold-4 reference for consistency with the selected-checkpoint ensemble.

### Selected 5-Fold Checkpoints

- Created non-destructive `checkpoint_selected.pth` symlinks:
  - Fold-0: `checkpoint_final.pth`
  - Fold-1: `checkpoint_best.pth`
  - Fold-2: `checkpoint_best.pth`
  - Fold-3: `checkpoint_best.pth`
  - Fold-4: `checkpoint_best.pth`
- Selected checkpoint single-fold references:
  - Fold-0 Mean Dice: `0.8832810582350146`
  - Fold-1 Mean Dice: `0.8743562312201778`
  - Fold-2 Mean Dice: `0.884120991648977`
  - Fold-3 Mean Dice: `0.8791797065669592`
  - Fold-4 Mean Dice: `0.8784472704844455`

### 20% Holdout Ensemble Evaluation

- Ran 5-fold ensemble inference on the original 20% holdout set:
  `/home/beelink/jiazhuangxian/data/nnunet/nnUNet_raw/Dataset503_TN3KThyroidROITight/imagesTs`
- Prediction output:
  `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-ensemble-selected/imagesTs_pred`
- Evaluation output:
  `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-ensemble-selected/imagesTs_pred/summary.json`
- Holdout ensemble metrics:
  - cases: `576`
  - Mean Dice: `0.8832263761130261`
  - Mean IoU: `0.7991194300709549`
  - median Dice: `0.903258010736987`
  - min Dice: `0.3877071313402102`
  - max Dice: `0.9743627473931336`
  - cases below Dice `0.70`: `24`
  - cases below Dice `0.80`: `55`
  - cases below Dice `0.85`: `103`
  - cases below Dice `0.90`: `269`
  - cases below Dice `0.95`: `519`
- Interpretation:
  - The selected 5-fold ensemble is close to the best single fold, but still far below the target Dice `0.95`.
  - Median Dice is above `0.90`, while the mean is pulled down by low-Dice outliers.
  - The next improvement step should focus on low-Dice case review, label quality, crop policy, and possibly a stronger segmentation family rather than simply extending the same trainer.

### Postprocessing Check

- Tested largest connected component postprocessing on holdout predictions.
- Correct label-value evaluation result:
  - Mean Dice: `0.8747615151227386`
  - Mean IoU: `0.7900013714130351`
  - median Dice: `0.9021783523138817`
  - cases below Dice `0.80`: `64`
  - cases below Dice `0.90`: `273`
- Decision:
  - Do not enable largest-connected-component postprocessing.
  - It worsens mean Dice and increases low-Dice cases, likely because some cases have multi-region labels or complex anatomy.

### Diagnostics Artifacts

- Generated holdout worst-case overlay:
  - remote: `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-ensemble-selected/diagnostics/holdout_worst_cases_overlay.png`
  - local: `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-ensemble-selected/holdout_worst_cases_overlay.png`
- Generated holdout worst-case manifest:
  - remote: `/home/beelink/jiazhuangxian/data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-ensemble-selected/diagnostics/holdout_worst_cases.json`
  - local: `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-ensemble-selected/holdout_worst_cases.json`
- Worst five holdout cases:
  - `tn3k_roi_0005`: Dice `0.3877`, IoU `0.2405`
  - `tn3k_roi_0335`: Dice `0.4586`, IoU `0.2975`
  - `tn3k_roi_0430`: Dice `0.4635`, IoU `0.3017`
  - `tn3k_roi_0358`: Dice `0.4736`, IoU `0.3103`
  - `tn3k_roi_0146`: Dice `0.4905`, IoU `0.3249`

### Background Tasks

- No active nnU-Net training task is currently expected.

### Blocking Issues

- The Dice `0.95` target was not reached.
- Current evidence suggests the remaining bottleneck is not simple epoch count:
  - 5-fold models are stable around pseudo Dice `0.89`.
  - Holdout median Dice is above `0.90`.
  - Mean Dice is held down by hard/low-quality outliers.

### Next Session Priorities

1. Review the holdout worst-case overlay and classify error types: label ambiguity, crop failure, boundary undersegmentation, false positive region, or multi-region label.
2. Build a low-Dice case audit table and optionally exclude/flag suspected label-quality cases for a clean validation subset.
3. Try a stronger segmentation route for the target `0.95`: MedSAM/SAM2 prompt-from-detector, Swin U-Net, or nnU-Net ResEnc presets on the tight ROI dataset.
4. Connect the preserved selected 5-fold weight package to the segmentation worker as the current validation baseline.

### Report Output

- Preserved best selected 5-fold weight package:
  `/home/beelink/jiazhuangxian/data/models/segmentation/tn3k-nnunet-tight-selected-5fold-v1`
- Training report written locally:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/TN3K_甲状腺结节分割训练报告_nnUNet_TightROI.md`
- Low-Dice audit report written locally:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/TN3K_低Dice病例审计报告.md`
- Report includes:
  - Dataset503 Tight ROI data design.
  - Historical experiment comparison.
  - Fold0-Fold4 selected checkpoint metrics.
  - 20% holdout 5-fold ensemble metrics.
  - Largest-connected-component postprocessing result.
  - Worst-case overlay and next-step recommendations.

### Low-Dice Audit

- Audited 20% holdout selected 5-fold ensemble predictions.
- Generated audit artifacts:
  - `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-low-dice-audit/holdout_low_dice_audit.csv`
  - `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-low-dice-audit/holdout_low_dice_audit.json`
  - `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-low-dice-audit/holdout_low_dice_audit_summary.json`
  - `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-low-dice-audit/holdout_low_dice_worst24_overlay.png`
  - `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-low-dice-audit/holdout_low_dice_by_category_overlay.png`
- Dice `< 0.80` count: `55`.
- Dice `< 0.90` count: `269`.
- Dice `< 0.80` heuristic categories:
  - `boundary_or_shape_mismatch`: `21`
  - `oversegmentation`: `13`
  - `multi_region_gt_partial`: `12`
  - `location_shift`: `5`
  - `undersegmentation`: `4`
- Note: categories are heuristic triage labels and require human/clinical annotation review before final conclusions.

### TN3K Dataset Curation After Audit

- Added dataset curation script:
  `/Users/xutianliang/Downloads/jiazhuangxian/scripts/curate_tn3k_low_dice_dataset.py`
- Added unit test:
  `/Users/xutianliang/Downloads/jiazhuangxian/test/unit/scripts/test_curate_tn3k_low_dice_dataset.py`
- Generated non-destructive curation output on the 5090 host:
  `/home/beelink/jiazhuangxian/data/curation/tn3k-tight-roi-low-dice-v1`
- Synced curation summary, manifest, and subset case lists locally:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-curation-v1`
- Generated manual review queue for the 92 high-priority cases:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-curation-v1/manual_review_queue.csv`
- Wrote curation report:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/TN3K_数据集梳理与修正方案.md`
- Curation result over 576 holdout cases:
  - `clean_high_confidence`: `307`
  - `clean_label_candidate`: `522`
  - `manual_review_required`: `92`
  - `label_or_task_review`: `54`
  - `model_hard_cases`: `38`
  - `borderline_boundary`: `177`
  - `low_dice_below_080`: `55`
- Key decision:
  - Keep original `Dataset503_TN3KThyroidROITight` frozen.
  - Do not train directly on suspected label/task-review cases.
  - Use `manual_review_required` as the first human correction queue.
  - Generate a new curated dataset version such as `Dataset504_TN3KThyroidROITightCuratedV1` after manual mask corrections.
- Verification:
  - `python3 -m py_compile scripts/curate_tn3k_low_dice_dataset.py test/unit/scripts/test_curate_tn3k_low_dice_dataset.py`
  - `python3 test/unit/scripts/test_curate_tn3k_low_dice_dataset.py`

### FangDai Hugging Face Final Validation Dataset

- Downloaded `FangDai/Thyroid_Ultrasound_Images` on the Mac, not on the 5090 host.
- Source URL:
  `https://huggingface.co/datasets/FangDai/Thyroid_Ultrasound_Images`
- Payload download used:
  `https://hf-mirror.com/datasets/FangDai/Thyroid_Ultrasound_Images`
- Reason:
  - Direct `huggingface.co` API access from the Mac timed out.
  - The mirror resolved the same repository snapshot.
- Local raw root:
  `/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/datasets/fangdai-thyroid-ultrasound-images/raw`
- Local metadata:
  - `/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/datasets/fangdai-thyroid-ultrasound-images/metadata/download_summary.json`
  - `/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/datasets/fangdai-thyroid-ultrasound-images/metadata/file_manifest.csv`
  - `/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/datasets/fangdai-thyroid-ultrasound-images/metadata/final_validation_lock.json`
- Downloaded snapshot:
  - repo sha: `ccd08799a57b8e5c045b71883900cf3e5872d1bc`
  - last modified: `2025-12-29T05:25:32.000Z`
  - API file count: `303`
- Local image count:
  - total images: `298`
  - `FTC`: `100`
  - `MTC`: `99`
  - `PTC`: `99`
  - `.png`: `199`
  - `.jpg`: `99`
- Note:
  - The README states `900` images, but this repository snapshot contains `298` image files under `Thyroid/`.
  - This dataset is reserved for final external subtype-classification validation only.
  - Do not mix it into training, hyperparameter tuning, dataset curation, or model selection.
- Updated:
  - `/Users/xutianliang/Downloads/jiazhuangxian/docs/PUBLIC_THYROID_ULTRASOUND_DATASETS.md`
  - `/Users/xutianliang/Downloads/jiazhuangxian/examples/datasets/thyroid-ultrasound-public.manifest.json`
- Added final validation lock script:
  `/Users/xutianliang/Downloads/jiazhuangxian/scripts/lock_final_validation_dataset.py`
- Added final validation protocol:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/FANGDAI_FINAL_VALIDATION_PROTOCOL.md`
- Added TN3K manual review workflow:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/TN3K_MANUAL_REVIEW_WORKFLOW.md`
- FangDai lock file was generated with manifest sha256:
  `9954ff990fe2870eacea841ab693aea492894eaa7be1d438f3a225c20f549c1e`
- Verification:
  - `python3 scripts/lock_final_validation_dataset.py --dataset-id fangdai-thyroid-ultrasound-images --raw-root data/artifacts/datasets/fangdai-thyroid-ultrasound-images/raw --file-manifest data/artifacts/datasets/fangdai-thyroid-ultrasound-images/metadata/file_manifest.csv --output-json data/artifacts/datasets/fangdai-thyroid-ultrasound-images/metadata/final_validation_lock.json --expected-count 298 --purpose final_external_validation_only --source-url https://huggingface.co/datasets/FangDai/Thyroid_Ultrasound_Images --download-url-used https://hf-mirror.com/datasets/FangDai/Thyroid_Ultrasound_Images --snapshot-sha ccd08799a57b8e5c045b71883900cf3e5872d1bc`

### TN3K Manual Review Pilot Packet

- Added review-packet generation script:
  `/Users/xutianliang/Downloads/jiazhuangxian/scripts/build_tn3k_manual_review_packet.py`
- Added unit test:
  `/Users/xutianliang/Downloads/jiazhuangxian/test/unit/scripts/test_build_tn3k_manual_review_packet.py`
- Generated the first 20 high-priority TN3K manual review cases on the 5090 host:
  `/home/beelink/jiazhuangxian/data/curation/tn3k-tight-roi-low-dice-v1/review_packets/pilot_first20`
- Synced the review packet locally:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/tn3k-manual-review-pilot-v1`
- Wrote the pilot report:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/TN3K_人工复核试跑包_前20例.md`
- Review packet artifacts:
  - `packet_summary.json`
  - `manual_review_queue_first20.csv`
  - `manual_review_packet.md`
  - `tn3k_manual_review_contact_sheet.png`
  - `panels/*.png`
  - `cases/<case_id>/*.png`
- Selected cases:
  - total: `20`
  - `label_or_task_review`: `12`
  - `model_hard`: `8`
  - categories: `multi_region_gt_partial=7`, `location_shift=5`, `oversegmentation=6`, `undersegmentation=1`, `boundary_or_shape_mismatch=1`
- Verification:
  - `python3 -m py_compile scripts/build_tn3k_manual_review_packet.py test/unit/scripts/test_build_tn3k_manual_review_packet.py`
  - `python3 test/unit/scripts/test_build_tn3k_manual_review_packet.py`
- TODO:
  - Do not generate the remaining 72 review cases yet.
  - First complete and inspect the first 20 reviewed decisions.
  - After the four review decisions are confirmed stable, generate the remaining 72-case review packet under:
    `/home/beelink/jiazhuangxian/data/curation/tn3k-tight-roi-low-dice-v1/review_packets/remaining_72`

### Strong Segmentation Route Setup - 2026-05-10

- Implemented static SAM2 detector-prompt routing in `services/model-gateway/app/segmentation.py`.
  - Static model names containing `sam2` / `medsam2` now use `Sam2ImageSegmenter`.
  - Input is existing `thyroid.segment_nodule` image + bbox prompt.
  - Output uses normal `segmentation_source = sam2_bbox_prompt`, bbox, contour, confidence, and doctor-review flag.
  - Absolute SAM2 yaml paths are accepted and mapped to the package-relative SAM2 config needed by Hydra.
- Extended `model-gateway` config check:
  - `segmenters` now reports `medsam`, `sam2-static`, and `unet`.
  - `sam2-static` checks `JZX_MEDSAM2_WEIGHTS` / `JZX_SAM2_WEIGHTS` plus `JZX_SAM2_IMAGE_CONFIG` / `JZX_MEDSAM2_CONFIG` / `JZX_SAM2_VIDEO_CONFIG`.
- Updated GPU requirements and setup notes for the strong route:
  - `sam2==1.1.0`
  - `segment-anything==1.0`
  - `nnunetv2>=2.7`
  - `timm>=1.0`
  - `segmentation-models-pytorch>=0.5`
  - `monai>=1.4,<2.0`
- Installed and verified these components on the 5090 host in:
  `/home/beelink/jiazhuangxian/.venv-model-gateway-gpu`
- Downloaded official SAM2.1 large checkpoint to:
  `/home/beelink/jiazhuangxian/data/models/segmentation/medsam2/sam2.1_hiera_large.pt`
- Copied SAM2.1 large config to:
  `/home/beelink/jiazhuangxian/data/models/segmentation/medsam2/sam2.1_hiera_l.yaml`
- 5090 config check with these env vars reports both `sam2-static` and `sam2-video` ready:
  - `JZX_MEDSAM2_WEIGHTS=/home/beelink/jiazhuangxian/data/models/segmentation/medsam2/sam2.1_hiera_large.pt`
  - `JZX_MEDSAM2_CONFIG=/home/beelink/jiazhuangxian/data/models/segmentation/medsam2/sam2.1_hiera_l.yaml`
  - `JZX_SAM2_IMAGE_CONFIG=/home/beelink/jiazhuangxian/data/models/segmentation/medsam2/sam2.1_hiera_l.yaml`
- Real static SAM2 smoke on 5090 succeeded with fallback disabled:
  - model: `sam2-thyroid-segmenter`
  - checkpoint: `sam2.1_hiera_large.pt`
  - result: `count=1`, `segmentation_source=sam2_bbox_prompt`, confidence `0.8505`, no warnings.
- Updated docs:
  - `/Users/xutianliang/Downloads/jiazhuangxian/docs/SEGMENTATION_MODEL_INTEGRATION_PLAN.md`
  - `/Users/xutianliang/Downloads/jiazhuangxian/services/model-gateway/README.md`
- Verification:
  - Local: `python3 -m py_compile services/model-gateway/app/segmentation.py services/model-gateway/app/config_check.py services/model-gateway/tests/test_gateway.py`
  - Local: `python3 -m unittest services/model-gateway/tests/test_gateway.py` -> 25 tests OK
  - Remote 5090: `.venv-model-gateway-gpu/bin/python -m unittest services/model-gateway/tests/test_gateway.py` -> 25 tests OK

### SAM2 Static Real Case Chain Validation - 2026-05-10

- Added validation runner:
  `/Users/xutianliang/Downloads/jiazhuangxian/scripts/run_sam2_static_chain_validation.py`
- Ran the first real static SAM2 chain validation on the 5090 host:
  - Dataset: TN3K test split, first 20 real thyroid ultrasound images.
  - Prompt: TN3K mask-derived bbox, used as a detector-prompt proxy.
  - Model: `sam2-thyroid-segmenter`
  - Weight: `/home/beelink/jiazhuangxian/data/models/segmentation/medsam2/sam2.1_hiera_large.pt`
  - Config: `/home/beelink/jiazhuangxian/data/models/segmentation/medsam2/sam2.1_hiera_l.yaml`
  - Fallback: disabled, `allow_bbox_fallback=false`
  - Chain: `ModelJobStore.enqueue_segment_nodule -> model-worker run_once -> Sam2ImageSegmenter -> segmentation.json + mask_nodule_<index>.png`
- Remote output directory:
  `/home/beelink/jiazhuangxian/data/artifacts/reports/sam2-static-chain-validation-20260510-real20`
- Synced local output directory:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/sam2-static-chain-validation-20260510-real20`
- Wrote summary report:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/SAM2_STATIC_CHAIN_VALIDATION_REPORT_20260510.md`
- Results over 20 cases:
  - succeeded: `20 / 20`
  - mean Dice: `0.830193`
  - median Dice: `0.850878`
  - min Dice: `0.487826`
  - mean IoU: `0.726572`
  - median IoU: `0.740689`
  - Dice >= 0.90: `8`
  - Dice >= 0.95: `1`
- Lowest Dice cases:
  - `0002`: Dice `0.487826`, IoU `0.322599`, confidence `0.3614`
  - `0003`: Dice `0.538054`, IoU `0.368039`, confidence `0.5876`
- Best case:
  - `0018`: Dice `0.962320`, IoU `0.927376`, confidence `0.9637`
- Key conclusion:
  - SAM2.1 large is now a real runnable static detector-prompt component in the official worker chain.
  - It should be treated as a strong prompt segmentation component and comparison baseline, not yet as the final main segmentation model.
  - Next validation should replace mask-derived bbox prompts with actual RF-DETR/YOLO detector outputs and compare SAM2 masks against the selected nnU-Net tight ROI ensemble.
- Verification:
  - Local: `python3 -m py_compile scripts/run_sam2_static_chain_validation.py`
  - Remote: `.venv-model-gateway-gpu/bin/python -m py_compile scripts/run_sam2_static_chain_validation.py`
  - Remote run command completed with status code `0`.

### SAM2 Actual Detector Prompt Validation - 2026-05-10

- Extended `scripts/run_sam2_static_chain_validation.py` with `--prompt-source detector`.
  - The script now runs `thyroid.detect_nodules` first, reads the detection artifact, selects a detector bbox, then queues `thyroid.segment_nodule`.
  - It records detector confidence, detector bbox, detector artifact URI, detector bbox IoU against GT, SAM2 mask metrics, and overlay images.
- Fixed two integration issues discovered by the actual detector prompt chain:
  - `services/model-gateway/app/segmentation.py`: numeric `JZX_MODEL_DEVICE=0` now normalizes to `cuda:0` for PyTorch/SAM2 segmenters while still allowing detectors to use `0`.
  - `services/model-gateway/app/detectors.py`: RF-DETR now converts grayscale ultrasound images to temporary RGB files for inference, without modifying originals.
- Added tests:
  - `torch_device({"JZX_MODEL_DEVICE": "0"}) == "cuda:0"`
  - RF-DETR RGB compatibility helper converts grayscale images to RGB.
- Ran YOLO actual detection prompt on 5090:
  - Detector: `yolov11-thyroid-detector`
  - Weight: `/home/beelink/jiazhuangxian/runs/detect/data/artifacts/model-training/tn3k-yolo/runs/tn3k-yolo11m-80-20-e120-i768-b16-fixed/weights/best.pt`
  - Cases: TN3K test first 20
  - succeeded: `20 / 20`
  - mean Dice: `0.802101`
  - median Dice: `0.850652`
  - min Dice: `0.458820`
  - mean IoU: `0.691587`
  - Dice >= 0.90: `7`
  - Dice >= 0.95: `1`
  - Local output: `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/sam2-static-chain-validation-20260510-yolo20`
- Ran RF-DETR actual detection prompt on 5090:
  - Detector: `rf-detr-medium-thyroid-detector`
  - Weight: `/home/beelink/jiazhuangxian/data/artifacts/model-training/tn5000-rfdetr/runs/tn5000-clean-rfdetr-medium-80-20-e40-r576-b4x4-target90/checkpoint_best_ema.pth`
  - Cases: TN3K test first 20
  - succeeded: `20 / 20`
  - mean Dice: `0.700522`
  - median Dice: `0.804631`
  - min Dice: `0.000000`
  - mean IoU: `0.604538`
  - Dice >= 0.90: `5`
  - Dice >= 0.95: `1`
  - Local output: `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/sam2-static-chain-validation-20260510-rfdetr20`
- Wrote comparison report:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/SAM2_DETECTOR_PROMPT_CHAIN_COMPARISON_20260510.md`
- Key conclusion:
  - `YOLO11m -> SAM2` is currently the better real detector-prompt chain on TN3K test first 20.
  - `RF-DETR -> SAM2` is runnable after fixes, but TN5000-trained RF-DETR shows domain shift on TN3K and should not be the SAM2 prompt source until calibrated or fine-tuned on the target data.
- Verification:
  - Local: `python3 -m unittest services/model-gateway/tests/test_gateway.py` -> 27 tests OK
  - Remote 5090: `.venv-model-gateway-gpu/bin/python -m unittest services/model-gateway/tests/test_gateway.py` -> 27 tests OK

### YOLO100 SAM2 vs nnU-Net Tight ROI Validation - 2026-05-10

- Expanded `YOLO11m -> SAM2` actual detector-prompt validation from 20 to 100 TN3K official test cases.
  - Remote output: `/home/beelink/jiazhuangxian/data/artifacts/reports/sam2-static-chain-validation-20260510-yolo100`
  - Local synced output: `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/sam2-static-chain-validation-20260510-yolo100`
  - Cases: `100`
  - succeeded: `97`
  - failed: `3` (`0037`, `0085`, `0087`, all detector empty at confidence `0.25`)
  - mean Dice: `0.769584`
  - median Dice: `0.837804`
  - min Dice: `0.065372`
  - mean IoU: `0.656610`
  - Dice >= 0.90: `22`
  - Dice >= 0.95: `3`
- Added `scripts/run_nnunet_detector_roi_validation.py`.
  - `prepare` creates nnU-Net ROI input crops from the same YOLO detector bboxes.
  - `evaluate` pastes ROI predictions back to full-size images and computes Dice/IoU against TN3K full masks.
- Ran `YOLO11m bbox -> nnU-Net Tight ROI 5-fold ensemble` on the same 100-case set.
  - nnU-Net model: `Dataset503_TN3KThyroidROITight`
  - Trainer/plans: `nnUNetTrainer_100epochs__nnUNetPlans__2d`
  - Folds: `0 1 2 3 4`
  - Checkpoint: `checkpoint_best.pth`
  - Remote output: `/home/beelink/jiazhuangxian/data/artifacts/reports/nnunet-detector-roi-validation-20260510-yolo100`
  - Local synced output: `/Users/xutianliang/Downloads/jiazhuangxian/docs/assets/nnunet-detector-roi-validation-20260510-yolo100`
  - Cases: `100`
  - succeeded: `97`
  - failed/skipped: `3` (same detector-empty cases)
  - mean Dice: `0.875605`
  - median Dice: `0.919343`
  - min Dice: `0.085727`
  - mean IoU: `0.797751`
  - Dice >= 0.90: `54`
  - Dice >= 0.95: `22`
- Wrote comparison report:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/SEGMENTATION_DETECTOR_ROI_COMPARISON_20260510.md`
- Key conclusion:
  - On the 97 paired successful cases, `YOLO -> nnU-Net Tight ROI` beats `YOLO -> SAM2` in `88 / 97` cases.
  - Mean Dice delta is `+0.106021` in favor of nnU-Net.
  - Current static-image automatic segmentation main route should become `YOLO11m detector -> nnU-Net Tight ROI segmenter -> paste back -> measurement`.
  - `SAM2 / MedSAM` should remain as interactive doctor revision and secondary review capability, not the default static auto-segmentation model.
- Verification:
  - Local: `python3 -m py_compile scripts/run_nnunet_detector_roi_validation.py`
  - Remote prepare: 100 cases -> 97 prepared, 3 skipped
  - Remote inference: `nnUNetv2_predict` 97 ROI cases completed with `checkpoint_best.pth`
  - Remote evaluation: completed with expected code `2` because 3 cases were skipped

### nnU-Net Tight ROI model-gateway Integration - 2026-05-10

- Integrated `nnunet-tight-roi-segmenter` into `services/model-gateway/app/segmentation.py`.
  - The adapter consumes bbox targets from `thyroid.segment_nodule`.
  - It crops a square tight ROI around each bbox.
  - It runs `nnUNetv2_predict` against Dataset503 / 5-fold checkpoint configuration.
  - It pastes ROI masks back to full image size.
  - It emits `segmentation_source = nnunet_tight_roi`.
  - It records segmentation metadata: `prompt_bbox`, `crop_box_xyxy`, `roi_size`, `full_size_paste`, `dataset`, `configuration`, `trainer`, `plans`, `folds`, `checkpoint`.
- Changed defaults:
  - `services/model-gateway/app/schemas.py`: `SegmentNoduleRequest.model = nnunet-tight-roi-segmenter`
  - `services/model-gateway/app/schemas.py`: `SegmentNoduleRequest.model_version = tn3k-tight-roi-5fold-best`
  - `src/medical/agentWorker.ts`: default `segment_nodules` model now matches the gateway default.
- Extended config check:
  - Added `nnunet-tight-roi` to `/model/v1/config/check`.
  - New envs include `JZX_NNUNET_RESULTS`, `JZX_NNUNET_RAW`, `JZX_NNUNET_PREPROCESSED`, `JZX_NNUNET_PREDICT_BIN`, `JZX_NNUNET_DATASET`, `JZX_NNUNET_FOLDS`, and ROI controls.
- Extended artifacts:
  - `services/model-gateway/app/artifacts.py` now preserves per-segmentation `metadata` in `segmentation.json`.
- Wrote integration note:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/NNUNET_TIGHT_ROI_GATEWAY_INTEGRATION_20260510.md`
- Updated model-gateway README with nnU-Net Tight ROI configuration.
- Validation:
  - Local py_compile: passed for model-gateway changed Python files.
  - Local model-gateway tests: `python3 -m unittest services/model-gateway/tests/test_gateway.py` -> `29` tests OK.
  - Local TS medical agent worker tests: `npm test -- test/unit/medical/agentWorker.test.ts` -> `13` tests OK.
  - Remote 5090 model-gateway tests: `.venv-model-gateway-gpu/bin/python -m unittest services/model-gateway/tests/test_gateway.py` -> `29` tests OK.
  - Remote 5090 config check with nnU-Net envs: `ready_segmenters = ["nnunet-tight-roi"]`.
  - Remote 5090 real smoke test:
    - TN3K test case `0000`
    - job type `thyroid.segment_nodule`
    - model `nnunet-tight-roi-segmenter`
    - `allow_bbox_fallback = false`
    - status `succeeded`
    - artifact `artifact://model-output/thyroid-segment-nodule/TN3K_NNUNET_GATEWAY_SMOKE/0000/mj_9780841659f94e02993aabecf5e6caf7/segmentation.json`
    - mask artifact exists
    - metadata includes `crop_box_xyxy = [97, 49, 200, 152]`

### Medical Agent End-to-End Chain - 2026-05-10

- Implemented conservative automatic downstream queueing in `src/medical/agentWorker.ts`.
  - `detect_nodules` success now auto-queues `segment_nodules` only when the completed task has no explicit child task.
  - `segment_nodules` success now auto-queues `measure_nodules` only when the completed task has no explicit child task.
  - Explicitly designed not to duplicate or override user-defined/CodeClaw-defined task chains.
- Auto-created segmentation task uses:
  - model: `nnunet-tight-roi-segmenter`
  - model_version: `tn3k-tight-roi-5fold-best`
- Auto-created measurement task uses:
  - model: `mask-measurement-worker`
  - model_version: `validation-measurement-v1`
- Report evidence is now enriched with model result evidence:
  - `segmentation_result`: model job, artifact URI, model name/version, segmentation source, mask URI, and nnU-Net ROI metadata such as `crop_box_xyxy` and `roi_size`.
  - `measurement_result`: model job, artifact URI, measurement source, mm values when available, and pixel measurements.
- Report structured payload now includes:
  - `model_evidence.segmentation_count`
  - `model_evidence.measurement_count`
  - `nodules[].segmentation`
  - `nodules[].measurement`
- Report text evidence summary now includes model-result evidence alongside TI-RADS rules and medical knowledge evidence.
- Wrote implementation note:
  `/Users/xutianliang/Downloads/jiazhuangxian/docs/MEDICAL_AGENT_END_TO_END_CHAIN_20260510.md`
- Validation:
  - `npm test -- test/unit/medical/agentWorker.test.ts` -> `14` tests OK.
  - `python3 -m unittest services/model-gateway/tests/test_gateway.py` -> `29` tests OK.
  - `npm run typecheck` -> OK.

### Doctor Workbench Model Evidence UI - 2026-05-10

- Implemented model evidence display in `web-react/src/components/panels/MedicalPanel.tsx`.
  - Adds a `Model Evidence` section in study detail.
  - Groups evidence by nodule.
  - Displays `segmentation_result` evidence from report evidence payloads:
    - segmentation source
    - model name/version
    - confidence
    - crop box
    - ROI size
    - mask URI
    - segmentation artifact URI
  - Displays `measurement_result` evidence:
    - measurement source
    - long/short/AP axes
    - area
    - aspect ratio
    - confidence
    - pixel measurement summary
    - measurement artifact URI
  - Falls back to persisted `measurement` rows and `nodule.mask_uri` when report evidence is incomplete.
  - Keeps existing overlay drag-box revision flow intact.
- Updated `web-react/src/components/panels/MedicalPanel.test.tsx`.
  - Fixture now includes nnU-Net segmentation evidence and mask measurement evidence.
  - Test asserts the doctor workbench shows crop box, ROI, mask URI, model names, mm measurements, and pixel measurement basis.
- Validation:
  - `cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx` -> `10` tests OK.
  - `cd web-react && npm run typecheck` -> OK.
  - `cd web-react && npm run build` -> OK.
- Local preview:
  - Vite dev server started at `http://127.0.0.1:5173/next/`.
  - Backend proxy target `127.0.0.1:7180` was already listening.

### Medical Web Loading Fix - 2026-05-10

- Reproduced the user-facing `Medical 加载失败：HTTP 404`/loading failure path.
- Root cause:
  - The React dev server was available on `5173`, but the web backend on `7180` was not reliably running.
  - After starting the backend, `/v1/web/medical/summary` returned `enabled=false` because `codeclaw web` did not pass `JZX_DATA_DB` into `startWebServer(...engineDefaults)`.
  - `medicalHandlers` intentionally enable medical storage only when `deps.dataDb` is present.
- Fixed `src/cli.tsx`:
  - Reads `JZX_DATA_DB`.
  - Resolves relative paths against the workspace.
  - Passes the resolved path as `engineDefaults.dataDbPath`.
- Restarted local backend with:
  - `JZX_DATA_DB=/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/runtime-smoke/data.db`
  - `JZX_RAG_DB=/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/runtime-smoke/rag.db`
- Verification:
  - `curl` to `http://127.0.0.1:7180/v1/web/medical/summary?limit=12` with saved bearer token -> HTTP 200, `enabled=true`.
  - `curl` through Vite proxy `http://127.0.0.1:5173/v1/web/medical/summary?limit=12` -> HTTP 200, `enabled=true`.
  - `npm run typecheck` -> OK.

### SSE Query Token and Legacy Data DB Migration Fix - 2026-05-10

- Fixed the stale SSE error path in `web-react/src/components/ChatPane.tsx`.
  - Chat SSE now uses the shared `openEventSource(...)` helper.
  - `openEventSource(...)` appends `?token=`/`&token=` because browser `EventSource` cannot set `Authorization`.
  - Replaced the old misleading error text that said the backend still only reads `Authorization`.
- Added backend regression coverage in `test/unit/channels/web/server.test.ts`.
  - `/v1/web/stream?sessionId=...&token=...` now has explicit test coverage without an `Authorization` header.
- Fixed legacy global `~/.codeclaw/data.db` migration compatibility in `src/storage/migrate.ts`.
  - Older CodeClaw DBs can already have schema version `6` from `team_write_proposals`.
  - The medical validation schema was also introduced as migration `006`, so old DBs skipped the medical schema and then failed on later seed migrations with `no such table: medical_documents`.
  - The migrator now detects `kind=data`, `current>=6`, and missing `medical_documents`, then applies the medical schema before later medical seed migrations.
- Added migration regression coverage in `test/unit/storage/migrate.test.ts`.
  - Simulates an old version-6 DB and verifies medical schema, seed documents, and terms are repaired.
- Rebuilt web React production assets with `cd web-react && npm run build`.
- Local verification:
  - Created a web session through `7180`.
  - Opened SSE with query token only: `GET /v1/web/stream?sessionId=...&token=...` -> HTTP 200 `text/event-stream`.
  - Medical summary through Vite proxy remains HTTP 200 and `enabled=true`.
- Validation:
  - `npm test -- test/unit/storage/migrate.test.ts test/unit/channels/web/server.test.ts test/unit/channels/web/server-stage-a.test.ts` -> `95` tests OK.
  - `npm run typecheck` -> OK.
  - `cd web-react && npm run typecheck` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: Stronger Segmentation Route

- SAM2 static detector-prompt route is implemented, smoke-tested, validated with GT-derived bbox, and validated with actual YOLO/RF-DETR detector bboxes through the full worker artifact chain.
- 100-case YOLO detector prompt validation is complete.
- Same-case nnU-Net Tight ROI comparison is complete and supports using nnU-Net Tight ROI as the static image auto-segmentation main route.
- `nnunet-tight-roi-segmenter` is now integrated into model-gateway and selected as the default static image segmentation model.
- A real 5090 smoke test succeeded with fallback disabled.
- Medical agent end-to-end model chain now auto-queues detect -> segment -> measure when no explicit child task is already present.
- Draft reports now include segmentation and measurement evidence, including nnU-Net crop metadata and measurement source.
- Doctor workbench now renders report model evidence for segmentation and measurement by nodule.
- Medical web backend now honors `JZX_DATA_DB`, and the local UI can load the smoke medical database through the Vite proxy.
- Chat SSE now uses query-token EventSource, and legacy global data DB migration no longer breaks session creation.
- SAM2 video route was already present and now has a real official SAM2.1 large checkpoint/config ready on 5090.
- nnU-Net v2 / ResEnc and Swin U-Net components are installed, but no new long training was started in this session.

### Background Tasks

- `cd web-react && npm run dev -- --host 127.0.0.1 --port 5173` is running for local UI preview.
- `JZX_DATA_DB=/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/medical/data.db JZX_RAG_DB=/Users/xutianliang/Downloads/jiazhuangxian/data/artifacts/medical/rag.db npm run dev -- web --host=127.0.0.1 --port=7180` is running for the local web backend.

### Next Session Priorities

1. Keep `sam2-thyroid-segmenter` as interactive bbox/point refinement and secondary review route in the doctor workbench.
2. Add doctor workbench overlay drag-box revision -> rerun nnU-Net segmentation -> refresh measurement flow.
3. Audit detector-empty cases `0037`, `0085`, `0087`; decide whether to lower YOLO threshold, use RF-DETR fallback, or ask doctor to draw a box.
4. Calibrate RF-DETR on TN3K or target hospital data before using it as a default prompt source.
5. Add report evidence diff/trace view for doctor edits after evidence-backed report approval.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
python3 -m py_compile scripts/run_nnunet_detector_roi_validation.py
python3 -m unittest services/model-gateway/tests/test_gateway.py
npm test -- test/unit/medical/agentWorker.test.ts
npm run typecheck
cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx && npm run typecheck
npm test -- test/unit/storage/migrate.test.ts test/unit/channels/web/server.test.ts test/unit/channels/web/server-stage-a.test.ts
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/Users/xutianliang/.codeclaw/web-auth.json','utf8')).token)") && curl -sS -H "Authorization: Bearer $TOKEN" 'http://127.0.0.1:5173/v1/web/medical/summary?limit=12'
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/Users/xutianliang/.codeclaw/web-auth.json','utf8')).token)") && SESSION=$(curl -sS -H "Authorization: Bearer $TOKEN" -X POST 'http://127.0.0.1:7180/v1/web/sessions' | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).sessionId))") && curl -i --max-time 2 "http://127.0.0.1:7180/v1/web/stream?sessionId=$SESSION&token=$TOKEN"
sed -n '1,220p' docs/SEGMENTATION_DETECTOR_ROI_COMPARISON_20260510.md
sed -n '1,220p' docs/NNUNET_TIGHT_ROI_GATEWAY_INTEGRATION_20260510.md
sed -n '1,220p' docs/MEDICAL_AGENT_END_TO_END_CHAIN_20260510.md
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && .venv-model-gateway-gpu/bin/python -m unittest services/model-gateway/tests/test_gateway.py'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian/services/model-gateway && JZX_NNUNET_RESULTS=/home/beelink/jiazhuangxian/data/nnunet/nnUNet_results JZX_NNUNET_RAW=/home/beelink/jiazhuangxian/data/nnunet/nnUNet_raw JZX_NNUNET_PREPROCESSED=/home/beelink/jiazhuangxian/data/nnunet/nnUNet_preprocessed JZX_NNUNET_PREDICT_BIN=/home/beelink/jiazhuangxian/.venv-model-gateway-gpu/bin/nnUNetv2_predict ../../.venv-model-gateway-gpu/bin/python -m app.config_check'
```

### Previous Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
ssh -o BatchMode=yes -S /tmp/jzx-5090-ssh.sock beelink@100.110.127.117 'cd ~/jiazhuangxian && .venv-model-gateway-gpu/bin/python - <<'"'"'PY'"'"'
from pathlib import Path
import json
p = Path("data/models/segmentation/nnunet-tn3k-roi-tight-2d-100epochs-ensemble-selected/imagesTs_pred/summary.json")
s = json.loads(p.read_text())
print(s["foreground_mean"])
PY'
```

## 2026-05-11 00:20 CST - Doctor BBox Revision Rerun Chain

- Implemented the doctor overlay bbox revision backend loop:
  - `POST /v1/web/medical/nodules/:id/revise` now validates that the nodule is image-backed, updates the bbox, creates a `doctor_bbox_revision` analysis session, and queues a chained rerun:
    1. `SegmentationAgent` / `segment_nodules` with `nnunet-tight-roi-segmenter`, `tn3k-tight-roi-5fold-best`, and `allow_bbox_fallback=false`.
    2. `MeasurementAgent` / `measure_nodules` for the same revised nodule.
    3. `ReportDraftAgent` / `draft_report` with `refresh_report_basis=true`.
  - The audit log now records the before/after bbox plus rerun analysis session id, agent task ids, and rerun task types.
- Updated the medical agent worker so segmentation and measurement model jobs honor `target_nodule_ids` / `nodule_id` / `nodule_index`.
  - Doctor revisions now send only the revised nodule to nnU-Net segmentation and measurement.
  - Existing full-study segmentation/measurement behavior remains unchanged when no target is provided.
- Updated web API typings and MedicalPanel test mocks so bbox revision responses expose the queued rerun session and tasks.

### Validation

- `npm test -- test/unit/channels/web/server.test.ts` -> 47 tests OK.
- `npm test -- test/unit/medical/agentWorker.test.ts` -> 15 tests OK.
- `npm run typecheck` -> OK.
- `cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx` -> 10 tests OK.
- `cd web-react && npm run typecheck` -> OK.
- Note: root `npm test -- web-react/src/components/panels/MedicalPanel.test.tsx` is not usable because the root Vitest config excludes `web-react/**`; the web package test command was used instead.

## 📌 SESSION HANDOFF STATUS

### Current Work: Doctor BBox Revision Rerun Chain

- Backend, worker targeting, API typing, and regression tests are complete for bbox revision -> nnU-Net segmentation queue -> measurement queue -> report basis refresh queue.
- The actual model execution still depends on the model worker/model-gateway consuming the queued `thyroid.segment_nodule` and `thyroid.measure_nodule` jobs.
- Report evidence refresh happens through the queued `draft_report` task after measurement succeeds.

### Background Tasks

- Existing local UI preview process is running: `npm run dev --host 127.0.0.1 --port 5173`.
- Existing local backend process is running: `npm run dev web --host=127.0.0.1 --port=7180`.
- No new long-running training or model-worker job was started in this session.

### Next Session Priorities

1. Run a real UI smoke: drag bbox in the doctor workbench, verify the new `doctor_bbox_revision` session and three queued tasks appear.
2. Run `npm run model-worker:once` against the same data DB after the revision to verify nnU-Net and measurement jobs are created and completed.
3. Verify the follow-up `draft_report` task creates a new report whose evidence includes the refreshed segmentation and measurement artifacts.
4. Add optional doctor-facing evidence diff between old bbox/mask/measurement/report basis and refreshed basis.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm test -- test/unit/channels/web/server.test.ts
npm test -- test/unit/medical/agentWorker.test.ts
npm run typecheck
cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx && npm run typecheck
```

## 2026-05-11 00:59 CST - UI Smoke: Doctor BBox Revision -> nnU-Net -> Measurement -> Report Evidence

- Ran a real UI smoke on the doctor workbench against `SMOKE_STUDY_UI` / `SMOKE_NODULE_UI`.
  - Dragged the overlay revision canvas and saved the bbox revision.
  - UI created a `doctor_bbox_revision` analysis session and queued the expected task chain:
    1. `segment_nodules`
    2. `measure_nodules`
    3. `draft_report`
  - Screenshot: `data/artifacts/medical/ui-smoke-after-bbox-revision.png`.
- The browser drag event produced a zero-area bbox in this synthetic smoke run. Before model execution, normalized the smoke bbox to `[112,64,214,172]` and recorded `smoke_normalization` in task/session/audit details so nnU-Net received a valid ROI.
- Ran real model-worker jobs on the 5090 host:
  - First GPU attempt hit CUDA OOM because LM Studio was occupying about 23.9GB VRAM.
  - Retried `thyroid.segment_nodule` with `JZX_MODEL_DEVICE=cpu`; nnU-Net succeeded and produced:
    - `artifact://model-output/thyroid-segment-nodule/SMOKE_STUDY_UI/SMOKE_IMAGE_UI/01KR9CJWG42MYM6RPXC74KZM8T/segmentation.json`
    - `artifact://model-output/thyroid-segment-nodule/SMOKE_STUDY_UI/SMOKE_IMAGE_UI/01KR9CJWG42MYM6RPXC74KZM8T/mask_nodule_1.png`
  - Ran `thyroid.measure_nodule`; after pixel-spacing parser fix, measurement succeeded with:
    - long axis `25.25mm`
    - short axis `20.0mm`
    - area `386.625mm2`
    - source `mask`
    - no warnings
- Fixed model-gateway pixel spacing parsing:
  - `services/model-gateway/app/segmentation.py` now accepts `row_spacing_mm`, `column_spacing_mm`, `col_spacing_mm`, and related aliases.
  - `services/model-gateway/tests/test_gateway.py` now verifies the agent-style spacing keys produce mm measurements.
- Ran final `draft_report`; report `01KR9D765ZSTSVWHGCM341NQZZ` includes:
  - segmentation evidence from `nnunet_tight_roi`
  - measurement evidence from `mask`
  - TI-RADS rule evidence
  - medical guideline/RAG evidence chunks
- Exported smoke verification artifact:
  - `data/artifacts/medical/ui-smoke-bbox-revision-verification.json`
- Output development document:
  - `docs/DOCTOR_BBOX_REVISION_UI_SMOKE_DEV_DOC_20260511.md`

### Validation

- `python3 -m unittest services/model-gateway/tests/test_gateway.py` -> 29 tests OK.
- `medical-agent-worker:once` segment task -> succeeded.
- `medical-agent-worker:once` measure task -> succeeded.
- `medical-agent-worker:once` draft report task -> succeeded.
- DB verification:
  - analysis session `01KR9CHM7RK3YGK7SWTZSDW2V2` -> `succeeded`.
  - tasks `segment_nodules`, `measure_nodules`, `draft_report` -> all `succeeded`.
  - model jobs `thyroid.detect_nodules`, `thyroid.segment_nodule`, `thyroid.measure_nodule` -> all `succeeded`.
  - `nodule.mask_uri` populated.
  - `measurement` row persisted.
  - latest report evidence includes `tirads_result`, `segmentation_result`, `measurement_result`, `tirads_rule`, and `medical_guideline`.

## 📌 SESSION HANDOFF STATUS

### Current Work: Real UI Smoke Completed

- The requested static chain is verified end to end: doctor bbox revision -> queued rerun -> nnU-Net segmentation -> mask measurement -> refreshed report basis.
- A small model-gateway compatibility fix is pending commit: pixel spacing parser aliases for `row_spacing_mm/col_spacing_mm`.

### Background Tasks

- No new long-running browser, backend, Vite, training, or model-worker job remains running from this smoke.
- The pre-existing local UI preview on port `5173` may still be running from an earlier session.

### Next Session Priorities

1. Commit and push the pixel-spacing parser fix if desired.
2. Add a UI-level guard against zero-area drag rectangles so synthetic/edge drag events cannot submit invalid bbox values.
3. Add doctor-facing old-vs-new evidence diff for bbox/mask/measurement/report basis.
4. Re-run the smoke with GPU after LM Studio/large LLM processes are unloaded, to validate the fast CUDA path.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
python3 -m unittest services/model-gateway/tests/test_gateway.py
node -e "const Database=require('better-sqlite3'); const db=new Database('data/artifacts/medical/data.db'); console.log(db.prepare(\"select id,status from analysis_session where id='01KR9CHM7RK3YGK7SWTZSDW2V2'\").get()); db.close();"
sed -n '1,220p' data/artifacts/medical/ui-smoke-bbox-revision-verification.json
```

## 2026-05-11 01:29 CST - P0 BBox Revision Validation Guard

- Implemented the first P0 follow-up from the UI smoke:
  - Frontend overlay bbox save now rejects zero-area or sub-1-pixel bbox drafts before calling `reviseMedicalNodule`.
  - Frontend manual bbox input now uses the same validation before saving a doctor revision.
  - Backend `POST /v1/web/medical/nodules/:id/revise` now normalizes xyxy order and rejects bbox width/height below 1 pixel.
- Added regression coverage:
  - Web API rejects zero-width bbox with `400 invalid-request`.
  - MedicalPanel overlay revision blocks zero-area drag submissions.
  - MedicalPanel manual bbox editor blocks zero-area submissions.

### Validation

- `npm test -- test/unit/channels/web/server.test.ts` -> 47 tests OK.
- `cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx` -> 12 tests OK.
- `npm run typecheck` -> OK.
- `cd web-react && npm run typecheck` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: P0 BBox Guard Implemented

- The zero-area bbox issue found during real UI smoke is now guarded in both UI and API.
- Changes are not yet committed or pushed.

### Background Tasks

- No long-running dev server, browser, training, or model-worker job was started for this task.

### Next Session Priorities

1. Commit and push the bbox validation guard if approved.
2. Continue P0 by turning the doctor bbox revision smoke into automated E2E.
3. Add doctor-facing old-vs-new evidence diff for bbox, mask, measurement, and report evidence.
4. Re-run the nnU-Net smoke on GPU after large LLM/LM Studio processes release VRAM.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm test -- test/unit/channels/web/server.test.ts
cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx && npm run typecheck
npm run typecheck
```

## 2026-05-11 01:47 CST - P0 Automated Doctor BBox Revision Smoke

- Continued P0 by turning the doctor bbox revision smoke into a CI-runnable integration path inside `test/unit/channels/web/server.test.ts`.
- The smoke now covers:
  1. `POST /v1/web/medical/nodules/:id/revise` creating a `doctor_bbox_revision` session.
  2. The queued `segment_nodules -> measure_nodules -> draft_report` task chain.
  3. `medical-agent-worker` creating the `thyroid.segment_nodule` model job with `allow_bbox_fallback=false` and only the revised nodule.
  4. Simulated successful model-worker segmentation output being consumed into `nodule.mask_uri`.
  5. `medical-agent-worker` creating and consuming the `thyroid.measure_nodule` model job.
  6. Measurement rows being persisted.
  7. `draft_report` completing and refreshing report evidence with `tirads_result`, `segmentation_result`, `measurement_result`, and `tirads_rule`.
- This does not replace the remote 5090 real-model smoke, but it now protects the orchestration and persistence chain in local automated tests.

### Validation

- `npm test -- test/unit/channels/web/server.test.ts` -> 47 tests OK.
- `cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx` -> 12 tests OK.
- `npm run typecheck` -> OK.
- `cd web-react && npm run typecheck` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: P0 BBox Guard and Automated Smoke Implemented

- UI/API zero-area bbox guards are implemented.
- The doctor bbox revision rerun chain is now covered by an automated integration smoke.
- Changes are not yet committed or pushed.

### Background Tasks

- No long-running dev server, browser, training, or model-worker job was started for this task.

### Next Session Priorities

1. Commit and push the current P0 changes if approved.
2. Add doctor-facing old-vs-new evidence diff for bbox, mask, measurement, and report evidence.
3. Re-run the nnU-Net smoke on GPU after large LLM/LM Studio processes release VRAM.
4. Optionally add a browser-level Playwright suite later if the project adopts Playwright as a dependency.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm test -- test/unit/channels/web/server.test.ts
cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx && npm run typecheck
npm run typecheck
```

## 2026-05-11 04:50 CST - P0 Doctor Revision Evidence Diff

- Continued the doctor bbox revision path by adding doctor-facing refreshed evidence visibility in the Safety Audit panel.
- Backend `medical.nodule.revise` audit snapshots now preserve nodule index, mask URI, and detection confidence, so later UI/report review has enough old-state context.
- The audit UI now renders a `Revision Evidence Diff` block for bbox revision audit rows:
  1. Old bbox and new bbox from the audit snapshot.
  2. Old mask availability from the audit snapshot.
  3. New mask availability from refreshed segmentation evidence or updated nodule state.
  4. New measurement value after refreshed measurement persistence.
  5. Latest refreshed report evidence sources and report artifact id.
- The UI intentionally shows `pending refresh` when the revision has been saved but the rerun worker has not yet produced newer segmentation, measurement, and report evidence.
- Added UI coverage for both pending refresh and completed refresh evidence states.

### Validation

- `npm test -- test/unit/channels/web/server.test.ts` -> 47 tests OK.
- `cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx` -> 13 tests OK.
- `npm run typecheck` -> OK.
- `cd web-react && npm run typecheck` -> OK.
- `git diff --check` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: P0 Doctor Revision Chain Strengthened

- UI/API zero-area bbox guards are implemented.
- Doctor bbox revision now queues `segment_nodules -> measure_nodules -> draft_report` and has automated worker smoke coverage.
- Safety Audit now surfaces old/new bbox plus refreshed mask, measurement, and report-basis evidence for doctor bbox revision audits.
- Changes are not yet committed or pushed.

### Background Tasks

- No long-running dev server, browser, training, model-worker, or GPU job was started for this task.

### Next Session Priorities

1. Commit and push the current P0 changes if approved.
2. Run a real browser smoke against the workbench if the user wants visual confirmation.
3. Re-run the nnU-Net real-model smoke on GPU after model availability is confirmed.
4. Continue MED-313 by expanding report-edit change history and evidence display if needed.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm test -- test/unit/channels/web/server.test.ts
cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx && npm run typecheck
cd .. && npm run typecheck
git status --short
```

## 2026-05-11 06:28 CST - P0 Revision Evidence BBox Consistency Guard

- Re-ran the real Medical workbench smoke with the local React UI and Web backend pointed at the project medical SQLite DB.
- Confirmed the static chain data is still present for `SMOKE_STUDY_UI`:
  - 1 patient, 1 study, 1 image, 1 nodule, 2 reports.
  - 3 succeeded model jobs and 3 succeeded agent tasks.
  - Latest report evidence includes `tirads_result`, `segmentation_result`, `measurement_result`, `tirads_rule`, and `medical_guideline`.
- Found one important UI evidence-mapping issue from the historical smoke data:
  - The stored audit row had an invalid zero-area `after.bbox` from the earlier pre-guard browser drag.
  - The UI was able to pair that audit row with later model/report evidence by nodule id and timestamp only.
- Implemented a consistency guard in the `Revision Evidence Diff` panel:
  - Refreshed evidence is now marked `refreshed` only when audit `after.bbox`, current nodule bbox, and segmentation `metadata.prompt_bbox` agree within 1 pixel.
  - Historical invalid bbox rows now show `invalid revision bbox`.
  - `new mask`, `new measure`, and `report basis` remain `pending refresh` when the evidence does not belong to that exact revision bbox.
- Added/updated development documentation:
  - `docs/DOCTOR_BBOX_REVISION_UI_SMOKE_DEV_DOC_20260511.md`
  - Documented the finished bbox guard, old-vs-new evidence diff, mismatch handling, and the need to start Web with absolute `JZX_DATA_DB/JZX_RAG_DB` paths.
- In-app browser verification:
  - `SMOKE_STUDY_UI` Safety Audit now shows `Revision Evidence Diff`.
  - The historical invalid audit row shows `refresh status invalid revision bbox`.
  - New mask, new measure, and report basis show `pending refresh`.
  - `screencapture` could not write a local PNG in this desktop environment (`could not create image from display`), so no new screenshot artifact was produced.

### Validation

- `cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx` -> 14 tests OK.
- `cd web-react && npm run typecheck` -> OK.
- `npm test -- test/unit/channels/web/server.test.ts` -> 47 tests OK.
- `npm run typecheck` -> OK.
- `git diff --check` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: P0 Doctor Revision Evidence Guard Implemented

- UI/API zero-area bbox guards are implemented.
- The automated doctor bbox revision worker smoke is implemented.
- Safety Audit now displays old/new bbox, mask, measurement, and report basis, with bbox consistency checks so stale or mismatched evidence is not shown as refreshed.
- Changes are not yet committed or pushed.

### Background Tasks

- Local backend and Vite dev servers used for UI smoke were stopped.
- No long-running training, model-worker, GPU, browser automation, or dev server task remains running from this session.

### Next Session Priorities

1. Commit and push the current P0 changes if approved.
2. Convert the real UI smoke into a proper browser-level E2E suite if the project adopts Playwright or an equivalent dependency.
3. Re-run the nnU-Net real-model smoke on GPU after model availability is confirmed.
4. Continue MED-313 by expanding report edit change history and evidence filtering by revision batch.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm test -- test/unit/channels/web/server.test.ts
cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx && npm run typecheck
cd .. && npm run typecheck
git status --short
```

## 2026-05-11 06:41 CST - P0 Doctor BBox Revision Chain Completed

- Completed the current P0 scope for doctor bbox revision:
  - Overlay and manual bbox revision are guarded in the UI.
  - Web API normalizes and rejects invalid bbox values.
  - Revision creates a `doctor_bbox_revision` analysis session and queues `segment_nodules -> measure_nodules -> draft_report`.
  - Automated Web/API + medical-agent-worker smoke verifies segmentation job creation, segmentation result sync, measurement job creation, measurement persistence, and report evidence refresh.
  - Safety Audit displays old/new bbox, old/new mask state, refreshed measurement, and report-basis evidence.
  - Revision evidence now checks bbox consistency before displaying refreshed model/report evidence.
- Updated `docs/DOCTOR_BBOX_REVISION_UI_SMOKE_DEV_DOC_20260511.md` with the final P0 completion state and explicit out-of-scope items:
  - No new Playwright dependency in this P0.
  - No new remote GPU training/inference run in this P0.
  - No backend revision-batch evidence query API in this P0.
- Full P0 validation pass completed:
  - `npm test -- test/unit/channels/web/server.test.ts test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts test/unit/medical/mcp-server.test.ts` -> 91 tests OK.
  - `cd web-react && npm test` -> 11 files, 47 tests OK.
  - `npm run typecheck` -> OK.
  - `cd web-react && npm run typecheck` -> OK.
  - `npm run build:web` -> OK, with the existing Monaco large chunk warning.
  - `python3 -m unittest discover services/model-gateway/tests` -> 29 tests OK.
  - `git diff --check` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: P0 Complete, Local Commit Created

- The current P0 doctor bbox revision chain is complete and validated.
- Local commit created with message `Complete doctor bbox revision P0`.
- Push to `origin/main` was attempted three times but failed with `Recv failure: Connection reset by peer`; `git ls-remote` against the same remote also fails with the same network error.
- Branch state after commit: `main...origin/main [ahead 1]`.
- `tmp-phase1.txt` remains untracked and unrelated; do not stage it unless the user explicitly asks.

### Background Tasks

- No backend, Vite, training, model-worker, GPU, or browser automation process is running from this session.

### Next Session Priorities

1. Retry `git push origin main` when GitHub/network connectivity is available.
2. Continue with P1/P2 follow-ups: browser E2E dependency decision, GPU rerun, report edit history, or backend revision-batch evidence query.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short
git push origin main
npm test -- test/unit/channels/web/server.test.ts test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts test/unit/medical/mcp-server.test.ts
cd web-react && npm test && npm run typecheck
cd .. && npm run typecheck && npm run build:web
python3 -m unittest discover services/model-gateway/tests
```

## 2026-05-11 07:16 CST - Server-Side Revision Evidence Summary

- Retried `git push origin main`; GitHub HTTPS still failed with `Recv failure: Connection reset by peer`.
- Continued the next evidence-safety follow-up by moving revision evidence attribution into the Web API response:
  - `GET /v1/web/medical/studies/:studyId` now enriches `medical.nodule.revise` audit rows with `detail.revision_evidence`.
  - The summary is bound to `rerun_analysis_session_id`, `rerun_agent_task_ids`, matching segmentation/measurement model jobs, and the report generated by the same analysis session.
  - Status values are `pending_refresh`, `refreshed`, `invalid_revision_bbox`, `bbox_mismatch`, and `failed`.
  - The summary carries model job ids, report id, evidence sources, old/new bbox, new mask URI, measurement values, and bbox consistency checks.
- Updated the doctor workbench UI:
  - `Revision Evidence Diff` now prefers `audit.detail.revision_evidence` when present.
  - The previous frontend inference remains only as a compatibility fallback.
- Updated `docs/DOCTOR_BBOX_REVISION_UI_SMOKE_DEV_DOC_20260511.md` with the server-side revision evidence summary design and payload example.

### Validation

- `npm test -- test/unit/channels/web/server.test.ts` -> 47 tests OK.
- `cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx` -> 15 tests OK.
- `npm test -- test/unit/channels/web/server.test.ts test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts test/unit/medical/mcp-server.test.ts` -> 91 tests OK.
- `cd web-react && npm test` -> 11 files, 48 tests OK.
- `npm run typecheck` -> OK.
- `cd web-react && npm run typecheck` -> OK.
- `npm run build:web` -> OK, with the existing Monaco large chunk warning.
- `python3 -m unittest discover services/model-gateway/tests` -> 29 tests OK.
- `git diff --check` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: Server-Side Revision Evidence Summary Committed Locally

- P0 commit `f8f952a` remains local and unpushed because GitHub HTTPS is resetting.
- Follow-up commit with message `Add server revision evidence summary` was created locally.
- `git push origin main` was retried after the follow-up commit and still failed with `Recv failure: Connection reset by peer`.
- Branch state after the follow-up commit: `main...origin/main [ahead 2]`.
- `tmp-phase1.txt` remains untracked and unrelated.

### Background Tasks

- No backend, Vite, training, model-worker, GPU, browser automation, or dev server process is running from this session.

### Next Session Priorities

1. Retry `git push origin main` when GitHub/network connectivity is available.
2. Continue P1/P2 follow-ups: browser E2E dependency decision, GPU rerun, report edit history, or richer backend revision-batch evidence queries if needed.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short
npm test -- test/unit/channels/web/server.test.ts test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts test/unit/medical/mcp-server.test.ts
cd web-react && npm test && npm run typecheck
cd .. && npm run typecheck && npm run build:web
python3 -m unittest discover services/model-gateway/tests
git push origin main
```

## 2026-05-11 07:31 CST - Doctor Report Edit Trace UI

- Continued the doctor workstation P0 follow-up by replacing the simple report edit length notice with a reusable `ReportTextDiff` panel.
- The live report editor now shows:
  - original/new character counts,
  - signed length delta,
  - changed-character span size,
  - compact original and new text snippets.
- Doctor review history now renders the same edit-trace panel when the persisted `before` and `after` report text differ, so confirmed reports expose the modification basis instead of only status/action.
- Updated `MedicalPanel.test.tsx` mocks and assertions to cover the live draft edit trace and the persisted review edit trace after confirmation.

### Validation

- `cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx` -> 15 tests OK.
- `cd web-react && npm run typecheck` -> OK.
- `cd web-react && npm test` -> 11 files, 48 tests OK. Existing React `act(...)` warnings in `ApprovalCard.test.tsx` remain unrelated.
- `npm run build:web` -> OK, with the existing Monaco large chunk warning.
- `git diff --check` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: Doctor Report Edit Trace Implemented

- P0 doctor bbox revision chain and server-side revision evidence summary are still committed locally.
- Current report edit trace changes are validated and committed locally.
- Push attempts during this session either failed with `Recv failure: Connection reset by peer` or hung without output and were terminated; retry when network/GitHub connectivity is stable.
- Branch state after this local commit is expected to be `main...origin/main [ahead 3]`.
- `tmp-phase1.txt` remains untracked and unrelated.

### Background Tasks

- No backend, Vite, training, model-worker, GPU, browser automation, or dev server process is running from this session.

### Next Session Priorities

1. Retry `git push origin main` when GitHub/network connectivity is available.
2. Continue remaining doctor workstation work: richer report editor, batch case queue, knowledge evidence panel, or browser E2E dependency decision.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short
cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx && npm run typecheck
cd .. && npm run build:web
git diff --check
git push origin main
```

## 2026-05-11 11:40 CST - Doctor Report Editor Hardening

- Strengthened the doctor workstation report editor without adding RBAC or a new report subsystem.
- Report cards now use structured paragraph editing:
  - AI draft/final text is split into editable paragraph sections.
  - Doctors can edit section titles/content, add sections, remove extra sections, and preview the composed final report text.
  - Read-only confirmed/archived reports render as structured sections instead of one long free-text block.
- Evidence references are now fixed and visible:
  - The report evidence panel shows `证据引用固定` plus the evidence count and source list.
  - Doctor review snapshots now preserve `structured`, `structured_sections`, full `evidence`, `evidence_count`, and `evidence_sources`.
  - Doctor review history displays a `证据快照` block alongside text-diff history.
- Added audit archive flow:
  - `ReportReviewAction` now supports `archive`.
  - Confirmed reports can be archived through the existing report review endpoint.
  - Archive keeps the confirmed text and original confirmed doctor/time, writes a `doctor_review` row, and writes a `medical.report.archive` audit log.
  - The UI shows an `审核归档` action after confirmation and moves the report to `archived` after success.
- Existing approve/reject behavior is preserved; `revise` now maps to `pending_review` instead of being treated as confirmed.
- `tmp-phase1.txt` remains untracked and unrelated.

### Validation

- `npm test -- test/unit/medical/caseRepo.test.ts` -> 13 tests OK.
- `npm test -- test/unit/channels/web/server.test.ts` -> 47 tests OK.
- `npm test -- test/unit/medical/caseRepo.test.ts test/unit/channels/web/server.test.ts` -> 2 files, 60 tests OK.
- `cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx` -> 15 tests OK.
- `npm run typecheck` -> OK.
- `cd web-react && npm run typecheck` -> OK.
- `npm run build:web` -> OK, with the existing Monaco large chunk warning.
- `git diff --check` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: Doctor Report Editor Hardening Implemented

- Report editing now has structured paragraph editing, evidence locking visibility, review snapshot evidence history, and archive action support.
- This change set is validated locally; confirm current commit/push state with `git status --short --branch`.
- Existing branch was already ahead of `origin/main`; network push was not retried in this session.
- Existing untracked `tmp-phase1.txt` remains unrelated and was not touched.

### Background Tasks

- No backend, Vite, model-worker, GPU, browser automation, or dev server process is running from this session.

### Next Session Priorities

1. Retry `git push origin main` when GitHub/network connectivity is available.
2. Continue UI polish: batch case queue, richer evidence filtering, and surfacing model `evaluation.status` / detector `quality_gate.review_reasons` in the report review panel.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short --branch
npm test -- test/unit/medical/caseRepo.test.ts test/unit/channels/web/server.test.ts
cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx && npm run typecheck
cd .. && npm run typecheck && npm run build:web
git diff --check
git push origin main
```

## 2026-05-11 10:14 CST - GPU Inference Pipeline Evaluation Gates

- Continued stabilizing the real GPU inference chain around the agreed policy `thyroid-gpu-pipeline-v1`.
- Added model-gateway config reporting for the unified chain:
  - Static image chain: RF-DETR primary detection, YOLO11m comparator, nnU-Net Tight ROI primary segmentation, SAM2/MedSAM review options, mask measurement.
  - Video chain: SAM2/MedSAM2 video prompt segmentation and video mask measurement.
  - `JZX_MEDICAL_REAL_INFERENCE=1` is now reflected in config output and disables validation fallback defaults in the CodeClaw medical Agent auto-queued static segmentation path.
- Added detector result gating:
  - RF-DETR/YOLO comparison now includes `evaluation_protocol = thyroid.detector.dual_model_consensus.v1`.
  - `comparison.json` now includes `quality_gate` with `pass` / `review`, IoU threshold, model roles, and machine-readable review reasons.
  - `detections.json` now includes detector artifact `evaluation`.
- Added artifact-level evaluation for all major model outputs:
  - Static segmentation: `thyroid.segmentation.evaluation.v1`.
  - Static measurement: `thyroid.measurement.evaluation.v1`.
  - Video segmentation: `thyroid.video_segmentation.evaluation.v1`.
  - Video measurement: `thyroid.video_measurement.evaluation.v1`.
- Updated CodeClaw medical Agent model job defaults and metadata:
  - Detector jobs default to `rf-detr-medium-thyroid-detector` / `tn5000-rfdetr-medium-ema`.
  - Automatic downstream segmentation uses `nnunet-tight-roi-segmenter` / `tn3k-tight-roi-5fold-best`.
  - Measurement uses `mask-measurement-worker` / `validation-measurement-v1`.
  - Model jobs now carry `metadata.model_pipeline` so downstream report evidence and audits can identify the intended model split.
- Updated documentation:
  - `services/model-gateway/README.md` documents the unified GPU chain, strict real inference flag, config report pipeline block, `quality_gate`, and artifact `evaluation`.
  - `docs/MODEL_ARTIFACT_CONVENTIONS.md` documents the unified evaluation field and per-artifact protocols.

### Validation

- `python3 -m unittest services/model-gateway/tests/test_gateway.py` -> 29 tests OK.
- `npm test -- test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts test/unit/medical/mcp-server.test.ts` -> 3 files, 45 tests OK.
- `npm run typecheck` -> OK.
- `git diff --check` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: GPU Pipeline Evaluation Gates Implemented

- Real GPU inference chain governance is now explicit in config, Agent model job metadata, detector comparison artifacts, and segmentation/measurement artifacts.
- This change set is validated locally; confirm current commit/push state with `git status --short --branch`.
- Local commit was created, but `git push origin main` failed with `Failed to connect to github.com port 443 after 75051 ms: Couldn't connect to server`; branch is expected to remain ahead of `origin/main`.
- Existing untracked `tmp-phase1.txt` remains unrelated and was not touched.

### Background Tasks

- No backend, Vite, training, model-worker, GPU, browser automation, or dev server process is running from this session.

### Next Session Priorities

1. Run a real 5090 strict-mode smoke with `JZX_MEDICAL_REAL_INFERENCE=1`: RF-DETR primary + YOLO comparator -> nnU-Net Tight ROI -> measurement, then inspect `quality_gate` and artifact `evaluation`.
2. Run or schedule the SAM2/MedSAM2 video prompt smoke once video weights/config are confirmed on the 5090.
3. Retry `git push origin main` once GitHub/network connectivity is available.
4. Surface `evaluation.status` and `quality_gate.review_reasons` more prominently in the doctor workstation and Qwen3.6 result-evaluation prompt.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short --branch
python3 -m unittest services/model-gateway/tests/test_gateway.py
npm test -- test/unit/medical/agentWorker.test.ts test/unit/medical/caseRepo.test.ts test/unit/medical/mcp-server.test.ts
npm run typecheck
git diff --check
git push origin main
```

## 2026-05-11 07:40 CST - Report Evidence Panel

- Continued the doctor workstation evidence workflow by adding a per-report `报告依据` panel in `MedicalPanel`.
- The panel renders the structured `report.evidence` already persisted by the medical agent worker:
  - `tirads_result` as TI-RADS calculation evidence,
  - `tirads_rule` as rule-library evidence,
  - `medical_guideline` as medical knowledge-base evidence with document/section/path lines,
  - `segmentation_result` as model segmentation evidence,
  - `measurement_result` as measurement evidence.
- The report row now shows the evidence basis directly beside the draft/final report text, so doctors can review report claims without running a separate manual knowledge search.
- Updated `MedicalPanel.test.tsx` fixture and assertions to cover rule, guideline, segmentation, and measurement evidence displayed from a selected study report.

### Validation

- `cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx` -> 15 tests OK.
- `cd web-react && npm run typecheck` -> OK.
- `cd web-react && npm test` -> 11 files, 48 tests OK. Existing React `act(...)` warnings in `ApprovalCard.test.tsx` remain unrelated.
- `npm run build:web` -> OK, with the existing Monaco large chunk warning.
- `npm run typecheck` -> OK.
- `git diff --check` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: Report Evidence Panel Implemented

- P0 doctor bbox revision, server-side revision evidence summary, report edit trace UI, and report evidence panel are complete locally.
- Current report evidence panel changes are validated and committed locally.
- `git push origin main` failed again with `Recv failure: Connection reset by peer`.
- Branch state after this local commit is expected to be `main...origin/main [ahead 4]`.
- `tmp-phase1.txt` remains untracked and unrelated.

### Background Tasks

- No backend, Vite, training, model-worker, GPU, browser automation, or dev server process is running from this session.

### Next Session Priorities

1. Retry `git push origin main` when GitHub/network connectivity is available.
2. Continue remaining doctor workstation work: richer report editor controls, batch case queue, or browser E2E dependency decision.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short --branch
cd web-react && npm test -- src/components/panels/MedicalPanel.test.tsx && npm run typecheck
cd .. && npm run build:web
git diff --check
git push origin main
```

## 2026-05-11 20:20 CST - Live Demo Auto Runner

- 新增 `scripts/medical-live-demo-runner.ts` 和 `npm run medical-demo:run`。
- Runner 负责自动循环调用现有 `medical-agent-worker`，不改变医学任务本身：
  - 自动执行 image_qc、RF-DETR/YOLO 检测、nnU-Net 分割、mask 测量等已排队任务；
  - 自动轮询 5090 远程 model-gateway job，并同步回 Mac 本地 SQLite；
  - 若缺少医生结构化 TI-RADS 特征，停在 `waiting_doctor_tirads_features`；
  - 到 `draft_report` 前检测 Qwen 是否 loaded，未加载时停在 `waiting_qwen_model`；
  - Qwen 加载后自动继续执行 `draft_report / safety_review`，生成主报告并落库。
- 更新 `docs/UI_SMOKE_5090_REMOTE_ARTIFACT_20260511.md`，补充自动演示命令和现场分阶段说明。

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
npm run medical-demo:run -- --help
npm run typecheck
git diff --check
```

## 2026-05-13 01:55 CST - Final Validation Review Persistence

- 完成最终验证数据集结果的持久化与 Review 闭环：
  - 新增 `final_validation_run`、`final_validation_image_result` 数据表，用于保存 FangDai 等最终验证批次、单图检测/分割/测量/报告结果、模型 artifact、任务事件与医生复核状态。
  - `scripts/medical-final-validation-static.ts` 在静态图 E2E 跑完后写入数据库，后续可按 run/result 追踪和复查。
  - 后端新增最终验证 API：列出验证批次、按复核状态列出结果、提交医生复核结论，并写入 `audit_log`。
  - 医生工作台新增 `Final Validation Review` 面板，可查看最终验证批次、待复核队列、原图/overlay、bbox、检测置信度、测量来源、artifact JSON，并标记“接受 / 需再看 / 退回”。
- 已在 5090 真实链路上完成 FangDai per-class smoke：FTC/MTC/PTC 各 1 例，RF-DETR + YOLO 对照、分割、测量链路成功落库，run id 为 `01KREJTHRDYFVW0283WD16BAAZ`。

### Validation

- `npm run typecheck` -> OK.
- `npm --prefix web-react run typecheck` -> OK.
- `npm test -- --run test/unit/medical/caseRepo.test.ts` -> 15 tests OK.
- `npm test -- --run test/unit/channels/web/server.test.ts` -> 51 tests OK.
- `npm --prefix web-react test -- --run src/components/panels/MedicalPanel.test.tsx` -> 28 tests OK.
- `git diff --check` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: Final Validation Review Closed Loop Implemented

- 最终验证结果已能从脚本写入 SQLite，并通过医生工作台进行人工复核。
- Review API 会持久化医生结论和备注，并写审计日志，后续可用于 review/误差分析/模型再训练样本筛选。
- 当前工作区仍包含本轮及前序开发的未提交变更；`tmp-phase1.txt`、`示例/`、`示例.zip` 仍是未跟踪文件，未处理。

### Background Tasks

- 本轮没有留下 dev server、model-worker、训练任务、GPU 推理任务或浏览器自动化进程。

### Next Session Priorities

1. 做最终验证 Review 面板的真实浏览器 smoke，确认 artifact 图片、overlay 和 JSON 链接在 Mac UI 能正常打开。
2. 增加最终验证结果导出/筛选能力，方便按 `accepted / rejected / needs_review` 形成再训练清单。
3. 继续稳固真实 GPU E2E：静态图批量验证、视频 E2E、MedSAM2/SAM2 分割质量复核。

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short --branch
npm run typecheck
npm test -- --run test/unit/channels/web/server.test.ts test/unit/medical/caseRepo.test.ts
npm --prefix web-react test -- --run src/components/panels/MedicalPanel.test.tsx
git diff --check
```

## 2026-05-13 03:10 CST - Doctor Workstation Chinese UI Pass

- 将医生工作台主界面中文化，覆盖左侧统计、病例队列、模型/智能体任务、模型网关、手工登记、知识证据、最终验证复核、病例详情、overlay 修订、模型依据、结节结果、报告编辑/审核、审计与修订依据面板。
- 增加统一中文映射函数，集中处理状态、来源、任务类型、模型任务类型、知识检索模式、审核动作、审计动作和存储禁用提示，减少界面直接暴露 `pending / unknown / draft / bbox / medical.nodule.revise` 等英文内部字段。
- 同步更新 `MedicalPanel.test.tsx` 中医生工作台相关断言，保持 UI 文案变更后回归测试仍覆盖主要工作流。

### Validation

- `npm --prefix web-react run typecheck` -> OK.
- `npm --prefix web-react test -- --run src/components/panels/MedicalPanel.test.tsx` -> 28 tests OK.
- `git diff --check -- web-react/src/components/panels/MedicalPanel.tsx web-react/src/components/panels/MedicalPanel.test.tsx` -> OK.

## 📌 SESSION HANDOFF STATUS

### Current Work: Doctor Workstation Chinese UI Pass Completed

- 当前完成范围是医生工作台/医疗面板主链路的中文化；模型名称、artifact URI、医学缩写、DICOM/JSON/AI/TI-RADS 等必要技术名词保留。
- 本轮没有处理全站非医疗页面，也没有启动真实 GPU 推理或 dev server。
- 当前工作区仍包含前序开发遗留的未提交变更和未跟踪示例文件，未在本轮清理。

### Background Tasks

- 无后台进程需要接管。

### Next Session Priorities

1. 做一次浏览器 smoke，确认医生工作台中文文案在真实布局中不溢出，尤其是最终验证复核、报告编辑器和 overlay 修订区。
2. 继续排查其他医疗相关页面或弹窗是否还暴露英文内部状态。
3. 如要上线演示，再跑 `npm run build:web` 做完整前端构建验证。

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short --branch
npm --prefix web-react run typecheck
npm --prefix web-react test -- --run src/components/panels/MedicalPanel.test.tsx
git diff --check
```

## 2026-05-13 03:18 CST - Full Build Validation

- 按用户要求执行完整编译：`npm run build`。
- 构建结果成功：
  - `web-react` 通过 `vite build` 生成生产包；
  - 根目录 build 脚本生成 `dist/cli.js`，复制 migrations，并输出 `dist/public/` 与 `dist/public-react/`。
- Vite 输出大 chunk 体积 warning，属于构建体积提示，不影响本次编译通过。

### Validation

- `npm run build` -> OK.

## 2026-05-13 03:55 CST - Video SAM2 Smoke Before Training

- 按“训练视频”方向先完成视频训练前置验证：
  - 将本地两个 DICOM 视频 `Q4DDKKO8 / Q4DDKKOA` 同步到 5090：
    `/home/beelink/jiazhuangxian/data/artifacts/datasets/final-validation-local-thyroid-case-001/dicom/video/`
  - 在 5090 `.venv-model-gateway-gpu` 安装 `pydicom==3.0.2`，用于 DICOM 多帧视频拆帧。
  - 确认 5090 SAM2 video adapter 可用：`ready_video_segmenters = ['sam2-video']`，GPU 为 RTX 5090 32GB。
  - 新增 `scripts/medical-video-sam2-smoke.py`，可将 DICOM 视频拆成帧目录，并调用 model-gateway 的 `thyroid.segment_video_nodule` / `thyroid.measure_video_nodule` 真实 SAM2 视频分割和测量链路。
- 修复 `services/model-gateway/app/segmentation.py` 的 SAM2 视频传播方向：
  - 原实现只从 prompt frame 向后传播；
  - 现改为向后 + 向前双向传播，并按 `frame_index` 排序，避免中帧 prompt 导致前半段视频缺失分割。
- 在 5090 上完成真实 SAM2 视频 smoke：
  - `Q4DDKKO8`：114 帧，prompt frame 57，分割 94 帧，测量产物生成；因缺 PixelSpacing，仅输出像素测量，毫米为空。
  - `Q4DDKKOA`：102 帧，prompt frame 51，分割 53 帧，测量产物生成；因缺 PixelSpacing，仅输出像素测量，毫米为空。
  - 汇总文件：`data/artifacts/reports/video-sam2-smoke-case001-bidirectional/summary.json`。
- 新增 `scripts/medical-video-smoke-import.ts` 和 `npm run medical:video-smoke:import`，用于把 5090 生成的视频 smoke `summary.json` 写入本地 `final_validation_run / final_validation_image_result`，后续可在医生工作台最终验证复核面板 review。
- 已将本次 2 条视频结果写入 `data/artifacts/live-demo-002/data.db`：
  - run_id：`01KRFCEPBS9FVNQEMR8WWCEZ2B`
  - result_id：`01KRFCEPBV0AGBQSWYP588QNMZ`、`01KRFCEPBV7D7ND6EHS79KTR52`
- 结论：
  - 当前具备“视频推理验证”能力；
  - 还不具备监督训练视频权重的条件，因为只有 2 条视频样本，且没有逐帧或关键帧 mask 真值标注。
  - 下一步训练视频权重前，必须让医生提供关键帧/逐帧标注，至少包括 prompt frame bbox/mask、结节轨迹确认和像素标定。

### Validation

- Remote 5090 SAM2 smoke -> OK.
- `python3 -m py_compile scripts/medical-video-sam2-smoke.py` -> OK.
- `python3 -m py_compile services/model-gateway/app/segmentation.py` -> OK.
- `python3 -m unittest services/model-gateway/tests/test_gateway.py` -> 31 tests OK.
- `npm run medical:video-smoke:import -- --data-db data/artifacts/live-demo-002/data.db --summary-json data/artifacts/reports/video-sam2-smoke-case001-bidirectional/summary.json --artifact-root data/artifacts --remote-model-gateway-url http://100.110.127.117:8766` -> OK.
- `git diff --check -- services/model-gateway/app/segmentation.py scripts/medical-video-sam2-smoke.py data/artifacts/reports/video-sam2-smoke-case001-bidirectional/summary.json` -> OK.

## 2026-05-13 09:06 CST - Standalone Dataset Builder Tool

- 按用户要求将“硬盘资料整理工具”设计为独立工具，不依赖 CodeClaw、数据库、前端或模型服务。
- 新增 `dataset-tool/thyroid_dataset_builder.py`：
  - 递归扫描 JPG/JPEG/PNG、LabelMe JSON、DOCX/PDF/TXT/MD/RTF/HTML 报告、普通视频和 DICOM 文件；
  - 支持 `--case-mode auto|first-folder|parent-folder|flat` 与 `--case-regex` 病例分组；
  - 支持 `--copy-mode symlink|copy|hardlink|manifest-only`；
  - 自动从 LabelMe polygon/rectangle 生成 bbox，并输出 `metadata/detection_manifest.jsonl`；
  - 当 LabelMe JSON 含 `imageData` 且源图缺失时，可抽取嵌入图像；
  - 将 `_marked/勾画/overlay` 图标记为 `review_overlay`，只用于医生复核，不作为模型训练输入；
  - 如安装 `pydicom`，可读取 DICOM 元数据；未安装时仍生成基础 manifest，并在 warnings 中标记。
- 新增 `dataset-tool/README.md` 和 `dataset-tool/requirements-optional.txt`。
- 新增单元测试 `dataset-tool/tests/test_thyroid_dataset_builder.py`。
- 用当前 `示例/` 目录完成 smoke：
  - 输出目录：`data/artifacts/datasets/standalone-tool-demo`
  - 识别 2 个 LabelMe 标注、7 个 DICOM、8 张图、1 个 DOCX 报告；
  - 生成 2 条 detection manifest 训练/验证清单；
  - 本机未安装 `pydicom`，DICOM 暂标记为 metadata unavailable。

### Validation

- `python3 -m py_compile dataset-tool/thyroid_dataset_builder.py dataset-tool/tests/test_thyroid_dataset_builder.py` -> OK.
- `python3 -m unittest discover -s dataset-tool/tests` -> 2 tests OK.
- `python3 dataset-tool/thyroid_dataset_builder.py --source-root 示例 --output-dir data/artifacts/datasets/standalone-tool-demo --dataset-id standalone-tool-demo --case-mode flat --copy-mode symlink --overwrite` -> OK.

## 2026-05-13 09:32 CST - Dataset Tool De-identification

- 按用户要求在独立数据集工具中加入默认基础脱敏，源文件保持只读不修改。
- `dataset-tool/thyroid_dataset_builder.py` 新增：
  - `--deidentify basic|off`，默认 `basic`；
  - `--redact-region x1,y1,x2,y2`，支持自定义图片/视频遮盖区域，默认遮盖顶部 16% 和底部 12%；
  - `--sensitive-term` 与 `--sensitive-terms-file`，用于精确替换姓名、身份证号等敏感词；
  - JPG/PNG 使用 Pillow 遮盖区域并保存为脱敏副本；
  - 普通视频使用 ffmpeg 遮盖区域、移除音频和 metadata；
  - TXT/MD/HTML/RTF/JSON 报告做正则脱敏；
  - DOCX 处理 `word/` 和 `docProps/` XML 文本；
  - LabelMe JSON 输出时移除 `imageData`，避免 JSON 中携带原始像素；
  - DICOM 若安装 pydicom 则替换常见患者 tag；像素烧录文字仍标记需进一步处理；
  - 脱敏失败时不再把未脱敏原件复制进数据集目录，只在 manifest/warnings 中记录。
- Manifest 新增 `target_bytes`、`target_sha256`、`deidentified`、`deidentification_status` 字段。
- 更新 `dataset-tool/README.md` 和 `requirements-optional.txt`。
- 用 `示例/` smoke 后，11 个文件成功生成脱敏副本，7 个 DICOM 因本机无 pydicom 标记 `failed_not_materialized`，未复制原始 DICOM 到输出数据集。

### Validation

- `python3 -m py_compile dataset-tool/thyroid_dataset_builder.py dataset-tool/tests/test_thyroid_dataset_builder.py` -> OK.
- `python3 -m unittest discover -s dataset-tool/tests` -> 2 tests OK.
- `python3 dataset-tool/thyroid_dataset_builder.py --source-root 示例 --output-dir data/artifacts/datasets/standalone-tool-demo --dataset-id standalone-tool-demo --case-mode flat --copy-mode symlink --overwrite --sensitive-term 张三` -> OK.
- `git diff --check -- dataset-tool/thyroid_dataset_builder.py dataset-tool/README.md dataset-tool/requirements-optional.txt dataset-tool/tests/test_thyroid_dataset_builder.py PROGRESS_LOG.md` -> OK.

## 2026-05-13 09:58 CST - Dataset Tool Source-Safe Case Linkage

- 按用户澄清，明确数据集工具边界：医院硬盘原始文件只读，不移动、不覆盖、不改名；脱敏后的副本、训练 manifest、病例 manifest 写入新的 `--output-dir` 数据集目录。
- `dataset-tool/thyroid_dataset_builder.py` 新增病例关联能力：
  - `--linkage-mode auto|path|identity`；
  - `--linkage-salt`、`--linkage-salt-file`，也可读取 `THYROID_DATASET_LINKAGE_SALT`；
  - `--include-source-paths`，默认关闭，避免把含姓名/病历号的原始路径写入输出数据集。
- 关联逻辑：
  - 从报告文本、DOCX、DICOM tag、路径日期中提取姓名、病历号、检查号、检查日期、StudyInstanceUID 等字段；
  - 原始身份字段只在内存里用于关联；
  - 从报告/DICOM 提取到的姓名、病历号、检查号等字段会自动作为当前文件的脱敏词，补充手工 `--sensitive-term`；
  - 输出仅写不可逆哈希后的 `patient_key`、`study_key`、`case_id`、`linkage_confidence`、`linkage_evidence`；
  - 缺身份字段时退回目录分组，并写入 warning。
- 新增医学标签清单：
  - `metadata/clinical_labels.jsonl`；
  - `metadata/report_pair_manifest.jsonl`；
  - `metadata/tirads_manifest.jsonl`；
  - `metadata/classification_manifest.jsonl`。
- 收紧脱敏模式：
  - 默认脱敏模式下，不支持安全脱敏的未知格式不再复制或软链进输出数据集；
  - 如果 `--output-dir` 位于 `--source-root` 内部，扫描阶段会跳过输出目录，避免把派生数据再次扫入源数据。

### Validation

- `python3 -m py_compile dataset-tool/thyroid_dataset_builder.py dataset-tool/tests/test_thyroid_dataset_builder.py` -> OK.
- `python3 -m unittest discover -s dataset-tool/tests` -> 3 tests OK.
- `python3 dataset-tool/thyroid_dataset_builder.py --source-root 示例 --output-dir data/artifacts/datasets/standalone-tool-demo --dataset-id standalone-tool-demo --case-mode flat --copy-mode symlink --overwrite --linkage-salt demo-secret` -> OK.
- `rg -n "示例|原始|脱敏|勾画|Q4DD|Q5CJ|张三|姓名" data/artifacts/datasets/standalone-tool-demo/metadata data/artifacts/datasets/standalone-tool-demo/cases || true` -> no hits.
- `git diff --check -- dataset-tool/thyroid_dataset_builder.py dataset-tool/README.md dataset-tool/requirements-optional.txt dataset-tool/tests/test_thyroid_dataset_builder.py PROGRESS_LOG.md` -> OK.

## 2026-05-13 10:34 CST - Dataset Tool GUI and Windows EXE Packaging

- 按用户“没有电脑知识、希望可执行文件自动执行”的要求，新增独立图形界面入口 `dataset-tool/thyroid_dataset_gui.py`：
  - 双击/运行后选择“原始资料文件夹”和“脱敏数据集保存目录”；
  - 默认启用基础脱敏和病例身份关联；
  - 自动在用户配置目录生成 linkage salt，不要求用户手工管理；
  - 默认 `copy_mode=copy`，避免 Windows 软链接权限问题；
  - 运行完成后可一键打开保存目录；
  - 关闭脱敏时会弹窗二次确认。
- 新增 Windows 打包脚本：
  - `dataset-tool/build_windows_exe.ps1`；
  - `dataset-tool/build_windows_exe.bat`；
  - 生成目标为 `dataset-tool/dist/ThyroidDatasetTool.exe`。
- 新增自动运行配置样例 `dataset-tool/dataset_tool_auto_run.example.json`：
  - 复制为 `dataset_tool_auto_run.json` 并放在 EXE 同目录后，可预设源目录、输出目录、数据集名称；
  - `auto_start=true` 时双击 EXE 后自动开始整理。
- 新增 `dataset-tool/README_EXECUTABLE.md`，用非技术人员能照着操作的方式说明 EXE 使用、打包和自动启动配置。

### Validation

- `python3 -m py_compile dataset-tool/thyroid_dataset_builder.py dataset-tool/thyroid_dataset_gui.py dataset-tool/tests/test_thyroid_dataset_builder.py` -> OK.
- `python3 -m unittest discover -s dataset-tool/tests` -> 3 tests OK.
- `git diff --check -- dataset-tool PROGRESS_LOG.md` -> OK.

## 2026-05-13 11:46 CST - Windows Dataset Tool ZIP Package

- 按用户要求生成 Windows 使用压缩包：
  - `data/artifacts/releases/thyroid-dataset-tool-windows.zip`
  - 解压后的目录名：`thyroid-dataset-tool-windows/`
- 压缩包包含：
  - `run_gui_windows.bat`：Windows 双击运行图形界面，自动创建本地 Python 环境并安装依赖；
  - `build_windows_exe.bat` / `build_windows_exe.ps1`：在 Windows 上生成 `dist/ThyroidDatasetTool.exe`；
  - `thyroid_dataset_gui.py`、`thyroid_dataset_builder.py`；
  - `requirements-optional.txt`；
  - `dataset_tool_auto_run.example.json`；
  - `README.md`、`README_EXECUTABLE.md`、`WINDOWS_QUICK_START.txt`。
- 为避免 Windows/终端文件名乱码，压缩包内快速说明文件使用英文文件名 `WINDOWS_QUICK_START.txt`。

### Validation

- `python3 -m py_compile dataset-tool/thyroid_dataset_builder.py dataset-tool/thyroid_dataset_gui.py` -> OK.
- `git diff --check -- dataset-tool PROGRESS_LOG.md` -> OK.
- `unzip -l data/artifacts/releases/thyroid-dataset-tool-windows.zip` -> OK, 10 files.

## 2026-05-13 12:56 CST - Windows Packaging Dependency Fix

- 用户在 Windows 截图反馈 `build_windows_exe.bat` 失败：
  - 当前 Windows Python 是 3.9；
  - 原 `requirements-optional.txt` 使用 `pydicom>=3.0.0`，该版本不支持 Python 3.9；
  - pip 安装中断后 PyInstaller 未安装，因此后续报 `No module named PyInstaller`。
- 修复：
  - `requirements-optional.txt` 改为按 Python 版本选择：
    - Python < 3.10 使用 `pydicom>=2.4.4,<3.0.0`；
    - Python >= 3.10 使用 `pydicom>=3.0.0`。
  - Windows 脚本和说明从“Python 3.11+”改为“Python 3.9+”。
  - `build_windows_exe.ps1` 增加 Python 版本输出，方便远程排错。
  - 重新生成 `data/artifacts/releases/thyroid-dataset-tool-windows.zip`。

### Validation

- `python3 -m py_compile dataset-tool/thyroid_dataset_builder.py dataset-tool/thyroid_dataset_gui.py dataset-tool/tests/test_thyroid_dataset_builder.py` -> OK.
- `python3 -m unittest discover -s dataset-tool/tests` -> 3 tests OK.
- `git diff --check -- dataset-tool PROGRESS_LOG.md` -> OK.
- `unzip -l data/artifacts/releases/thyroid-dataset-tool-windows.zip` -> OK, 10 files.

## 2026-05-13 22:02 CST - Compile and Real Static GPU Smoke

- 编译主项目成功：
  - `npm run build` -> OK；
  - Vite 仅提示前端 chunk 偏大，未阻断构建。
- 确认 5090 model-gateway 可用：
  - `GET /health` -> ready；
  - `GET /model/v1/config/check` -> RF-DETR、YOLOv11、RT-DETR 检测 ready；SAM2 static、nnU-Net tight ROI 分割 ready；SAM2 video ready。
- 新建真实测试库：
  - `data/artifacts/compile-realtest-20260513-215539/data.db`；
  - `data/artifacts/compile-realtest-20260513-215539/rag.db`；
  - migration version: 9，样例知识库 ingest OK。
- 使用 FangDai 最终验证集跑 1 张静态图真实链路：
  - dataset root: `data/artifacts/datasets/fangdai-thyroid-ultrasound-images`；
  - RF-DETR 检测、nnU-Net tight ROI 分割、mask measurement 测量均 succeeded；
  - DB 落库：study 1、image 1、nodule 1、measurement 1、model_job 3、agent_task 4；
  - report 未生成，原因是本次为 image model smoke，不包含医生 TI-RADS 确认和 LLM 报告阶段。
- 远程 artifact 下载校验通过：
  - `overlay.png` HTTP 200，已保存为 `data/artifacts/reports/fangdai-thyroid-ultrasound-images/static-e2e-2026-05-13-135650/overlay-check.png`；
  - `segmentation.json` HTTP 200，已保存为 `data/artifacts/reports/fangdai-thyroid-ultrasound-images/static-e2e-2026-05-13-135650/segmentation-check.json`。

### Validation

- `npm run build` -> OK.
- `npm run medical:init-db -- --data-db data/artifacts/compile-realtest-20260513-215539/data.db --rag-db data/artifacts/compile-realtest-20260513-215539/rag.db --workspace /Users/xutianliang/Downloads/jiazhuangxian --ingest-sample-knowledge` -> OK.
- `JZX_MEDICAL_REAL_INFERENCE=1 npm run medical:final-validation:static -- --data-db data/artifacts/compile-realtest-20260513-215539/data.db --rag-db data/artifacts/compile-realtest-20260513-215539/rag.db --workspace /Users/xutianliang/Downloads/jiazhuangxian --dataset-root data/artifacts/datasets/fangdai-thyroid-ultrasound-images --artifact-root data/artifacts --remote-model-gateway-url http://100.110.127.117:8766 --max-images 1 --max-steps 80` -> OK.

## 2026-05-13 22:28 CST - Main LLM Switch to qwen/qwen3.5-9b

- 按用户要求，将验证版主报告大模型默认从 Qwen3.6 系列切到 `qwen/qwen3.5-9b`：
  - Web 自动运行默认 provider：`lmstudio:qwen35-9b`；
  - 自动演示 Runner 默认 provider：`lmstudio:qwen35-9b`；
  - 默认模型检查目标：`qwen/qwen3.5-9b`；
  - 医生工作台真实演示提示同步改为要求加载 `qwen/qwen3.5-9b`。
- 本机 CodeClaw provider 配置已更新：
  - `lmstudio:default` 指向 `http://100.110.127.117:1234/v1` + `qwen/qwen3.5-9b`；
  - 新增 `lmstudio:qwen35-9b`，用于医疗演示默认 provider。
- 文档同步：
  - `docs/TECHNICAL_DESIGN.md`；
  - `docs/MEDICAL_MCP_SETUP.md`；
  - `docs/LLM_PROVIDER_SETUP_5090.md`；
  - `docs/UI_SMOKE_5090_REMOTE_ARTIFACT_20260511.md`；
  - `docs/MODEL_ARTIFACT_CONVENTIONS.md`。
- 5090 LM Studio 当前状态：
  - `/api/v0/models` 可见 `qwen/qwen3.5-9b`；
  - `state=loaded`；
  - 小 token 预算下该模型会把较多内容写入 `reasoning_content`，正式 JSON 可能被挤掉；provider 配置保持 `maxTokens=10000`，真实报告链路需继续保留较大输出预算。

### Validation

- `npm run typecheck` -> OK.
- `npm run test -- test/unit/medical/agentWorker.test.ts test/unit/channels/web/server.test.ts` -> OK, 71 tests.
- `cd web-react && npm run typecheck` -> OK.
- `cd web-react && npm run test -- src/components/panels/MedicalPanel.test.tsx` -> OK, 28 tests.
- `npm run build` -> OK.
- `curl http://100.110.127.117:1234/api/v0/models` -> `qwen/qwen3.5-9b` loaded.
- `curl http://100.110.127.117:1234/v1/chat/completions` with `model=qwen/qwen3.5-9b`, `max_tokens=1000` -> returned final JSON content.
