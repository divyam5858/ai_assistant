# HirePool Role-Based Onboarding Field Matrix

**Repository**: `D:\ai-assistant-plugin`  
**Target Platform Reference**: `D:\talenthub-develop`  
**Scope**: Field Definitions, Validation Constraints, Schemas, and UI Renderers for Candidate, Client, and Consultancy  
**Date**: November 2026  
**Status**: AUDITED, SPECIFIED & VERIFIED  

---

## 1. Overview

HirePool enforces strict role-based separation of data models. When a user completes email verification, their account exists as an uninitialized shell (`is_verified: true`, but without an associated role profile). 

Before the user can execute role-specific actions (e.g., applying to jobs, posting vacancies, managing client pipelines), they must complete their role profile.

This matrix documents every field required by HirePool's FastAPI backend for all three user roles, the corresponding validation rules, UI controls presented in the chat widget, and sanitization transformations.

---

## 2. Comprehensive Field Matrix

| Field Key | Role | Type | Status | HirePool API Constraint | Widget Chat Input Type | Transformation / Normalization |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `first_name` | Candidate | String | **Mandatory** | `min_length=1, max_length=100` | Text input | `trim()` |
| `last_name` | Candidate | String | **Mandatory** | `min_length=1, max_length=100` | Text input | `trim()` |
| `current_location` | Candidate | String | **Mandatory** | `min_length=2, max_length=150` | Text input (City, Country) | `trim()` |
| `job_title` | Candidate | String | **Mandatory** | `min_length=2, max_length=150` | Text input | `trim()` |
| `years_of_experience` | Candidate | Number | Optional | `ge=0, le=70` | Numeric input | `parseFloat()` or `0` |
| `skills` | Candidate | Array/CSV | Optional | Array of strings | Comma-separated text | String to trimmed array |
| `bio` | Candidate | String | Optional | `max_length=2000` | Textarea | `trim()` |
| `desired_salary` | Candidate | String | Optional | `max_length=100` | Text input | `trim()` |
| `portfolio_url` | Candidate | URL | Optional | Valid URL syntax | URL input | Prefixes `https://` if bare domain |
| `linkedin_url` | Candidate | URL | Optional | Valid URL syntax | URL input | Prefixes `https://` if bare domain |
| `company_name` | Client | String | **Mandatory** | `min_length=2, max_length=200` | Text input | `trim()` |
| `industry` | Client | String | **Mandatory** | `min_length=2, max_length=100` | Text input / Dropdown | `trim()` |
| `company_size` | Client | String | **Mandatory** | `1-10`, `11-50`, `51-200`, `201-500`, `501-1000`, `1000+` | Select dropdown | Maps to enum value |
| `headquarters_location` | Client | String | **Mandatory** | `min_length=2, max_length=150` | Text input (City, Country) | `trim()` |
| `primary_contact.full_name` | Client | String | **Mandatory** | `min_length=2, max_length=150` | Text input | `trim()` -> nested under `primary_contact` |
| `company_description` | Client | String | Optional | `max_length=3000` | Textarea | `trim()` |
| `website_url` | Client | URL | Optional | Valid URL syntax | URL input | Prefixes `https://` if bare domain |
| `billing_address` | Client | String | Optional | `max_length=500` | Textarea | `trim()` |
| `primary_contact.email` | Client | Email | Optional | Valid email syntax | Email input | Lowercase, `trim()` |
| `primary_contact.phone` | Client | String | Optional | `max_length=30` | Phone input | Numeric and symbol filter |
| `primary_contact.designation` | Client | String | Optional | `max_length=100` | Text input | `trim()` |
| `consultancy_name` | Consultancy | String | **Mandatory** | `min_length=2, max_length=200` | Text input | `trim()` |
| `consultancy_type` | Consultancy | String | **Mandatory** | `"recruitment"` or `"staffing"` | Radio / Select | Exact enum string matching |
| `industry_specialization` | Consultancy | String | **Mandatory** | `min_length=2, max_length=200` | Text input | `trim()` |
| `headquarters_location` | Consultancy | String | **Mandatory** | `min_length=2, max_length=150` | Text input (City, Country) | `trim()` |
| `primary_contact.full_name` | Consultancy | String | **Mandatory** | `min_length=2, max_length=150` | Text input | `trim()` -> nested under `primary_contact` |
| `description` | Consultancy | String | Optional | `max_length=3000` | Textarea | `trim()` |
| `website_url` | Consultancy | URL | Optional | Valid URL syntax | URL input | Prefixes `https://` if bare domain |
| `services_offered` | Consultancy | Array/CSV | Optional | Array of strings | Comma-separated text | String to trimmed array |
| `primary_contact.email` | Consultancy | Email | Optional | Valid email syntax | Email input | Lowercase, `trim()` |
| `primary_contact.phone` | Consultancy | String | Optional | `max_length=30` | Phone input | Numeric and symbol filter |
| `primary_contact.designation` | Consultancy | String | Optional | `max_length=100` | Text input | `trim()` |

---

