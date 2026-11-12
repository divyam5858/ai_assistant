# HirePool × AI Assistant SDK — Three-Role Implementation Status & Matrix
**Date:** November 9, 2026  
**Repositories:** `D:\ai-assistant-plugin` & `D:\talenthub-develop`  
**Classification:** Strictly Read-Only Source Audit & Capability Matrix  

---

## 1. Executive Role Summary

| Role | Total Intended Capabilities | Allowlisted Operations | Fully Verified (Preflight + Staging + Readback + Tests) | Connected But Lacks Preflight / Readback | Blocked by Parser (PATCH/DELETE) | Missing from Role Allowlist (Exists in Backend) |
|---|---|---|---|---|---|---|
| **Candidate** | 11 | 10 (+ Resume Endpoint) | **11** (100%) | 0 | 0 | 0 |
| **Company / Client** | 13 | 13 | **3** (Profile & User Profile) | 7 (Jobs, Applicants, Bulk Status) | 2 (`PATCH` status endpoints) | 1 (`get_candidate_for_client`) |
| **Consultancy / Agency** | 13 | 13 | **3** (Profile & User Profile) | 6 (Candidates, Matching, Submissions) | 1 (`DELETE` candidate) | 2 (`get_candidate`, `search_jobs`) |

---

## 2. Candidate Role Implementation Status

The Candidate role is the most mature role in the integration, encompassing Milestones 2, 2.1, 2.2, 2.3, and 3.

### 2.1 Capability Deep Dive

1. **Candidate Profile Viewing & Updating**:
   - `get_my_profile_api_v1_candidates_profile_get` retrieves current candidate data.
   - `update_my_profile_api_v1_candidates_profile_put` executes preflight profile read, formats field-level changes, stages confirmation, and upon user approval executes `executeAndVerifyProfileUpdate` (`dynamic-api-confirmation.js:54`), reading back the updated profile from FastAPI before returning success.
2. **Job Discovery & Matching**:
   - `search_jobs_api_v1_jobs_search_get` allows open search by keyword, title, location, and department.
   - `get_matching_jobs_api_v1_matching_jobs_get` calls HirePool's matching service, returning matched active jobs with compatibility scores.
   - `get_job_api_v1_jobs__job_id__get` retrieves full job descriptions, skills, and screening prerequisites.
3. **Screening & Application Preflight Readiness**:
   - `get_screening_questions_for_candidate_...` retrieves screening questions.
   - `check_screening_eligibility_...` verifies if the candidate has passed required assessments.
   - When staging `create_application_api_v1_applications_post`, `prepareHirePoolAction` (`local-development.js:255-320`) executes a 5-step preflight inspection:
     1. Asserts target job exists and status is `active`.
     2. Asserts candidate profile completeness.
     3. Checks existing applications to prevent duplicate submissions.
     4. Verifies screening question configuration.
     5. Verifies candidate screening eligibility score.
4. **Application Submission & Destructive Withdrawal**:
   - Upon confirmation, `create_application` executes POST, confirms `id` and `status`, and updates `sessionManager` workflow state to `APPLICATION_SUBMITTED`.
   - `withdraw_application_api_v1_applications__application_id__withdraw_post` reads application history first, asserts the application belongs to the candidate, verifies it is not already withdrawn, and requires explicit confirmation.
5. **Resume Upload (Milestone 3)**:
   - Implemented via dedicated endpoint `POST /api/hirepool/resume/prepare`.
   - Validates `%PDF-` magic bytes, enforces 5MB limit, computes SHA-256 hash.
   - Requires explicit confirmation via `/confirm`.
   - Dispatches multipart upload to FastAPI `POST /api/v1/candidates/resume` and reads back profile to verify `resume_url`.

---

## 3. Company / Client Role Implementation Status

### 3.1 Capability Deep Dive

1. **Company & User Identity**:
   - `get_my_company_profile_...` and `get_my_user_profile_...` are allowlisted and tested.
   - `update_company_profile_...` and `update_my_user_profile_...` are review-staged and readback-verified.
2. **Job Postings Management**:
   - `get_my_jobs_api_v1_jobs_my_jobs_get` lists jobs posted by the authenticated company.
   - `create_job_api_v1_jobs_post` stages a review card summarizing title, location, type, and skills. **Gap**: Staging does not verify company profile status, and execution lacks post-write readback.
   - `update_job_api_v1_jobs__job_id__put` stages a review card with requested updates. Can update title, description, skills, salary, and `status`. **Gap**: Staging does not verify that the target job belongs to this company (`membership.client_id`).
   - `update_job_status_api_v1_jobs__job_id__status_patch` (`PATCH /api/v1/jobs/{job_id}/status`): **Blocked by SDK OpenAPI parser** (`dynamic-api/openapi.js:377`).
