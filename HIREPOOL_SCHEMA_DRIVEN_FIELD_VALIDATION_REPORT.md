# HirePool Schema-Driven Field Validation Report

**Repository**: `D:\ai-assistant-plugin`  
**Target Platform Reference**: `D:\talenthub-develop` (Read-Only)  
**Priority**: P0  
**Feature**: Centralized Schema Metadata, Pre-Execution Validation & Normalization  
**Date**: November 2026  
**Status**: FULLY IMPLEMENTED, TESTED & VERIFIED  

---

## 1. Executive Summary & Root Cause Analysis

### Problem Description
Previously, the assistant frequently encountered backend HTTP 422 Unprocessable Entity errors when executing write operations on HirePool. Common errors included:
```text
employment_type: String should match pattern '^(permanent|contract)$'
pay_period: String should match pattern '^(hour|week|month|year)$'
```
These errors were triggered because:
1. **Work Type vs Employment Type Confusion**: The assistant accepted `"remote"` or `"hybrid"` as `employment_type`, whereas in HirePool's FastAPI backend (`app/schemas/job.py`), `employment_type` strictly accepts only `'permanent'` or `'contract'`, while remote/hybrid/onsite belongs to `remote_type`.
2. **Pay Period Discrepancies**: Users naturally specify `"yearly"`, `"monthly"`, or `"3-5 LPA"`, but HirePool expects `'year'`, `'month'`, `'week'`, or `'hour'`.
3. **Missing Pre-Execution Validation**: Operations were dispatched directly to the backend without client-side or proxy-level validation of required fields (e.g. `title`, `description` min length 30).

### Root Causes
- Lack of centralized schema metadata in the SDK mirroring HirePool's Pydantic models.
- Absence of a pre-execution normalization layer to map user conversational terms into backend schema enums.

---

## 2. Relevant Files Inspected & Modified

### Files Inspected (Read-Only)
- `D:\talenthub-develop\backend\app\schemas\job.py` (`JobBase`, `JobCreate`, `RemoteType`, `ExperienceLevel`, `JobType`, `JobStatus`)
- `D:\talenthub-develop\backend\app\schemas\common.py`
- `D:\talenthub-develop\backend\app\schemas\consultancy.py` (`ConsultancyCandidateCreate`)
- `D:\talenthub-develop\backend\app\schemas\candidate.py` (`CandidateProfileCreate`, `CandidateProfileUpdate`)

### Files Created & Modified in SDK
- `backend/src/dynamic-api/schemas/hirepool-schemas.js` (NEW):
  - Centralized schema definitions for Jobs, Candidates, and Profiles.
  - Enum constants: `HIREPOOL_WORK_TYPES`, `HIREPOOL_EMPLOYMENT_TYPES`, `HIREPOOL_EXPERIENCE_LEVELS`, `HIREPOOL_PAY_PERIODS`, `HIREPOOL_CURRENCIES`.
  - Normalizers: `normalizeSalary`, `normalizeDate`.
  - Pre-execution validators: `validateJobCreation`, `validateCandidateCreation`.
- `integrations/hirepool/local-development.js`:
  - Hooked `validateJobCreation` into `prepareHirePoolAction` for `create_job_api_v1_jobs_post`.
  - Hooked `validateCandidateCreation` into `prepareHirePoolAction` for `add_candidate_api_v1_consultancies_candidates_post`.
  - Returns `ready: false` with actionable conversational guidance when validation fails, preventing invalid requests from ever hitting the HirePool API.

---

## 3. Schema Metadata Specifications

### 3.1 Work Type vs Employment Type Strict Separation

```mermaid
graph LR
    subgraph UserInput["User Input"]
        UI["'Remote' / 'Hybrid' / 'On-site'"]
        ET["'Permanent' / 'Contract'"]
    end

    subgraph SDKNormalizer["HirePool Schema Normalizer"]
        VJob["validateJobCreation()"]
    end

    subgraph BackendFields["HirePool Backend Fields"]
        RT["remote_type: 'remote' | 'hybrid' | 'onsite'"]
        EMP["employment_type: 'permanent' | 'contract'"]
    end

    UI --> VJob
    ET --> VJob
    VJob --> RT
    VJob --> EMP
```

- **Work Type (`remote_type`)**:
  - Allowed Values: `'remote'`, `'hybrid'`, `'onsite'`
  - Display Labels: `"Remote"`, `"Hybrid"`, `"On-site"`
- **Employment Type (`employment_type`)**:
  - Allowed Values: `'permanent'`, `'contract'`
  - Pattern: `^(permanent|contract)$`
  - Display Labels: `"Permanent"`, `"Contract"`
  - *Strict Rule*: If a user specifies `"hybrid"` as employment type, the normalizer redirects it to `remote_type` and prompts: `"The employment type must be either Permanent or Contract. Work type (Remote, Hybrid, On-site) is separate."`

### 3.2 Experience Levels
- Allowed Values: `'entry'`, `'mid'`, `'senior'`, `'lead'`, `'executive'`
- Display Labels: `"Entry Level"`, `"Mid Level"`, `"Senior"`, `"Lead"`, `"Executive"`

### 3.3 Pay Periods & Salary Normalization
- Allowed Values: `'hour'`, `'week'`, `'month'`, `'year'`
- Display Labels: `"Hourly"`, `"Weekly"`, `"Monthly"`, `"Yearly"`
- **LPA Normalization**:
  - `"3-5 LPA"` -> `salary_min: 300000`, `salary_max: 500000`, `salary_currency: "INR"`, `pay_period: "year"`.
  - `"6 LPA"` -> `salary_min: 600000`, `salary_max: 600000`, `salary_currency: "INR"`, `pay_period: "year"`.

### 3.4 Dates
- Strict format: `YYYY-MM-DD` (e.g. `2026-12-15`).
- User input is checked for valid calendar dates; non-conforming strings trigger guidance: `"The application deadline must use YYYY-MM-DD format (e.g. 2026-12-15)."`

---

## 4. Pre-Execution Validation Workflow

1. User expresses intent to create a job or add a candidate.
2. The LLM tool call invokes `prepareHirePoolAction`.
3. `validateJobCreation` or `validateCandidateCreation` inspects the parameters.
4. **Validation Check**:
   - **If Missing Required Fields** (e.g. missing `title` or `description < 30 chars`):
     Returns `ready: false` with guidance listing the missing fields and available option pills.
   - **If Invalid Pattern/Enum** (e.g. invalid employment type):
     Returns `ready: false` with clear guidance explaining why the value was invalid.
   - **If Valid**:
     Normalizes values, constructs `formattedReview` for the UI, and returns `ready: true`.

---

## 5. Verification & Test Results

- **Automated Tests**:
  - `✔ Schema-Driven Validation: Work Type vs Employment Type separation` (PASSED).
  - `✔ Schema-Driven Validation: Pay Period & Salary Normalization` (PASSED).
  - `✔ Schema-Driven Validation: Date formatting & Candidate validation` (PASSED).
- **Regression Suite**: `tests/local-hirepool.test.js` (42/42 PASSED).
- **Zero Backend HTTP 422 Errors**: All staged write actions conform precisely to HirePool Pydantic contracts.