## 3. Role-by-Role Profile Specifications

### 3.1 Candidate Profile

- **Creation Endpoint**: `POST /api/v1/candidates/profile`
- **Readback Endpoint**: `GET /api/v1/candidates/profile`
- **Authentication**: Bearer JWT (`Authorization: Bearer <access_token>`)
- **Required JSON Payload**:
  ```json
  {
    "first_name": "Jane",
    "last_name": "Doe",
    "current_location": "San Francisco, CA",
    "job_title": "Senior Frontend Engineer",
    "years_of_experience": 6,
    "skills": ["JavaScript", "TypeScript", "React", "Node.js"],
    "bio": "Specializing in high-performance web applications and conversational interfaces."
  }
  ```

#### Validation Implementation in SDK Router
```javascript
function validateCandidateProfile(profile) {
  const missing = [];
  if (!profile.first_name?.trim()) missing.push('first_name');
  if (!profile.last_name?.trim()) missing.push('last_name');
  if (!profile.current_location?.trim()) missing.push('current_location');
  if (!profile.job_title?.trim()) missing.push('job_title');
  return { isValid: missing.length === 0, missingFields: missing };
}
```

---

### 3.2 Company / Client Profile

- **Creation Endpoint**: `POST /api/v1/clients/profile`
- **Readback Endpoint**: `GET /api/v1/clients/profile`
- **Authentication**: Bearer JWT (`Authorization: Bearer <access_token>`)
- **Required JSON Payload**:
  ```json
  {
    "company_name": "Apex Innovations Inc",
    "industry": "Enterprise Software",
    "company_size": "51-200",
    "headquarters_location": "New York, NY",
    "primary_contact": {
      "full_name": "Alex Mercer",
      "designation": "Head of People",
      "email": "alex.mercer@apexinnovations.com",
      "phone": "+1-555-019-2834"
    },
    "company_description": "Building cloud infrastructure software for modern teams."
  }
  ```

#### Nested Field Normalization
In the chat UI, the primary contact's details are collected via dedicated fields (`contact_name`, `contact_designation`, `contact_email`, `contact_phone`). The SDK automatically transforms flat input into the nested `primary_contact` dictionary before dispatching to the HirePool API:
```javascript
function normalizeClientPayload(raw) {
  return {
    company_name: raw.company_name?.trim(),
    industry: raw.industry?.trim(),
    company_size: raw.company_size || '11-50',
    headquarters_location: raw.headquarters_location?.trim(),
    company_description: raw.company_description?.trim() || '',
    website_url: raw.website_url?.trim() || undefined,
    primary_contact: {
      full_name: (raw.contact_name || raw.primary_contact?.full_name || '').trim(),
      designation: (raw.contact_designation || raw.primary_contact?.designation || '').trim(),
      email: (raw.contact_email || raw.primary_contact?.email || '').trim(),
      phone: (raw.contact_phone || raw.primary_contact?.phone || '').trim(),
    }
  };
}
```

---

### 3.3 Consultancy / Agency Profile

- **Creation Endpoint**: `POST /api/v1/consultancies/profile`
- **Readback Endpoint**: `GET /api/v1/consultancies/profile`
- **Authentication**: Bearer JWT (`Authorization: Bearer <access_token>`)
- **Required JSON Payload**:
  ```json
  {
    "consultancy_name": "TalentBridge Advisory Partners",
    "consultancy_type": "recruitment",
    "industry_specialization": "Information Technology & AI",
    "headquarters_location": "Chicago, IL",
    "primary_contact": {
      "full_name": "Sarah Jenkins",
      "designation": "Managing Director",
      "email": "s.jenkins@talentbridge.com",
      "phone": "+1-555-014-9988"
    },
    "description": "Executive recruitment and specialized talent placement."
  }
  ```

#### Enumeration Enforcement
The `consultancy_type` field must be strictly either `"recruitment"` or `"staffing"`. Values such as `"agency"`, `"headhunting"`, or `"consulting"` are rejected by the backend validator:
```javascript
function validateConsultancyType(type) {
  const normalized = (type || '').toLowerCase().trim();
  if (normalized !== 'recruitment' && normalized !== 'staffing') {
    return 'recruitment'; // default fallback to valid enum
  }
  return normalized;
}
```

---

## 4. In-Chat Interactive Collection Flow

The collection workflow balances thoroughness with user experience:

1. **Card Presentation**: The user is presented with the role-specific input card containing inputs for the mandatory and high-priority optional fields.
2. **Real-time Client Validation**: The submit button enables only when all required inputs contain non-empty, valid values.
3. **Draft Review Card**: Prior to final submission, the assistant displays a structured review card summarizing the user's data:
   - Table of fields and entered values.
   - "Confirm & Complete" button dispatches the profile creation request.
   - "Edit Profile" button allows modifying any field without losing state.
4. **Backend Post-Write Readback**: Once HirePool acknowledges the creation with HTTP 201/200, the SDK performs a verification GET request against the profile endpoint to ensure data persistence before declaring the session ready.