3. **Applicant & Pipeline Management**:
   - `get_job_applications_api_v1_applications_job__job_id__get` retrieves applications for a specific job.
   - `get_client_applications_api_v1_applications_for_client_get` retrieves all authorized company applications. Supports pipeline stage filtering via query params (`status=applied`, `status=interview_scheduled`, etc.).
   - `get_candidate_for_client_api_v1_clients_candidates__candidate_id__get`: **Exists in backend (`clients.py:1201`), but omitted from `roleOperationIds.client` in `local-development.js`**. The company assistant cannot inspect an applicant's complete profile.
   - `get_matching_candidates_api_v1_matching_candidates__job_id__get`: Retrieves algorithmic match scores for candidate applicants.
   - `bulk_update_status_api_v1_applications_bulk_status_post`: Stages review card for status transitions (shortlisted, rejected, etc.). **Gap**: Lacks company ownership preflight and post-write readback.
   - `update_application_status_...` (`PATCH /api/v1/applications/{application_id}/status`): Dedicated single-application status and recruiter notes route is **blocked by SDK OpenAPI parser** (`PATCH` not supported).
4. **Dashboard Metrics**:
   - `get_dashboard_stats_api_v1_clients_dashboard_get` retrieves counts of active jobs, pending reviews, scheduled interviews, and placements.

---

## 4. Consultancy / Agency Role Implementation Status

### 4.1 Capability Deep Dive

1. **Consultancy Identity & Profile**:
   - `get_my_consultancy_profile_...` and `get_my_user_profile_...` are allowlisted.
   - Updates are review-staged and readback-verified.
2. **Agency Candidate Pool Management**:
   - `list_candidates_api_v1_consultancies_candidates_get` lists candidates owned by the consultancy.
   - `add_candidate_api_v1_consultancies_candidates_post` stages review card for candidate creation. **Gap**: Does not perform preflight check against existing candidates to detect duplicate email or phone numbers before staging.
   - `update_candidate_api_v1_consultancies_candidates__candidate_id__put` stages review card for candidate updates. **Gap**: Does not pre-verify that candidate belongs to the consultancy.
   - `get_candidate_api_v1_consultancies_candidates__candidate_id__get`: **Exists in backend (`consultancies.py:1816`), but omitted from `roleOperationIds.consultancy` in `local-development.js`**. The agency assistant cannot retrieve an individual candidate's full profile.
   - `delete_candidate_...` (`DELETE /api/v1/consultancies/candidates/{candidate_id}`): **Blocked by SDK OpenAPI parser** (`DELETE` not supported).
3. **Job Discovery & Matching**:
   - **Gap**: `search_jobs_api_v1_jobs_search_get` (`GET /api/v1/jobs/search`) was **omitted from `roleOperationIds.consultancy`**. The consultancy assistant cannot discover active jobs on the platform.
   - `get_matching_candidates_for_job_api_v1_consultancies_candidates_matching_get` takes `job_id` and calculates match scores for consultancy candidates.
4. **Candidate Submissions & Tracking**:
   - `bulk_submit_consultancy_candidates_api_v1_applications_consultancy_submit_post` stages review card with proposed candidate IDs and job ID. **Gap**: Does not verify candidate ownership, active job status, or duplicate prior submissions during staging. Lacks post-write readback.
   - `get_consultancy_submissions_api_v1_applications_for_consultancy_get` retrieves submission history and statuses.
5. **Placements & Dashboard**:
   - `get_placements_api_v1_consultancies_placements_get` lists finalized placements.
   - `get_placement_stats_api_v1_consultancies_placements_stats_get` retrieves commission and fee analytics.
   - `get_dashboard_stats_api_v1_consultancies_dashboard_get` retrieves agency metrics.

---

## 5. Master Operation-Level Implementation Matrix

The matrix below audits all 39 relevant platform operations across all three roles.

