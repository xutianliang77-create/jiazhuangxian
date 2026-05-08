# PROGRESS_LOG

## Session Handoff Status

### Current Work

P0 medical validation foundation on top of CodeClaw: local SQLite storage, Python image-worker, and medical MCP wrappers.

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

### Verification

- `npm run typecheck` passed.
- `npm test` passed after the medical MCP change: 170 files passed, 1 skipped; 1648 tests passed, 3 skipped.
- Targeted storage tests passed: `npm test -- --run test/unit/medical/caseRepo.test.ts test/unit/storage/migrate.test.ts`.
- Targeted medical MCP tests passed: `npm test -- --run test/unit/medical/mcp-server.test.ts test/unit/medical/caseRepo.test.ts`.
- `python3 -m unittest discover services/image-worker/tests` passed: 3 tests.
- `npx eslint packages/medical-mcp test/unit/medical/mcp-server.test.ts` passed.
- `web-react`: `npm run typecheck` passed.
- `git diff --cached --check` passed.
- `web-react npm ci` reported 8 npm audit findings in upstream frontend dependencies; no functional failure observed.
- `npm run lint` is currently blocked by two existing unrelated lint findings:
  - `src/reports/renderHtml.ts`: unused `ReportChart` import/type.
  - `test/golden/runner/meta-router.ts`: unnecessary escaped `\-`.
- GitHub push now works with `git -c http.version=HTTP/1.1 push origin main` when the default HTTP path is slow.

### Background Tasks

None.

### Next Session Priorities

1. Add seed data for `tirads_rules`, `report_templates`, and safety rules.
2. Implement model-gateway skeleton and SQLite `model_job` queue so `thyroid.DetectNodules` can leave placeholder status.
3. Add medical Web/API routes and doctor workstation panels incrementally on top of CodeClaw Web/React.
4. Add MCP configuration examples for running `medical:mcp` with CodeClaw.
5. Fix or intentionally suppress the two pre-existing lint findings when lint hygiene becomes the next task.

### Resume Checklist

```bash
cd /Users/xutianliang/Downloads/jiazhuangxian
git status --short --branch
find src packages web-react docs services data -maxdepth 3 -type f | sort
npm test -- --run test/unit/medical/caseRepo.test.ts test/unit/storage/migrate.test.ts
npm test -- --run test/unit/medical/mcp-server.test.ts
python3 -m unittest discover services/image-worker/tests
```