| # | Operation Description | FastAPI Backend Route | OpenAPI Operation ID | Spec Present | Parser Status | Global Allowlist | Role Allowlist | Staged Review | Readback Verified | Test Status | Classification Tag |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Candidate Role** |
| 1 | View Profile | `GET /api/v1/candidates/profile` | `get_my_profile_api_v1_candidates_profile_get` | Yes | Accepted | Yes | Candidate | N/A (Read) | N/A | Mock (Test 21) | **Verified** |
| 2 | Update Profile | `PUT /api/v1/candidates/profile` | `update_my_profile_api_v1_candidates_profile_put` | Yes | Accepted | Yes | Candidate | Yes (`prepareHirePoolAction`) | Yes (`executeAndVerifyProfileUpdate`) | Mock (Test 22) | **Verified** |
| 3 | Search Jobs | `GET /api/v1/jobs/search` | `search_jobs_api_v1_jobs_search_get` | Yes | Accepted | Yes | Candidate | N/A (Read) | N/A | Mock (Test 24) | **Verified** |
| 4 | Intelligent Matching | `GET /api/v1/matching/jobs` | `get_matching_jobs_api_v1_matching_jobs_get` | Yes | Accepted | Yes | Candidate | N/A (Read) | N/A | Mock (Test 25) | **Verified** |
| 5 | View Job Details | `GET /api/v1/jobs/{job_id}` | `get_job_api_v1_jobs__job_id__get` | Yes | Accepted | Yes | Candidate, Client | N/A (Read) | N/A | Mock (Test 17) | **Verified** |
| 6 | Get Screening Questions | `GET /api/v1/jobs/{job_id}/screening-questions/candidate` | `get_screening_questions_for_candidate_...` | Yes | Accepted | Yes | Candidate | N/A (Read) | N/A | Mock (Test 27) | **Verified** |
| 7 | Check Screening Eligibility | `GET /api/v1/applications/screening/eligibility/{job_id}` | `check_screening_eligibility_...` | Yes | Accepted | Yes | Candidate | N/A (Read) | N/A | Mock (Test 28) | **Verified** |
| 8 | Application History | `GET /api/v1/applications/my-applications` | `get_my_applications_api_v1_applications_my_applications_get` | Yes | Accepted | Yes | Candidate | N/A (Read) | N/A | Mock (Test 19) | **Verified** |
| 9 | Submit Application | `POST /api/v1/applications` | `create_application_api_v1_applications_post` | Yes | Accepted | Yes | Candidate | Yes (5 Preflights) | Yes (`data.id` & `status`) | Mock (Test 17) | **Verified** |
| 10 | Withdraw Application | `POST /api/v1/applications/{application_id}/withdraw` | `withdraw_application_...` | Yes | Accepted | Yes | Candidate | Yes (History Preflight) | Yes (`data.message`) | Mock (Test 19) | **Verified** |
| 11 | Resume Upload (M3) | `POST /api/v1/candidates/resume` | N/A (Dedicated SDK Endpoint) | N/A | Accepted | Yes | Candidate | Yes (`%PDF-`, 5MB) | Yes (`get_my_profile`) | Mock (Test 30-36) | **Verified** |
| **Company / Client Role** |
| 12 | View Company Profile | `GET /api/v1/clients/profile` | `get_my_company_profile_api_v1_clients_profile_get` | Yes | Accepted | Yes | Client | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 13 | Update Company Profile | `PUT /api/v1/clients/profile` | `update_company_profile_api_v1_clients_profile_put` | Yes | Accepted | Yes | Client | Yes (`prepareHirePoolAction`) | Yes (`executeAndVerifyProfileUpdate`) | Mock-Only | **Verified** |
| 14 | View Client User Profile | `GET /api/v1/clients/me` | `get_my_user_profile_api_v1_clients_me_get` | Yes | Accepted | Yes | Client | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 15 | Update Client User Profile | `PUT /api/v1/clients/me` | `update_my_user_profile_api_v1_clients_me_put` | Yes | Accepted | Yes | Client | Yes (`prepareHirePoolAction`) | Yes (`executeAndVerifyProfileUpdate`) | Mock-Only | **Verified** |
| 16 | Company Dashboard Stats | `GET /api/v1/clients/dashboard` | `get_dashboard_stats_api_v1_clients_dashboard_get` | Yes | Accepted | Yes | Client | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 17 | List Company Jobs | `GET /api/v1/jobs/my-jobs` | `get_my_jobs_api_v1_jobs_my_jobs_get` | Yes | Accepted | Yes | Client | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 18 | Create Job | `POST /api/v1/jobs` | `create_job_api_v1_jobs_post` | Yes | Accepted | Yes | Client | Yes (No Preflight) | No Readback | None | **Connected Not Executable** |
| 19 | Update Job | `PUT /api/v1/jobs/{job_id}` | `update_job_api_v1_jobs__job_id__put` | Yes | Accepted | Yes | Client | Yes (No Ownership Preflight) | No Readback | None | **Connected Not Executable** |
| 20 | Update Job Status | `PATCH /api/v1/jobs/{job_id}/status` | `update_job_status_...` | Yes | **Rejected (PATCH)** | No | None | No | No | None | **Blocked** |
| 21 | List Job Applications | `GET /api/v1/applications/job/{job_id}` | `get_job_applications_...` | Yes | Accepted | Yes | Client | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 22 | List Client Applications | `GET /api/v1/applications/for-client` | `get_client_applications_...` | Yes | Accepted | Yes | Client | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 23 | View Applicant Details | `GET /api/v1/clients/candidates/{candidate_id}` | `get_candidate_for_client_...` | Yes | Accepted | No | **Omitted** | No | No | None | **Missing** |
| 24 | Matching Candidates | `GET /api/v1/matching/candidates/{job_id}` | `get_matching_candidates_...` | Yes | Accepted | Yes | Client | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 25 | Bulk Update App Status | `POST /api/v1/applications/bulk-status` | `bulk_update_status_...` | Yes | Accepted | Yes | Client | Yes (No Preflight) | No Readback | None | **Connected Not Executable** |
| 26 | Single App Status & Notes | `PATCH /api/v1/applications/{application_id}/status` | `update_application_status_...` | Yes | **Rejected (PATCH)** | No | None | No | No | None | **Blocked** |
| **Consultancy / Agency Role** |
| 27 | View Agency Profile | `GET /api/v1/consultancies/profile` | `get_my_consultancy_profile_...` | Yes | Accepted | Yes | Consultancy | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 28 | Update Agency Profile | `PUT /api/v1/consultancies/profile` | `update_consultancy_profile_...` | Yes | Accepted | Yes | Consultancy | Yes (`prepareHirePoolAction`) | Yes (`executeAndVerifyProfileUpdate`) | Mock-Only | **Verified** |
| 29 | View Agency User Profile | `GET /api/v1/consultancies/me` | `get_my_user_profile_api_v1_consultancies_me_get` | Yes | Accepted | Yes | Consultancy | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 30 | Update Agency User Profile | `PUT /api/v1/consultancies/me` | `update_my_user_profile_api_v1_consultancies_me_put` | Yes | Accepted | Yes | Consultancy | Yes (`prepareHirePoolAction`) | Yes (`executeAndVerifyProfileUpdate`) | Mock-Only | **Verified** |
| 31 | Agency Dashboard Stats | `GET /api/v1/consultancies/dashboard` | `get_dashboard_stats_...` | Yes | Accepted | Yes | Consultancy | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 32 | List Agency Candidates | `GET /api/v1/consultancies/candidates` | `list_candidates_...` | Yes | Accepted | Yes | Consultancy | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 33 | Create Agency Candidate | `POST /api/v1/consultancies/candidates` | `add_candidate_...` | Yes | Accepted | Yes | Consultancy | Yes (No Duplicate Preflight) | No Readback | None | **Connected Not Executable** |
| 34 | Update Agency Candidate | `PUT /api/v1/consultancies/candidates/{candidate_id}` | `update_candidate_...` | Yes | Accepted | Yes | Consultancy | Yes (No Ownership Preflight) | No Readback | None | **Connected Not Executable** |
| 35 | View Candidate Details | `GET /api/v1/consultancies/candidates/{candidate_id}` | `get_candidate_...` | Yes | Accepted | No | **Omitted** | No | No | None | **Missing** |
| 36 | Delete Candidate | `DELETE /api/v1/consultancies/candidates/{candidate_id}` | `delete_candidate_...` | Yes | **Rejected (DELETE)** | No | None | No | No | None | **Blocked** |
| 37 | Discover Active Jobs | `GET /api/v1/jobs/search` | `search_jobs_api_v1_jobs_search_get` | Yes | Accepted | Yes | **Omitted** | N/A (Read) | N/A | None | **Missing** |
| 38 | Match Agency Candidates | `GET /api/v1/consultancies/candidates/matching` | `get_matching_candidates_for_job_...` | Yes | Accepted | Yes | Consultancy | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 39 | Bulk Submit Candidates | `POST /api/v1/applications/consultancy-submit` | `bulk_submit_consultancy_candidates_...` | Yes | Accepted | Yes | Consultancy | Yes (No Preflight) | No Readback | None | **Connected Not Executable** |
| 40 | Agency Submissions List | `GET /api/v1/applications/for-consultancy` | `get_consultancy_submissions_...` | Yes | Accepted | Yes | Consultancy | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 41 | List Placements | `GET /api/v1/consultancies/placements` | `get_placements_...` | Yes | Accepted | Yes | Consultancy | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
| 42 | Placement Analytics | `GET /api/v1/consultancies/placements/stats` | `get_placement_stats_...` | Yes | Accepted | Yes | Consultancy | N/A (Read) | N/A | Mock-Only | **Mock-Only** |
