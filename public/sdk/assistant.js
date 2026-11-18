var AssistantSDKBundle = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // widget/src/sdk.js
  var sdk_exports = {};
  __export(sdk_exports, {
    default: () => sdk_default
  });

  // widget/src/markdown.js
  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function parseMarkdown(text) {
    if (!text) return "";
    const textWithoutAction = text.replace(/```(?:action:[a-zA-Z0-9_-]+|action)\s*\n[\s\S]*?\n```/gi, "").trim();
    let md = escapeHtml(textWithoutAction);
    md = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const langLabel = lang ? `<span class="code-lang">${lang}</span>` : "";
      return `<div class="code-block-wrapper">
      <div class="code-header">
        ${langLabel}
        <button class="copy-code-btn" type="button" aria-label="Copy code block">Copy</button>
      </div>
      <pre><code>${code.trim()}</code></pre>
    </div>`;
    });
    md = md.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    md = md.replace(/^### (.*$)/gim, "<h4>$1</h4>");
    md = md.replace(/^## (.*$)/gim, "<h3>$1</h3>");
    md = md.replace(/^# (.*$)/gim, "<h2>$1</h2>");
    md = md.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    md = md.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    md = md.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    md = md.replace(/_([^_]+)_/g, "<em>$1</em>");
    md = md.replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>");
    md = md.replace(/^\s*[-*+]\s+(.*)$/gim, "<li>$1</li>");
    md = md.replace(/(<li>.*<\/li>)/gims, (match) => {
      return `<ul>${match}</ul>`;
    });
    md = md.replace(/<\/ul>\s*<ul>/g, "");
    md = md.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    const paragraphs = md.split(/\n{2,}/);
    const formatted = paragraphs.map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      if (/^<(h[1-4]|div|pre|ul|ol|blockquote)/i.test(trimmed)) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    }).filter(Boolean).join("");
    return formatted;
  }

  // widget/src/hirepool-resume.js
  var HIREPOOL_RESUME_MAX_BYTES = 5 * 1024 * 1024;
  var HIREPOOL_RESUME_STATES = Object.freeze({
    IDLE: "IDLE",
    FILE_SELECTED: "FILE_SELECTED",
    PREPARING: "PREPARING",
    AWAITING_CONFIRMATION: "AWAITING_CONFIRMATION",
    UPLOADING: "UPLOADING",
    UPLOAD_SUCCESS: "UPLOAD_SUCCESS",
    UPLOAD_UNVERIFIED: "UPLOAD_UNVERIFIED",
    UPLOAD_FAILED: "UPLOAD_FAILED",
    CANCELLED: "CANCELLED"
  });
  function validateHirePoolResumeFile(file) {
    if (!file || typeof file.name !== "string" || !Number.isFinite(file.size)) {
      return "Select a PDF resume to continue.";
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return "Only PDF resumes are supported.";
    }
    const mimeType = typeof file.type === "string" ? file.type.toLowerCase() : "";
    const allowedMimeTypes = /* @__PURE__ */ new Set([
      "",
      "application/pdf",
      "application/octet-stream",
      "application/x-pdf",
      "binary/octet-stream"
    ]);
    if (mimeType && !allowedMimeTypes.has(mimeType)) {
      return "Only PDF resumes are supported.";
    }
    if (file.size < 1) return "The selected PDF is empty.";
    if (file.size > HIREPOOL_RESUME_MAX_BYTES) return "Resume PDFs must be 5 MB or smaller.";
    return null;
  }
  function formatHirePoolResumeSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  function isCandidateIdentity(identity) {
    return identity?.user_type === "candidate";
  }
  var HirePoolResumeUpload = class {
    constructor(apiClient, onStateChange = () => {
    }) {
      this.apiClient = apiClient;
      this.onStateChange = onStateChange;
      this.state = HIREPOOL_RESUME_STATES.IDLE;
      this.file = null;
      this.pending = null;
      this.conversationId = null;
      this.identityKey = null;
      this.operation = null;
      this.errorMessage = null;
      this.generation = 0;
    }
    _emit(state, details = {}) {
      this.state = state;
      this.onStateChange({
        state,
        filename: this.pending?.filename || this.file?.name || null,
        fileSize: this.pending?.fileSize ?? this.file?.size ?? null,
        replacingExisting: this.pending?.replacingExisting ?? null,
        conversationId: this.conversationId,
        message: details.message || null,
        error: this.errorMessage
      });
    }
    setIdentity(identity, sessionScope = null) {
      const identityKey = isCandidateIdentity(identity) && identity.id != null ? `${identity.id}:${identity.user_type}:${identity.role || ""}:${sessionScope || ""}` : null;
      if (identityKey === this.identityKey) return false;
      this.generation += 1;
      this.identityKey = identityKey;
      this.file = null;
      this.pending = null;
      this.conversationId = null;
      this.operation = null;
      this.errorMessage = null;
      this._emit(HIREPOOL_RESUME_STATES.IDLE);
      return true;
    }
    selectFile(file, conversationId) {
      if (!this.identityKey) throw new Error("Sign in to a verified HirePool candidate account to upload a resume.");
      if (this.operation || this.state === HIREPOOL_RESUME_STATES.UPLOADING || this.state === HIREPOOL_RESUME_STATES.PREPARING) {
        throw new Error("Wait for the current resume operation to finish.");
      }
      if (this.pending) throw new Error("Confirm or cancel the prepared resume before selecting another file.");
      const validationError = validateHirePoolResumeFile(file);
      if (validationError) throw new Error(validationError);
      this.file = file;
      this.conversationId = conversationId;
      this.errorMessage = null;
      this._emit(HIREPOOL_RESUME_STATES.FILE_SELECTED);
    }
    removeFile() {
      if (this.state !== HIREPOOL_RESUME_STATES.FILE_SELECTED) return false;
      this.file = null;
      this.conversationId = null;
      this._emit(HIREPOOL_RESUME_STATES.IDLE);
      return true;
    }
    reset() {
      this.generation += 1;
      this.file = null;
      this.pending = null;
      this.conversationId = null;
      this.operation = null;
      this.errorMessage = null;
      this._emit(HIREPOOL_RESUME_STATES.IDLE);
    }
    async prepare(conversationId) {
      if (this.state !== HIREPOOL_RESUME_STATES.FILE_SELECTED || !this.file) return false;
      if (this.operation) return this.operation;
      const file = this.file;
      const requestGeneration = this.generation;
      this.conversationId = conversationId || null;
      this.errorMessage = null;
      this._emit(HIREPOOL_RESUME_STATES.PREPARING);
      const operation = (async () => {
        try {
          if (typeof file.slice !== "function") {
            throw new Error("The selected file could not be validated as a PDF.");
          }
          const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
          if (new TextDecoder().decode(signature) !== "%PDF-") {
            throw new Error("The selected file is not a valid PDF.");
          }
          const result = await this.apiClient.prepareHirePoolResume(file, conversationId);
          if (requestGeneration !== this.generation) return false;
          if (result?.status !== "requires_confirmation" || typeof result.confirmationToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.confirmationToken) || typeof result.conversationId !== "string" || conversationId && result.conversationId !== conversationId || typeof result.filename !== "string" || !Number.isInteger(result.fileSize) || typeof result.replacingExisting !== "boolean") {
            throw new Error("HirePool returned an unexpected resume preparation response. Select the PDF and try again.");
          }
          this.conversationId = result.conversationId;
          this.pending = {
            confirmationToken: result.confirmationToken,
            conversationId: result.conversationId,
            filename: result.filename,
            fileSize: result.fileSize,
            replacingExisting: result.replacingExisting
          };
          this.file = null;
          this.errorMessage = null;
          this._emit(HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION);
          return true;
        } catch (error) {
          if (requestGeneration !== this.generation) return false;
          this.errorMessage = error.message || "HirePool could not prepare the resume upload.";
          this._emit(HIREPOOL_RESUME_STATES.UPLOAD_FAILED);
          return false;
        } finally {
          if (this.operation === operation) this.operation = null;
        }
      })();
      this.operation = operation;
      return operation;
    }
    async confirm() {
      if (this.operation) return this.operation;
      if (this.state !== HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION || !this.pending) return false;
      const pending = this.pending;
      const requestGeneration = this.generation;
      this._emit(HIREPOOL_RESUME_STATES.UPLOADING);
      const operation = (async () => {
        try {
          const result = await this.apiClient.confirmHirePoolResume(
            pending.confirmationToken,
            pending.conversationId
          );
          if (requestGeneration !== this.generation) return false;
          if (result?.status === "success" && result.verified === true && typeof result.message === "string") {
            this.pending = null;
            this.errorMessage = null;
            this._emit(HIREPOOL_RESUME_STATES.UPLOAD_SUCCESS);
            return true;
          }
          throw new Error("HirePool returned an unexpected resume upload response.");
        } catch (error) {
          if (requestGeneration !== this.generation) return false;
          this.pending = null;
          this.errorMessage = error.message || "HirePool could not confirm the resume upload.";
          if (error.responseStatus === "uploaded_unverified") {
            this._emit(HIREPOOL_RESUME_STATES.UPLOAD_UNVERIFIED);
          } else {
            this._emit(HIREPOOL_RESUME_STATES.UPLOAD_FAILED);
          }
          return false;
        } finally {
          if (this.operation === operation) this.operation = null;
        }
      })();
      this.operation = operation;
      return operation;
    }
    async cancel() {
      if (this.operation) return this.operation;
      if (this.state !== HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION || !this.pending) return false;
      const pending = this.pending;
      const requestGeneration = this.generation;
      this._emit(HIREPOOL_RESUME_STATES.UPLOADING, { message: "Cancelling the prepared upload..." });
      const operation = (async () => {
        try {
          const result = await this.apiClient.cancelHirePoolResume(
            pending.confirmationToken,
            pending.conversationId
          );
          if (requestGeneration !== this.generation) return false;
          if (result?.status !== "cancelled") {
            throw new Error("HirePool did not confirm cancellation of the prepared resume.");
          }
          this.pending = null;
          this.file = null;
          this.conversationId = null;
          this.errorMessage = null;
          this._emit(HIREPOOL_RESUME_STATES.CANCELLED);
          return true;
        } catch (error) {
          if (requestGeneration !== this.generation) return false;
          this.errorMessage = error.message || "The prepared resume could not be cancelled.";
          this._emit(HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION);
          return false;
        } finally {
          if (this.operation === operation) this.operation = null;
        }
      })();
      this.operation = operation;
      return operation;
    }
  };

  // widget/src/hirepool-validation.js
  var LIMITS = Object.freeze({
    yearsExperience: { min: 0, max: 50 },
    monthsExperience: { min: 0, max: 11 },
    noticeDays: { min: 0, max: 180 },
    expectedSalaryInr: { min: 0, max: 5e7 },
    foundingYear: { min: 1800, max: 2100 },
    maxPhoneLength: 20,
    exactPhoneDigits: 10
  });
  function rangeError(label, v, min, max, unit = "") {
    if (v === null || v === void 0 || Number.isNaN(v)) return null;
    if (v < min) return `${label} must be at least ${min.toLocaleString("en-IN")}${unit}`;
    if (v > max) return `${label} cannot be more than ${max.toLocaleString("en-IN")}${unit}`;
    return null;
  }
  var CLIENT_INDUSTRIES = Object.freeze([
    "Technology",
    "Healthcare",
    "Finance",
    "Education",
    "Manufacturing",
    "Retail",
    "Consulting",
    "Media",
    "Real Estate",
    "Logistics",
    "E-commerce",
    "Other"
  ]);
  var CONSULTANCY_SPECIALIZATIONS = Object.freeze([
    "Technology",
    "Healthcare",
    "Finance",
    "Engineering",
    "Sales",
    "Marketing",
    "HR",
    "Operations",
    "Design",
    "Data Science",
    "General"
  ]);
  var COMPANY_SIZES = Object.freeze([
    "1-10",
    "11-50",
    "51-200",
    "201-500",
    "500+"
  ]);
  var CONSULTANCY_TYPES = Object.freeze(["recruitment", "staffing"]);
  var WORK_TYPES = Object.freeze(["remote", "hybrid", "onsite"]);
  var JOB_TYPES = Object.freeze(["full_time", "contract"]);
  function validatePhoneNumber(value, { required = false, fieldLabel = "Phone number" } = {}) {
    const str = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
    if (!str) {
      if (required) {
        return { isValid: false, error: `${fieldLabel} is required`, digits: "" };
      }
      return { isValid: true, digits: "" };
    }
    if (/[a-zA-Z]/.test(str)) {
      return { isValid: false, error: "Phone number must contain exactly 10 digits", digits: "" };
    }
    let digitsOnly = str.replace(/\D/g, "");
    if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) {
      digitsOnly = digitsOnly.slice(2);
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith("0")) {
      digitsOnly = digitsOnly.slice(1);
    }
    if (digitsOnly.length !== 10) {
      return { isValid: false, error: "Phone number must contain exactly 10 digits", digits: digitsOnly };
    }
    return { isValid: true, digits: digitsOnly };
  }
  function validateEmail(value, { required = true } = {}) {
    const str = typeof value === "string" ? value.trim() : "";
    if (!str) {
      if (required) {
        return { isValid: false, error: "Email is required" };
      }
      return { isValid: true, sanitized: "" };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(str)) {
      return { isValid: false, error: "Invalid email address" };
    }
    return { isValid: true, sanitized: str.toLowerCase() };
  }
  function validatePassword(password, { confirmPassword = null, acceptAgreement = null, requireAgreement = false } = {}) {
    const errors = [];
    if (typeof password !== "string" || !password) {
      errors.push("Password is required");
      return { isValid: false, errors, firstError: "Password is required" };
    }
    if (password.length < 8) {
      errors.push("Password must be at least 8 characters");
    } else if (password.length > 128) {
      errors.push("Password must be at most 128 characters");
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }
    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }
    if (!/\d/.test(password)) {
      errors.push("Password must contain at least one number");
    }
    if (confirmPassword !== null && password !== confirmPassword) {
      errors.push("Passwords do not match");
    }
    if (requireAgreement && acceptAgreement !== true) {
      errors.push("You must agree to the User Agreement to create an account");
    }
    return {
      isValid: errors.length === 0,
      errors,
      firstError: errors[0]
    };
  }
  function validateWebsiteUrl(url, { required = false, fieldLabel = "Website" } = {}) {
    const str = typeof url === "string" ? url.trim() : "";
    if (!str) {
      if (required) {
        return { isValid: false, error: `${fieldLabel} is required` };
      }
      return { isValid: true, sanitized: null };
    }
    if (!/^https?:\/\//i.test(str)) {
      return { isValid: false, error: "Website must start with http:// or https://" };
    }
    try {
      const parsed = new URL(str);
      const hostname = parsed.hostname;
      if (!hostname.includes(".") || hostname.startsWith(".") || hostname.endsWith(".")) {
        return { isValid: false, error: "Please enter a valid website URL" };
      }
      const parts = hostname.split(".");
      const tld = parts[parts.length - 1];
      if (tld.length < 2) {
        return { isValid: false, error: "Please enter a valid website URL" };
      }
      return { isValid: true, sanitized: str };
    } catch {
      return { isValid: false, error: "Please enter a valid website URL" };
    }
  }
  function validateGstin(gstin) {
    const str = typeof gstin === "string" ? gstin.trim().toUpperCase() : "";
    if (!str) return { isValid: true };
    if (str.length !== 15) {
      return { isValid: false, error: "GSTIN must be exactly 15 characters" };
    }
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstinRegex.test(str)) {
      return { isValid: false, error: "Please enter a valid GSTIN format" };
    }
    const stateCode = parseInt(str.substring(0, 2), 10);
    if (!(stateCode >= 1 && stateCode <= 38 || stateCode === 97 || stateCode === 99)) {
      return { isValid: false, error: "Invalid state code in GSTIN" };
    }
    return { isValid: true };
  }
  function validateEducationItem(item) {
    if (!item || typeof item !== "object") {
      return { isValid: false, error: "Education entry must be an object" };
    }
    const inst = typeof item.institution === "string" ? item.institution.trim() : "";
    const deg = typeof item.degree === "string" ? item.degree.trim() : "";
    if (!inst && !deg && !item.field_of_study) {
      return { isValid: false, error: "Empty education entries cannot be submitted" };
    }
    if (!inst) {
      return { isValid: false, error: "Institution is required" };
    }
    if (!deg) {
      return { isValid: false, error: "Degree is required" };
    }
    return { isValid: true };
  }
  function validateWorkExperienceItem(item) {
    if (!item || typeof item !== "object") {
      return { isValid: false, error: "Work experience entry must be an object" };
    }
    const comp = typeof item.company === "string" ? item.company.trim() : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!comp && !title && !item.description) {
      return { isValid: false, error: "Empty work experience entries cannot be submitted" };
    }
    if (!comp) {
      return { isValid: false, error: "Company is required" };
    }
    if (!title) {
      return { isValid: false, error: "Job title is required" };
    }
    return { isValid: true };
  }
  function validateCandidateProfile(profile, { mode = "onboarding" } = {}) {
    const errors = {};
    const data = { ...profile || {} };
    const firstName = typeof data.first_name === "string" ? data.first_name.trim() : "";
    if (!firstName) {
      errors.first_name = "First name is required";
    } else if (firstName.length > 100) {
      errors.first_name = "First name cannot be more than 100 characters";
    } else {
      data.first_name = firstName;
    }
    const lastName = typeof data.last_name === "string" ? data.last_name.trim() : "";
    if (!lastName) {
      errors.last_name = "Last name is required";
    } else if (lastName.length > 100) {
      errors.last_name = "Last name cannot be more than 100 characters";
    } else {
      data.last_name = lastName;
    }
    const location = typeof data.current_location === "string" ? data.current_location.trim() : "";
    if (!location) {
      errors.current_location = "Location is required";
    } else if (location.length > 255) {
      errors.current_location = "Location cannot be more than 255 characters";
    } else {
      data.current_location = location;
    }
    const jobTitle = typeof data.job_title === "string" ? data.job_title.trim() : "";
    if (!jobTitle) {
      errors.job_title = "Job title is required";
    } else if (jobTitle.length > 255) {
      errors.job_title = "Job title cannot be more than 255 characters";
    } else {
      data.job_title = jobTitle;
    }
    const phoneRes = validatePhoneNumber(data.phone, {
      required: mode === "profile",
      fieldLabel: "Phone number"
    });
    if (!phoneRes.isValid) {
      errors.phone = phoneRes.error;
    } else {
      data.phone = phoneRes.digits || null;
    }
    if (data.years_of_experience !== void 0 && data.years_of_experience !== null && data.years_of_experience !== "") {
      const yoe = Number(data.years_of_experience);
      if (!Number.isFinite(yoe) || !Number.isInteger(yoe) || yoe < LIMITS.yearsExperience.min || yoe > LIMITS.yearsExperience.max) {
        errors.years_of_experience = `Years of experience must be between ${LIMITS.yearsExperience.min} and ${LIMITS.yearsExperience.max}`;
      } else {
        data.years_of_experience = yoe;
      }
    } else if (mode === "profile") {
      errors.years_of_experience = "Years of experience is required";
    } else {
      data.years_of_experience = 0;
    }
    if (data.months_of_experience !== void 0 && data.months_of_experience !== null && data.months_of_experience !== "") {
      const moe = Number(data.months_of_experience);
      if (!Number.isFinite(moe) || !Number.isInteger(moe) || moe < LIMITS.monthsExperience.min || moe > LIMITS.monthsExperience.max) {
        errors.months_of_experience = "Months of experience must be between 0 and 11";
      } else {
        data.months_of_experience = moe;
      }
    } else {
      data.months_of_experience = 0;
    }
    if (data.notice_period_days !== void 0 && data.notice_period_days !== null && data.notice_period_days !== "") {
      const notice = Number(data.notice_period_days);
      const err = rangeError("Notice period", notice, LIMITS.noticeDays.min, LIMITS.noticeDays.max, " days");
      if (!Number.isFinite(notice) || err) {
        errors.notice_period_days = err || `Notice period cannot be more than ${LIMITS.noticeDays.max} days`;
      } else {
        data.notice_period_days = Math.floor(notice);
      }
    } else {
      data.notice_period_days = null;
    }
    let salMin = null;
    let salMax = null;
    if (data.expected_salary_min !== void 0 && data.expected_salary_min !== null && data.expected_salary_min !== "") {
      const v = Number(data.expected_salary_min);
      const err = rangeError("Minimum expected salary", v, LIMITS.expectedSalaryInr.min, LIMITS.expectedSalaryInr.max);
      if (!Number.isFinite(v) || err) {
        errors.expected_salary_min = err || "Minimum expected salary cannot be more than 50,000,000";
      } else {
        salMin = Math.floor(v);
        data.expected_salary_min = salMin;
      }
    } else {
      data.expected_salary_min = null;
    }
    if (data.expected_salary_max !== void 0 && data.expected_salary_max !== null && data.expected_salary_max !== "") {
      const v = Number(data.expected_salary_max);
      const err = rangeError("Maximum expected salary", v, LIMITS.expectedSalaryInr.min, LIMITS.expectedSalaryInr.max);
      if (!Number.isFinite(v) || err) {
        errors.expected_salary_max = err || "Maximum expected salary cannot be more than 50,000,000";
      } else {
        salMax = Math.floor(v);
        data.expected_salary_max = salMax;
      }
    } else {
      data.expected_salary_max = null;
    }
    if (salMin !== null && salMax !== null && salMin > salMax) {
      errors.expected_salary_min = "The minimum expected salary cannot be more than the maximum";
    }
    let skillsList = [];
    if (Array.isArray(data.skills)) {
      skillsList = data.skills.map((s) => String(s).trim()).filter(Boolean);
    } else if (typeof data.skills === "string") {
      skillsList = data.skills.split(",").map((s) => s.trim()).filter(Boolean);
    }
    data.skills = skillsList;
    if (mode === "profile" && skillsList.length === 0) {
      errors.skills = "At least one skill is required";
    }
    for (const urlField of ["linkedin_url", "github_url", "portfolio_url", "personal_website"]) {
      if (data[urlField]) {
        const urlRes = validateWebsiteUrl(data[urlField], { required: false });
        if (!urlRes.isValid) {
          errors[urlField] = urlRes.error;
        } else {
          data[urlField] = urlRes.sanitized;
        }
      } else {
        data[urlField] = null;
      }
    }
    if (Array.isArray(data.education) && data.education.length > 0) {
      for (let i = 0; i < data.education.length; i++) {
        const eduRes = validateEducationItem(data.education[i]);
        if (!eduRes.isValid) {
          errors[`education.${i}`] = eduRes.error;
          break;
        }
      }
    }
    if (Array.isArray(data.work_experience) && data.work_experience.length > 0) {
      for (let i = 0; i < data.work_experience.length; i++) {
        const expRes = validateWorkExperienceItem(data.work_experience[i]);
        if (!expRes.isValid) {
          errors[`work_experience.${i}`] = expRes.error;
          break;
        }
      }
    }
    const isValid = Object.keys(errors).length === 0;
    return {
      isValid,
      errors,
      firstError: Object.values(errors)[0],
      sanitizedData: data
    };
  }
  function validateClientProfile(profile, { mode = "onboarding" } = {}) {
    const errors = {};
    const data = { ...profile || {} };
    const companyName = typeof data.company_name === "string" ? data.company_name.trim() : "";
    if (!companyName) {
      errors.company_name = "Company name is required";
    } else if (companyName.length > 255) {
      errors.company_name = "Company name cannot be more than 255 characters";
    } else {
      data.company_name = companyName;
    }
    const industry = typeof data.industry === "string" ? data.industry.trim() : "";
    if (!industry) {
      errors.industry = "Industry is required";
    } else {
      data.industry = industry;
    }
    const companySize = typeof data.company_size === "string" ? data.company_size.trim() : "";
    if (!companySize) {
      errors.company_size = "Company size is required";
    } else if (!COMPANY_SIZES.includes(companySize)) {
      errors.company_size = "Please select a valid company size";
    } else {
      data.company_size = companySize;
    }
    const location = typeof data.headquarters_location === "string" ? data.headquarters_location.trim() : "";
    if (!location) {
      errors.headquarters_location = "Location is required";
    } else if (location.length > 255) {
      errors.headquarters_location = "Location cannot be more than 255 characters";
    } else {
      data.headquarters_location = location;
    }
    const contact = { ...data.primary_contact || {} };
    const contactName = typeof contact.full_name === "string" ? contact.full_name.trim() : typeof data.full_name === "string" ? data.full_name.trim() : "";
    if (!contactName) {
      errors["primary_contact.full_name"] = "Your name is required";
    } else if (contactName.length > 200) {
      errors["primary_contact.full_name"] = "Name cannot be more than 200 characters";
    } else {
      contact.full_name = contactName;
    }
    const rawPhone = contact.phone || data.phone;
    const phoneRes = validatePhoneNumber(rawPhone, {
      required: mode === "profile",
      fieldLabel: "Phone number"
    });
    if (!phoneRes.isValid) {
      errors["primary_contact.phone"] = phoneRes.error;
    } else {
      contact.phone = phoneRes.digits || null;
    }
    if (contact.designation) {
      contact.designation = String(contact.designation).trim().slice(0, 100);
    } else if (data.designation) {
      contact.designation = String(data.designation).trim().slice(0, 100);
    } else {
      contact.designation = null;
    }
    data.primary_contact = contact;
    if (data.company_website) {
      const webRes = validateWebsiteUrl(data.company_website, { required: false });
      if (!webRes.isValid) {
        errors.company_website = webRes.error;
      } else {
        data.company_website = webRes.sanitized;
      }
    } else {
      data.company_website = null;
    }
    if (data.founding_year !== void 0 && data.founding_year !== null && data.founding_year !== "") {
      const yr = Number(data.founding_year);
      if (!Number.isFinite(yr) || yr < LIMITS.foundingYear.min || yr > LIMITS.foundingYear.max) {
        errors.founding_year = `Founding year must be between ${LIMITS.foundingYear.min} and ${LIMITS.foundingYear.max}`;
      } else {
        data.founding_year = Math.floor(yr);
      }
    } else {
      data.founding_year = null;
    }
    if (data.gst_tax_id) {
      const gstinRes = validateGstin(data.gst_tax_id);
      if (!gstinRes.isValid) {
        errors.gst_tax_id = gstinRes.error;
      }
    }
    const isValid = Object.keys(errors).length === 0;
    return {
      isValid,
      errors,
      firstError: Object.values(errors)[0],
      sanitizedData: data
    };
  }
  function validateConsultancyProfile(profile, { mode = "onboarding" } = {}) {
    const errors = {};
    const data = { ...profile || {} };
    const consultType = typeof data.consultancy_type === "string" ? data.consultancy_type.trim().toLowerCase() : "";
    if (!consultType || !CONSULTANCY_TYPES.includes(consultType)) {
      errors.consultancy_type = "Please select your agency type";
    } else {
      data.consultancy_type = consultType;
    }
    const consultName = typeof data.consultancy_name === "string" ? data.consultancy_name.trim() : "";
    if (!consultName) {
      errors.consultancy_name = "Agency name is required";
    } else if (consultName.length > 255) {
      errors.consultancy_name = "Agency name cannot be more than 255 characters";
    } else {
      data.consultancy_name = consultName;
    }
    const location = typeof data.headquarters_location === "string" ? data.headquarters_location.trim() : "";
    if (!location) {
      errors.headquarters_location = "Location is required";
    } else if (location.length > 255) {
      errors.headquarters_location = "Location cannot be more than 255 characters";
    } else {
      data.headquarters_location = location;
    }
    let specs = [];
    if (Array.isArray(data.industry_specialization)) {
      specs = data.industry_specialization.map((s) => String(s).trim()).filter(Boolean);
    } else if (typeof data.industry_specialization === "string") {
      specs = data.industry_specialization.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (specs.length === 0) {
      errors.industry_specialization = "Select at least one industry";
    } else {
      data.industry_specialization = specs;
    }
    if (data.company_size) {
      const cs = String(data.company_size).trim();
      if (cs && !COMPANY_SIZES.includes(cs)) {
        errors.company_size = "Please select a valid company size";
      } else {
        data.company_size = cs || null;
      }
    } else {
      data.company_size = null;
    }
    const contact = { ...data.primary_contact || {} };
    const contactName = typeof contact.full_name === "string" ? contact.full_name.trim() : typeof data.full_name === "string" ? data.full_name.trim() : "";
    if (!contactName) {
      errors["primary_contact.full_name"] = "Your name is required";
    } else if (contactName.length > 200) {
      errors["primary_contact.full_name"] = "Name cannot be more than 200 characters";
    } else {
      contact.full_name = contactName;
    }
    const rawPhone = contact.phone || data.phone;
    const phoneRes = validatePhoneNumber(rawPhone, {
      required: mode === "profile",
      fieldLabel: "Phone number"
    });
    if (!phoneRes.isValid) {
      errors["primary_contact.phone"] = phoneRes.error;
    } else {
      contact.phone = phoneRes.digits || null;
    }
    if (contact.designation) {
      contact.designation = String(contact.designation).trim().slice(0, 100);
    } else if (data.designation) {
      contact.designation = String(data.designation).trim().slice(0, 100);
    } else {
      contact.designation = null;
    }
    data.primary_contact = contact;
    if (data.website) {
      const webRes = validateWebsiteUrl(data.website, { required: false });
      if (!webRes.isValid) {
        errors.website = webRes.error;
      } else {
        data.website = webRes.sanitized;
      }
    } else {
      data.website = null;
    }
    if (data.founding_year !== void 0 && data.founding_year !== null && data.founding_year !== "") {
      const yr = Number(data.founding_year);
      if (!Number.isFinite(yr) || yr < LIMITS.foundingYear.min || yr > LIMITS.foundingYear.max) {
        errors.founding_year = `Founding year must be between ${LIMITS.foundingYear.min} and ${LIMITS.foundingYear.max}`;
      } else {
        data.founding_year = Math.floor(yr);
      }
    } else {
      data.founding_year = null;
    }
    const isValid = Object.keys(errors).length === 0;
    return {
      isValid,
      errors,
      firstError: Object.values(errors)[0],
      sanitizedData: data
    };
  }

  // widget/src/hirepool-signup.js
  var HIREPOOL_SIGNUP_STATES = Object.freeze({
    IDLE: "idle",
    ROLE_SELECTION: "role_selection",
    AGREEMENT_FETCHING: "agreement_fetching",
    SIGNUP_FORM: "signup_form",
    REGISTERING: "registering",
    SIGNUP_SUBMITTING: "registering",
    REGISTRATION_CONFIRMED: "registration_confirmed",
    EMAIL_VERIFICATION_PENDING: "email_verification_pending",
    VERIFICATION_PENDING: "email_verification_pending",
    EMAIL_VERIFICATION_IN_PROGRESS: "email_verification_in_progress",
    VERIFICATION_IN_PROGRESS: "email_verification_in_progress",
    EMAIL_VERIFIED: "email_verified",
    PROFILE_COLLECTION: "profile_collection",
    PROFILE_REVIEW: "profile_review",
    PROFILE_SUBMITTING: "profile_submitting",
    PROFILE_READBACK: "profile_readback",
    AUTH_SESSION_ESTABLISHED: "auth_session_established",
    AUTHENTICATION_SMOKE_TEST: "authentication_smoke_test",
    COMPLETED: "completed",
    ERROR: "error",
    CANCELLED: "cancelled"
  });
  var ROLE_DEFINITIONS = Object.freeze({
    candidate: {
      label: "Candidate",
      description: "Looking for tech jobs and personalized AI matching",
      badge: "Job Seeker",
      defaultTitle: "Software Engineer"
    },
    client: {
      label: "Employer / Company",
      description: "Hiring talent and managing applications for your company",
      badge: "Hiring Company",
      defaultTitle: "Hiring Manager"
    },
    consultancy: {
      label: "Agency / Consultancy",
      description: "Placing candidates and tracking placements across clients",
      badge: "Recruitment Agency",
      defaultTitle: "Recruitment Partner"
    }
  });
  function escapeHtml2(str) {
    if (typeof str !== "string") return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  var APPROVED_VERIFICATION_ORIGINS = /* @__PURE__ */ new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://app.hirepool.ai",
    "https://hirepool.ai"
  ]);
  function isSafeVerificationUrl(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) return false;
    let parsed;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      return false;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    if (!APPROVED_VERIFICATION_ORIGINS.has(parsed.origin)) return false;
    if (!parsed.pathname.startsWith("/auth/verify")) return false;
    return Boolean(parsed.searchParams.get("token"));
  }
  function parseHirePoolRoleChoice(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;
    if (/\bstaffing\b/i.test(trimmed)) {
      return "staffing";
    }
    if (/\b(?:as\s+(?:a\s+)?candidate|candidate|job\s*seeker|applicant)\b/i.test(trimmed)) {
      return "candidate";
    }
    if (/\b(?:company|client|employer)\b/i.test(trimmed)) {
      return "client";
    }
    if (/\b(?:consultancy|agency|recruitment\s+(?:agency|firm))\b/i.test(trimmed)) {
      return "consultancy";
    }
    return null;
  }
  var HirePoolSignupCoordinator = class {
    constructor({ apiClient, onAuthenticated, onStateChange, onAddMessage } = {}) {
      this.apiClient = apiClient;
      this.onAuthenticated = onAuthenticated;
      this.onStateChange = onStateChange;
      this.onAddMessage = onAddMessage;
      this.state = HIREPOOL_SIGNUP_STATES.IDLE;
      this.selectedRole = null;
      this.agreement = null;
      this.session = null;
      this.verificationUrl = null;
      this.profileData = {};
      this.missingFields = [];
      this._verificationCheckPromise = null;
      this._verifiedTransitioned = false;
    }
    setState(nextState, extra = {}) {
      this.state = nextState;
      if (this.onStateChange) {
        this.onStateChange(this.state, {
          role: this.selectedRole,
          session: this.session,
          verificationUrl: this.verificationUrl,
          profileData: this.profileData,
          missingFields: this.missingFields,
          ...extra
        });
      }
    }
    async start(initialRole = null) {
      if (initialRole && ROLE_DEFINITIONS[initialRole]) {
        return this.selectRole(initialRole);
      }
      this.setState(HIREPOOL_SIGNUP_STATES.ROLE_SELECTION);
      return { stage: HIREPOOL_SIGNUP_STATES.ROLE_SELECTION };
    }
    async selectRole(role) {
      let resolvedRole = role;
      let initialConsultancyType = null;
      if (role === "staffing") {
        resolvedRole = "consultancy";
        initialConsultancyType = "staffing";
      }
      if (!ROLE_DEFINITIONS[resolvedRole]) {
        throw new Error(`Unsupported role: ${role}`);
      }
      this.selectedRole = resolvedRole;
      if (initialConsultancyType) {
        this.profileData.consultancy_type = initialConsultancyType;
      }
      this.setState(HIREPOOL_SIGNUP_STATES.AGREEMENT_FETCHING, { role: this.selectedRole });
      try {
        const agreement = await this.apiClient.getSignupAgreement(this.selectedRole);
        this.agreement = agreement;
        this.setState(HIREPOOL_SIGNUP_STATES.SIGNUP_FORM, { agreement, role: this.selectedRole });
        return { stage: HIREPOOL_SIGNUP_STATES.SIGNUP_FORM, agreement };
      } catch (error) {
        this.setState(HIREPOOL_SIGNUP_STATES.ERROR, { error: error.message });
        throw error;
      }
    }
    async submitSignup({ email, password, confirmPassword }) {
      if (!this.selectedRole || !this.agreement) {
        throw new Error("Please select an account type and accept the User Agreement.");
      }
      this.setState(HIREPOOL_SIGNUP_STATES.REGISTERING);
      try {
        const result = await this.apiClient.signupRegister({
          email,
          password,
          confirmPassword,
          userType: this.selectedRole,
          acceptAgreement: true,
          agreementVersionId: this.agreement.id
        });
        this.session = {
          signupToken: result.signupToken,
          email: result.email,
          userType: result.userType
        };
        this.verificationUrl = isSafeVerificationUrl(result?.verificationUrl) ? result.verificationUrl : null;
        this._verifiedTransitioned = false;
        this.setState(HIREPOOL_SIGNUP_STATES.REGISTRATION_CONFIRMED, {
          session: this.session,
          verificationUrl: this.verificationUrl,
          result
        });
        this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING, {
          session: this.session,
          verificationUrl: this.verificationUrl
        });
        return result;
      } catch (error) {
        this.setState(HIREPOOL_SIGNUP_STATES.SIGNUP_FORM, { error: error.message });
        throw error;
      }
    }
    async resendVerification() {
      if (!this.session?.signupToken) {
        throw new Error("No active registration session.");
      }
      const result = await this.apiClient.resendSignupVerification({ signupToken: this.session.signupToken });
      if (isSafeVerificationUrl(result?.verificationUrl)) {
        this.verificationUrl = result.verificationUrl;
        if (this.state === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING) {
          this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING, {
            session: this.session,
            verificationUrl: this.verificationUrl,
            message: "A fresh verification email has been sent. Use the button below to verify your email."
          });
        }
      }
      return result;
    }
    async verifyWithToken(tokenOrUrl) {
      if (!this.session?.signupToken) {
        throw new Error("No active registration session.");
      }
      if (this._verifiedTransitioned) {
        return { isVerified: true };
      }
      this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_IN_PROGRESS);
      try {
        const result = await this.apiClient.verifySignupEmail({
          signupToken: this.session.signupToken,
          verificationToken: tokenOrUrl
        });
        this._verifiedTransitioned = true;
        this.verificationUrl = null;
        this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFIED);
        this.missingFields = this._getInitialMissingFields(this.selectedRole);
        this.setState(HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION, { missingFields: this.missingFields });
        return result;
      } catch (error) {
        this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING, { error: error.message });
        throw error;
      }
    }
    async checkVerificationStatus({ silent = false } = {}) {
      if (!this.session?.signupToken) {
        throw new Error("No active registration session.");
      }
      if (this._verifiedTransitioned || this.state === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFIED || this.state === HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION || this.state === HIREPOOL_SIGNUP_STATES.PROFILE_REVIEW || this.state === HIREPOOL_SIGNUP_STATES.COMPLETED) {
        return { isVerified: true };
      }
      if (this._verificationCheckPromise) {
        return this._verificationCheckPromise;
      }
      if (!silent) {
        this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_IN_PROGRESS);
      }
      const runCheck = (async () => {
        try {
          const result = await this.apiClient.checkSignupVerificationStatus(this.session.signupToken);
          if (result.isVerified) {
            if (!this._verifiedTransitioned) {
              this._verifiedTransitioned = true;
              this.verificationUrl = null;
              this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFIED);
              this.missingFields = this._getInitialMissingFields(this.selectedRole);
              this.setState(HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION, { missingFields: this.missingFields });
            }
          } else if (!silent) {
            this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING, {
              notVerifiedYet: true,
              verificationUrl: this.verificationUrl,
              message: this.verificationUrl ? 'Email verification not completed yet. Click "Verify Email" above (or use the link in your inbox), then we will continue automatically.' : "Verification link not yet clicked. Please check your email inbox and click the link, then try again."
            });
          }
          return result;
        } catch (error) {
          if (!silent) {
            this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING, {
              verificationUrl: this.verificationUrl,
              error: error.message
            });
          }
          throw error;
        } finally {
          this._verificationCheckPromise = null;
        }
      })();
      this._verificationCheckPromise = runCheck;
      return runCheck;
    }
    async updateProfileFields(fields) {
      if (!this.session?.signupToken) {
        throw new Error("No active registration session.");
      }
      const result = await this.apiClient.updateSignupProfile({
        signupToken: this.session.signupToken,
        fields
      });
      this.profileData = result.profileData;
      this.missingFields = result.missingFields;
      this.setState(result.stage, {
        profileData: this.profileData,
        missingFields: this.missingFields
      });
      return result;
    }
    async completeProfile(finalProfile = null) {
      if (!this.session?.signupToken) {
        throw new Error("No active registration session.");
      }
      this.setState(HIREPOOL_SIGNUP_STATES.PROFILE_SUBMITTING);
      try {
        const payload = finalProfile || this.profileData;
        const result = await this.apiClient.completeSignupProfile({
          signupToken: this.session.signupToken,
          confirmedProfile: payload
        });
        this.setState(HIREPOOL_SIGNUP_STATES.PROFILE_READBACK, { profile: result.profile });
        this.setState(HIREPOOL_SIGNUP_STATES.AUTH_SESSION_ESTABLISHED, { result });
        this.setState(HIREPOOL_SIGNUP_STATES.AUTHENTICATION_SMOKE_TEST);
        if (this.onAuthenticated) {
          await this.onAuthenticated({
            credential: result.credential,
            sessionScope: result.sessionScope,
            expiresIn: result.expiresIn,
            identity: result.identity,
            profile: result.profile,
            role: this.selectedRole
          });
        }
        this.setState(HIREPOOL_SIGNUP_STATES.COMPLETED, { result });
        return result;
      } catch (error) {
        this.setState(HIREPOOL_SIGNUP_STATES.PROFILE_REVIEW, { error: error.message });
        throw error;
      }
    }
    async cancel() {
      if (this.session?.signupToken) {
        try {
          await this.apiClient.cancelSignup(this.session.signupToken);
        } catch {
        }
      }
      this.state = HIREPOOL_SIGNUP_STATES.IDLE;
      this.selectedRole = null;
      this.agreement = null;
      this.session = null;
      this.verificationUrl = null;
      this.profileData = {};
      this.missingFields = [];
      this._verificationCheckPromise = null;
      this._verifiedTransitioned = false;
      this.setState(HIREPOOL_SIGNUP_STATES.IDLE);
    }
    /**
     * Export only non-sensitive pre-registration state (`role_selection` or
     * `signup_form`) for safe persistence across reloads. Never includes
     * credentials, passwords, email addresses, or verification/signup tokens.
     */
    getSafeProgressSnapshot() {
      if (this.state === HIREPOOL_SIGNUP_STATES.ROLE_SELECTION) {
        return {
          state: "role_selection",
          selectedRole: null,
          consultancyType: null,
          agreement: null
        };
      }
      if (this.state === HIREPOOL_SIGNUP_STATES.SIGNUP_FORM && this.selectedRole) {
        return {
          state: "signup_form",
          selectedRole: this.selectedRole,
          consultancyType: this.profileData?.consultancy_type || null,
          agreement: this.agreement ? {
            id: this.agreement.id || this.agreement.version_id || null,
            version: this.agreement.version || null,
            role: this.agreement.role || this.selectedRole,
            title: this.agreement.title || null,
            summary: this.agreement.summary || null,
            effectiveDate: this.agreement.effectiveDate || this.agreement.effective_date || null
          } : null
        };
      }
      return null;
    }
    /**
     * Restore safe non-sensitive signup UI state (`role_selection` or `signup_form`)
     * after a page reload.
     *
     * @param {object|null} snapshot
     */
    async restoreProgress(snapshot) {
      if (!snapshot || typeof snapshot !== "object") return false;
      if (snapshot.state === "role_selection") {
        this.selectedRole = null;
        this.agreement = null;
        this.setState(HIREPOOL_SIGNUP_STATES.ROLE_SELECTION);
        return true;
      }
      if (snapshot.state === "signup_form" && snapshot.selectedRole && ROLE_DEFINITIONS[snapshot.selectedRole]) {
        this.selectedRole = snapshot.selectedRole;
        if (snapshot.consultancyType) {
          this.profileData.consultancy_type = snapshot.consultancyType;
        }
        if (snapshot.agreement && snapshot.agreement.id) {
          this.agreement = snapshot.agreement;
          this.setState(HIREPOOL_SIGNUP_STATES.SIGNUP_FORM, {
            agreement: this.agreement,
            role: this.selectedRole
          });
          return true;
        }
        await this.selectRole(snapshot.selectedRole);
        return true;
      }
      return false;
    }
    /**
     * Re-emit / focus the current active signup card when the user asks to
     * continue or resume signup via chat.
     */
    resume() {
      if (this.state === HIREPOOL_SIGNUP_STATES.IDLE || this.state === HIREPOOL_SIGNUP_STATES.CANCELLED || this.state === HIREPOOL_SIGNUP_STATES.COMPLETED) {
        return false;
      }
      this.setState(this.state, {
        role: this.selectedRole,
        agreement: this.agreement,
        session: this.session,
        profileData: this.profileData,
        missingFields: this.missingFields
      });
      return true;
    }
    _getInitialMissingFields(role) {
      if (role === "candidate") {
        return ["first_name", "last_name", "current_location", "job_title"];
      }
      if (role === "client") {
        return ["company_name", "industry", "company_size", "headquarters_location", "primary_contact.full_name"];
      }
      if (role === "consultancy") {
        return ["consultancy_name", "consultancy_type", "industry_specialization", "headquarters_location", "primary_contact.full_name"];
      }
      return [];
    }
  };
  function renderRoleSelectionCard({ onSelect, onCancel }) {
    const card = document.createElement("div");
    card.className = "ai-action-card ai-signup-card";
    card.innerHTML = `
    <div class="ai-action-header">
      <span class="ai-action-badge">Registration</span>
      <span class="ai-action-title">Create a HirePool Account</span>
    </div>
    <p class="ai-action-explanation">Select your role to begin registration directly inside this assistant:</p>
    <div class="ai-signup-role-options">
      <button type="button" class="ai-role-btn" data-role="candidate">
        <div class="ai-role-badge">Job Seeker</div>
        <div class="ai-role-title">Candidate</div>
        <div class="ai-role-desc">Looking for tech jobs and AI match scoring</div>
      </button>
      <button type="button" class="ai-role-btn" data-role="client">
        <div class="ai-role-badge">Hiring Company</div>
        <div class="ai-role-title">Employer / Company</div>
        <div class="ai-role-desc">Post jobs and manage your candidate pipeline</div>
      </button>
      <button type="button" class="ai-role-btn" data-role="consultancy">
        <div class="ai-role-badge">Recruitment Agency</div>
        <div class="ai-role-title">Agency / Consultancy</div>
        <div class="ai-role-desc">Place agency candidates and track commissions</div>
      </button>
    </div>
    <div class="ai-action-controls" style="margin-top: 12px;">
      <button type="button" class="ai-btn-action-cancel">Cancel</button>
    </div>
  `;
    card.querySelectorAll(".ai-role-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.getAttribute("data-role");
        onSelect(role);
      });
    });
    card.querySelector(".ai-btn-action-cancel")?.addEventListener("click", () => {
      card.remove();
      if (onCancel) onCancel();
    });
    return card;
  }
  function renderSignupFormCard({ role, agreement, onSubmit, onCancel }) {
    const card = document.createElement("div");
    card.className = "ai-action-card ai-signup-card";
    const roleMeta = ROLE_DEFINITIONS[role] || { label: role, badge: "HirePool Account" };
    card.innerHTML = `
    <div class="ai-action-header">
      <span class="ai-action-badge">${escapeHtml2(roleMeta.badge)}</span>
      <span class="ai-action-title">Sign up as ${escapeHtml2(roleMeta.label)}</span>
    </div>
    <p class="ai-action-explanation">Enter your details to create your ${escapeHtml2(roleMeta.label)} account. Passwords are encrypted directly and never shared with the AI model.</p>
    
    <form class="ai-signup-form" autocomplete="off">
      <div class="ai-form-group">
        <label class="ai-form-label">Email Address *</label>
        <input type="email" name="email" class="ai-form-input" required placeholder="you@company.com" autocomplete="username">
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Password * (min 8 chars, 1 uppercase, 1 lowercase, 1 number)</label>
        <div class="ai-password-wrapper">
          <input type="password" name="password" class="ai-form-input" required minlength="8" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autocomplete="new-password">
          <button type="button" class="ai-password-toggle" title="Show/Hide Password">\u{1F441}</button>
        </div>
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Confirm Password *</label>
        <input type="password" name="confirmPassword" class="ai-form-input" required minlength="8" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autocomplete="new-password">
      </div>

      <div class="ai-form-group ai-agreement-group">
        <label class="ai-action-acknowledgement" style="font-size: 13px;">
          <input type="checkbox" name="acceptAgreement" required>
          I agree to the <a href="http://localhost:5173/agreements?role=${encodeURIComponent(role)}" target="_blank" rel="noopener noreferrer" style="color: #16a34a; text-decoration: underline;">HirePool User Agreement (v${escapeHtml2(agreement?.version || "1.0")})</a>.
        </label>
      </div>

      <div class="ai-form-error" style="display: none; color: #dc2626; font-size: 13px; margin-bottom: 10px;"></div>

      <div class="ai-action-controls">
        <button type="submit" class="ai-btn-action-confirm">Create Account</button>
        <button type="button" class="ai-btn-action-cancel">Cancel</button>
      </div>
    </form>
  `;
    const form = card.querySelector("form");
    const errorBox = card.querySelector(".ai-form-error");
    const submitBtn = card.querySelector(".ai-btn-action-confirm");
    const cancelBtn = card.querySelector(".ai-btn-action-cancel");
    const passwordInput = card.querySelector('input[name="password"]');
    const toggleBtn = card.querySelector(".ai-password-toggle");
    toggleBtn?.addEventListener("click", () => {
      passwordInput.type = passwordInput.type === "password" ? "text" : "password";
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorBox.style.display = "none";
      const email = form.email.value.trim();
      const password = form.password.value;
      const confirmPassword = form.confirmPassword.value;
      const acceptAgreement = form.acceptAgreement.checked;
      const emailRes = validateEmail(email, { required: true });
      if (!emailRes.isValid) {
        errorBox.textContent = emailRes.error || "Please enter a valid email address.";
        errorBox.style.display = "block";
        form.email.focus();
        return;
      }
      const passRes = validatePassword(password, { confirmPassword, acceptAgreement, requireAgreement: true });
      if (!passRes.isValid) {
        errorBox.textContent = passRes.firstError;
        errorBox.style.display = "block";
        if (passRes.firstError.includes("match")) {
          form.confirmPassword.focus();
        } else if (passRes.firstError.includes("Agreement")) {
          form.acceptAgreement.focus();
        } else {
          form.password.focus();
        }
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating account...";
      try {
        await onSubmit({ email: emailRes.sanitized, password, confirmPassword });
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
        errorBox.textContent = err.message || "Registration failed.";
        errorBox.style.display = "block";
      }
    });
    cancelBtn.addEventListener("click", () => {
      card.remove();
      if (onCancel) onCancel();
    });
    return card;
  }
  function renderVerificationCard({
    email,
    verificationUrl = null,
    onVerifyClick,
    onCheckStatus,
    onResend,
    onCancel,
    notVerifiedYet = false,
    message = null,
    error = null
  }) {
    const card = document.createElement("div");
    card.className = "ai-action-card ai-signup-card";
    const safeUrl = isSafeVerificationUrl(verificationUrl) ? verificationUrl : null;
    const introText = safeUrl ? `Your verification email has been sent to <strong>${escapeHtml2(email)}</strong>. You can verify your email using the button below.` : `We've sent a verification link to <strong>${escapeHtml2(email)}</strong>.`;
    const hintHtml = safeUrl ? "Click <strong>Verify Email</strong> below to confirm your address. Once verified, we'll automatically load your profile setup here." : "<strong>Check your email:</strong> Open the verification link sent to your inbox to verify your account. We'll detect verification automatically when you return, or you can check status below.";
    card.innerHTML = `
    <div class="ai-action-header">
      <span class="ai-action-badge">Email Verification</span>
      <span class="ai-action-title">Verify Your Email</span>
    </div>
    <div class="ai-verification-body">
      <p style="margin: 0 0 10px 0; font-size: 13px; line-height: 1.5; color: var(--ai-text, #0f172a); overflow-wrap: break-word;">
        ${introText}
      </p>
      <div style="background: rgba(22, 163, 74, 0.08); border: 1px solid rgba(22, 163, 74, 0.25); border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; font-size: 12px; line-height: 1.45; color: var(--ai-text, #0f172a); overflow-wrap: break-word;">
        ${hintHtml}
      </div>

      <div class="ai-verification-msg" style="display: ${error || notVerifiedYet || message ? "block" : "none"}; font-size: 12px; margin-bottom: 12px; padding: 8px 10px; border-radius: 6px; overflow-wrap: break-word; ${error || notVerifiedYet ? "background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;" : "background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe;"}">
        ${escapeHtml2(error || message || "")}
      </div>

      <div class="ai-action-controls">
        ${safeUrl ? '<button type="button" class="ai-btn-action-confirm ai-btn-verify-email">Verify Email</button>' : ""}
        <button type="button" class="${safeUrl ? "ai-btn-action-edit ai-btn-check-status" : "ai-btn-action-confirm ai-btn-check-status"}">${safeUrl ? "Check status" : "Check Verification Status"}</button>
        <button type="button" class="ai-btn-action-edit ai-btn-resend">Resend email</button>
        <button type="button" class="ai-btn-action-cancel">Cancel</button>
      </div>
    </div>
  `;
    const verifyBtn = card.querySelector(".ai-btn-verify-email");
    const checkStatusBtn = card.querySelector(".ai-btn-check-status");
    const resendBtn = card.querySelector(".ai-btn-resend");
    const cancelBtn = card.querySelector(".ai-btn-action-cancel");
    const msgBox = card.querySelector(".ai-verification-msg");
    const showMsg = (text, isError = true) => {
      msgBox.textContent = text;
      msgBox.style.color = isError ? "#991b1b" : "#1e40af";
      msgBox.style.background = isError ? "#fef2f2" : "#eff6ff";
      msgBox.style.border = isError ? "1px solid #fecaca" : "1px solid #bfdbfe";
      msgBox.style.display = "block";
    };
    if (verifyBtn && safeUrl) {
      verifyBtn.addEventListener("click", () => {
        if (onVerifyClick) {
          onVerifyClick(safeUrl);
        } else if (typeof window !== "undefined" && typeof window.open === "function") {
          window.open(safeUrl, "_blank", "noopener,noreferrer");
        }
        showMsg("Verification link opened. Complete verification in that tab and we will advance automatically once confirmed.", false);
      });
    }
    checkStatusBtn.addEventListener("click", async () => {
      if (checkStatusBtn.disabled) return;
      checkStatusBtn.disabled = true;
      const idleLabel = safeUrl ? "Check status" : "Check Verification Status";
      checkStatusBtn.textContent = "Checking...";
      try {
        const res = await onCheckStatus();
        if (!res?.isVerified) {
          showMsg("Verification not detected yet. Complete verification and we will automatically continue once confirmed.");
          checkStatusBtn.disabled = false;
          checkStatusBtn.textContent = idleLabel;
        }
      } catch (err) {
        checkStatusBtn.disabled = false;
        checkStatusBtn.textContent = idleLabel;
        showMsg(err.message || "Could not verify status.");
      }
    });
    resendBtn.addEventListener("click", async () => {
      if (resendBtn.disabled) return;
      resendBtn.disabled = true;
      resendBtn.textContent = "Sending...";
      try {
        const res = await onResend();
        showMsg(
          res?.verificationUrl ? "A fresh verification email has been sent. Use Verify Email above to verify." : "A fresh verification email has been requested. Check your inbox.",
          false
        );
      } catch (err) {
        showMsg(err.message || "Could not resend email.");
      } finally {
        resendBtn.disabled = false;
        resendBtn.textContent = "Resend email";
      }
    });
    cancelBtn.addEventListener("click", () => {
      card.remove();
      if (onCancel) onCancel();
    });
    return card;
  }
  function renderProfileCollectionCard({ role, profileData = {}, missingFields = [], onReview, onCancel }) {
    const card = document.createElement("div");
    card.className = "ai-action-card ai-signup-card";
    const roleMeta = ROLE_DEFINITIONS[role] || { label: role, badge: "Profile" };
    let fieldsHtml = "";
    if (role === "candidate") {
      fieldsHtml = `
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">First Name *</label>
          <input type="text" name="first_name" class="ai-form-input" required value="${escapeHtml2(profileData.first_name || "")}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Last Name *</label>
          <input type="text" name="last_name" class="ai-form-input" required value="${escapeHtml2(profileData.last_name || "")}">
        </div>
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Current Location (City) *</label>
          <input type="text" name="current_location" class="ai-form-input" required placeholder="e.g. Bengaluru" value="${escapeHtml2(profileData.current_location || "")}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Phone Number (10 digits)</label>
          <input type="tel" name="phone" class="ai-form-input" placeholder="e.g. 9876543210" value="${escapeHtml2(profileData.phone || "")}">
        </div>
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Current / Desired Job Title *</label>
        <input type="text" name="job_title" class="ai-form-input" required placeholder="e.g. Senior Frontend Developer" value="${escapeHtml2(profileData.job_title || "")}">
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Years of Experience (0-50)</label>
          <input type="number" name="years_of_experience" min="0" max="50" class="ai-form-input" value="${profileData.years_of_experience !== void 0 ? profileData.years_of_experience : 0}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Notice Period (Days, 0-180)</label>
          <input type="number" name="notice_period_days" min="0" max="180" class="ai-form-input" placeholder="30" value="${profileData.notice_period_days || ""}">
        </div>
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Skills (comma separated)</label>
        <input type="text" name="skills" class="ai-form-input" placeholder="React, Node.js, Python, TypeScript" value="${escapeHtml2(Array.isArray(profileData.skills) ? profileData.skills.join(", ") : profileData.skills || "")}">
      </div>
    `;
    } else if (role === "client") {
      fieldsHtml = `
      <div class="ai-form-group">
        <label class="ai-form-label">Company Name *</label>
        <input type="text" name="company_name" class="ai-form-input" required placeholder="e.g. Acme Technologies" value="${escapeHtml2(profileData.company_name || "")}">
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Industry *</label>
          <select name="industry" class="ai-form-input" required>
            ${CLIENT_INDUSTRIES.map((ind) => `<option value="${escapeHtml2(ind)}" ${profileData.industry === ind ? "selected" : ""}>${escapeHtml2(ind)}</option>`).join("")}
          </select>
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Company Size *</label>
          <select name="company_size" class="ai-form-input" required>
            ${COMPANY_SIZES.map((sz) => `<option value="${escapeHtml2(sz)}" ${profileData.company_size === sz ? "selected" : ""}>${escapeHtml2(sz)} employees</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Headquarters Location (City) *</label>
        <input type="text" name="headquarters_location" class="ai-form-input" required placeholder="e.g. Mumbai, India" value="${escapeHtml2(profileData.headquarters_location || "")}">
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Primary Contact Full Name *</label>
          <input type="text" name="contact_name" class="ai-form-input" required placeholder="Your full name" value="${escapeHtml2(profileData.primary_contact?.full_name || profileData.contact_name || "")}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Primary Contact Phone</label>
          <input type="tel" name="contact_phone" class="ai-form-input" placeholder="e.g. 9876543210" value="${escapeHtml2(profileData.primary_contact?.phone || profileData.contact_phone || "")}">
        </div>
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Designation</label>
          <input type="text" name="designation" class="ai-form-input" placeholder="e.g. Head of HR" value="${escapeHtml2(profileData.primary_contact?.designation || profileData.designation || "")}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Company Website</label>
          <input type="url" name="company_website" class="ai-form-input" placeholder="https://example.com" value="${escapeHtml2(profileData.company_website || "")}">
        </div>
      </div>
    `;
    } else if (role === "consultancy") {
      fieldsHtml = `
      <div class="ai-form-group">
        <label class="ai-form-label">Agency / Consultancy Name *</label>
        <input type="text" name="consultancy_name" class="ai-form-input" required placeholder="e.g. Apex Recruitment" value="${escapeHtml2(profileData.consultancy_name || "")}">
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Agency Type *</label>
          <select name="consultancy_type" class="ai-form-input" required>
            <option value="recruitment" ${(profileData.consultancy_type || "recruitment") === "recruitment" ? "selected" : ""}>Recruitment Agency</option>
            <option value="staffing" ${profileData.consultancy_type === "staffing" ? "selected" : ""}>Staffing Agency</option>
          </select>
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Headquarters Location *</label>
          <input type="text" name="headquarters_location" class="ai-form-input" required placeholder="e.g. Bengaluru" value="${escapeHtml2(profileData.headquarters_location || "")}">
        </div>
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Specializations (comma separated) *</label>
        <input type="text" name="industry_specialization" class="ai-form-input" required placeholder="Technology, Finance, Engineering" value="${escapeHtml2(Array.isArray(profileData.industry_specialization) ? profileData.industry_specialization.join(", ") : profileData.industry_specialization || "Technology")}">
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Primary Contact Full Name *</label>
          <input type="text" name="contact_name" class="ai-form-input" required placeholder="Your full name" value="${escapeHtml2(profileData.primary_contact?.full_name || profileData.contact_name || "")}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Primary Contact Phone</label>
          <input type="tel" name="contact_phone" class="ai-form-input" placeholder="e.g. 9876543210" value="${escapeHtml2(profileData.primary_contact?.phone || profileData.contact_phone || "")}">
        </div>
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Designation</label>
          <input type="text" name="designation" class="ai-form-input" placeholder="e.g. Managing Director" value="${escapeHtml2(profileData.primary_contact?.designation || profileData.designation || "")}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Agency Website</label>
          <input type="url" name="website" class="ai-form-input" placeholder="https://example.com" value="${escapeHtml2(profileData.website || "")}">
        </div>
      </div>
    `;
    }
    card.innerHTML = `
    <div class="ai-action-header">
      <span class="ai-action-badge">${escapeHtml2(roleMeta.badge)}</span>
      <span class="ai-action-title">Complete Your Profile</span>
    </div>
    <p class="ai-action-explanation">Your email is verified! Complete the required information below to finish setting up your account:</p>
    
    <form class="ai-profile-form">
      ${fieldsHtml}
      <div class="ai-form-error" style="display: none; color: #dc2626; font-size: 13px; margin: 8px 0;"></div>
      <div class="ai-action-controls" style="margin-top: 14px;">
        <button type="submit" class="ai-btn-action-confirm">Review Profile Details</button>
        <button type="button" class="ai-btn-action-cancel">Cancel</button>
      </div>
    </form>
  `;
    const form = card.querySelector("form");
    const errorBox = card.querySelector(".ai-form-error");
    const cancelBtn = card.querySelector(".ai-btn-action-cancel");
    const setInputError = (input, msg) => {
      if (!input) return;
      input.classList.add("ai-input-invalid");
      let errElem = input.parentElement?.querySelector(".ai-field-error");
      if (!errElem) {
        errElem = document.createElement("div");
        errElem.className = "ai-field-error";
        input.parentElement?.appendChild(errElem);
      }
      errElem.textContent = msg;
      errElem.style.display = "block";
    };
    const clearInputError = (input) => {
      if (!input) return;
      input.classList.remove("ai-input-invalid");
      const errElem = input.parentElement?.querySelector(".ai-field-error");
      if (errElem) {
        errElem.remove();
      }
    };
    const clearAllFieldErrors = () => {
      form.querySelectorAll(".ai-input-invalid").forEach((inp) => inp.classList.remove("ai-input-invalid"));
      form.querySelectorAll(".ai-field-error").forEach((el) => el.remove());
    };
    const phoneInput = form.querySelector('input[name="phone"], input[name="contact_phone"]');
    if (phoneInput) {
      phoneInput.addEventListener("input", () => {
        const val = phoneInput.value;
        if (/[a-zA-Z]/.test(val)) {
          setInputError(phoneInput, "Phone number must contain exactly 10 digits");
        } else {
          clearInputError(phoneInput);
        }
      });
      phoneInput.addEventListener("blur", () => {
        const val = phoneInput.value.trim();
        if (val) {
          const res = validatePhoneNumber(val, { required: false });
          if (!res.isValid) {
            setInputError(phoneInput, res.error);
          } else {
            clearInputError(phoneInput);
          }
        } else {
          clearInputError(phoneInput);
        }
      });
    }
    const websiteInput = form.querySelector('input[name="company_website"], input[name="website"]');
    if (websiteInput) {
      websiteInput.addEventListener("blur", () => {
        const val = websiteInput.value.trim();
        if (val) {
          const res = validateWebsiteUrl(val, { required: false });
          if (!res.isValid) {
            setInputError(websiteInput, res.error);
          } else {
            clearInputError(websiteInput);
          }
        } else {
          clearInputError(websiteInput);
        }
      });
    }
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      errorBox.style.display = "none";
      clearAllFieldErrors();
      const formData = new FormData(form);
      const data = {};
      for (const [key, val] of formData.entries()) {
        data[key] = val;
      }
      if (role === "client" || role === "consultancy") {
        data.primary_contact = {
          full_name: data.contact_name,
          designation: data.designation || null,
          phone: data.contact_phone || null
        };
        delete data.contact_name;
        delete data.designation;
        delete data.contact_phone;
      }
      if (data.skills && typeof data.skills === "string") {
        data.skills = data.skills.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (data.industry_specialization && typeof data.industry_specialization === "string") {
        data.industry_specialization = data.industry_specialization.split(",").map((s) => s.trim()).filter(Boolean);
      }
      let valResult;
      if (role === "candidate") {
        valResult = validateCandidateProfile(data, { mode: "onboarding" });
      } else if (role === "client") {
        valResult = validateClientProfile(data, { mode: "onboarding" });
      } else if (role === "consultancy") {
        valResult = validateConsultancyProfile(data, { mode: "onboarding" });
      }
      if (valResult && !valResult.isValid) {
        errorBox.textContent = valResult.firstError || "Please correct the highlighted errors.";
        errorBox.style.display = "block";
        let firstInvalidInput = null;
        for (const [errField, errMsg] of Object.entries(valResult.errors)) {
          let inputEl = null;
          if (errField === "primary_contact.full_name") {
            inputEl = form.querySelector('[name="contact_name"]');
          } else if (errField === "primary_contact.phone") {
            inputEl = form.querySelector('[name="contact_phone"]');
          } else if (errField === "primary_contact.designation") {
            inputEl = form.querySelector('[name="designation"]');
          } else {
            inputEl = form.querySelector(`[name="${errField}"]`);
          }
          if (inputEl) {
            setInputError(inputEl, errMsg);
            if (!firstInvalidInput) firstInvalidInput = inputEl;
          }
        }
        if (firstInvalidInput) {
          firstInvalidInput.focus();
        }
        return;
      }
      onReview(valResult ? valResult.sanitizedData : data);
    });
    cancelBtn.addEventListener("click", () => {
      card.remove();
      if (onCancel) onCancel();
    });
    return card;
  }
  function renderProfileReviewCard({ role, profileData, onConfirm, onEdit, onCancel }) {
    const card = document.createElement("div");
    card.className = "ai-action-card ai-signup-card";
    const roleMeta = ROLE_DEFINITIONS[role] || { label: role, badge: "Profile Review" };
    let summaryRows = "";
    for (const [key, val] of Object.entries(profileData)) {
      if (val === void 0 || val === null || val === "" || typeof val === "object" && Object.keys(val).length === 0) continue;
      const label = key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
      let displayVal = val;
      if (key === "primary_contact" && typeof val === "object") {
        const parts = [];
        if (val.full_name) parts.push(`Name: ${val.full_name}`);
        if (val.designation) parts.push(`Designation: ${val.designation}`);
        if (val.phone) parts.push(`Phone: ${val.phone}`);
        displayVal = parts.join(", ");
      } else if (Array.isArray(val)) {
        if (val.length === 0) continue;
        if (typeof val[0] === "object") {
          displayVal = val.map((item) => Object.values(item).filter(Boolean).join(" - ")).join("; ");
        } else {
          displayVal = val.join(", ");
        }
      } else if (typeof val === "object") {
        displayVal = Object.entries(val).map(([k, v]) => `${k}: ${v}`).join(", ");
      }
      summaryRows += `
      <div class="ai-action-param-row">
        <span class="ai-action-param-key">${escapeHtml2(label)}:</span>
        <span class="ai-action-param-val">${escapeHtml2(String(displayVal))}</span>
      </div>
    `;
    }
    card.innerHTML = `
    <div class="ai-action-header">
      <span class="ai-action-badge">${escapeHtml2(roleMeta.badge)}</span>
      <span class="ai-action-title">Review &amp; Confirm Your Profile</span>
    </div>
    <p class="ai-action-explanation">Please review the details below. Once confirmed, your profile will be created and your assistant will be ready for account actions.</p>
    <div class="ai-action-details">${summaryRows}</div>
    <div class="ai-review-msg" style="display: none; color: #dc2626; font-size: 13px; margin: 8px 0;"></div>
    <div class="ai-action-controls" style="margin-top: 14px;">
      <button type="button" class="ai-btn-action-confirm ai-btn-complete">Confirm &amp; Complete Registration</button>
      <button type="button" class="ai-btn-edit" style="background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px;">Edit</button>
      <button type="button" class="ai-btn-action-cancel">Cancel</button>
    </div>
  `;
    const confirmBtn = card.querySelector(".ai-btn-complete");
    const editBtn = card.querySelector(".ai-btn-edit");
    const cancelBtn = card.querySelector(".ai-btn-action-cancel");
    const msgBox = card.querySelector(".ai-review-msg");
    confirmBtn.addEventListener("click", async () => {
      msgBox.style.display = "none";
      let valRes;
      if (role === "candidate") {
        valRes = validateCandidateProfile(profileData, { mode: "onboarding" });
      } else if (role === "client") {
        valRes = validateClientProfile(profileData, { mode: "onboarding" });
      } else if (role === "consultancy") {
        valRes = validateConsultancyProfile(profileData, { mode: "onboarding" });
      }
      if (valRes && !valRes.isValid) {
        msgBox.textContent = valRes.firstError || "Profile validation failed. Please edit your details.";
        msgBox.style.display = "block";
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Saving & Verifying...";
      try {
        await onConfirm();
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirm & Complete Registration";
        msgBox.textContent = err.message || "Could not complete registration.";
        msgBox.style.display = "block";
      }
    });
    editBtn.addEventListener("click", () => {
      card.remove();
      onEdit();
    });
    cancelBtn.addEventListener("click", () => {
      card.remove();
      if (onCancel) onCancel();
    });
    return card;
  }

  // widget/src/widget.js
  var ICONS = {
    chat: `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    minimize: `<svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14v2z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
    send: `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
    stop: `<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>`,
    copy: `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
    check: `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
    attachment: `<svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 0 0 6 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>`
  };
  var AssistantWidgetUI = class {
    constructor(options, apiClient, storage, events) {
      this.options = options;
      this.apiClient = apiClient;
      this.storage = storage;
      this.events = events;
      this._initialGreeting = options.greeting || "";
      this._initialSuggestedPrompts = Array.isArray(options.suggestedPrompts) ? [...options.suggestedPrompts] : [];
      this.isOpen = false;
      this.isGenerating = false;
      this.abortController = null;
      this.documentUploadController = null;
      this.hirePoolResume = new HirePoolResumeUpload(
        apiClient,
        (state) => this._renderHirePoolResumeState(state)
      );
      this.hirePoolResumeCard = null;
      this.hirePoolSignup = new HirePoolSignupCoordinator({
        apiClient: this.apiClient,
        onAuthenticated: async (session) => {
          await this._handleHirePoolSignupSuccess(session);
        },
        onStateChange: (state, data) => {
          this._renderHirePoolSignupState(state, data);
        }
      });
      this.hirePoolSignupCard = null;
      this._verificationPollTimer = null;
      this._verificationFocusHandler = null;
      this._verificationVisibilityHandler = null;
      this.hostIdentity = null;
      this.messages = [];
      this.activeConversationId = null;
      this.contextOverrideSet = false;
      this.hostElement = null;
      this.shadowRoot = null;
    }
    /**
     * Mount widget into the DOM
     */
    mount(cssContent = "") {
      if (this.hostElement && this.hostElement.parentNode) {
        return;
      }
      if (document.getElementById("ai-assistant-plugin-root")) {
        throw new Error("An AI Assistant widget is already mounted on this page.");
      }
      this.hostElement = document.createElement("div");
      this.hostElement.id = "ai-assistant-plugin-root";
      this.shadowRoot = this.hostElement.attachShadow({ mode: "open" });
      const styleTag = document.createElement("style");
      styleTag.textContent = cssContent;
      this.shadowRoot.appendChild(styleTag);
      this._buildDOM();
      this._restoreState();
      this._attachEvents();
      this._authMessageHandler = (event) => {
        if (!event.data || typeof event.data !== "object") return;
        if (event.data.type === "hirepool-auth:logout") {
          void this._handleHirePoolLogout({ loggedOut: true }, "You have been logged out of HirePool.");
        }
      };
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("message", this._authMessageHandler);
      }
      document.body.appendChild(this.hostElement);
    }
    /**
     * Unmount widget and clean up DOM
     */
    unmount() {
      if (this._authMessageHandler && typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("message", this._authMessageHandler);
        this._authMessageHandler = null;
      }
      this._stopVerificationWatcher();
      if (this.abortController) {
        this.abortController.abort();
      }
      this.cancelDocumentUpload();
      if (this.hirePoolResume.state === HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION) {
        void this.hirePoolResume.cancel();
      }
      if (this.hirePoolSignup && this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.IDLE) {
        void this.hirePoolSignup.cancel();
      }
      if (this.hostElement && this.hostElement.parentNode) {
        this.hostElement.parentNode.removeChild(this.hostElement);
      }
      this.hostElement = null;
      this.shadowRoot = null;
    }
    _buildDOM() {
      const { name, theme, position, primaryColor, greeting, suggestedPrompts, avatarUrl } = this.options;
      const container = document.createElement("div");
      container.className = `ai-widget-container pos-${position || "bottom-right"}`;
      container.setAttribute("data-theme", theme || "auto");
      if (primaryColor) {
        container.style.setProperty("--ai-primary", primaryColor);
        container.style.setProperty("--ai-user-bubble", primaryColor);
      }
      this.container = container;
      const launcherBtn = document.createElement("button");
      launcherBtn.className = "ai-launcher-btn";
      launcherBtn.type = "button";
      launcherBtn.setAttribute("aria-label", `Open ${name}`);
      launcherBtn.setAttribute("aria-haspopup", "dialog");
      launcherBtn.setAttribute("aria-expanded", "false");
      launcherBtn.innerHTML = `
      <span class="icon-chat">${ICONS.chat}</span>
      <span class="icon-close">${ICONS.close}</span>
    `;
      this.launcherBtn = launcherBtn;
      const panel = document.createElement("div");
      panel.className = "ai-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", name);
      const avatarHtml = avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)} avatar"/>` : escapeHtml(name.charAt(0).toUpperCase());
      panel.innerHTML = `
      <header class="ai-header">
        <div class="ai-header-info">
          <div class="ai-avatar">${avatarHtml}</div>
          <div class="ai-header-titles">
            <span class="ai-title">${escapeHtml(name)}</span>
            <span class="ai-status">
              <span class="ai-status-dot"></span>
              <span class="ai-status-text">Online</span>
            </span>
          </div>
        </div>
        <div class="ai-header-actions">
          <button class="ai-icon-btn btn-new-chat" type="button" title="New Conversation" aria-label="Start new conversation">
            ${ICONS.refresh}
          </button>
          <button class="ai-icon-btn btn-close" type="button" title="Close" aria-label="Close chat panel">
            ${ICONS.close}
          </button>
        </div>
      </header>

      <main class="ai-body" role="log" aria-live="polite" aria-relevant="additions text">
        <div class="ai-welcome-box">
          <div class="ai-welcome-greeting">${escapeHtml(greeting)}</div>
          ${suggestedPrompts && suggestedPrompts.length > 0 ? `
            <div class="ai-suggested-prompts">
            <div class="ai-suggested-prompts-label">Suggested Prompts</div>
            <div class="ai-prompts-list">
              ${suggestedPrompts.map((p) => `<button type="button" class="ai-prompt-pill">${escapeHtml(p)}</button>`).join("")}
            </div>
            </div>
          ` : ""}
        </div>
        <div class="ai-messages-list"></div>
        <div class="ai-streaming-indicator" style="display: none;">
          <span class="ai-typing-dot"></span>
          <span class="ai-typing-dot"></span>
          <span class="ai-typing-dot"></span>
        </div>
      </main>

      <footer class="ai-footer">
        <form class="ai-input-form">
          <button class="ai-attach-btn" type="button" aria-label="Upload document" title="Upload a document (PDF, DOCX, TXT)">
            ${ICONS.attachment}
          </button>
          <input type="file" class="ai-file-input" accept=".pdf,.docx,.txt,.text,.md,.markdown,.csv,.json,.log,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/json" style="display: none;" />
          <textarea
            class="ai-textarea"
            placeholder="Ask a question or request a summary..."
            rows="1"
            aria-label="Message input"
            maxlength="10000"
          ></textarea>
          <button class="ai-send-btn" type="submit" aria-label="Send message" disabled>
            ${ICONS.send}
          </button>
          <button class="ai-stop-btn" type="button" aria-label="Stop generating" style="display: none;">
            ${ICONS.stop}
          </button>
        </form>
        <div class="ai-footer-note">Press Enter to send, Shift+Enter for newline</div>
      </footer>
    `;
      this.panel = panel;
      this.messagesList = panel.querySelector(".ai-messages-list");
      this.streamingIndicator = panel.querySelector(".ai-streaming-indicator");
      this.statusDot = panel.querySelector(".ai-status-dot");
      this.statusText = panel.querySelector(".ai-status-text");
      this.textarea = panel.querySelector(".ai-textarea");
      this.sendBtn = panel.querySelector(".ai-send-btn");
      this.stopBtn = panel.querySelector(".ai-stop-btn");
      this.attachBtn = panel.querySelector(".ai-attach-btn");
      this.fileInput = panel.querySelector(".ai-file-input");
      if (this._isHirePoolResumeEnabled()) {
        this.attachBtn.disabled = true;
        this.attachBtn.title = "Sign in to a verified HirePool candidate account to upload a resume.";
        this.attachBtn.setAttribute("aria-label", this.attachBtn.title);
      }
      this.fileInput.accept = this._isHirePoolResumeEnabled() ? ".pdf,application/pdf" : this.options.documentUpload?.allowedExtensions?.join(",") || ".pdf,.docx,.txt";
      this.body = panel.querySelector(".ai-body");
      container.appendChild(panel);
      container.appendChild(launcherBtn);
      this.shadowRoot.appendChild(container);
    }
    _attachEvents() {
      this.launcherBtn.addEventListener("click", () => {
        this.toggle();
      });
      this.panel.querySelector(".btn-close").addEventListener("click", () => {
        this.close();
      });
      this.panel.querySelector(".btn-new-chat").addEventListener("click", () => {
        this.newConversation();
      });
      this.stopBtn.addEventListener("click", () => {
        this.cancelGeneration();
      });
      this.panel.querySelectorAll(".ai-prompt-pill").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const text = e.target.textContent.trim();
          if (text) {
            this.sendMessage(text);
          }
        });
      });
      this.textarea.addEventListener("input", () => {
        this.textarea.style.height = "auto";
        this.textarea.style.height = Math.min(this.textarea.scrollHeight, 120) + "px";
        this.sendBtn.disabled = !this.textarea.value.trim() || this.isGenerating;
      });
      this.textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const text = this.textarea.value.trim();
          if (text && !this.isGenerating) {
            this.sendMessage(text);
          }
        }
      });
      this.panel.querySelector(".ai-input-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const text = this.textarea.value.trim();
        if (text && !this.isGenerating) {
          this.sendMessage(text);
        }
      });
      if (this.attachBtn && this.fileInput) {
        this.attachBtn.addEventListener("click", () => {
          if (this.isGenerating) return;
          if (this._isHirePoolResumeEnabled() && this.hirePoolResume.state === HIREPOOL_RESUME_STATES.UPLOADING) return;
          this.fileInput.click();
        });
        this.fileInput.addEventListener("change", (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          this.fileInput.value = "";
          if (this._isHirePoolResumeEnabled()) {
            this._handleHirePoolResumeFile(file);
          } else {
            this._handleFileUpload(file);
          }
        });
      }
      this.panel.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isOpen) {
          this.close();
        }
      });
      this.messagesList.addEventListener("click", (e) => {
        const copyBtn = e.target.closest(".ai-msg-action-btn") || e.target.closest(".copy-code-btn");
        if (copyBtn) {
          this._handleCopyClick(copyBtn);
        }
        const retryBtn = e.target.closest(".ai-error-retry-btn");
        if (retryBtn) {
          if (typeof this._lastErrorRetryCallback === "function") {
            const callback = this._lastErrorRetryCallback;
            this._lastErrorRetryCallback = null;
            retryBtn.disabled = true;
            retryBtn.textContent = "Verifying...";
            void (async () => {
              try {
                const banner = retryBtn.closest(".ai-error-banner");
                if (banner && banner.parentNode) {
                  banner.parentNode.removeChild(banner);
                }
                await callback();
              } catch (retryErr) {
                this._renderErrorBanner(
                  retryErr?.message || "Verification retry failed. Please try again.",
                  callback
                );
              }
            })();
            return;
          }
          const lastUserMsg = [...this.messages].reverse().find((m) => m.role === "user");
          if (lastUserMsg) {
            this.sendMessage(lastUserMsg.content);
          }
        }
      });
    }
    _handleCopyClick(btn) {
      let textToCopy = "";
      if (btn.classList.contains("copy-code-btn")) {
        const wrapper = btn.closest(".code-block-wrapper");
        textToCopy = wrapper ? wrapper.querySelector("code").innerText : "";
      } else {
        const row = btn.closest(".ai-message-row");
        textToCopy = row ? row.getAttribute("data-raw-content") : "";
      }
      if (textToCopy && navigator.clipboard) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          const originalText = btn.innerHTML;
          btn.innerHTML = btn.classList.contains("copy-code-btn") ? "Copied!" : `${ICONS.check} Copied`;
          setTimeout(() => {
            btn.innerHTML = originalText;
          }, 2e3);
        }).catch((err) => {
          console.warn("Copy failed:", err);
        });
      }
    }
    _restoreState() {
      const savedSession = this.storage.get("hirepool_session", null);
      if (savedSession && savedSession.credential) {
        this.apiClient.setAuthenticatedSession(savedSession);
        this.hostIdentity = savedSession.identity;
        if (typeof this.storage.setUser === "function") {
          this.storage.setUser(savedSession.identity?.id);
        }
        if (this.options.integration) {
          this.options.integration.getAuthHeaders = async () => ({ Authorization: `Bearer ${savedSession.credential}` });
          this.options.integration.getSessionScope = async () => savedSession.sessionScope;
          this.options.integration.getIdentity = async () => savedSession.identity;
          if (typeof this.options.integration.setSession === "function") {
            this.options.integration.setSession(savedSession);
          }
        }
        void this.apiClient.validateHirePoolSession(savedSession.credential).then((validation) => {
          if (!validation?.valid) {
            this._clearSessionAndFallbackToGuest();
          }
        }).catch(() => {
          this._clearSessionAndFallbackToGuest();
        });
      }
      const savedConvoId = this.storage.getConversationId();
      const savedMessages = this.storage.get("messages", []);
      this.activeConversationId = savedConvoId;
      if (Array.isArray(savedMessages) && savedMessages.length > 0) {
        this.messages = savedMessages;
        this.messages.forEach((msg) => {
          this._renderMessageBubble(msg.role, msg.content, false, msg.action);
        });
      }
      const wasOpen = this.storage.get("is_open", false);
      if (wasOpen) {
        this.open();
      }
      if (this._isGuestSession() && this._isHirePoolSignupEnabled()) {
        const savedSignup = this.storage.getSignupProgress?.();
        if (savedSignup) {
          void this.hirePoolSignup.restoreProgress(savedSignup).catch(() => {
            this.storage.clearSignupProgress?.();
          });
        }
      }
    }
    _clearHirePoolContextAuth() {
      const ctx = this.options?.context;
      if (!ctx) return;
      if (typeof ctx === "object" && !Array.isArray(ctx)) {
        if ("authentication" in ctx || "identity" in ctx) {
          const sanitized = { ...ctx };
          delete sanitized.authentication;
          delete sanitized.identity;
          this.options.context = sanitized;
        }
        return;
      }
      if (typeof ctx === "string" && ctx.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(ctx);
          if (parsed && typeof parsed === "object" && ("authentication" in parsed || "identity" in parsed)) {
            delete parsed.authentication;
            delete parsed.identity;
            this.options.context = JSON.stringify(parsed);
          }
        } catch {
        }
      }
    }
    _resetHirePoolIntegrationToGuest() {
      this._clearHirePoolContextAuth();
      const integration = this.options?.integration;
      if (integration) {
        integration.getAuthHeaders = async () => ({});
        integration.getSessionScope = async () => "guest";
        integration.getIdentity = async () => null;
        if ("authHeadersProvider" in integration) integration.authHeadersProvider = () => ({});
        if ("sessionScopeProvider" in integration) integration.sessionScopeProvider = () => "guest";
        if ("identityProvider" in integration) integration.identityProvider = () => null;
      }
      if (this.apiClient) {
        this.apiClient.clearAuthenticatedSession();
        this.apiClient.clearDemoToken?.();
        this.apiClient.getAuthHeaders = integration ? () => integration.getAuthHeaders() : null;
      }
    }
    _clearSessionAndFallbackToGuest() {
      this.storage.remove("hirepool_session");
      this._resetHirePoolIntegrationToGuest();
      if (typeof this.storage.setUser === "function") {
        this.storage.setUser(null);
      }
      this.storage.remove("hirepool_session");
      this.storage.clear();
      this.activeConversationId = null;
      this.messages = [];
      if (this.messagesList) {
        this.messagesList.innerHTML = "";
      }
      this.setHostIdentity(null, "guest");
      this.setGreeting(this._initialGreeting || "", this._initialSuggestedPrompts || []);
      this._persistState();
    }
    async _handleHirePoolLogout(logoutInfo = {}, confirmationMessage = null) {
      this.cancelGeneration();
      this.cancelDocumentUpload();
      this._stopVerificationWatcher();
      this._dismissRecoverableBanner();
      this.hirePoolResume?.reset?.();
      this.storage.clearSignupProgress?.();
      if (this.hirePoolSignupCard) {
        this.hirePoolSignupCard.remove();
        this.hirePoolSignupCard = null;
      }
      if (this.hirePoolSignup && this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.IDLE) {
        this.hirePoolSignup.state = HIREPOOL_SIGNUP_STATES.IDLE;
        this.hirePoolSignup.selectedRole = null;
        this.hirePoolSignup.agreement = null;
        this.hirePoolSignup.session = null;
        this.hirePoolSignup.verificationUrl = null;
        this.hirePoolSignup.profileData = {};
        this.hirePoolSignup.missingFields = [];
      }
      const integration = this.options?.integration;
      for (const hook of [
        integration?.clearSession,
        integration?.logout,
        integration?.onLogout,
        integration?.logoutHandler,
        this.options?.onLogout
      ]) {
        if (typeof hook === "function") {
          try {
            await hook.call(integration || this.options, logoutInfo);
          } catch {
          }
        }
      }
      this.storage.remove("hirepool_session");
      this.storage.clear();
      this._resetHirePoolIntegrationToGuest();
      if (typeof this.storage.setUser === "function") {
        this.storage.setUser(null);
      }
      this.storage.remove("hirepool_session");
      this.storage.clear();
      this.activeConversationId = null;
      this.messages = [];
      if (this.messagesList) {
        this.messagesList.innerHTML = "";
      }
      this.setHostIdentity(null, "guest");
      this.setGreeting(this._initialGreeting || "", this._initialSuggestedPrompts || []);
      this._persistState();
      this._setGenerating(false);
      if (confirmationMessage) {
        this._renderMessageBubble("assistant", confirmationMessage, false);
      }
      this.events.emit("auth:logout", logoutInfo || { loggedOut: true });
      this.events.emit("conversation:cleared");
    }
    _persistState() {
      this.storage.set("messages", this.messages.map((message) => message.action?.action === "hirepool_begin_login" || message.action?.parameters?.continuationReference ? { ...message, action: { ...message.action, parameters: {} } } : message));
      this.storage.saveConversationId(this.activeConversationId);
      this.storage.set("is_open", this.isOpen);
    }
    open() {
      if (this.isOpen) return;
      this.isOpen = true;
      this.container.classList.add("is-open");
      this.launcherBtn.setAttribute("aria-expanded", "true");
      this._persistState();
      this.events.emit("open");
      setTimeout(() => {
        this.textarea.focus();
        this._scrollToBottom();
      }, 100);
    }
    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.container.classList.remove("is-open");
      this.launcherBtn.setAttribute("aria-expanded", "false");
      this._persistState();
      this.events.emit("close");
      this.launcherBtn.focus();
    }
    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }
    setTheme(theme) {
      if (["light", "dark", "auto"].includes(theme)) {
        this.container.setAttribute("data-theme", theme);
        this.options.theme = theme;
      }
    }
    setPosition(pos) {
      ["bottom-right", "bottom-left", "top-right", "top-left"].forEach((p) => {
        this.container.classList.remove(`pos-${p}`);
      });
      this.container.classList.add(`pos-${pos}`);
      this.options.position = pos;
    }
    setContext(context, override = true) {
      this.options.context = context;
      this.contextOverrideSet = override;
    }
    setGreeting(greeting, suggestedPrompts = []) {
      const welcome = this.panel?.querySelector(".ai-welcome-box");
      const greetingElement = welcome?.querySelector(".ai-welcome-greeting");
      if (!welcome || !greetingElement) return;
      greetingElement.textContent = greeting;
      this.options.greeting = greeting;
      this.options.suggestedPrompts = suggestedPrompts;
      let promptSection = welcome.querySelector(".ai-suggested-prompts");
      if (!suggestedPrompts.length) {
        promptSection?.remove();
        return;
      }
      if (!promptSection) {
        promptSection = document.createElement("div");
        promptSection.className = "ai-suggested-prompts";
        promptSection.innerHTML = '<div class="ai-suggested-prompts-label">Suggested Prompts</div><div class="ai-prompts-list"></div>';
        greetingElement.insertAdjacentElement("afterend", promptSection);
      }
      const promptList = promptSection.querySelector(".ai-prompts-list");
      promptList.replaceChildren(...suggestedPrompts.map((prompt) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ai-prompt-pill";
        button.textContent = prompt;
        button.addEventListener("click", () => this.sendMessage(prompt));
        return button;
      }));
    }
    async newConversation() {
      if (this.hirePoolResume.state === HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION) {
        if (!await this.hirePoolResume.cancel()) return false;
      } else if (this.hirePoolResume.state === HIREPOOL_RESUME_STATES.PREPARING || this.hirePoolResume.state === HIREPOOL_RESUME_STATES.UPLOADING) {
        this._renderHirePoolResumeError("Wait for the current resume operation to finish before starting a new chat.");
        return false;
      }
      this.cancelGeneration();
      this.cancelDocumentUpload();
      this._stopVerificationWatcher();
      if (this.activeConversationId) {
        try {
          await this.apiClient.clearSession(this.activeConversationId);
        } catch (err) {
          this._renderErrorBanner(`Could not clear the previous conversation: ${err.message}`);
          this.events.emit("error", err);
          return false;
        }
      }
      this.activeConversationId = null;
      this.messages = [];
      this.messagesList.innerHTML = "";
      this.hirePoolResume.reset();
      if (this.hirePoolSignup && this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.IDLE) {
        await this.hirePoolSignup.cancel();
      }
      this.storage.clear();
      this._persistState();
      this._setGenerating(false);
      this.events.emit("conversation:cleared");
      this.textarea.focus();
      return true;
    }
    clearLocalConversation() {
      this.cancelGeneration();
      this.cancelDocumentUpload();
      this._stopVerificationWatcher();
      this.hirePoolResume.reset();
      if (this.hirePoolSignup && this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.IDLE) {
        void this.hirePoolSignup.cancel();
      }
      this.activeConversationId = null;
      this.messages = [];
      if (this.messagesList) {
        this.messagesList.innerHTML = "";
      }
      this._resetHirePoolIntegrationToGuest();
      this.setHostIdentity(null, "guest");
      if (typeof this.storage.setUser === "function") {
        this.storage.setUser(null);
      }
      this.storage.remove("hirepool_session");
      this.storage.clear();
      this.setGreeting(this._initialGreeting || "", this._initialSuggestedPrompts || []);
      this._persistState();
      this._setGenerating(false);
      this.events.emit("conversation:cleared");
    }
    cancelGeneration() {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      this._setGenerating(false);
    }
    _setGenerating(generating) {
      this.isGenerating = generating;
      if (generating) {
        this.statusDot.classList.add("busy");
        this.statusText.textContent = "Thinking...";
        this.sendBtn.style.display = "none";
        this.stopBtn.style.display = "flex";
        this.streamingIndicator.style.display = "flex";
      } else {
        this.statusDot.classList.remove("busy");
        this.statusText.textContent = "Online";
        this.sendBtn.style.display = "flex";
        this.stopBtn.style.display = "none";
        this.streamingIndicator.style.display = "none";
        this.sendBtn.disabled = !this.textarea.value.trim();
      }
    }
    _scrollToBottom() {
      this.body.scrollTop = this.body.scrollHeight;
    }
    _stripActionBlocks(text) {
      if (!text || typeof text !== "string") return "";
      return text.replace(/```(?:action:[a-zA-Z0-9_-]+|action)\s*\n[\s\S]*?\n```/gi, "").replace(/\n{3,}/g, "\n\n").trim();
    }
    _syncMessageActionState(action) {
      if (!action || !Array.isArray(this.messages)) return;
      for (const msg of this.messages) {
        if (msg?.action && (msg.action === action || action.id && msg.action.id === action.id)) {
          msg.action._status = action._status;
          msg.action._statusMessage = action._statusMessage;
        }
      }
      this._persistState();
    }
    _extractAction(text, actionProp) {
      if (actionProp && typeof actionProp === "object") {
        return actionProp;
      }
      if (!text || typeof text !== "string") return null;
      const match = text.match(/```(?:action:[a-zA-Z0-9_-]+|action)\s*\n([\s\S]*?)\n```/i);
      if (!match) return null;
      try {
        const data = JSON.parse(match[1].trim());
        if (data && data.action && data.title) {
          if (this.options?.assistantId === "hirepool") {
            const hasToken = typeof data.confirmationToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(data.confirmationToken);
            if (!hasToken) {
              return null;
            }
          }
          return data;
        }
      } catch {
      }
      return null;
    }
    _renderActionCard(bubble, action) {
      if (!action || !action.action) return;
      if (this.options?.assistantId === "hirepool" && action.requiresConfirmation === false && action.action !== "hirepool_login" && action.action !== "hirepool_signup") {
        return;
      }
      if (typeof this.options.hasActionHandler !== "function" || !this.options.hasActionHandler(action)) return;
      const actionId = action.id || action.action;
      if (bubble.querySelector(`[data-action-id="${escapeHtml(actionId)}"]`)) {
        return;
      }
      const card = document.createElement("div");
      card.className = "ai-action-card";
      card.setAttribute("data-action-id", actionId);
      card.setAttribute("data-action-type", action.action);
      this.events.emit("action:proposed", action);
      const risk = ["read", "write", "destructive"].includes(action.risk) ? action.risk : "write";
      const requiresAcknowledgement = risk === "destructive";
      const isHirePoolAccountAction = ["hirepool_login", "hirepool_signup"].includes(action.action);
      const accountButtonLabel = action.action === "hirepool_signup" ? "Sign up for HirePool" : "Log in to HirePool";
      const badgeLabel = isHirePoolAccountAction ? "HirePool account" : action.formattedReview ? "Review & Confirm" : "Application action";
      let detailsHtml = "";
      const hasReview = Boolean(action.formattedReview && typeof action.formattedReview === "object");
      if (hasReview) {
        const review = action.formattedReview;
        let rowsHtml = "";
        if (Array.isArray(review.fields)) {
          rowsHtml = `
          <table class="ai-review-table">
            <tbody>
              ${review.fields.map((f) => `
                <tr>
                  <th class="ai-review-key">${escapeHtml(f.label)}</th>
                  <td class="ai-review-val">${escapeHtml(f.value)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `;
        }
        let skillsHtml = "";
        if (Array.isArray(review.requiredSkills) && review.requiredSkills.length > 0) {
          skillsHtml += `
          <div class="ai-review-section">
            <div class="ai-review-section-title">Required Skills</div>
            <div class="ai-review-tags">
              ${review.requiredSkills.map((s) => `<span class="ai-review-tag">${escapeHtml(s)}</span>`).join("")}
            </div>
          </div>
        `;
        }
        if (Array.isArray(review.preferredSkills) && review.preferredSkills.length > 0) {
          skillsHtml += `
          <div class="ai-review-section">
            <div class="ai-review-section-title">Preferred Skills</div>
            <div class="ai-review-tags">
              ${review.preferredSkills.map((s) => `<span class="ai-review-tag preferred">${escapeHtml(s)}</span>`).join("")}
            </div>
          </div>
        `;
        }
        let descHtml = "";
        if (review.description && typeof review.description === "string" && review.description.trim()) {
          descHtml = `
          <div class="ai-review-section">
            <div class="ai-review-section-title">Job Description</div>
            <div class="ai-review-desc">${escapeHtml(review.description.trim())}</div>
          </div>
        `;
        }
        detailsHtml = `
        <div class="ai-review-card-content">
          ${rowsHtml}
          ${skillsHtml}
          ${descHtml}
        </div>
      `;
      } else {
        const params = action.parameters?.body || action.parameters || {};
        let paramRowsHtml = "";
        for (const [key, val] of Object.entries(params)) {
          if (key === "continuationReference" || key === "confirmationToken" || val === void 0 || val === null || val === "") continue;
          const formattedKey = key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
          let formattedVal = "";
          if (typeof val === "object") {
            if (Array.isArray(val)) {
              formattedVal = val.join(", ");
            } else {
              formattedVal = Object.entries(val).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ");
            }
          } else {
            formattedVal = String(val);
          }
          paramRowsHtml += `
          <div class="ai-action-param-row">
            <span class="ai-action-param-key">${escapeHtml(formattedKey)}:</span>
            <span class="ai-action-param-val">${escapeHtml(formattedVal)}</span>
          </div>
        `;
        }
        if (paramRowsHtml) {
          detailsHtml = `<div class="ai-action-details">${paramRowsHtml}</div>`;
        }
      }
      const titleText = action.formattedReview?.title || action.title || "Review Action";
      const confirmBtnLabel = action.formattedReview?.type === "job_creation" ? "Confirm &amp; Create" : isHirePoolAccountAction ? accountButtonLabel : "Confirm &amp; Execute";
      card.innerHTML = `
      <div class="ai-action-header">
        <span class="ai-action-badge">${badgeLabel}</span>
        <span class="ai-action-risk risk-${risk}">${risk === "destructive" ? "Destructive" : risk === "read" ? "Read" : "Write"}</span>
        <span class="ai-action-title">${escapeHtml(titleText)}</span>
      </div>
      ${action.explanation ? `<p class="ai-action-explanation">${escapeHtml(action.explanation)}</p>` : ""}
      ${detailsHtml}
      ${requiresAcknowledgement ? `
        <label class="ai-action-acknowledgement">
          <input type="checkbox" class="ai-action-acknowledge">
          I understand this action may be difficult to undo.
        </label>
      ` : ""}
      <div class="ai-action-status-msg" style="display: none;"></div>
      <div class="ai-action-controls">
        <button type="button" class="ai-btn-action-confirm" ${requiresAcknowledgement ? "disabled" : ""}>${confirmBtnLabel}</button>
        ${hasReview ? '<button type="button" class="ai-btn-action-edit">Edit details</button>' : ""}
        <button type="button" class="ai-btn-action-cancel">${isHirePoolAccountAction ? "Not now" : "Cancel"}</button>
      </div>
    `;
      const btnConfirm = card.querySelector(".ai-btn-action-confirm");
      const btnCancel = card.querySelector(".ai-btn-action-cancel");
      const btnEdit = card.querySelector(".ai-btn-action-edit");
      const statusMsg = card.querySelector(".ai-action-status-msg");
      const controls = card.querySelector(".ai-action-controls");
      const acknowledgement = card.querySelector(".ai-action-acknowledge");
      if (action._status && action._status !== "pending") {
        if (controls) controls.style.display = "none";
        if (acknowledgement) acknowledgement.disabled = true;
        btnConfirm.disabled = true;
        btnCancel.disabled = true;
        if (btnEdit) btnEdit.disabled = true;
        statusMsg.style.display = "flex";
        statusMsg.className = `ai-action-status-msg ${action._status === "completed" ? "success" : action._status}`;
        statusMsg.textContent = action._statusMessage || (action._status === "completed" ? "Action executed successfully!" : action._status === "cancelled" ? "Action cancelled." : "Action could not be completed.");
        bubble.appendChild(card);
        this._scrollToBottom();
        return;
      }
      if (btnEdit) {
        btnEdit.addEventListener("click", () => {
          this.textarea.focus();
          this.textarea.placeholder = "Type changes to profile, job, or candidate details...";
          this._scrollToBottom();
        });
      }
      let executing = false;
      let timeoutId = null;
      acknowledgement?.addEventListener("change", () => {
        btnConfirm.disabled = !acknowledgement.checked;
      });
      btnConfirm.addEventListener("click", () => {
        if (executing || action._status && action._status !== "pending") return;
        if (action.action === "hirepool_signup") {
          card.remove();
          void this._startHirePoolSignup(action.parameters?.role || null);
          return;
        }
        executing = true;
        btnConfirm.disabled = true;
        btnCancel.disabled = true;
        statusMsg.style.display = "flex";
        statusMsg.className = "ai-action-status-msg executing";
        statusMsg.textContent = isHirePoolAccountAction ? "Opening HirePool login..." : "Executing action in the host application...";
        let handled = false;
        timeoutId = setTimeout(() => {
          if (!handled && executing) {
            executing = false;
            statusMsg.style.display = "flex";
            statusMsg.className = "ai-action-status-msg error";
            if (action.confirmationToken) {
              const timeoutMsg = "The confirmation result was not received. Do not retry this write; check HirePool application history before asking for a fresh readiness check.";
              statusMsg.textContent = timeoutMsg;
              controls.style.display = "none";
              action._status = "error";
              action._statusMessage = timeoutMsg;
              this._syncMessageActionState(action);
            } else {
              statusMsg.textContent = "Action timed out before confirmation completed. Click Retry to try again or Cancel to dismiss.";
              btnConfirm.disabled = false;
              btnCancel.disabled = false;
              btnConfirm.textContent = "Retry";
            }
          }
        }, 15e3);
        this.events.emit("action:execute", {
          actionId: action.id,
          action: action.action,
          parameters: action.parameters || {},
          confirmationToken: action.confirmationToken,
          resolve: (result) => {
            handled = true;
            executing = false;
            clearTimeout(timeoutId);
            const successMsg = result?.message || "Action executed successfully!";
            statusMsg.style.display = "flex";
            statusMsg.className = "ai-action-status-msg success";
            statusMsg.innerHTML = `${ICONS.check} ${escapeHtml(successMsg)}`;
            controls.style.display = "none";
            action._status = "completed";
            action._statusMessage = successMsg;
            this._syncMessageActionState(action);
            this.events.emit("action:success", { actionId: action.id, action: action.action, result });
            this._scrollToBottom();
          },
          reject: (err) => {
            handled = true;
            executing = false;
            clearTimeout(timeoutId);
            const errorMsg = err?.message || "Action failed";
            statusMsg.style.display = "flex";
            statusMsg.className = "ai-action-status-msg error";
            statusMsg.innerHTML = `\u26A0\uFE0F ${escapeHtml(errorMsg)}`;
            const isTerminalWriteError = Boolean(action.confirmationToken) || err?.status >= 400 && err?.status < 500;
            if (isTerminalWriteError) {
              controls.style.display = "none";
              action._status = "error";
              action._statusMessage = errorMsg;
              this._syncMessageActionState(action);
            } else {
              btnConfirm.disabled = false;
              btnCancel.disabled = false;
              btnConfirm.textContent = "Retry";
            }
            this.events.emit("action:error", { actionId: action.id, action: action.action, error: err });
            this._scrollToBottom();
          }
        });
      });
      btnCancel.addEventListener("click", () => {
        if (executing || action._status && action._status !== "pending") return;
        btnConfirm.disabled = true;
        btnCancel.disabled = true;
        clearTimeout(timeoutId);
        controls.style.display = "none";
        statusMsg.style.display = "flex";
        statusMsg.className = "ai-action-status-msg cancelled";
        statusMsg.textContent = "Action cancelled.";
        action._status = "cancelled";
        action._statusMessage = "Action cancelled.";
        this._syncMessageActionState(action);
        this.events.emit("action:cancel", {
          actionId: action.id,
          action: action.action,
          confirmationToken: action.confirmationToken
        });
        this._scrollToBottom();
      });
      bubble.appendChild(card);
      this._scrollToBottom();
    }
    _isHirePoolResumeEnabled() {
      return this.options.assistantId === "hirepool" && this.options.applicationId === "hirepool-local-app" && typeof this.apiClient.prepareHirePoolResume === "function";
    }
    setHostIdentity(identity, sessionScope = null) {
      this.hostIdentity = identity;
      const roleType = identity?.user_type || identity?.userType;
      if (this.attachBtn && this._isHirePoolResumeEnabled()) {
        const eligible = roleType === "candidate";
        this.attachBtn.disabled = !eligible;
        this.attachBtn.title = eligible ? "Attach a PDF resume" : "Sign in to a verified HirePool candidate account to upload a resume.";
        this.attachBtn.setAttribute("aria-label", this.attachBtn.title);
      }
      return this.hirePoolResume.setIdentity(identity, sessionScope);
    }
    _handleHirePoolResumeFile(file) {
      const roleType = this.hostIdentity?.user_type || this.hostIdentity?.userType;
      if (roleType !== "candidate") {
        this._renderHirePoolResumeError("Sign in to a verified HirePool candidate account to upload a resume.");
        return;
      }
      try {
        this.hirePoolResume.selectFile(file, this.activeConversationId);
      } catch (error) {
        this._renderHirePoolResumeError(error.message);
      }
    }
    _renderHirePoolResumeError(message) {
      const row = document.createElement("div");
      row.className = "ai-message-row assistant";
      const bubble = document.createElement("div");
      bubble.className = "ai-bubble";
      const error = document.createElement("p");
      error.className = "ai-action-status-msg error";
      error.textContent = message;
      bubble.appendChild(error);
      row.appendChild(bubble);
      this.messagesList.appendChild(row);
      this._scrollToBottom();
    }
    _renderHirePoolResumeState(state) {
      if (state.conversationId && !this.activeConversationId) {
        this.activeConversationId = state.conversationId;
        this._persistState();
      }
      const busy = state.state === HIREPOOL_RESUME_STATES.PREPARING || state.state === HIREPOOL_RESUME_STATES.UPLOADING;
      if (this.attachBtn && this._isHirePoolResumeEnabled()) {
        this.attachBtn.disabled = busy || this.hostIdentity?.user_type !== "candidate";
      }
      if (state.state === HIREPOOL_RESUME_STATES.IDLE) {
        this.hirePoolResumeCard?.remove();
        this.hirePoolResumeCard = null;
        return;
      }
      if (!this.messagesList) return;
      if (!this.hirePoolResumeCard) {
        const row = document.createElement("div");
        row.className = "ai-message-row assistant";
        const bubble = document.createElement("div");
        bubble.className = "ai-bubble";
        const card2 = document.createElement("section");
        card2.className = "ai-hirepool-resume-card";
        card2.setAttribute("aria-live", "polite");
        bubble.appendChild(card2);
        row.appendChild(bubble);
        this.messagesList.appendChild(row);
        this.hirePoolResumeCard = card2;
      }
      const card = this.hirePoolResumeCard;
      card.replaceChildren();
      const addText = (tagName, className, text) => {
        const node = document.createElement(tagName);
        if (className) node.className = className;
        node.textContent = text;
        card.appendChild(node);
        return node;
      };
      const addButton = (label, className, handler, disabled = false) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = label;
        button.disabled = disabled;
        button.addEventListener("click", handler);
        controls.appendChild(button);
        return button;
      };
      const controls = document.createElement("div");
      controls.className = "ai-hirepool-resume-controls";
      const filename = state.filename || "Selected resume";
      const size = Number.isInteger(state.fileSize) ? formatHirePoolResumeSize(state.fileSize) : "";
      const fileDescription = size ? `${filename} (${size})` : filename;
      if (state.state === HIREPOOL_RESUME_STATES.FILE_SELECTED) {
        addText("strong", "", fileDescription);
        addText("p", "", "Review the selected PDF before preparing a secure upload.");
        addButton("Remove", "ai-btn-resume-remove", () => this.hirePoolResume.removeFile());
        addButton("Prepare upload", "ai-btn-resume-prepare", () => {
          void this.hirePoolResume.prepare(this.activeConversationId);
        });
      } else if (state.state === HIREPOOL_RESUME_STATES.PREPARING) {
        addText("strong", "", "Preparing resume upload\u2026");
        addText("p", "", "Your PDF is being securely staged. It is not being sent to the assistant.");
        addText("span", "ai-spinner", "");
      } else if (state.state === HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION) {
        addText("strong", "", fileDescription);
        addText(
          "p",
          "",
          state.replacingExisting ? "Confirming will replace the resume currently stored in your HirePool profile." : "Confirm to upload this resume to your HirePool profile."
        );
        addButton("Confirm upload", "ai-btn-resume-confirm", () => {
          void this.hirePoolResume.confirm();
        });
        addButton("Cancel", "ai-btn-resume-cancel", () => {
          void this.hirePoolResume.cancel();
        });
      } else if (state.state === HIREPOOL_RESUME_STATES.UPLOADING) {
        addText("strong", "", state.message || "Uploading resume\u2026");
        addText("span", "ai-spinner", "");
      } else if (state.state === HIREPOOL_RESUME_STATES.UPLOAD_SUCCESS) {
        addText("strong", "", "Your resume was uploaded and verified by HirePool.");
      } else if (state.state === HIREPOOL_RESUME_STATES.UPLOAD_UNVERIFIED) {
        addText("strong", "", "HirePool may have accepted the resume, but the result could not be verified.");
        addText("p", "", "Check your HirePool profile before trying another upload.");
      } else if (state.state === HIREPOOL_RESUME_STATES.UPLOAD_FAILED) {
        addText("strong", "", state.error || "HirePool could not complete the resume operation.");
        if (state.filename) {
          addText("p", "", "You can select a PDF again after checking your HirePool profile.");
        }
      } else if (state.state === HIREPOOL_RESUME_STATES.CANCELLED) {
        addText("p", "ai-document-cancelled", "The prepared resume upload was cancelled.");
      }
      if (state.state === HIREPOOL_RESUME_STATES.FILE_SELECTED || state.state === HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION) {
        card.appendChild(controls);
      }
      this._scrollToBottom();
    }
    _stopVerificationWatcher() {
      if (this._verificationPollTimer) {
        clearInterval(this._verificationPollTimer);
        this._verificationPollTimer = null;
      }
      if (this._verificationFocusHandler && typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("focus", this._verificationFocusHandler);
        this._verificationFocusHandler = null;
      }
      if (this._verificationVisibilityHandler && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", this._verificationVisibilityHandler);
        this._verificationVisibilityHandler = null;
      }
    }
    _startVerificationWatcher() {
      this._stopVerificationWatcher();
      const triggerCheck = async () => {
        if (!this.hirePoolSignup || this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING && this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.VERIFICATION_PENDING) {
          this._stopVerificationWatcher();
          return;
        }
        try {
          await this.hirePoolSignup.checkVerificationStatus({ silent: true });
        } catch (err) {
          if (/expired/i.test(err?.message || "")) {
            this._stopVerificationWatcher();
          }
        }
      };
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        this._verificationFocusHandler = () => {
          void triggerCheck();
        };
        window.addEventListener("focus", this._verificationFocusHandler);
      }
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        this._verificationVisibilityHandler = () => {
          if (document.visibilityState === "visible") {
            void triggerCheck();
          }
        };
        document.addEventListener("visibilitychange", this._verificationVisibilityHandler);
      }
      let pollsRemaining = 100;
      this._verificationPollTimer = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          return;
        }
        pollsRemaining -= 1;
        if (pollsRemaining <= 0) {
          this._stopVerificationWatcher();
          return;
        }
        void triggerCheck();
      }, 3e3);
      this._verificationPollTimer.unref?.();
    }
    _renderHirePoolSignupState(state, data) {
      if (this.hirePoolSignupCard) {
        this.hirePoolSignupCard.remove();
        this.hirePoolSignupCard = null;
      }
      const isPendingVerificationState = state === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING || state === HIREPOOL_SIGNUP_STATES.VERIFICATION_PENDING;
      const isInProgressVerificationState = state === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_IN_PROGRESS || state === HIREPOOL_SIGNUP_STATES.VERIFICATION_IN_PROGRESS;
      if (!isPendingVerificationState && !isInProgressVerificationState) {
        this._stopVerificationWatcher();
      }
      if (state === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFIED) {
        this._appendAssistantSignupNotice(
          "Your email has been verified! Complete your HirePool profile details below to finish creating your account."
        );
      }
      const safeSnapshot = this.hirePoolSignup.getSafeProgressSnapshot?.();
      if (safeSnapshot) {
        this.storage.saveSignupProgress?.(safeSnapshot);
      } else {
        this.storage.clearSignupProgress?.();
      }
      if (state === HIREPOOL_SIGNUP_STATES.IDLE || state === HIREPOOL_SIGNUP_STATES.CANCELLED) {
        return;
      }
      const row = document.createElement("div");
      row.className = "ai-message-row assistant ai-signup-row";
      let card = null;
      if (state === HIREPOOL_SIGNUP_STATES.ROLE_SELECTION) {
        card = renderRoleSelectionCard({
          onSelect: (role) => void this.hirePoolSignup.selectRole(role),
          onCancel: () => void this.hirePoolSignup.cancel()
        });
      } else if (state === HIREPOOL_SIGNUP_STATES.SIGNUP_FORM) {
        card = renderSignupFormCard({
          role: data.role || this.hirePoolSignup.selectedRole,
          agreement: data.agreement || this.hirePoolSignup.agreement,
          onSubmit: (formData) => this.hirePoolSignup.submitSignup(formData),
          onCancel: () => void this.hirePoolSignup.cancel()
        });
      } else if (isPendingVerificationState || isInProgressVerificationState) {
        const verificationUrl = data.verificationUrl ?? this.hirePoolSignup.verificationUrl ?? null;
        if (isPendingVerificationState) {
          this._startVerificationWatcher();
        }
        card = renderVerificationCard({
          email: data.session?.email || this.hirePoolSignup.session?.email,
          verificationUrl,
          notVerifiedYet: Boolean(data.notVerifiedYet),
          message: data.message,
          error: data.error,
          onVerifyClick: (url) => {
            if (typeof window !== "undefined" && typeof window.open === "function") {
              window.open(url, "_blank", "noopener,noreferrer");
            }
            this._startVerificationWatcher();
          },
          onCheckStatus: () => this.hirePoolSignup.checkVerificationStatus(),
          onResend: () => this.hirePoolSignup.resendVerification(),
          onCancel: () => void this.hirePoolSignup.cancel()
        });
      } else if (state === HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION) {
        card = renderProfileCollectionCard({
          role: data.role || this.hirePoolSignup.selectedRole,
          profileData: data.profileData || this.hirePoolSignup.profileData,
          missingFields: data.missingFields || this.hirePoolSignup.missingFields,
          onReview: (updatedData) => {
            this.hirePoolSignup.profileData = { ...this.hirePoolSignup.profileData, ...updatedData };
            this.hirePoolSignup.setState(HIREPOOL_SIGNUP_STATES.PROFILE_REVIEW, {
              profileData: this.hirePoolSignup.profileData
            });
          },
          onCancel: () => void this.hirePoolSignup.cancel()
        });
      } else if (state === HIREPOOL_SIGNUP_STATES.PROFILE_REVIEW) {
        card = renderProfileReviewCard({
          role: data.role || this.hirePoolSignup.selectedRole,
          profileData: data.profileData || this.hirePoolSignup.profileData,
          onConfirm: () => this.hirePoolSignup.completeProfile(),
          onEdit: () => {
            this.hirePoolSignup.setState(HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION, {
              profileData: this.hirePoolSignup.profileData,
              missingFields: this.hirePoolSignup.missingFields
            });
          },
          onCancel: () => void this.hirePoolSignup.cancel()
        });
      }
      if (card) {
        this.hirePoolSignupCard = card;
        row.appendChild(card);
        this.messagesList.appendChild(row);
        this._scrollToBottom();
      }
    }
    async _handleHirePoolSignupSuccess(sessionData) {
      if (!sessionData?.credential) {
        throw new Error("Authentication transition failed: missing SDK session credential.");
      }
      const newUserId = sessionData.identity?.id;
      const previousSession = this.storage.get("hirepool_session", null);
      const previousUserId = previousSession?.identity?.id;
      if (typeof this.storage.setUser === "function") {
        this.storage.setUser(newUserId);
      }
      if (previousUserId && previousUserId !== newUserId) {
        this.activeConversationId = null;
        this.storage.clearConversationId();
        this.messages = [];
        if (this.messagesList) {
          this.messagesList.innerHTML = "";
        }
      }
      this.storage.clearSignupProgress?.();
      this.apiClient.setAuthenticatedSession(sessionData);
      this.storage.set("hirepool_session", sessionData);
      this.setHostIdentity(sessionData.identity, sessionData.sessionScope);
      if (this.options.integration) {
        this.options.integration.getAuthHeaders = async () => ({ Authorization: `Bearer ${sessionData.credential}` });
        this.options.integration.getSessionScope = async () => sessionData.sessionScope;
        this.options.integration.getIdentity = async () => sessionData.identity;
        if (typeof this.options.integration.setSession === "function") {
          this.options.integration.setSession(sessionData);
        }
      }
      const runSmokeTest = async () => {
        try {
          const smokeResult = await this.apiClient.validateHirePoolSession(sessionData.credential);
          if (!smokeResult?.valid) {
            throw new Error("HirePool could not validate the newly established session.");
          }
          this._dismissRecoverableBanner();
          this._displaySignupConfirmation(sessionData);
          this.events.emit("auth:session", sessionData);
          return true;
        } catch (smokeErr) {
          console.warn("[AI Assistant] Smoke test failed after account creation:", smokeErr);
          this._renderRecoverableWarningBanner(
            "Account created successfully! However, assistant session verification timed out.",
            "Retry Connection",
            () => runSmokeTest()
          );
          return false;
        }
      };
      await runSmokeTest();
    }
    _displaySignupConfirmation(sessionData) {
      const role = sessionData.role || sessionData.identity?.userType;
      let greeting = "Welcome to HirePool!";
      let prompts = [];
      let welcomeMsg = "";
      if (role === "candidate") {
        greeting = "Welcome back. I can help with matching jobs, applications, and your profile.";
        prompts = ["Find matching jobs", "View my profile", "My applications"];
        welcomeMsg = `\u{1F389} **Welcome to HirePool!** Your candidate account is verified and your profile is complete. You can now use the assistant to access your account and explore jobs.`;
      } else if (role === "client") {
        greeting = "Welcome back. I can help with your hiring dashboard and jobs.";
        prompts = ["View my jobs", "View company profile", "Dashboard stats"];
        welcomeMsg = `\u{1F389} **Welcome to HirePool!** Your company account is verified and your profile is complete. You can now use the assistant to manage your job listings and view applications.`;
      } else if (role === "consultancy") {
        greeting = "Welcome back. I can help with placements, bench candidates, and your consultancy dashboard.";
        prompts = ["View candidate pool", "Add a candidate", "Placement stats", "View agency profile"];
        welcomeMsg = `\u{1F389} **Welcome to HirePool!** Your consultancy account is verified and your profile is complete. You can now use the assistant to manage bench candidates, track placements, and view your consultancy dashboard.`;
      }
      this.setGreeting(greeting, prompts);
      this._renderMessageBubble("assistant", welcomeMsg);
      this.messages.push({ role: "assistant", content: welcomeMsg });
      this._persistState();
      const pillRow = document.createElement("div");
      pillRow.className = "ai-message-row assistant";
      const pillContainer = document.createElement("div");
      pillContainer.className = "ai-suggested-prompts";
      pillContainer.style.marginTop = "4px";
      pillContainer.style.marginBottom = "8px";
      prompts.forEach((promptText) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-prompt-chip";
        btn.textContent = promptText;
        btn.addEventListener("click", () => {
          this.sendMessage(promptText);
        });
        pillContainer.appendChild(btn);
      });
      pillRow.appendChild(pillContainer);
      this.messagesList.appendChild(pillRow);
      this._scrollToBottom();
    }
    _handleFileUpload(file) {
      if (!file) return;
      const settings = this.options.documentUpload;
      if (!settings?.enabled) {
        this._renderMessageBubble("assistant", "Document upload is disabled for this assistant.");
        return;
      }
      const filename = typeof file.name === "string" ? file.name : "document";
      const extension = "." + filename.split(".").pop().toLowerCase();
      if (!settings.allowedExtensions.includes(extension)) {
        this._renderMessageBubble("assistant", "Unsupported document type.");
        return;
      }
      if (!Number.isFinite(file.size) || file.size < 1 || file.size > settings.maxSizeBytes) {
        const limitMb = Math.floor(settings.maxSizeBytes / (1024 * 1024));
        this._renderMessageBubble("assistant", `Document exceeds the ${limitMb} MB upload limit or is empty.`);
        return;
      }
      const sizeFormatted = (file.size / 1024).toFixed(0) + " KB";
      const hasHostListener = Boolean(this.events?.listeners?.get("file:upload")?.size > 0);
      const consent = settings.consent;
      const consentId = `ai-document-consent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const row = document.createElement("div");
      row.className = "ai-message-row assistant";
      const bubble = document.createElement("div");
      bubble.className = "ai-bubble";
      const description = hasHostListener ? consent.hostDescription : consent.description;
      const checkboxLabel = hasHostListener ? consent.hostCheckboxLabel : consent.checkboxLabel;
      bubble.innerHTML = `
      <section class="ai-document-consent" role="group" aria-labelledby="${consentId}-title">
        <h3 id="${consentId}-title">${escapeHtml(consent.title)}</h3>
        <p>${escapeHtml(description)}</p>
        <label class="ai-document-consent-choice" for="${consentId}-accepted">
          <input id="${consentId}-accepted" type="checkbox" class="ai-document-consent-checkbox">
          <span>${escapeHtml(checkboxLabel)}</span>
        </label>
        <div class="ai-document-consent-controls">
          <button type="button" class="ai-btn-document-consent-accept" disabled>Continue</button>
          <button type="button" class="ai-btn-document-consent-cancel">Cancel</button>
        </div>
      </section>
    `;
      row.appendChild(bubble);
      this.messagesList.appendChild(row);
      this._scrollToBottom();
      const checkbox = bubble.querySelector(".ai-document-consent-checkbox");
      const acceptButton = bubble.querySelector(".ai-btn-document-consent-accept");
      const cancelButton = bubble.querySelector(".ai-btn-document-consent-cancel");
      checkbox.addEventListener("change", () => {
        acceptButton.disabled = !checkbox.checked;
      });
      acceptButton.addEventListener("click", () => {
        if (!checkbox.checked || acceptButton.disabled) return;
        this.events.emit("document:consent-accepted", { filename });
        this._processFileUpload(file, bubble, sizeFormatted, hasHostListener);
      });
      cancelButton.addEventListener("click", () => {
        bubble.innerHTML = '<p class="ai-document-cancelled">Document processing cancelled. The file was not sent.</p>';
        this.events.emit("document:consent-rejected", { filename });
        this._scrollToBottom();
      });
    }
    _processFileUpload(file, bubble, sizeFormatted, hasHostListener) {
      const filename = typeof file.name === "string" ? file.name : "document";
      const controller = new AbortController();
      this.documentUploadController = controller;
      const uploadMessage = `Uploaded document: ${filename} (${sizeFormatted})`;
      this.messages.push({ role: "user", content: uploadMessage });
      this._renderMessageBubble("user", uploadMessage);
      this._persistState();
      bubble.innerHTML = `
      <div class="ai-processing-state">
        <span class="ai-spinner"></span>
        <span>Processing <strong>${escapeHtml(filename)}</strong>...</span>
        <button type="button" class="ai-btn-document-cancel">Cancel</button>
      </div>
    `;
      const cancelButton = bubble.querySelector(".ai-btn-document-cancel");
      cancelButton.addEventListener("click", () => controller.abort(), { once: true });
      const showCancelled = () => {
        bubble.innerHTML = '<p class="ai-document-cancelled">Document processing cancelled.</p>';
        this.events.emit("document:cancelled", { filename });
        if (this.documentUploadController === controller) this.documentUploadController = null;
        this._scrollToBottom();
      };
      controller.signal.addEventListener("abort", showCancelled, { once: true });
      if (hasHostListener) {
        let handled = false;
        const timeout = setTimeout(() => {
          if (handled || controller.signal.aborted) return;
          handled = true;
          if (this.documentUploadController === controller) this.documentUploadController = null;
          bubble.innerHTML = '<p class="ai-action-status-msg error">The host application did not complete document processing in time.</p>';
          this._scrollToBottom();
        }, 45e3);
        this.events.emit("file:upload", {
          file,
          filename,
          fileSize: file.size,
          fileType: file.type,
          signal: controller.signal,
          resolve: (result) => {
            if (handled || controller.signal.aborted) return;
            handled = true;
            clearTimeout(timeout);
            if (this.documentUploadController === controller) this.documentUploadController = null;
            const message = typeof result?.message === "string" ? result.message : "The host application processed the document.";
            bubble.innerHTML = `<p class="ai-document-host-result">${escapeHtml(message)}</p>`;
            this.events.emit("document:host-processed", { filename, result });
            this._scrollToBottom();
          },
          reject: (error) => {
            if (handled || controller.signal.aborted) return;
            handled = true;
            clearTimeout(timeout);
            if (this.documentUploadController === controller) this.documentUploadController = null;
            bubble.innerHTML = `<p class="ai-action-status-msg error">${escapeHtml(error?.message || "The host application could not process this document.")}</p>`;
            this._scrollToBottom();
          }
        });
        controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
        return;
      }
      this.apiClient.uploadDocument(file, this.activeConversationId, {
        assistantId: this.config?.assistantId,
        consentAccepted: true,
        signal: controller.signal
      }).then(async (data) => {
        if (controller.signal.aborted) {
          await this.apiClient.removeDocument(data.conversationId, data.document.id);
          return;
        }
        if (data.conversationId && !this.activeConversationId) {
          this.activeConversationId = data.conversationId;
          this._persistState();
        }
        const doc = data.document;
        const wordsCount = doc.wordCount || Math.round(doc.textLength / 5) || 0;
        const pageInfo = doc.pageCount ? ` \u2022 ${doc.pageCount} page${doc.pageCount > 1 ? "s" : ""}` : "";
        bubble.innerHTML = `
        <div class="ai-doc-card">
          <div class="ai-doc-header">
            <div class="ai-doc-icon">\u{1F4C4}</div>
            <div class="ai-doc-details">
              <div class="ai-doc-title">${escapeHtml(doc.filename)}</div>
              <div class="ai-doc-meta">${escapeHtml(doc.fileType.toUpperCase())} \u2022 ${sizeFormatted}${pageInfo} \u2022 ${wordsCount} words</div>
            </div>
            <div class="ai-doc-badge">Ready for questions</div>
          </div>
          <p class="ai-doc-hint">You can ask questions about the extracted text. The text is temporary and limited to this conversation session.</p>
          <button type="button" class="ai-btn-document-remove" aria-label="Remove ${escapeHtml(doc.filename)} from this conversation">Remove document</button>
        </div>
      `;
        const knownDocuments = this.storage.get("documents", []);
        this.storage.set("documents", [...knownDocuments.filter((item) => item.id !== doc.id), doc]);
        this.messages.push({ role: "assistant", content: `Processed document: ${doc.filename}. Ready for questions.` });
        this._persistState();
        bubble.querySelector(".ai-btn-document-remove").addEventListener("click", async (event) => {
          event.currentTarget.disabled = true;
          try {
            await this.apiClient.removeDocument(this.activeConversationId, doc.id);
            const remaining = this.storage.get("documents", []).filter((item) => item.id !== doc.id);
            this.storage.set("documents", remaining);
            bubble.innerHTML = '<p class="ai-document-cancelled">Document removed from this conversation.</p>';
            this.events.emit("document:removed", doc);
          } catch (error) {
            event.currentTarget.disabled = false;
            this._renderErrorBanner(error.message);
            this.events.emit("error", error);
          }
          this._scrollToBottom();
        });
        this.events.emit("document:uploaded", doc);
        this._scrollToBottom();
      }).catch((error) => {
        if (error.name === "AbortError") return;
        bubble.innerHTML = `<p class="ai-action-status-msg error">${escapeHtml(error?.message || "Failed to process document")}</p>`;
        this._scrollToBottom();
      }).finally(() => {
        controller.signal.removeEventListener("abort", showCancelled);
        if (this.documentUploadController === controller) this.documentUploadController = null;
      });
    }
    cancelDocumentUpload() {
      this.documentUploadController?.abort();
      this.documentUploadController = null;
    }
    _renderMessageBubble(role, content, animate = true, action = null) {
      const row = document.createElement("div");
      row.className = `ai-message-row ${role}`;
      row.setAttribute("data-raw-content", content);
      const bubble = document.createElement("div");
      bubble.className = "ai-bubble";
      if (role === "user") {
        bubble.textContent = content;
        row.appendChild(bubble);
      } else {
        const renderedContent = this.options?.assistantId === "hirepool" ? this._stripActionBlocks(content) : content;
        bubble.innerHTML = parseMarkdown(renderedContent);
        const detectedAction = action || this._extractAction(content);
        if (detectedAction) {
          this._renderActionCard(bubble, detectedAction);
        }
        row.appendChild(bubble);
        const actions = document.createElement("div");
        actions.className = "ai-message-actions";
        actions.innerHTML = `
        <button class="ai-msg-action-btn" type="button" aria-label="Copy response">
          ${ICONS.copy} Copy
        </button>
      `;
        row.appendChild(actions);
      }
      this.messagesList.appendChild(row);
      this._scrollToBottom();
      return row;
    }
    _renderRecoverableWarningBanner(message, actionText = "Retry Connection", actionCallback = null) {
      this._dismissRecoverableBanner();
      const banner = document.createElement("div");
      banner.className = "ai-warning-banner ai-recoverable-banner";
      banner.style.cssText = "background: #fff3cd; color: #856404; border: 1px solid #ffeeba; border-radius: 8px; padding: 10px 14px; margin: 8px 12px; font-size: 13px; display: flex; align-items: center; justify-content: space-between; gap: 8px;";
      const textSpan = document.createElement("span");
      textSpan.textContent = message;
      banner.appendChild(textSpan);
      if (actionCallback) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-warning-action-btn";
        btn.style.cssText = "background: #856404; color: #ffffff; border: none; border-radius: 4px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;";
        btn.textContent = actionText;
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          btn.textContent = "Verifying...";
          try {
            await actionCallback();
          } finally {
            btn.disabled = false;
            btn.textContent = actionText;
          }
        });
        banner.appendChild(btn);
      }
      this._recoverableBanner = banner;
      this.messagesList.appendChild(banner);
      this._scrollToBottom();
    }
    _dismissRecoverableBanner() {
      if (this._recoverableBanner && this._recoverableBanner.parentNode) {
        this._recoverableBanner.parentNode.removeChild(this._recoverableBanner);
        this._recoverableBanner = null;
      }
    }
    _renderErrorBanner(message, retryCallback = null) {
      this._lastErrorRetryCallback = typeof retryCallback === "function" ? retryCallback : null;
      const banner = document.createElement("div");
      banner.className = "ai-error-banner";
      banner.innerHTML = `
      <span>${escapeHtml(message || "An error occurred. Please try again.")}</span>
      <button class="ai-error-retry-btn" type="button">Retry</button>
    `;
      this.messagesList.appendChild(banner);
      this._scrollToBottom();
    }
    displayHirePoolLoginNotice(message) {
      this._renderMessageBubble("assistant", message, false, {
        id: `hirepool-login-recovery-${Date.now()}`,
        action: "hirepool_login",
        title: "Sign in to HirePool",
        explanation: "Renew your HirePool session. The assistant will verify your account again after sign-in.",
        parameters: {},
        risk: "read",
        requiresConfirmation: true
      });
    }
    invalidatePendingActions(message) {
      for (const card of this.messagesList.querySelectorAll(".ai-action-card")) {
        if (["hirepool_login", "hirepool_signup"].includes(card.getAttribute("data-action-type"))) continue;
        const controls = card.querySelector(".ai-action-controls");
        const status = card.querySelector(".ai-action-status-msg");
        if (controls) controls.style.display = "none";
        if (status) {
          status.style.display = "flex";
          status.className = "ai-action-status-msg cancelled";
          status.textContent = message;
        }
      }
    }
    _isGuestSession() {
      if (this.apiClient?.getAuthenticatedSession?.()) return false;
      if (this.hostIdentity?.id || this.hostIdentity?.email) return false;
      const ctx = this.options?.context;
      if (ctx && typeof ctx === "object" && ctx.authentication?.identity) return false;
      if (typeof ctx === "string" && ctx.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(ctx);
          if (parsed?.authentication?.identity) return false;
        } catch {
        }
      }
      return true;
    }
    _isHirePoolSignupEnabled() {
      return Boolean(
        (!this.options?.assistantId || this.options.assistantId === "hirepool") && typeof this.apiClient?.getSignupAgreement === "function"
      );
    }
    _buildChatContextPayload(rawContext) {
      let baseContext = typeof rawContext === "string" && rawContext.trim().length > 0 ? rawContext.trim() : "";
      const activeSignupStates = /* @__PURE__ */ new Set([
        HIREPOOL_SIGNUP_STATES.IDLE,
        HIREPOOL_SIGNUP_STATES.CANCELLED,
        HIREPOOL_SIGNUP_STATES.COMPLETED
      ]);
      if (this._isHirePoolSignupEnabled() && this.hirePoolSignup && !activeSignupStates.has(this.hirePoolSignup.state)) {
        const rolePart = this.hirePoolSignup.selectedRole ? ` role=${this.hirePoolSignup.selectedRole}` : "";
        const tag = `[HIREPOOL_SIGNUP_STATE state=${this.hirePoolSignup.state}${rolePart}]`;
        baseContext = baseContext ? `${baseContext}
${tag}` : tag;
      }
      return baseContext || void 0;
    }
    _appendAssistantSignupNotice(text) {
      this._renderMessageBubble("assistant", text, true);
      this.messages.push({ role: "assistant", content: text });
      this._persistState();
      this.events.emit("message:received", { role: "assistant", content: text });
    }
    async _startHirePoolSignup(initialRole = null) {
      try {
        await this.hirePoolSignup.start(initialRole || null);
      } catch (error) {
        this._renderErrorBanner(error?.message || "Unable to start HirePool signup.");
      }
    }
    async _handleHirePoolSignupConversation(trimmed) {
      if (!this._isGuestSession() || !this._isHirePoolSignupEnabled()) {
        return false;
      }
      const signupState = this.hirePoolSignup.state;
      const inActiveSignup = ![
        HIREPOOL_SIGNUP_STATES.IDLE,
        HIREPOOL_SIGNUP_STATES.CANCELLED,
        HIREPOOL_SIGNUP_STATES.COMPLETED
      ].includes(signupState);
      if (inActiveSignup) {
        if (/^\s*(?:cancel|stop|quit|never\s*mind|close\s+signup)(?:\s+signup)?\s*[.!?]*\s*$/i.test(trimmed)) {
          await this.hirePoolSignup.cancel();
          this._appendAssistantSignupNotice(
            'Signup has been cancelled. Ask me anything about HirePool or say "Signup" whenever you would like to start again.'
          );
          return true;
        }
        if (signupState === HIREPOOL_SIGNUP_STATES.ROLE_SELECTION || signupState === HIREPOOL_SIGNUP_STATES.SIGNUP_FORM || signupState === HIREPOOL_SIGNUP_STATES.ERROR) {
          const parsedRole = parseHirePoolRoleChoice(trimmed);
          const explicitRolePhrase = /^\s*(?:i(?:'m| am)\s+(?:a|an)\s+|i\s+(?:want|would\s+like|'d\s+like)\s+(?:to\s+(?:join|sign\s*up|register)\s+as\s+)?(?:a|an)\s+|as\s+(?:a|an)\s+|join\s+(?:hirepool\s+)?as\s+(?:a|an)\s+|switch\s+(?:role\s+)?to\s+|change\s+(?:role\s+)?to\s+|select\s+|choose\s+)?(?:candidate|job\s*seeker|company|client|employer|consultancy|agency|staffing(?:\s+agency)?)\b/i.test(trimmed);
          if (parsedRole && (signupState === HIREPOOL_SIGNUP_STATES.ROLE_SELECTION || explicitRolePhrase)) {
            const canonicalRole = parsedRole === "staffing" ? "consultancy" : parsedRole;
            const label = ROLE_DEFINITIONS[canonicalRole]?.label || canonicalRole;
            this._appendAssistantSignupNotice(
              `Great \u2014 I selected the **${label}** role and loaded your HirePool registration form below.`
            );
            try {
              await this.hirePoolSignup.selectRole(parsedRole);
            } catch (error) {
              this._renderErrorBanner(error?.message || "Unable to load the selected signup role.");
            }
            return true;
          }
        }
        if (signupState === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING || signupState === HIREPOOL_SIGNUP_STATES.VERIFICATION_PENDING || signupState === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_IN_PROGRESS || signupState === HIREPOOL_SIGNUP_STATES.VERIFICATION_IN_PROGRESS) {
          if (/\b(?:resend|send\s+again|new\s+(?:link|email|verification))\b/i.test(trimmed)) {
            try {
              await this.hirePoolSignup.resendVerification();
              this._appendAssistantSignupNotice(
                "I requested a fresh verification email. Please check your inbox and click Verify once you have opened the link."
              );
            } catch (error) {
              this._renderErrorBanner(error?.message || "Could not resend verification email.");
            }
            return true;
          }
          if (/^\s*(?:done|verified|i(?:'ve| have)?\s+verified|i\s+clicked|check(?:\s+verification(?:\s+status)?)?|verify|continue)\s*[.!?]*\s*$/i.test(trimmed)) {
            try {
              await this.hirePoolSignup.checkVerificationStatus();
            } catch (error) {
              this._renderErrorBanner(error?.message || "Could not verify email status yet.");
            }
            return true;
          }
        }
        if (/^\s*(?:continue|resume|show\s+(?:signup|form|card)|go\s+back\s+to\s+signup)\s*[.!?]*\s*$/i.test(trimmed)) {
          this._appendAssistantSignupNotice(
            'Here is your active HirePool signup step below\u2014complete the card or type "cancel" to exit.'
          );
          this.hirePoolSignup.resume();
          return true;
        }
        return false;
      }
      const isRoleSpecificTrigger = /^\s*(?:(?:i\s+(?:want|would\s+like|'d\s+like)\s+to\s+)?(?:sign\s*up|signup|register|join)|(?:create\s+(?:an?\s+)?account))\s+(?:hirepool\s+)?as\s+(?:an?\s+)?(?:candidate|job\s*seeker|company|client|employer|consultancy|agency|staffing(?:\s+agency)?)\b/i.test(trimmed) || /^\s*(?:sign\s*up|register)(?:\s+as)?\s+(?:an?\s+)?(?:candidate|company|client|employer|consultancy|agency|staffing)\b/i.test(trimmed);
      if (isRoleSpecificTrigger) {
        const parsedRole = parseHirePoolRoleChoice(trimmed);
        if (parsedRole) {
          const canonicalRole = parsedRole === "staffing" ? "consultancy" : parsedRole;
          const label = ROLE_DEFINITIONS[canonicalRole]?.label || canonicalRole;
          this._appendAssistantSignupNotice(
            `Starting your **${label}** HirePool signup right here in chat.`
          );
          await this._startHirePoolSignup(parsedRole);
          return true;
        }
      }
      const isGeneralSignupTrigger = /^\s*(?:(?:sign\s*up|signup|register|create\s+(?:an?\s+)?account)\s*(?:for\s+hirepool)?|i\s+(?:want|would\s+like|'d\s+like)\s+to\s+(?:sign\s*up|signup|register|join(?:\s+hirepool)?))\s*[.!?]*\s*$/i.test(trimmed);
      if (isGeneralSignupTrigger) {
        this._appendAssistantSignupNotice(
          "Let\u2019s get your HirePool account set up! Choose your account type below, or reply with **Candidate**, **Employer / Company**, or **Agency / Consultancy**."
        );
        await this._startHirePoolSignup(null);
        return true;
      }
      return false;
    }
    async _assertDocumentContextAvailable() {
      const knownDocuments = this.storage.get("documents", []);
      if (!Array.isArray(knownDocuments) || knownDocuments.length === 0) return;
      if (!this.activeConversationId) {
        throw new Error("The previous document session is unavailable. Start a new conversation and upload the document again.");
      }
      const currentDocuments = await this.apiClient.getDocuments(this.activeConversationId);
      const availableIds = new Set(currentDocuments.map((document2) => document2.id));
      if (knownDocuments.some((doc) => !availableIds.has(doc.id))) {
        throw new Error("Document context is no longer available for this conversation. Start a new conversation and upload the document again.");
      }
    }
    async sendMessage(text, { displayUserMessage = true } = {}) {
      const trimmed = (text || "").trim();
      if (!trimmed || this.isGenerating) return;
      try {
        await this._assertDocumentContextAvailable();
      } catch (error) {
        this._renderErrorBanner(error.message);
        this.events.emit("error", error);
        return;
      }
      this.textarea.value = "";
      this.textarea.style.height = "auto";
      if (displayUserMessage) {
        this.messages.push({ role: "user", content: trimmed });
        this._renderMessageBubble("user", trimmed);
        this._persistState();
      }
      this.events.emit("message:sent", {
        role: "user",
        content: trimmed,
        resumed: !displayUserMessage
      });
      const isHandledBySignup = await this._handleHirePoolSignupConversation(trimmed);
      if (isHandledBySignup) {
        if (this.sendBtn) this.sendBtn.disabled = true;
        return;
      }
      this._setGenerating(true);
      this.abortController = new AbortController();
      const stream = this.options.features?.streaming ?? true;
      const sendAttempt = async (isRetry = false) => {
        let assistantBubbleRow = null;
        let assistantBubbleContent = null;
        let accumulatedText = "";
        const handleError = async (err) => {
          const isSessionDenied = err?.status === 403 || err?.code === "SESSION_ACCESS_DENIED" || String(err?.message || "").toLowerCase().includes("belongs to another user");
          if (!isRetry && isSessionDenied) {
            console.warn("[AI Assistant] Conversation ownership conflict detected; resetting conversation ID and retrying:", err.message);
            this.activeConversationId = null;
            this.storage.clearConversationId();
            if (assistantBubbleRow && assistantBubbleRow.parentNode) {
              assistantBubbleRow.parentNode.removeChild(assistantBubbleRow);
            }
            await sendAttempt(true);
            return;
          }
          if (err?.name !== "AbortError") {
            this._renderErrorBanner(err.message);
            this.events.emit("error", err);
          }
        };
        try {
          const rawContext = this.options.integration && !this.contextOverrideSet ? await this.options.integration.getContext() : this.options.context;
          const contextPayload = this._buildChatContextPayload(rawContext);
          await this.apiClient.sendMessage({
            assistantId: this.options.assistantId || "default",
            message: trimmed,
            context: contextPayload,
            conversationId: typeof this.activeConversationId === "string" && this.activeConversationId.trim().length > 0 ? this.activeConversationId.trim() : void 0,
            history: (displayUserMessage ? this.messages.slice(0, -1) : this.messages).slice(-25),
            stream,
            signal: this.abortController.signal,
            onStart: (event) => {
              if (event.conversationId) {
                this.activeConversationId = event.conversationId;
                this._persistState();
              }
            },
            onChunk: (delta) => {
              accumulatedText += delta;
              if (!assistantBubbleRow) {
                this.streamingIndicator.style.display = "none";
                assistantBubbleRow = document.createElement("div");
                assistantBubbleRow.className = "ai-message-row assistant";
                assistantBubbleContent = document.createElement("div");
                assistantBubbleContent.className = "ai-bubble";
                assistantBubbleRow.appendChild(assistantBubbleContent);
                this.messagesList.appendChild(assistantBubbleRow);
              }
              assistantBubbleContent.innerHTML = parseMarkdown(accumulatedText);
              assistantBubbleRow.setAttribute("data-raw-content", accumulatedText);
              this._scrollToBottom();
            },
            onDone: (result) => {
              const rawFinalText = result.text || accumulatedText;
              const finalText = this.options?.assistantId === "hirepool" ? this._stripActionBlocks(rawFinalText) || rawFinalText : rawFinalText;
              const detectedAction = result.action || this._extractAction(rawFinalText);
              if (result?.logout?.loggedOut) {
                if (assistantBubbleRow && assistantBubbleRow.parentNode) {
                  assistantBubbleRow.parentNode.removeChild(assistantBubbleRow);
                }
                this.streamingIndicator.style.display = "none";
                void this._handleHirePoolLogout(result.logout, finalText);
                this.events.emit("message:received", {
                  role: "assistant",
                  content: finalText,
                  logout: result.logout
                });
                return;
              }
              if (result.conversationId) {
                this.activeConversationId = result.conversationId;
              }
              if (!assistantBubbleRow) {
                this.streamingIndicator.style.display = "none";
                this._renderMessageBubble("assistant", finalText, true, detectedAction);
              } else {
                assistantBubbleContent.innerHTML = parseMarkdown(finalText);
                if (detectedAction) {
                  this._renderActionCard(assistantBubbleContent, detectedAction);
                }
                const actions = document.createElement("div");
                actions.className = "ai-message-actions";
                actions.innerHTML = `
                <button class="ai-msg-action-btn" type="button" aria-label="Copy response">
                  ${ICONS.copy} Copy
                </button>
              `;
                assistantBubbleRow.appendChild(actions);
              }
              this.messages.push({ role: "assistant", content: finalText, action: detectedAction || void 0 });
              this._persistState();
              this.events.emit("message:received", { role: "assistant", content: finalText, action: detectedAction || void 0 });
            },
            onError: async (err) => {
              await handleError(err);
            }
          });
        } catch (err) {
          await handleError(err);
        }
      };
      try {
        await sendAttempt(false);
      } finally {
        this._setGenerating(false);
        this.abortController = null;
      }
    }
  };

  // config/document-upload.js
  var DOCUMENT_PROCESSING_CONSENT_VERSION = "1";
  var SUPPORTED_EXTENSIONS = Object.freeze([
    ".pdf",
    ".docx",
    ".txt",
    ".text",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".log"
  ]);
  var DEFAULT_DOCUMENT_UPLOAD_SETTINGS = Object.freeze({
    enabled: true,
    maxSizeBytes: 10 * 1024 * 1024,
    allowedExtensions: SUPPORTED_EXTENSIONS,
    consent: Object.freeze({
      title: "Before processing this document",
      description: "If you continue, the SDK sends this file to the assistant backend for text extraction. Extracted text is held temporarily with this conversation and may be sent to the configured AI provider when you ask questions.",
      checkboxLabel: "I agree to process this document for this conversation.",
      hostDescription: "If you continue, this file is passed to the host application\u2019s registered file handler. The host may process or transmit it under its own privacy terms. The SDK document backend is not used in this flow.",
      hostCheckboxLabel: "I agree to let the host application process this document."
    })
  });
  function normalizeDocumentUploadSettings(settings = {}) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new TypeError("documentUpload settings must be an object");
    }
    const maxSizeBytes = settings.maxSizeBytes ?? DEFAULT_DOCUMENT_UPLOAD_SETTINGS.maxSizeBytes;
    if (!Number.isInteger(maxSizeBytes) || maxSizeBytes < 1 || maxSizeBytes > 10 * 1024 * 1024) {
      throw new RangeError("documentUpload.maxSizeBytes must be an integer between 1 and 10485760");
    }
    const allowedExtensions = settings.allowedExtensions ?? DEFAULT_DOCUMENT_UPLOAD_SETTINGS.allowedExtensions;
    if (!Array.isArray(allowedExtensions) || allowedExtensions.length === 0 || allowedExtensions.some((extension) => !SUPPORTED_EXTENSIONS.includes(extension))) {
      throw new TypeError(`documentUpload.allowedExtensions must contain supported extensions: ${SUPPORTED_EXTENSIONS.join(", ")}`);
    }
    const consent = settings.consent ?? {};
    if (!consent || typeof consent !== "object" || Array.isArray(consent)) {
      throw new TypeError("documentUpload.consent must be an object");
    }
    const defaults = DEFAULT_DOCUMENT_UPLOAD_SETTINGS.consent;
    const normalizedConsent = {};
    for (const key of Object.keys(defaults)) {
      const value = consent[key] ?? defaults[key];
      if (typeof value !== "string" || value.trim().length === 0 || value.length > 1e3) {
        throw new TypeError(`documentUpload.consent.${key} must be a non-empty string of at most 1000 characters`);
      }
      normalizedConsent[key] = value.trim();
    }
    const enabled = settings.enabled ?? DEFAULT_DOCUMENT_UPLOAD_SETTINGS.enabled;
    if (typeof enabled !== "boolean") {
      throw new TypeError("documentUpload.enabled must be a boolean");
    }
    return {
      enabled,
      maxSizeBytes,
      allowedExtensions: [...new Set(allowedExtensions)],
      consent: normalizedConsent
    };
  }

  // widget/src/api-client.js
  async function readSseEvents(response, onEvent) {
    if (!response.body?.getReader) {
      throw new Error("The server did not return a readable streaming response.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    const dispatchFrame = async (frame) => {
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
      if (!data) return;
      let event;
      try {
        event = JSON.parse(data);
      } catch (cause) {
        throw new Error("The server returned a malformed streaming event.", { cause });
      }
      await onEvent(event);
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";
        for (const frame of frames) {
          await dispatchFrame(frame);
        }
        if (done) break;
      }
      if (buffer.trim()) {
        await dispatchFrame(buffer);
      }
    } catch (error) {
      try {
        await reader.cancel(error);
      } catch {
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
  function createStreamError(event, fallbackMessage) {
    const error = new Error(event.error?.message || fallbackMessage);
    error.code = event.error?.code;
    error.status = event.error?.status;
    return error;
  }
  var AssistantApiClient = class {
    /**
     * @param {string} baseUrl
     */
    constructor(baseUrl = "", options = {}) {
      this.baseUrl = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
      this.assistantId = options.assistantId || "default";
      this.getAuthHeaders = options.getAuthHeaders;
      this.credentials = options.credentials || "same-origin";
      this._demoToken = null;
      this._demoTokenExpiresAt = 0;
      this._tokenFetchPromise = null;
      this._authenticatedSession = null;
    }
    setAuthenticatedSession(session) {
      this._authenticatedSession = session && typeof session === "object" ? session : null;
    }
    getAuthenticatedSession() {
      return this._authenticatedSession;
    }
    clearAuthenticatedSession() {
      this._authenticatedSession = null;
    }
    clearDemoToken() {
      this._demoToken = null;
      this._demoTokenExpiresAt = 0;
    }
    /**
     * Acquire a scoped demo token from the backend when running in standalone / demo mode
     * without a host integration auth provider.
     * @returns {Promise<string|null>}
     */
    async _getOrFetchDemoToken() {
      if (this.getAuthHeaders) return null;
      if (this._demoToken && Date.now() < this._demoTokenExpiresAt - 6e4) {
        return this._demoToken;
      }
      if (this._tokenFetchPromise) {
        return this._tokenFetchPromise;
      }
      this._tokenFetchPromise = (async () => {
        try {
          const url = `${this.baseUrl}/api/auth/token`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assistantId: this.assistantId || "default" }),
            credentials: this.credentials
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.token) {
              this._demoToken = data.token;
              this._demoTokenExpiresAt = Date.now() + (data.expiresIn || 3600) * 1e3;
              return this._demoToken;
            }
          }
        } catch {
        } finally {
          this._tokenFetchPromise = null;
        }
        return null;
      })();
      return this._tokenFetchPromise;
    }
    async _headers(json = false) {
      let headers = {};
      if (this._authenticatedSession?.credential) {
        headers = { Authorization: `Bearer ${this._authenticatedSession.credential}` };
      } else if (this.getAuthHeaders) {
        headers = await this.getAuthHeaders() || {};
        if (!headers.Authorization && this._authenticatedSession?.credential) {
          headers.Authorization = `Bearer ${this._authenticatedSession.credential}`;
        }
      } else {
        const token = await this._getOrFetchDemoToken();
        if (token) {
          headers = { Authorization: `Bearer ${token}` };
        }
      }
      return json ? { ...headers, "Content-Type": "application/json" } : headers;
    }
    async _hirePoolResumeRequest(path, { method, body, json = false } = {}) {
      const response = await fetch(`${this.baseUrl}/api/hirepool/resume/${path}`, {
        method,
        headers: await this._headers(json),
        body,
        credentials: this.credentials,
        cache: "no-store"
      });
      let result = null;
      try {
        result = await response.json();
      } catch {
      }
      if (!response.ok) {
        const error = new Error(
          typeof result?.error?.message === "string" ? result.error.message : `Resume upload request failed (HTTP ${response.status}).`
        );
        error.status = response.status;
        error.responseStatus = result?.status;
        error.code = result?.error?.code;
        throw error;
      }
      return result;
    }
    async prepareHirePoolResume(file, conversationId) {
      const body = new FormData();
      body.append("file", file, file.name);
      if (typeof conversationId === "string" && conversationId) {
        body.append("conversationId", conversationId);
      }
      return this._hirePoolResumeRequest("prepare", { method: "POST", body });
    }
    async confirmHirePoolResume(confirmationToken, conversationId) {
      return this._hirePoolResumeRequest("confirm", {
        method: "POST",
        body: JSON.stringify({ confirmationToken, conversationId }),
        json: true
      });
    }
    async cancelHirePoolResume(confirmationToken, conversationId) {
      return this._hirePoolResumeRequest("cancel", {
        method: "POST",
        body: JSON.stringify({ confirmationToken, conversationId }),
        json: true
      });
    }
    /**
     * Fetch public assistant configuration
     */
    async fetchConfig(assistantId = "default") {
      const url = `${this.baseUrl}/api/config/${encodeURIComponent(assistantId)}`;
      const res = await fetch(url, { credentials: this.credentials });
      if (!res.ok) {
        throw new Error(`Failed to load assistant configuration (HTTP ${res.status})`);
      }
      const data = await res.json();
      return data.assistant;
    }
    /**
     * Send a chat message (streaming or non-streaming)
     */
    async sendMessage({
      assistantId = "default",
      message,
      context,
      conversationId,
      history = [],
      stream = true,
      signal,
      onStart,
      onChunk,
      onDone,
      onAction,
      onError
    }) {
      const endpoint = stream ? "/api/chat/stream" : "/api/chat";
      const url = `${this.baseUrl}${endpoint}`;
      const payload = {
        assistantId: assistantId || "default",
        message,
        stream: !!stream
      };
      if (conversationId && typeof conversationId === "string" && conversationId.trim().length > 0) {
        payload.conversationId = conversationId.trim();
      }
      if (Array.isArray(history) && history.length > 0) {
        payload.history = history;
      }
      if (typeof context === "string" && context.trim().length > 0) {
        payload.context = context.trim();
      }
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: await this._headers(true),
          body: JSON.stringify(payload),
          credentials: this.credentials,
          signal
        });
        if (!response.ok) {
          let errMsg = `Server returned HTTP ${response.status}`;
          let errCode = null;
          try {
            const errData = await response.json();
            if (errData?.error) {
              errCode = errData.error.code || null;
              if (Array.isArray(errData.error.details) && errData.error.details.length > 0) {
                const detailMsg = errData.error.details.map((d) => `${d.field}: ${d.message}`).join(", ");
                errMsg = `${errData.error.message} (${detailMsg})`;
              } else if (errData.error.message) {
                errMsg = errData.error.message;
              }
            }
          } catch {
          }
          const error = new Error(errMsg);
          error.status = response.status;
          error.code = errCode;
          throw error;
        }
        if (!stream) {
          const data = await response.json();
          if (onDone) onDone(data);
          return data;
        }
        let accumulatedText = "";
        let activeConversationId = conversationId;
        let actionProposal = null;
        let doneEvent = null;
        await readSseEvents(response, (event) => {
          if (event.type === "start") {
            activeConversationId = event.conversationId || activeConversationId;
            if (onStart) onStart(event);
          } else if (event.type === "chunk") {
            accumulatedText += event.delta || "";
            if (onChunk) onChunk(event.delta || "", accumulatedText);
          } else if (event.type === "action") {
            actionProposal = event.action;
            if (onAction) onAction(event.action);
          } else if (event.type === "done") {
            if (doneEvent) throw new Error("The streaming response contained duplicate completion events.");
            doneEvent = event;
            const result = {
              text: event.text || accumulatedText,
              action: event.action || actionProposal,
              conversationId: event.logout?.loggedOut ? null : event.conversationId || activeConversationId,
              model: event.model,
              logout: event.logout || null,
              connectorResult: event.connectorResult || null
            };
            if (onDone) onDone(result);
          } else if (event.type === "error") {
            throw createStreamError(event, "Streaming request failed.");
          }
        });
        if (!doneEvent) {
          throw new Error("The streaming response ended before the assistant completed the request.");
        }
        return {
          text: doneEvent.text || accumulatedText,
          action: doneEvent.action || actionProposal,
          conversationId: doneEvent.logout?.loggedOut ? null : doneEvent.conversationId || activeConversationId,
          model: doneEvent.model,
          logout: doneEvent.logout || null,
          connectorResult: doneEvent.connectorResult || null
        };
      } catch (err) {
        if (err.name === "AbortError") {
          return;
        }
        if (onError) onError(err);
        throw err;
      }
    }
    /**
     * Summarize text
     */
    async summarize({ text, style = "concise", focus, stream = false, signal, onChunk, onDone, onError }) {
      const url = `${this.baseUrl}/api/summarize`;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: await this._headers(true),
          body: JSON.stringify({ text, style, focus, stream }),
          credentials: this.credentials,
          signal
        });
        if (!response.ok) {
          let errMsg = `Summarization failed (HTTP ${response.status})`;
          try {
            const data = await response.json();
            if (data?.error?.message) errMsg = data.error.message;
          } catch {
          }
          throw new Error(errMsg);
        }
        if (!stream) {
          const data = await response.json();
          if (onDone) onDone(data);
          return data;
        }
        let accumulated = "";
        let doneEvent = null;
        await readSseEvents(response, (event) => {
          if (event.type === "chunk") {
            accumulated += event.delta || "";
            if (onChunk) onChunk(event.delta || "", accumulated);
          } else if (event.type === "done") {
            if (doneEvent) throw new Error("The summarization stream contained duplicate completion events.");
            doneEvent = event;
            if (onDone) onDone({ text: event.text || accumulated, model: event.model });
          } else if (event.type === "error") {
            throw createStreamError(event, "Streaming summarization failed.");
          }
        });
        if (!doneEvent) {
          throw new Error("The summarization stream ended before completion.");
        }
        return { text: doneEvent.text || accumulated, model: doneEvent.model };
      } catch (err) {
        if (err.name === "AbortError") return;
        if (onError) onError(err);
        throw err;
      }
    }
    /**
     * Upload a document to the backend and attach it to the conversation session
     * @param {File|Blob} file
     * @param {string} [conversationId]
     * @param {object} [options]
     * @returns {Promise<object>}
     */
    async uploadDocument(file, conversationId, options = {}) {
      if (options.consentAccepted !== true) {
        throw new Error("Explicit document-processing consent is required before upload.");
      }
      const url = `${this.baseUrl}/api/documents/upload`;
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("consentAccepted", "true");
      formData.append("consentVersion", DOCUMENT_PROCESSING_CONSENT_VERSION);
      if (conversationId) {
        formData.append("conversationId", conversationId);
      }
      if (options.assistantId) {
        formData.append("assistantId", options.assistantId);
      }
      const res = await fetch(url, {
        method: "POST",
        headers: {
          ...await this._headers(),
          "X-Document-Processing-Consent": "accepted",
          "X-Document-Consent-Version": DOCUMENT_PROCESSING_CONSENT_VERSION
        },
        body: formData,
        credentials: this.credentials,
        signal: options.signal
      });
      if (!res.ok) {
        let errMsg = `Upload failed (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data?.error?.message) {
            errMsg = data.error.message;
          }
        } catch {
        }
        const error = new Error(errMsg);
        error.status = res.status;
        throw error;
      }
      return await res.json();
    }
    /**
     * Fetch list of documents attached to a session
     * @param {string} conversationId
     */
    async getDocuments(conversationId) {
      if (!conversationId) return [];
      const url = `${this.baseUrl}/api/documents/${encodeURIComponent(conversationId)}?assistantId=${encodeURIComponent(this.assistantId)}`;
      const res = await fetch(url, {
        headers: await this._headers(),
        credentials: this.credentials
      });
      if (!res.ok) {
        let message = `Failed to retrieve documents (HTTP ${res.status})`;
        try {
          const data2 = await res.json();
          if (data2?.error?.message) message = data2.error.message;
        } catch {
        }
        throw new Error(message);
      }
      const data = await res.json();
      return data.documents || [];
    }
    async removeDocument(conversationId, documentId) {
      if (!conversationId || !documentId) return;
      const res = await fetch(
        `${this.baseUrl}/api/documents/${encodeURIComponent(conversationId)}/${encodeURIComponent(documentId)}?assistantId=${encodeURIComponent(this.assistantId)}`,
        {
          method: "DELETE",
          headers: await this._headers(),
          credentials: this.credentials
        }
      );
      if (!res.ok) {
        let message = `Failed to remove document (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data?.error?.message) message = data.error.message;
        } catch {
        }
        throw new Error(message);
      }
    }
    /**
     * Clear session on the server
     */
    async clearSession(conversationId) {
      if (!conversationId) return;
      const res = await fetch(`${this.baseUrl}/api/sessions/clear`, {
        method: "POST",
        headers: await this._headers(true),
        body: JSON.stringify({ conversationId, assistantId: this.assistantId }),
        credentials: this.credentials
      });
      if (!res.ok) {
        let message = `Failed to clear conversation (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data?.error?.message) message = data.error.message;
        } catch {
        }
        throw new Error(message);
      }
    }
    async _hirePoolSignupRequest(path, { method = "POST", body, json = true } = {}) {
      const isGet = method === "GET";
      const headers = json ? { "Content-Type": "application/json" } : {};
      const response = await fetch(`${this.baseUrl}/api/hirepool/signup/${path}`, {
        method,
        headers,
        body: isGet ? void 0 : json && body ? JSON.stringify(body) : body,
        credentials: this.credentials,
        cache: "no-store"
      });
      let result = null;
      try {
        result = await response.json();
      } catch {
      }
      if (!response.ok) {
        const error = new Error(
          typeof result?.error?.message === "string" ? result.error.message : `Signup request failed (HTTP ${response.status}).`
        );
        error.status = response.status;
        error.code = result?.error?.code;
        error.details = result?.error;
        throw error;
      }
      return result;
    }
    async getSignupAgreement(role) {
      return this._hirePoolSignupRequest(`agreement?role=${encodeURIComponent(role)}`, {
        method: "GET",
        json: false
      });
    }
    async signupRegister(data) {
      return this._hirePoolSignupRequest("register", { body: data });
    }
    async resendSignupVerification(data) {
      return this._hirePoolSignupRequest("resend-verification", { body: data });
    }
    async verifySignupEmail(data) {
      return this._hirePoolSignupRequest("verify-email", { body: data });
    }
    async checkSignupVerificationStatus(signupToken) {
      return this._hirePoolSignupRequest("check-verification", { body: { signupToken } });
    }
    async updateSignupProfile(data) {
      return this._hirePoolSignupRequest("profile-update", { body: data });
    }
    async completeSignupProfile(data) {
      return this._hirePoolSignupRequest("complete-profile", { body: data });
    }
    async cancelSignup(signupToken) {
      return this._hirePoolSignupRequest("cancel", { body: { signupToken } });
    }
    async validateHirePoolSession(credential = null) {
      const cred = credential || this._authenticatedSession?.credential;
      if (!cred) throw new Error("No session credential to validate");
      let response = await fetch(`${this.baseUrl}/api/hirepool/session/validate`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${cred}`,
          Accept: "application/json"
        },
        credentials: this.credentials,
        cache: "no-store"
      });
      if (response.status === 404) {
        try {
          const altResponse = await fetch(`${this.baseUrl}/api/hirepool/signup/validate`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${cred}`,
              Accept: "application/json"
            },
            credentials: this.credentials,
            cache: "no-store"
          });
          if (altResponse.ok || altResponse.status !== 404) {
            response = altResponse;
          }
        } catch {
        }
      }
      let result = null;
      try {
        result = await response.json();
      } catch {
      }
      if (!response.ok) {
        const error = new Error(result?.error?.message || `Session validation failed (HTTP ${response.status})`);
        error.status = response.status;
        error.code = result?.error?.code;
        throw error;
      }
      return result;
    }
    async confirmDynamicApiAction(confirmationToken) {
      const response = await fetch(`${this.baseUrl}/api/dynamic-api/confirm`, {
        method: "POST",
        headers: await this._headers(true),
        body: JSON.stringify({ confirmationToken }),
        credentials: this.credentials,
        cache: "no-store"
      });
      let result = null;
      try {
        result = await response.json();
      } catch {
      }
      if (!response.ok) {
        const error = new Error(result?.error?.message || `Dynamic API action failed (HTTP ${response.status})`);
        error.status = response.status;
        error.code = result?.error?.code;
        throw error;
      }
      return result;
    }
    async cancelDynamicApiAction(confirmationToken) {
      const response = await fetch(`${this.baseUrl}/api/dynamic-api/confirm/cancel`, {
        method: "POST",
        headers: await this._headers(true),
        body: JSON.stringify({ confirmationToken }),
        credentials: this.credentials,
        cache: "no-store"
      });
      let result = null;
      try {
        result = await response.json();
      } catch {
      }
      if (!response.ok) {
        const error = new Error(result?.error?.message || `Dynamic API cancellation failed (HTTP ${response.status})`);
        error.status = response.status;
        error.code = result?.error?.code;
        throw error;
      }
      return result;
    }
    async logoutHirePoolSession(conversationId = null) {
      const body = {};
      if (typeof conversationId === "string" && conversationId.trim()) {
        body.conversationId = conversationId.trim();
      }
      try {
        const response = await fetch(`${this.baseUrl}/api/hirepool/session/logout`, {
          method: "POST",
          headers: await this._headers(true),
          body: JSON.stringify(body),
          credentials: this.credentials,
          cache: "no-store"
        });
        let result = null;
        try {
          result = await response.json();
        } catch {
        }
        if (!response.ok) {
          const error = new Error(result?.error?.message || `Logout failed (HTTP ${response.status})`);
          error.status = response.status;
          error.code = result?.error?.code;
          throw error;
        }
        return result;
      } finally {
        this.clearAuthenticatedSession();
        this.clearDemoToken();
      }
    }
  };

  // widget/src/storage.js
  var MemoryStore = class {
    constructor() {
      this.map = /* @__PURE__ */ new Map();
    }
    getItem(k) {
      return this.map.has(k) ? this.map.get(k) : null;
    }
    setItem(k, v) {
      this.map.set(k, String(v));
    }
    removeItem(k) {
      this.map.delete(k);
    }
    clear() {
      this.map.clear();
    }
  };
  function getSafeStorage(storageType = "session") {
    try {
      const target = storageType === "local" ? window.localStorage : window.sessionStorage;
      const testKey = "__storage_test__";
      target.setItem(testKey, testKey);
      target.removeItem(testKey);
      return target;
    } catch {
      return new MemoryStore();
    }
  }
  var AssistantStorage = class {
    constructor(assistantId = "default", storageType = "session") {
      this.assistantId = assistantId;
      this.prefix = `ai_assistant_${assistantId}_`;
      this.store = getSafeStorage(storageType);
      this.sessionStore = storageType === "session" ? this.store : getSafeStorage("session");
      this.userScope = "guest_";
    }
    setUser(userId = null) {
      this.userScope = userId ? `usr_${String(userId).trim()}_` : "guest_";
    }
    getUserScope() {
      return this.userScope;
    }
    _getKey(key) {
      if (key === "hirepool_session" || key === "is_open") {
        return `${this.prefix}${key}`;
      }
      return `${this.prefix}${this.userScope || ""}${key}`;
    }
    get(key, defaultValue = null) {
      try {
        const fullKey = this._getKey(key);
        let raw = this.store.getItem(fullKey);
        if (raw === null && this.userScope === "guest_") {
          raw = this.store.getItem(this.prefix + key);
        }
        return raw !== null ? JSON.parse(raw) : defaultValue;
      } catch {
        return defaultValue;
      }
    }
    set(key, value) {
      try {
        const fullKey = this._getKey(key);
        this.store.setItem(fullKey, JSON.stringify(value));
      } catch (err) {
        console.warn("AssistantStorage write failed:", err);
      }
    }
    remove(key) {
      try {
        const fullKey = this._getKey(key);
        this.store.removeItem(fullKey);
        if (this.userScope === "guest_") {
          this.store.removeItem(this.prefix + key);
        }
      } catch {
      }
    }
    getConversationId() {
      return this.get("conversation_id", null);
    }
    saveConversationId(conversationId) {
      if (typeof conversationId === "string" && conversationId.trim()) {
        this.set("conversation_id", conversationId.trim());
      } else {
        this.clearConversationId();
      }
    }
    clearConversationId() {
      this.remove("conversation_id");
    }
    /**
     * Persist only non-sensitive HirePool signup UI progress (`role_selection` or
     * `signup_form` step, selected role, consultancy type, and public agreement metadata)
     * in sessionStorage. Passwords, verification links/tokens, and auth credentials
     * are strictly excluded.
     *
     * @param {object|null} progress
     */
    saveSignupProgress(progress) {
      if (!progress || typeof progress !== "object") {
        this.clearSignupProgress();
        return;
      }
      const allowedStates = /* @__PURE__ */ new Set(["role_selection", "signup_form"]);
      const normalizedState = allowedStates.has(progress.state) ? progress.state : null;
      const normalizedRole = ["candidate", "client", "consultancy"].includes(progress.selectedRole) ? progress.selectedRole : null;
      if (!normalizedState) {
        this.clearSignupProgress();
        return;
      }
      const agreement = progress.agreement && typeof progress.agreement === "object" ? {
        id: progress.agreement.id || progress.agreement.version_id || null,
        version: progress.agreement.version || null,
        role: progress.agreement.role || normalizedRole || null,
        title: progress.agreement.title || null,
        summary: progress.agreement.summary || null,
        effectiveDate: progress.agreement.effectiveDate || progress.agreement.effective_date || null
      } : null;
      const safePayload = {
        state: normalizedState,
        selectedRole: normalizedRole,
        consultancyType: typeof progress.consultancyType === "string" ? progress.consultancyType.slice(0, 64) : null,
        agreement
      };
      try {
        const fullKey = this._getKey("hirepool_signup_progress");
        this.sessionStore.setItem(fullKey, JSON.stringify(safePayload));
      } catch (err) {
        console.warn("AssistantStorage signup progress write failed:", err);
      }
    }
    getSignupProgress() {
      try {
        const fullKey = this._getKey("hirepool_signup_progress");
        const raw = this.sessionStore.getItem(fullKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !["role_selection", "signup_form"].includes(parsed.state)) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    }
    clearSignupProgress() {
      try {
        const fullKey = this._getKey("hirepool_signup_progress");
        this.sessionStore.removeItem(fullKey);
      } catch {
      }
    }
    clear() {
      try {
        this.clearConversationId();
        this.clearSignupProgress();
        this.remove("messages");
        this.remove("documents");
        this.remove("is_open");
      } catch {
      }
    }
  };

  // widget/src/integration.js
  var MAX_CONTEXT_LENGTH = 3e4;
  function serializeContext(context) {
    if (context === null || context === void 0 || context === "") {
      return null;
    }
    if (typeof context === "string") {
      const value2 = context.trim();
      if (value2.length > MAX_CONTEXT_LENGTH) {
        throw new RangeError(`Application context cannot exceed ${MAX_CONTEXT_LENGTH} characters`);
      }
      return value2 || null;
    }
    if (typeof context !== "object" || Array.isArray(context)) {
      throw new TypeError("Application context must be a string or a plain object");
    }
    const value = JSON.stringify(context);
    if (value.length > MAX_CONTEXT_LENGTH) {
      throw new RangeError(`Application context cannot exceed ${MAX_CONTEXT_LENGTH} characters`);
    }
    return value;
  }
  var HostIntegrationAdapter = class {
    constructor(config) {
      if (!config || typeof config !== "object" || config.version !== 1) {
        throw new TypeError("Host integration must use contract version 1");
      }
      const application = config.application;
      if (!application || typeof application.id !== "string" || !application.id.trim() || typeof application.name !== "string" || !application.name.trim()) {
        throw new TypeError("Host integration requires an application ID and name");
      }
      if (application.id.length > 100 || application.name.length > 120) {
        throw new RangeError("Host application ID and name exceed their length limits");
      }
      if (config.contextProvider !== void 0 && typeof config.contextProvider !== "function") {
        throw new TypeError("contextProvider must be a function");
      }
      if (config.getAuthHeaders !== void 0 && typeof config.getAuthHeaders !== "function") {
        throw new TypeError("getAuthHeaders must be a function");
      }
      if (config.getSessionScope !== void 0 && typeof config.getSessionScope !== "function") {
        throw new TypeError("getSessionScope must be a function");
      }
      if (config.canExecuteAction !== void 0 && typeof config.canExecuteAction !== "function") {
        throw new TypeError("canExecuteAction must be a function");
      }
      if (config.executeAction !== void 0 && typeof config.executeAction !== "function") {
        throw new TypeError("executeAction must be a function");
      }
      for (const key of ["getIdentity", "getPermissions", "getAvailableActions", "onActionProposed", "onActionResult", "onError", "subscribeContext"]) {
        if (config[key] !== void 0 && typeof config[key] !== "function") {
          throw new TypeError(`${key} must be a function`);
        }
      }
      const credentials = config.credentials || "same-origin";
      if (!["omit", "same-origin", "include"].includes(credentials)) {
        throw new TypeError("credentials must be omit, same-origin, or include");
      }
      this.application = {
        id: application.id.trim(),
        name: application.name.trim()
      };
      this.contextProvider = config.contextProvider;
      this.authHeadersProvider = config.getAuthHeaders;
      this.sessionScopeProvider = config.getSessionScope;
      this.permissionAdapter = config.canExecuteAction;
      this.actionExecutor = config.executeAction;
      this.identityProvider = config.getIdentity;
      this.permissionsProvider = config.getPermissions;
      this.availableActionsProvider = config.getAvailableActions;
      this.actionProposalListener = config.onActionProposed;
      this.actionResultListener = config.onActionResult;
      this.errorListener = config.onError;
      this.contextSubscription = config.subscribeContext;
      this.credentials = credentials;
    }
    async getContext() {
      const provided = this.contextProvider ? await this.contextProvider() : {};
      if (provided === null || provided === void 0) {
        return serializeContext({ application: this.application });
      }
      if (typeof provided !== "object" || Array.isArray(provided)) {
        throw new TypeError("contextProvider must return an object or null");
      }
      return serializeContext({
        ...provided,
        application: this.application
      });
    }
    async getAuthHeaders() {
      const headers = this.authHeadersProvider ? await this.authHeadersProvider() : {};
      if (headers === null || headers === void 0) {
        return {};
      }
      if (typeof headers !== "object" || Array.isArray(headers)) {
        throw new TypeError("getAuthHeaders must return an object of header values");
      }
      const normalized = {};
      for (const [name, value] of Object.entries(headers)) {
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== "string" || /[\r\n]/.test(value)) {
          throw new TypeError(`Invalid host authentication header: ${name}`);
        }
        normalized[name] = value;
      }
      return normalized;
    }
    async getSessionScope() {
      const scope = this.sessionScopeProvider ? await this.sessionScopeProvider() : null;
      if (scope === null || scope === void 0 || scope === "") return null;
      if (typeof scope !== "string" || scope.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(scope)) {
        throw new TypeError("getSessionScope must return a short opaque identifier or null");
      }
      return scope;
    }
    async getIdentity() {
      const identity = this.identityProvider ? await this.identityProvider() : null;
      if (identity === null || identity === void 0) return null;
      if (typeof identity !== "object" || Array.isArray(identity)) {
        throw new TypeError("getIdentity must return an object or null");
      }
      return identity;
    }
    async getPermissions() {
      const permissions = this.permissionsProvider ? await this.permissionsProvider() : [];
      if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== "string")) {
        throw new TypeError("getPermissions must return an array of strings");
      }
      return [...permissions];
    }
    async getAvailableActions() {
      const actions = this.availableActionsProvider ? await this.availableActionsProvider() : [];
      if (!Array.isArray(actions) || actions.some((action) => !action || typeof action !== "object" || typeof action.id !== "string")) {
        throw new TypeError("getAvailableActions must return an array of action objects with string IDs");
      }
      return actions;
    }
    subscribeToContextChanges(callback) {
      if (!this.contextSubscription) return () => {
      };
      const unsubscribe = this.contextSubscription(callback);
      if (typeof unsubscribe !== "function") {
        throw new TypeError("subscribeContext must return an unsubscribe function");
      }
      return unsubscribe;
    }
    notifyActionProposed(action) {
      this.actionProposalListener?.(action);
    }
    notifyActionResult(result) {
      this.actionResultListener?.(result);
    }
    notifyError(error) {
      this.errorListener?.(error);
    }
    async executeHostAction(actionId, parameters, confirmationToken) {
      if (!this.actionExecutor) {
        throw new Error("No host action executor is configured");
      }
      if (this.permissionAdapter && !await this.permissionAdapter(actionId, parameters)) {
        throw new Error("The host application denied permission to execute this action");
      }
      return this.actionExecutor({
        application: this.application,
        actionId,
        parameters,
        ...confirmationToken ? { confirmationToken } : {}
      });
    }
  };

  // widget/src/styles.css
  var styles_default = ':host {\n  all: initial;\n  display: block;\n  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;\n  font-size: 14px;\n  line-height: 1.5;\n  color: #1f2937;\n  z-index: 2147483640;\n}\n\n*, *::before, *::after {\n  box-sizing: border-box;\n}\n\n.ai-widget-container {\n  --ai-primary: #4f46e5;\n  --ai-primary-hover: #4338ca;\n  --ai-primary-contrast: #ffffff;\n  --ai-bg: #ffffff;\n  --ai-surface: #f9fafb;\n  --ai-surface-alt: #f3f4f6;\n  --ai-border: #e5e7eb;\n  --ai-text: #111827;\n  --ai-text-muted: #6b7280;\n  --ai-user-bubble: #4f46e5;\n  --ai-user-text: #ffffff;\n  --ai-bot-bubble: #f3f4f6;\n  --ai-bot-text: #111827;\n  --ai-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);\n  --ai-radius: 16px;\n  --ai-radius-sm: 8px;\n\n  position: fixed;\n  z-index: 2147483647;\n  pointer-events: none;\n}\n\n/* Dark Theme overrides */\n.ai-widget-container[data-theme="dark"] {\n  --ai-bg: #18181b;\n  --ai-surface: #27272a;\n  --ai-surface-alt: #3f3f46;\n  --ai-border: #3f3f46;\n  --ai-text: #f4f4f5;\n  --ai-text-muted: #a1a1aa;\n  --ai-user-bubble: var(--ai-primary);\n  --ai-user-text: #ffffff;\n  --ai-bot-bubble: #27272a;\n  --ai-bot-text: #f4f4f5;\n  --ai-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);\n}\n\n/* Auto Theme Media Query */\n@media (prefers-color-scheme: dark) {\n  .ai-widget-container[data-theme="auto"] {\n    --ai-bg: #18181b;\n    --ai-surface: #27272a;\n    --ai-surface-alt: #3f3f46;\n    --ai-border: #3f3f46;\n    --ai-text: #f4f4f5;\n    --ai-text-muted: #a1a1aa;\n    --ai-user-bubble: var(--ai-primary);\n    --ai-user-text: #ffffff;\n    --ai-bot-bubble: #27272a;\n    --ai-bot-text: #f4f4f5;\n    --ai-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);\n  }\n}\n\n/* Launcher Positions */\n.pos-bottom-right { bottom: 20px; right: 20px; }\n.pos-bottom-left { bottom: 20px; left: 20px; }\n.pos-top-right { top: 20px; right: 20px; }\n.pos-top-left { top: 20px; left: 20px; }\n\n/* Floating Launcher Button */\n.ai-launcher-btn {\n  pointer-events: auto;\n  position: relative;\n  width: 56px;\n  height: 56px;\n  border-radius: 50%;\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  border: none;\n  cursor: pointer;\n  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.2s ease, box-shadow 0.2s ease;\n  outline: none;\n}\n\n.ai-launcher-btn:hover {\n  transform: scale(1.08);\n  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);\n}\n\n.ai-launcher-btn:active {\n  transform: scale(0.96);\n}\n\n.ai-launcher-btn:focus-visible {\n  outline: 3px solid var(--ai-primary);\n  outline-offset: 3px;\n}\n\n.ai-launcher-btn svg {\n  width: 26px;\n  height: 26px;\n  fill: currentColor;\n  transition: transform 0.25s ease, opacity 0.2s ease;\n}\n\n.ai-launcher-btn .icon-close {\n  display: none;\n}\n\n.ai-widget-container.is-open .ai-launcher-btn .icon-chat {\n  display: none;\n}\n\n.ai-widget-container.is-open .ai-launcher-btn .icon-close {\n  display: block;\n}\n\n/* Chat Panel */\n.ai-panel {\n  pointer-events: auto;\n  position: absolute;\n  width: 380px;\n  height: 560px;\n  max-width: calc(100vw - 32px);\n  max-height: calc(100vh - 100px);\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: var(--ai-radius);\n  box-shadow: var(--ai-shadow);\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  opacity: 0;\n  transform: scale(0.95) translateY(10px);\n  transform-origin: bottom right;\n  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);\n  visibility: hidden;\n}\n\n/* Position-based origins and anchors */\n.pos-bottom-right .ai-panel { bottom: 70px; right: 0; transform-origin: bottom right; }\n.pos-bottom-left .ai-panel { bottom: 70px; left: 0; transform-origin: bottom left; }\n.pos-top-right .ai-panel { top: 70px; right: 0; transform-origin: top right; }\n.pos-top-left .ai-panel { top: 70px; left: 0; transform-origin: top left; }\n\n.ai-widget-container.is-open .ai-panel {\n  opacity: 1;\n  transform: scale(1) translateY(0);\n  visibility: visible;\n}\n\n/* Header */\n.ai-header {\n  padding: 12px 16px;\n  background: var(--ai-bg);\n  border-bottom: 1px solid var(--ai-border);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-shrink: 0;\n  user-select: none;\n}\n\n.ai-header-info {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.ai-avatar {\n  width: 32px;\n  height: 32px;\n  border-radius: 50%;\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-weight: 600;\n  font-size: 14px;\n  overflow: hidden;\n  flex-shrink: 0;\n}\n\n.ai-avatar img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.ai-header-titles {\n  display: flex;\n  flex-direction: column;\n}\n\n.ai-title {\n  font-size: 14px;\n  font-weight: 600;\n  color: var(--ai-text);\n  line-height: 1.2;\n}\n\n.ai-status {\n  font-size: 11px;\n  color: var(--ai-text-muted);\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.ai-status-dot {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: #10b981;\n}\n\n.ai-status-dot.busy {\n  background: #f59e0b;\n  animation: pulse-dot 1.5s infinite;\n}\n\n@keyframes pulse-dot {\n  0%, 100% { opacity: 1; transform: scale(1); }\n  50% { opacity: 0.5; transform: scale(1.2); }\n}\n\n.ai-header-actions {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.ai-icon-btn {\n  background: transparent;\n  border: none;\n  color: var(--ai-text-muted);\n  width: 30px;\n  height: 30px;\n  border-radius: var(--ai-radius-sm);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  transition: background-color 0.15s ease, color 0.15s ease;\n  outline: none;\n}\n\n.ai-icon-btn:hover {\n  background: var(--ai-surface-alt);\n  color: var(--ai-text);\n}\n\n.ai-icon-btn:focus-visible {\n  outline: 2px solid var(--ai-primary);\n}\n\n.ai-icon-btn svg {\n  width: 16px;\n  height: 16px;\n  fill: currentColor;\n}\n\n/* Conversation Body */\n.ai-body {\n  flex: 1;\n  min-height: 0;\n  overflow-y: auto;\n  overflow-x: hidden;\n  padding: 16px;\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  background: var(--ai-bg);\n  scroll-behavior: smooth;\n}\n\n.ai-body::-webkit-scrollbar {\n  width: 5px;\n}\n\n.ai-body::-webkit-scrollbar-thumb {\n  background: var(--ai-border);\n  border-radius: 4px;\n}\n\n/* Welcome Box */\n.ai-welcome-box {\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: var(--ai-radius-sm);\n  padding: 14px;\n  margin-bottom: 4px;\n}\n\n.ai-welcome-greeting {\n  font-size: 13.5px;\n  color: var(--ai-text);\n  margin-bottom: 12px;\n  line-height: 1.5;\n}\n\n.ai-suggested-prompts-label {\n  font-size: 11px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  color: var(--ai-text-muted);\n  margin-bottom: 8px;\n}\n\n.ai-prompts-list {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ai-prompt-pill {\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: 14px;\n  padding: 5px 10px;\n  font-size: 12px;\n  color: var(--ai-text);\n  cursor: pointer;\n  transition: all 0.15s ease;\n  text-align: left;\n  outline: none;\n}\n\n.ai-prompt-pill:hover {\n  background: var(--ai-primary);\n  border-color: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  transform: translateY(-1px);\n}\n\n.ai-prompt-pill:focus-visible {\n  outline: 2px solid var(--ai-primary);\n}\n\n/* Message Rows */\n.ai-message-row {\n  display: flex;\n  flex-direction: column;\n  max-width: 88%;\n  min-width: 0;\n  animation: fadeInMsg 0.2s ease;\n}\n\n.ai-message-row.ai-signup-row {\n  width: 100%;\n  max-width: 100%;\n  min-width: 0;\n}\n\n@keyframes fadeInMsg {\n  from { opacity: 0; transform: translateY(4px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n\n.ai-message-row.user {\n  align-self: flex-end;\n}\n\n.ai-message-row.assistant {\n  align-self: flex-start;\n}\n\n.ai-bubble {\n  padding: 10px 14px;\n  border-radius: 14px;\n  font-size: 13.5px;\n  line-height: 1.55;\n  word-break: break-word;\n}\n\n.ai-message-row.user .ai-bubble {\n  background: var(--ai-user-bubble);\n  color: var(--ai-user-text);\n  border-bottom-right-radius: 4px;\n}\n\n.ai-message-row.assistant .ai-bubble {\n  background: var(--ai-bot-bubble);\n  color: var(--ai-bot-text);\n  border-bottom-left-radius: 4px;\n  border: 1px solid var(--ai-border);\n}\n\n/* Assistant Bubble Markdown elements */\n.ai-bubble p {\n  margin: 0 0 8px 0;\n}\n.ai-bubble p:last-child {\n  margin-bottom: 0;\n}\n\n.ai-bubble h2, .ai-bubble h3, .ai-bubble h4 {\n  margin: 10px 0 6px 0;\n  color: var(--ai-text);\n  font-weight: 600;\n}\n.ai-bubble h2 { font-size: 15px; }\n.ai-bubble h3 { font-size: 14px; }\n.ai-bubble h4 { font-size: 13.5px; }\n\n.ai-bubble ul, .ai-bubble ol {\n  margin: 6px 0 8px 18px;\n  padding: 0;\n}\n\n.ai-bubble li {\n  margin-bottom: 4px;\n}\n\n.ai-bubble blockquote {\n  margin: 8px 0;\n  padding: 4px 10px;\n  border-left: 3px solid var(--ai-primary);\n  background: var(--ai-surface);\n  color: var(--ai-text-muted);\n  font-style: italic;\n}\n\n.ai-bubble a {\n  color: var(--ai-primary);\n  text-decoration: underline;\n}\n\n.ai-bubble code.inline-code {\n  background: rgba(0, 0, 0, 0.08);\n  padding: 2px 5px;\n  border-radius: 4px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;\n  font-size: 12px;\n}\n\n[data-theme="dark"] .ai-bubble code.inline-code {\n  background: rgba(255, 255, 255, 0.12);\n}\n\n/* Code block container */\n.code-block-wrapper {\n  margin: 8px 0;\n  border-radius: 6px;\n  overflow: hidden;\n  background: #1e1e24;\n  color: #f8f8f2;\n  font-size: 12px;\n}\n\n.code-header {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 4px 10px;\n  background: #282a36;\n  color: #a0a0a0;\n  font-size: 11px;\n}\n\n.code-lang {\n  text-transform: uppercase;\n  font-weight: 600;\n}\n\n.copy-code-btn {\n  background: transparent;\n  border: 1px solid #44475a;\n  color: #f8f8f2;\n  border-radius: 4px;\n  padding: 2px 6px;\n  font-size: 10px;\n  cursor: pointer;\n}\n\n.copy-code-btn:hover {\n  background: #44475a;\n}\n\n.code-block-wrapper pre {\n  margin: 0;\n  padding: 10px;\n  overflow-x: auto;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;\n}\n\n/* Message Meta & Action Bar */\n.ai-message-actions {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-top: 4px;\n  font-size: 11px;\n  color: var(--ai-text-muted);\n}\n\n.ai-msg-action-btn {\n  background: transparent;\n  border: none;\n  color: var(--ai-text-muted);\n  font-size: 11px;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n  padding: 2px 6px;\n  border-radius: 4px;\n  transition: all 0.15s ease;\n  outline: none;\n}\n\n.ai-msg-action-btn:hover {\n  background: var(--ai-surface-alt);\n  color: var(--ai-text);\n}\n\n.ai-msg-action-btn:focus-visible {\n  outline: 2px solid var(--ai-primary);\n}\n\n/* Typing / Streaming Indicator */\n.ai-streaming-indicator {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  padding: 8px 12px;\n  border-radius: 12px;\n  background: var(--ai-bot-bubble);\n  border: 1px solid var(--ai-border);\n  width: fit-content;\n  align-self: flex-start;\n}\n\n.ai-typing-dot {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--ai-text-muted);\n  animation: typingBounce 1.4s infinite ease-in-out both;\n}\n\n.ai-typing-dot:nth-child(1) { animation-delay: -0.32s; }\n.ai-typing-dot:nth-child(2) { animation-delay: -0.16s; }\n\n@keyframes typingBounce {\n  0%, 80%, 100% { transform: scale(0); opacity: 0.4; }\n  40% { transform: scale(1); opacity: 1; }\n}\n\n/* Error Banner */\n.ai-error-banner {\n  background: #fef2f2;\n  border: 1px solid #fecaca;\n  color: #991b1b;\n  border-radius: var(--ai-radius-sm);\n  padding: 8px 12px;\n  font-size: 12px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin: 4px 0;\n}\n\n[data-theme="dark"] .ai-error-banner {\n  background: #450a0a;\n  border-color: #7f1d1d;\n  color: #fca5a5;\n}\n\n.ai-error-retry-btn {\n  background: #dc2626;\n  color: white;\n  border: none;\n  padding: 3px 8px;\n  border-radius: 4px;\n  font-size: 11px;\n  font-weight: 500;\n  cursor: pointer;\n}\n\n/* Footer / Input Area */\n.ai-footer {\n  padding: 12px 14px;\n  background: var(--ai-bg);\n  border-top: 1px solid var(--ai-border);\n  flex-shrink: 0;\n}\n\n.ai-input-form {\n  display: flex;\n  align-items: flex-end;\n  gap: 8px;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: 18px;\n  padding: 4px 6px 4px 12px;\n  transition: border-color 0.2s ease, box-shadow 0.2s ease;\n}\n\n.ai-input-form:focus-within {\n  border-color: var(--ai-primary);\n  box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.15);\n}\n\n.ai-textarea {\n  flex: 1;\n  background: transparent;\n  border: none;\n  outline: none;\n  resize: none;\n  padding: 6px 0;\n  max-height: 120px;\n  min-height: 24px;\n  font-family: inherit;\n  font-size: 13.5px;\n  line-height: 1.4;\n  color: var(--ai-text);\n}\n\n.ai-textarea::placeholder {\n  color: var(--ai-text-muted);\n}\n\n.ai-send-btn, .ai-stop-btn {\n  width: 32px;\n  height: 32px;\n  border-radius: 50%;\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  border: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  flex-shrink: 0;\n  transition: background-color 0.15s ease, transform 0.1s ease;\n  outline: none;\n}\n\n.ai-send-btn:hover, .ai-stop-btn:hover {\n  background: var(--ai-primary-hover);\n}\n\n.ai-send-btn:disabled {\n  background: var(--ai-border);\n  color: var(--ai-text-muted);\n  cursor: not-allowed;\n}\n\n.ai-stop-btn {\n  background: #ef4444;\n}\n\n.ai-stop-btn:hover {\n  background: #dc2626;\n}\n\n.ai-send-btn svg, .ai-stop-btn svg {\n  width: 15px;\n  height: 15px;\n  fill: currentColor;\n}\n\n.ai-footer-note {\n  font-size: 10.5px;\n  color: var(--ai-text-muted);\n  text-align: center;\n  margin-top: 6px;\n}\n\n/* Reduced Motion */\n@media (prefers-reduced-motion: reduce) {\n  .ai-launcher-btn, .ai-panel, .ai-message-row, .ai-prompt-pill {\n    transition: none !important;\n    animation: none !important;\n  }\n}\n\n/* Mobile & Small Screen Adaptability */\n@media (max-width: 640px) {\n  .ai-panel {\n    width: 100vw !important;\n    height: 100% !important;\n    max-width: 100vw !important;\n    max-height: 100vh !important;\n    top: 0 !important;\n    left: 0 !important;\n    right: 0 !important;\n    bottom: 0 !important;\n    border-radius: 0 !important;\n    position: fixed !important;\n  }\n\n  .pos-bottom-right, .pos-bottom-left, .pos-top-right, .pos-top-left {\n    bottom: 16px;\n    right: 16px;\n    left: auto;\n    top: auto;\n  }\n}\n\n@media (max-width: 480px) {\n  .ai-body {\n    padding: 12px;\n  }\n\n  .ai-form-row {\n    grid-template-columns: minmax(0, 1fr);\n  }\n}\n\n/* Action Proposal Card */\n.ai-action-card {\n  margin-top: 10px;\n  width: 100%;\n  max-width: 100%;\n  min-width: 0;\n  box-sizing: border-box;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: var(--ai-radius-sm);\n  padding: 12px;\n  font-size: 12.5px;\n  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n[data-theme="dark"] .ai-action-card {\n  background: rgba(255, 255, 255, 0.04);\n  border-color: rgba(255, 255, 255, 0.12);\n}\n\n.ai-action-header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.ai-action-badge {\n  background: rgba(79, 70, 229, 0.12);\n  color: var(--ai-primary);\n  font-size: 10.5px;\n  font-weight: 600;\n  padding: 2px 7px;\n  border-radius: 10px;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n}\n\n[data-theme="dark"] .ai-action-badge {\n  background: rgba(99, 102, 241, 0.25);\n  color: #818cf8;\n}\n\n.ai-action-title {\n  font-weight: 600;\n  color: var(--ai-text);\n  font-size: 13px;\n  flex: 1;\n}\n\n.ai-action-explanation {\n  margin: 0;\n  color: var(--ai-text-muted);\n  line-height: 1.4;\n  font-size: 12px;\n}\n\n.ai-action-details {\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: 6px;\n  padding: 8px 10px;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n[data-theme="dark"] .ai-action-details {\n  background: rgba(0, 0, 0, 0.2);\n}\n\n.ai-action-param-row {\n  display: flex;\n  gap: 8px;\n  font-size: 11.5px;\n}\n\n.ai-action-param-key {\n  font-weight: 500;\n  color: var(--ai-text-muted);\n  min-width: 80px;\n  flex-shrink: 0;\n}\n\n.ai-action-param-val {\n  color: var(--ai-text);\n  word-break: break-word;\n  font-weight: 500;\n}\n\n.ai-action-risk {\n  border-radius: 999px;\n  font-size: 10px;\n  font-weight: 600;\n  padding: 2px 7px;\n  text-transform: uppercase;\n}\n\n.ai-action-risk.risk-read {\n  background: rgba(16, 185, 129, 0.12);\n  color: #047857;\n}\n\n.ai-action-risk.risk-write {\n  background: rgba(79, 70, 229, 0.12);\n  color: var(--ai-primary);\n}\n\n.ai-action-risk.risk-destructive {\n  background: rgba(220, 38, 38, 0.12);\n  color: #b91c1c;\n}\n\n.ai-action-acknowledgement {\n  align-items: flex-start;\n  color: var(--ai-text-muted);\n  display: flex;\n  font-size: 11px;\n  gap: 7px;\n  line-height: 1.4;\n}\n\n.ai-action-acknowledgement input {\n  margin: 1px 0 0;\n}\n\n.ai-action-controls {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  margin-top: 4px;\n  width: 100%;\n  min-width: 0;\n}\n\n.ai-btn-action-confirm, .ai-btn-action-cancel {\n  border-radius: 6px;\n  font-size: 12px;\n  font-weight: 500;\n  padding: 6px 12px;\n  cursor: pointer;\n  border: 1px solid transparent;\n  transition: all 0.15s ease;\n  min-width: 0;\n  white-space: normal;\n  text-align: center;\n}\n\n.ai-btn-action-confirm {\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  flex: 1;\n}\n\n.ai-btn-action-confirm:hover:not(:disabled) {\n  background: var(--ai-primary-hover);\n}\n\n.ai-btn-action-confirm:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n\n.ai-btn-action-cancel {\n  background: transparent;\n  border-color: var(--ai-border);\n  color: var(--ai-text-muted);\n}\n\n.ai-btn-action-cancel:hover:not(:disabled) {\n  background: var(--ai-bg);\n  color: var(--ai-text);\n}\n\n.ai-action-status-msg {\n  border-radius: 6px;\n  padding: 6px 10px;\n  font-size: 11.5px;\n  font-weight: 500;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.ai-action-status-msg.executing {\n  background: #eff6ff;\n  color: #1d4ed8;\n  border: 1px solid #bfdbfe;\n}\n\n.ai-action-status-msg.success {\n  background: #f0fdf4;\n  color: #15803d;\n  border: 1px solid #bbf7d0;\n}\n\n.ai-action-status-msg.error {\n  background: #fef2f2;\n  color: #b91c1c;\n  border: 1px solid #fecaca;\n}\n\n.ai-action-status-msg.cancelled {\n  background: var(--ai-bg);\n  color: var(--ai-text-muted);\n  border: 1px solid var(--ai-border);\n}\n\n[data-theme="dark"] .ai-action-status-msg.executing {\n  background: #1e3a8a;\n  color: #93c5fd;\n  border-color: #2563eb;\n}\n\n[data-theme="dark"] .ai-action-status-msg.success {\n  background: #14532d;\n  color: #86efac;\n  border-color: #16a34a;\n}\n\n[data-theme="dark"] .ai-action-status-msg.error {\n  background: #7f1d1d;\n  color: #fca5a5;\n  border-color: #dc2626;\n}\n\n/* Document Attachment Button */\n.ai-attach-btn {\n  width: 32px;\n  height: 32px;\n  border-radius: 50%;\n  background: transparent;\n  color: var(--ai-text-muted);\n  border: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  flex-shrink: 0;\n  transition: all 0.15s ease;\n  outline: none;\n  margin-right: 4px;\n}\n.ai-attach-btn:hover {\n  background: var(--ai-bg);\n  color: var(--ai-primary);\n}\n.ai-attach-btn svg {\n  width: 17px;\n  height: 17px;\n  fill: currentColor;\n}\n\n.ai-processing-state {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  font-size: 12.5px;\n  color: var(--ai-text);\n}\n.ai-document-consent {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding: 12px;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: 8px;\n}\n.ai-document-consent h3,\n.ai-document-consent p {\n  margin: 0;\n}\n.ai-document-consent h3 {\n  font-size: 14px;\n  color: var(--ai-text);\n}\n.ai-document-consent p,\n.ai-document-consent-choice {\n  font-size: 12px;\n  color: var(--ai-text);\n}\n.ai-document-consent-choice {\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  cursor: pointer;\n}\n.ai-document-consent-choice input {\n  flex: 0 0 auto;\n  margin-top: 3px;\n}\n.ai-document-consent-controls {\n  display: flex;\n  gap: 8px;\n}\n.ai-document-consent-controls button,\n.ai-btn-document-cancel,\n.ai-btn-document-remove {\n  border: 1px solid var(--ai-border);\n  border-radius: 6px;\n  padding: 6px 10px;\n  color: var(--ai-text);\n  background: var(--ai-bg);\n  font: inherit;\n  cursor: pointer;\n}\n.ai-document-consent-controls .ai-btn-document-consent-accept {\n  border-color: var(--ai-primary);\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n}\n.ai-document-consent-controls button:disabled,\n.ai-btn-document-cancel:disabled,\n.ai-btn-document-remove:disabled {\n  opacity: 0.55;\n  cursor: not-allowed;\n}\n.ai-document-cancelled {\n  color: var(--ai-text-muted);\n}\n.ai-hirepool-resume-card {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding: 12px;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: 8px;\n}\n.ai-hirepool-resume-card strong,\n.ai-hirepool-resume-card p {\n  margin: 0;\n  overflow-wrap: anywhere;\n}\n.ai-hirepool-resume-card strong {\n  color: var(--ai-text);\n  font-size: 13px;\n}\n.ai-hirepool-resume-card p {\n  color: var(--ai-text-muted);\n  font-size: 12px;\n}\n.ai-hirepool-resume-controls {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n.ai-hirepool-resume-card button {\n  border: 1px solid var(--ai-border);\n  border-radius: 6px;\n  padding: 6px 10px;\n  color: var(--ai-text);\n  background: var(--ai-bg);\n  font: inherit;\n  cursor: pointer;\n}\n.ai-hirepool-resume-card .ai-btn-resume-confirm,\n.ai-hirepool-resume-card .ai-btn-resume-prepare {\n  border-color: var(--ai-primary);\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n}\n.ai-hirepool-resume-card button:disabled,\n.ai-attach-btn:disabled {\n  opacity: 0.55;\n  cursor: not-allowed;\n}\n.ai-spinner {\n  width: 16px;\n  height: 16px;\n  border: 2px solid rgba(79, 70, 229, 0.2);\n  border-top-color: var(--ai-primary);\n  border-radius: 50%;\n  animation: ai-spin 0.8s linear infinite;\n}\n@keyframes ai-spin {\n  to { transform: rotate(360deg); }\n}\n\n/* Generic Document Attachment Card */\n.ai-doc-card {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: 8px;\n  padding: 10px 12px;\n  margin: 4px 0;\n  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);\n}\n.ai-doc-header {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n.ai-doc-icon {\n  font-size: 22px;\n  line-height: 1;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.ai-doc-details {\n  flex: 1;\n  min-width: 0;\n}\n.ai-doc-title {\n  font-size: 13px;\n  font-weight: 600;\n  color: var(--ai-text);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.ai-doc-meta {\n  font-size: 11px;\n  color: var(--ai-text-muted);\n  margin-top: 2px;\n}\n.ai-doc-badge {\n  font-size: 10.5px;\n  font-weight: 500;\n  color: #059669;\n  background: rgba(16, 185, 129, 0.12);\n  padding: 3px 8px;\n  border-radius: 12px;\n  white-space: nowrap;\n}\n[data-theme="dark"] .ai-doc-badge {\n  color: #34d399;\n  background: rgba(16, 185, 129, 0.22);\n}\n.ai-doc-hint {\n  font-size: 12px;\n  color: var(--ai-text);\n  line-height: 1.4;\n  margin: 0;\n}\n\n/* In-Chat Signup & Onboarding Styles */\n.ai-signup-card {\n  border-left: 3px solid #16a34a;\n  width: 100%;\n  max-width: 100%;\n  min-width: 0;\n  box-sizing: border-box;\n}\n.ai-signup-role-options {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  margin: 8px 0;\n}\n.ai-role-btn {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  padding: 10px 12px;\n  border: 1px solid var(--ai-border);\n  border-radius: 8px;\n  background: var(--ai-bg);\n  cursor: pointer;\n  transition: all 0.2s ease;\n  text-align: left;\n}\n.ai-role-btn:hover {\n  border-color: #16a34a;\n  background: rgba(22, 163, 74, 0.05);\n}\n.ai-role-badge {\n  font-size: 10.5px;\n  font-weight: 600;\n  color: #16a34a;\n  text-transform: uppercase;\n  margin-bottom: 2px;\n}\n.ai-role-title {\n  font-size: 13.5px;\n  font-weight: 600;\n  color: var(--ai-text);\n}\n.ai-role-desc {\n  font-size: 11.5px;\n  color: var(--ai-text-muted);\n  margin-top: 2px;\n}\n.ai-signup-form,\n.ai-profile-form {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  margin-top: 8px;\n  width: 100%;\n  min-width: 0;\n  max-width: 100%;\n  box-sizing: border-box;\n}\n.ai-form-row {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 8px;\n  align-items: start;\n  width: 100%;\n  min-width: 0;\n  max-width: 100%;\n  box-sizing: border-box;\n}\n.ai-form-group {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  width: 100%;\n  min-width: 0;\n  max-width: 100%;\n  box-sizing: border-box;\n}\n.ai-form-label {\n  font-size: 11.5px;\n  font-weight: 500;\n  color: var(--ai-text);\n  line-height: 1.35;\n  overflow-wrap: break-word;\n  word-wrap: break-word;\n  min-width: 0;\n}\n.ai-form-input {\n  box-sizing: border-box;\n  width: 100%;\n  min-width: 0;\n  max-width: 100%;\n  margin: 0;\n  padding: 7px 10px;\n  border: 1px solid var(--ai-border);\n  border-radius: 6px;\n  font-size: 12.5px;\n  background: var(--ai-bg);\n  color: var(--ai-text);\n  outline: none;\n  font-family: inherit;\n}\n.ai-form-input:focus {\n  border-color: #16a34a;\n  box-shadow: 0 0 0 1px #16a34a;\n}\n.ai-password-wrapper {\n  position: relative;\n  display: flex;\n  align-items: center;\n}\n.ai-password-wrapper .ai-form-input {\n  width: 100%;\n  padding-right: 32px;\n}\n.ai-password-toggle {\n  position: absolute;\n  right: 8px;\n  background: none;\n  border: none;\n  cursor: pointer;\n  font-size: 14px;\n  color: var(--ai-text-muted);\n  padding: 2px;\n}\n.ai-form-input.ai-input-invalid {\n  border-color: #dc2626 !important;\n  background-color: #fef2f2 !important;\n}\n.ai-field-error {\n  color: #dc2626;\n  font-size: 11px;\n  margin-top: 2px;\n  line-height: 1.3;\n}\n\n/* Structured Action Review Cards & Tables */\n.ai-review-card-content {\n  margin: 8px 0;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n.ai-review-table {\n  width: 100%;\n  border-collapse: collapse;\n  font-size: 12px;\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: 6px;\n  overflow: hidden;\n}\n.ai-review-table tr {\n  border-bottom: 1px solid var(--ai-border);\n}\n.ai-review-table tr:last-child {\n  border-bottom: none;\n}\n.ai-review-key {\n  text-align: left;\n  padding: 6px 10px;\n  width: 38%;\n  font-weight: 600;\n  color: var(--ai-text-muted);\n  background: rgba(0, 0, 0, 0.02);\n  vertical-align: top;\n}\n.ai-review-val {\n  padding: 6px 10px;\n  color: var(--ai-text);\n  font-weight: 500;\n  vertical-align: top;\n}\n.ai-review-section {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n.ai-review-section-title {\n  font-size: 11px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  color: var(--ai-text-muted);\n}\n.ai-review-tags {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 4px;\n}\n.ai-review-tag {\n  display: inline-block;\n  padding: 2px 8px;\n  border-radius: 12px;\n  font-size: 11px;\n  font-weight: 500;\n  background: #e0f2fe;\n  color: #0369a1;\n  border: 1px solid #bae6fd;\n}\n.ai-review-tag.preferred {\n  background: #f1f5f9;\n  color: #475569;\n  border-color: #cbd5e1;\n}\n.ai-review-desc {\n  font-size: 11.5px;\n  line-height: 1.4;\n  color: var(--ai-text);\n  padding: 6px 8px;\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: 6px;\n  max-height: 120px;\n  overflow-y: auto;\n  white-space: pre-wrap;\n}\n.ai-btn-action-edit {\n  background: transparent;\n  color: var(--ai-text);\n  border: 1px solid var(--ai-border);\n  border-radius: 6px;\n  padding: 6px 12px;\n  font-size: 12px;\n  cursor: pointer;\n  transition: all 0.15s ease;\n}\n.ai-btn-action-edit:hover {\n  background: rgba(0, 0, 0, 0.05);\n  border-color: var(--ai-text-muted);\n}\n.ai-verification-body {\n  padding: 4px 0;\n  width: 100%;\n  min-width: 0;\n  box-sizing: border-box;\n}\n.ai-role-btn {\n  width: 100%;\n  box-sizing: border-box;\n}\n';

  // config/hirepool-site-policy.js
  var HIREPOOL_PUBLIC_SITE_ORIGIN = "https://hirepool.ai";
  var HIREPOOL_PRODUCTION_LOGIN_URL = "https://app.hirepool.ai/login";
  var HIREPOOL_LOCAL_LOGIN_URL = "http://localhost:5173/login";
  var HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS = Object.freeze([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001"
  ]);
  var HIREPOOL_LOCAL_PUBLIC_SITE_PATHS = Object.freeze([
    "/",
    "/features",
    "/enterprise",
    "/pricing",
    "/partners",
    "/women",
    "/terms",
    "/privacy",
    "/contact"
  ]);
  var HIREPOOL_LOCAL_DASHBOARD_ORIGINS = Object.freeze([
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ]);
  var localOrigins = new Set(HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS);
  var publicOrigins = /* @__PURE__ */ new Set([...HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS, HIREPOOL_PUBLIC_SITE_ORIGIN]);
  var publicPaths = new Set(HIREPOOL_LOCAL_PUBLIC_SITE_PATHS);
  function isApprovedPublicSiteUrl(value, origins) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (!origins.has(url.origin) || url.username || url.password) {
      return false;
    }
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    return publicPaths.has(pathname);
  }
  function isHirePoolLocalPublicSiteUrl(value) {
    return isApprovedPublicSiteUrl(value, localOrigins);
  }
  function isHirePoolPublicSiteUrl(value) {
    return isApprovedPublicSiteUrl(value, publicOrigins);
  }

  // widget/src/hirepool-login.js
  var HIREPOOL_LOGIN_ACTION = "hirepool_login";
  var HIREPOOL_SIGNUP_ACTION = "hirepool_signup";
  var activeAccountWindow = null;
  function getHirePoolAccountUrl(currentUrl, action = HIREPOOL_LOGIN_ACTION) {
    let pageUrl;
    try {
      pageUrl = new URL(currentUrl);
    } catch {
      throw new TypeError("The current page URL is invalid");
    }
    if (!isHirePoolPublicSiteUrl(pageUrl.href)) {
      throw new Error("HirePool account actions can only be opened from an approved public website page");
    }
    const isSignup = action === HIREPOOL_SIGNUP_ACTION;
    if (!isSignup && action !== HIREPOOL_LOGIN_ACTION) {
      throw new TypeError("Unsupported HirePool account action");
    }
    const route = isSignup ? "/register" : "/login";
    if (pageUrl.origin === HIREPOOL_PUBLIC_SITE_ORIGIN) {
      return new URL(route, HIREPOOL_PRODUCTION_LOGIN_URL).href;
    }
    const accountUrl = new URL(route, HIREPOOL_LOCAL_LOGIN_URL);
    accountUrl.searchParams.set("assistant_origin", pageUrl.origin);
    return accountUrl.href;
  }
  function openHirePoolAccount({ currentUrl, openWindow, action = HIREPOOL_LOGIN_ACTION }) {
    if (typeof openWindow !== "function") {
      throw new TypeError("A browser window opener is required");
    }
    const accountUrl = getHirePoolAccountUrl(currentUrl, action);
    let accountWindow;
    try {
      accountWindow = openWindow("about:blank", "_blank");
      if (!accountWindow) {
        throw new Error("The HirePool account window was blocked by the browser");
      }
      accountWindow.location.replace(accountUrl);
      activeAccountWindow = accountWindow;
      return {
        message: action === HIREPOOL_SIGNUP_ACTION ? "HirePool signup opened in a new tab. Complete the existing registration and email verification steps, then return to this assistant." : "HirePool login opened in a new tab. Return to this assistant afterward; this conversation will remain open."
      };
    } catch (error) {
      accountWindow?.close?.();
      throw new Error(
        error instanceof Error ? error.message : "HirePool login could not be opened"
      );
    }
  }
  function openHirePoolLogin(options) {
    return openHirePoolAccount({ ...options, action: HIREPOOL_LOGIN_ACTION });
  }
  function openHirePoolSignup(options) {
    return openHirePoolAccount({ ...options, action: HIREPOOL_SIGNUP_ACTION });
  }
  function isHirePoolAccountWindow(source) {
    return Boolean(activeAccountWindow && source === activeAccountWindow);
  }
  function clearHirePoolAccountWindow(source) {
    if (source && source !== activeAccountWindow) return false;
    activeAccountWindow = null;
    return true;
  }

  // widget/src/sdk.js
  var EventEmitter = class {
    constructor() {
      this.listeners = /* @__PURE__ */ new Map();
    }
    on(event, handler) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, /* @__PURE__ */ new Set());
      }
      this.listeners.get(event).add(handler);
      return () => this.off(event, handler);
    }
    off(event, handler) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).delete(handler);
      }
    }
    emit(event, ...args) {
      if (this.listeners.has(event)) {
        for (const handler of this.listeners.get(event)) {
          try {
            handler(...args);
          } catch (err) {
            console.error(`Error in event listener for "${event}":`, err);
          }
        }
      }
    }
    clear() {
      this.listeners.clear();
    }
  };
  var AssistantSDK = class {
    constructor() {
      this.version = "1.0.0";
      this.events = new EventEmitter();
      this.initialized = false;
      this.initializing = false;
      this.widgetUI = null;
      this.apiClient = null;
      this.storage = null;
      this.integration = null;
      this.config = null;
      this.storageNamespace = null;
      this.integrationUnsubscribe = null;
      this.integrationCancelUnsubscribe = null;
      this.integrationHookUnsubscribes = [];
      this.actionHandlers = /* @__PURE__ */ new Map();
      this.hostIdentityRefreshId = 0;
    }
    /**
     * Initialize the SDK and mount widget
     * @param {object} [options]
     * @param {string} [options.assistantId='default']
     * @param {string} [options.apiUrl=''] Base URL of the backend (default: current host origin)
     * @param {string} [options.theme='auto'] 'light' | 'dark' | 'auto'
     * @param {string} [options.primaryColor] Custom hex color
     * @param {string} [options.position='bottom-right'] 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
     * @param {string} [options.name] Display name override
     * @param {string} [options.greeting] Greeting override
     * @param {string[]} [options.suggestedPrompts] Suggested prompt list override
     * @param {object} [options.features] Feature flag overrides
     */
    async init(options = {}) {
      if (this.initialized) {
        console.warn("[AssistantSDK] SDK is already initialized. Call AssistantSDK.destroy() before reinitializing.");
        return this;
      }
      if (this.initializing) {
        return this;
      }
      const assistantId = options.assistantId ?? "default";
      if (typeof assistantId !== "string" || assistantId.length < 1 || assistantId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(assistantId)) {
        throw new TypeError("assistantId must contain 1-64 letters, numbers, underscores, or hyphens");
      }
      if (assistantId === "hirepool" && typeof window !== "undefined" && !isHirePoolPublicSiteUrl(window.location.href)) {
        throw new Error("The HirePool assistant is available only on approved public website pages");
      }
      const apiUrl = options.apiUrl ?? this._detectApiUrl();
      if (typeof apiUrl !== "string") {
        throw new TypeError("apiUrl must be an absolute HTTP or HTTPS origin");
      }
      if (apiUrl) {
        let parsedApiUrl;
        try {
          parsedApiUrl = new URL(apiUrl);
        } catch {
          throw new TypeError("apiUrl must be an absolute HTTP or HTTPS origin");
        }
        if (!["http:", "https:"].includes(parsedApiUrl.protocol) || parsedApiUrl.username || parsedApiUrl.password || parsedApiUrl.pathname !== "/" || parsedApiUrl.search || parsedApiUrl.hash) {
          throw new TypeError("apiUrl must be an HTTP or HTTPS origin without credentials, path, query, or fragment");
        }
      }
      const integration = options.integration ? new HostIntegrationAdapter(options.integration) : null;
      const sessionScope = integration ? await integration.getSessionScope() : null;
      const initialContext = serializeContext(options.context);
      const documentUpload = normalizeDocumentUploadSettings(options.documentUpload);
      this.initializing = true;
      this.integration = integration;
      this.actionHandlers.clear();
      if (assistantId === "hirepool") {
        this.actionHandlers.set(HIREPOOL_LOGIN_ACTION, () => openHirePoolLogin({
          currentUrl: window.location.href,
          openWindow: (...args) => window.open(...args)
        }));
        this.actionHandlers.set(HIREPOOL_SIGNUP_ACTION, () => openHirePoolSignup({
          currentUrl: window.location.href,
          openWindow: (...args) => window.open(...args)
        }));
      }
      this.apiClient = new AssistantApiClient(apiUrl, {
        assistantId,
        getAuthHeaders: this.integration ? () => this.integration.getAuthHeaders() : void 0,
        credentials: this.integration?.credentials
      });
      const storageNamespace = integration ? `${integration.application.id}:${assistantId}:${sessionScope || "guest"}` : assistantId;
      this.storageNamespace = storageNamespace;
      this.storage = new AssistantStorage(storageNamespace);
      let serverConfig = {};
      try {
        serverConfig = await this.apiClient.fetchConfig(assistantId);
      } catch (err) {
        console.warn(`[AssistantSDK] Could not fetch remote configuration for "${assistantId}", using fallback defaults.`, err.message);
      }
      this.config = {
        assistantId,
        apiUrl,
        name: options.name || serverConfig.name || "AI Assistant",
        description: options.description || serverConfig.description || "",
        avatarUrl: options.avatarUrl || serverConfig.avatarUrl || "",
        theme: options.theme || serverConfig.theme || "auto",
        primaryColor: options.primaryColor || serverConfig.primaryColor || "#4f46e5",
        position: options.position || serverConfig.position || "bottom-right",
        greeting: options.greeting || serverConfig.greeting || "Hello! How can I help you today?",
        suggestedPrompts: options.suggestedPrompts || serverConfig.suggestedPrompts || [],
        context: initialContext,
        applicationId: this.integration?.application.id || null,
        documentUpload,
        features: {
          ...serverConfig.features || {},
          ...options.features || {}
        }
      };
      if (!this.initializing) {
        return this;
      }
      this.initializing = false;
      this.widgetUI = new AssistantWidgetUI({
        ...this.config,
        integration: this.integration,
        hasActionHandler: (action) => this._hasActionHandler(action)
      }, this.apiClient, this.storage, this.events);
      this._setupIntegrationHooks();
      this.widgetUI.mount(styles_default);
      this.initialized = true;
      this.refreshHostIdentity().catch((error) => this.events.emit("error", error));
      this.events.emit("ready", { assistantId, config: this.config });
      return this;
    }
    _setupIntegrationHooks() {
      if ((this.actionHandlers.size > 0 || this.integration?.actionExecutor || typeof this.apiClient?.confirmDynamicApiAction === "function") && !this.integrationUnsubscribe) {
        this.integrationUnsubscribe = this.events.on("action:execute", async (request) => {
          try {
            const handler = this.actionHandlers.get(request.action);
            if (handler) {
              request.resolve(await handler(request.parameters));
            } else if (request.confirmationToken && this.apiClient.getAuthenticatedSession()?.credential) {
              request.resolve(await this.apiClient.confirmDynamicApiAction(request.confirmationToken));
            } else if (this.integration?.actionExecutor) {
              request.resolve(await this.integration.executeHostAction(
                request.action,
                request.parameters,
                request.confirmationToken
              ));
            } else {
              throw new Error("No action handler is registered for this operation");
            }
          } catch (err) {
            request.reject(err);
          }
        });
      }
      if (!this.integrationCancelUnsubscribe) {
        this.integrationCancelUnsubscribe = this.events.on("action:cancel", (action) => {
          if (!action?.confirmationToken) return;
          const cancelPromise = this.apiClient?.getAuthenticatedSession?.()?.credential && typeof this.apiClient?.cancelDynamicApiAction === "function" ? this.apiClient.cancelDynamicApiAction(action.confirmationToken) : typeof this.integration?.cancelHostAction === "function" ? this.integration.cancelHostAction({ confirmationToken: action.confirmationToken }) : null;
          if (cancelPromise && typeof cancelPromise.catch === "function") {
            cancelPromise.catch((error) => {
              this.displayNotice(`The action card was cancelled, but its server confirmation could not be revoked: ${error.message}`);
              this.events.emit("error", error);
            });
          }
        });
      }
      if (this.integration && this.integrationHookUnsubscribes.length === 0) {
        this.integrationHookUnsubscribes.push(
          this.events.on("action:proposed", (action) => this.integration?.notifyActionProposed(action)),
          this.events.on("action:success", (result) => this.integration?.notifyActionResult({ status: "success", ...result })),
          this.events.on("action:error", (result) => this.integration?.notifyActionResult({ status: "error", ...result })),
          this.events.on("error", (error) => this.integration?.notifyError(error))
        );
        const unsubscribe = this.integration.subscribeToContextChanges(() => {
          this.refreshContext().catch((error) => {
            this.events.emit("error", error);
          });
        });
        this.integrationHookUnsubscribes.push(unsubscribe);
      }
    }
    _hasActionHandler(actionOrId) {
      const actionId = typeof actionOrId === "string" ? actionOrId : actionOrId?.action;
      if (this.actionHandlers.has(actionId)) {
        return true;
      }
      if (this.config?.assistantId === "hirepool" && actionOrId && typeof actionOrId === "object") {
        const isAccountAction = actionId === HIREPOOL_LOGIN_ACTION || actionId === HIREPOOL_SIGNUP_ACTION;
        const hasToken = typeof actionOrId.confirmationToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(actionOrId.confirmationToken);
        if (hasToken && this.apiClient?.getAuthenticatedSession?.()?.credential) {
          return true;
        }
        if (!this.integration?.actionExecutor) {
          return false;
        }
        return isAccountAction || hasToken;
      }
      if (!this.integration?.actionExecutor) {
        return false;
      }
      return true;
    }
    async attachHostIntegration(config) {
      this._ensureInit();
      if (this.config.assistantId !== "hirepool" || !isHirePoolLocalPublicSiteUrl(window.location.href)) {
        throw new Error("Host integration can only be attached to the local HirePool public website");
      }
      if (this.integration) {
        throw new Error("A host integration is already attached to this assistant");
      }
      const integration = new HostIntegrationAdapter(config);
      this.integration = integration;
      this.apiClient.getAuthHeaders = () => this.integration.getAuthHeaders();
      this.apiClient.credentials = integration.credentials;
      this.widgetUI.options.integration = integration;
      this.config.applicationId = integration.application.id;
      this.config.context = await integration.getContext();
      if (!this.widgetUI.contextOverrideSet) {
        this.widgetUI.setContext(this.config.context, false);
      }
      this._setupIntegrationHooks();
      await this.refreshSessionScope();
      return this;
    }
    async refreshSessionScope({ preserveConversation = true } = {}) {
      this._ensureInit();
      if (!this.integration) {
        throw new Error("A host integration is required to change the assistant session scope");
      }
      const scope = await this.integration.getSessionScope();
      const nextNamespace = `${this.integration.application.id}:${this.config.assistantId}:${scope || "guest"}`;
      if (nextNamespace === this.storageNamespace) return this;
      const previousStorage = this.storage;
      const nextStorage = new AssistantStorage(nextNamespace);
      nextStorage.clear();
      if (preserveConversation) {
        nextStorage.set("documents", previousStorage.get("documents", []));
      }
      this.storageNamespace = nextNamespace;
      this.storage = nextStorage;
      this.widgetUI.storage = nextStorage;
      this.widgetUI._persistState();
      previousStorage.clear();
      return this;
    }
    async resumePendingMessage({ conversationId, message }) {
      this._ensureInit();
      if (typeof conversationId !== "string" || typeof message !== "string" || !message.trim()) {
        throw new TypeError("A conversation ID and pending message are required");
      }
      this.widgetUI.activeConversationId = conversationId;
      this.widgetUI._persistState();
      if (!this.widgetUI.isOpen) this.widgetUI.open();
      return this.widgetUI.sendMessage(message, { displayUserMessage: false });
    }
    clearConversationLocal() {
      this._ensureInit();
      this.widgetUI.clearLocalConversation();
    }
    async logout() {
      this._ensureInit();
      let result = null;
      let logoutError = null;
      try {
        result = await this.apiClient.logoutHirePoolSession(this.widgetUI?.activeConversationId || null);
      } catch (err) {
        logoutError = err;
      }
      const confirmationMessage = logoutError ? `Local assistant credentials were cleared, but server logout could not be confirmed (${logoutError.message}).` : result?.backendRevoked === false ? `You are logged out of this assistant session, though HirePool did not confirm upstream token revocation (${result.reason || "backend revocation unavailable"}).` : "You have been logged out of HirePool.";
      await this.widgetUI?._handleHirePoolLogout?.(
        result || { loggedOut: true, sdkSessionRevoked: true, backendRevoked: false, reason: logoutError?.message },
        confirmationMessage
      );
      if (logoutError) {
        throw logoutError;
      }
      return result;
    }
    displayNotice(message) {
      if (typeof message !== "string" || !message.trim()) {
        throw new TypeError("A non-empty notice message is required");
      }
      if (!this.widgetUI) {
        console.error(`[AssistantSDK] ${message.trim().slice(0, 500)}`);
        return;
      }
      const safeMessage = message.trim().slice(0, 500).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character]);
      const isVerificationError = /could not verify|verification|session/i.test(message);
      const retryCallback = isVerificationError ? async () => {
        let credential = null;
        if (typeof this.integration?.getAuthHeaders === "function") {
          try {
            const headers = await this.integration.getAuthHeaders();
            const authHeader = headers?.Authorization || headers?.authorization || "";
            credential = authHeader.replace(/^Bearer\s+/i, "").trim() || null;
          } catch {
          }
        }
        if (!credential) {
          credential = this.widgetUI?.storage?.get?.("hirepool_session")?.credential || null;
        }
        if (credential && this.apiClient) {
          const result = await this.apiClient.validateHirePoolSession(credential);
          if (result?.valid) {
            await this.refreshSessionScope({ preserveConversation: true });
            return;
          }
        }
        throw new Error("HirePool login verification failed. Please try signing in again.");
      } : null;
      this.widgetUI._renderErrorBanner(safeMessage, retryCallback);
    }
    displayHirePoolLoginNotice(message) {
      this._ensureInit();
      if (!this.widgetUI) {
        return this.displayNotice(message);
      }
      this.widgetUI.displayHirePoolLoginNotice(message);
    }
    invalidatePendingActions(message) {
      this._ensureInit();
      this.widgetUI?.invalidatePendingActions(message);
    }
    isHirePoolAccountWindow(source) {
      return this.config?.assistantId === "hirepool" && isHirePoolAccountWindow(source);
    }
    clearHirePoolAccountWindow(source) {
      return clearHirePoolAccountWindow(source);
    }
    /**
     * Open the chat panel
     */
    open() {
      this._ensureInit();
      this.widgetUI.open();
    }
    /**
     * Close the chat panel
     */
    close() {
      this._ensureInit();
      this.widgetUI.close();
    }
    /**
     * Toggle the chat panel open/closed
     */
    toggle() {
      this._ensureInit();
      this.widgetUI.toggle();
    }
    /**
     * Programmatically send a message as the user
     * @param {string} text
     */
    async sendMessage(text) {
      this._ensureInit();
      if (!this.widgetUI.isOpen) {
        this.widgetUI.open();
      }
      return this.widgetUI.sendMessage(text);
    }
    /**
     * Standalone summarization helper
     * @param {string} text Text to summarize
     * @param {object} [options]
     * @param {'concise'|'detailed'|'bullet_points'|'key_takeaways'|'action_items'|'structured_json'} [options.style='concise']
     * @param {string} [options.focus] Specific aspect to focus on
     * @param {boolean} [options.stream=false]
     * @param {function} [options.onChunk]
     */
    async summarize(text, options = {}) {
      this._ensureInit();
      return this.apiClient.summarize({
        text,
        style: options.style || "concise",
        focus: options.focus,
        stream: !!options.stream,
        onChunk: options.onChunk
      });
    }
    /**
     * Clear active conversation history
     */
    clearConversation() {
      this._ensureInit();
      return this.widgetUI.newConversation();
    }
    /**
     * Change theme dynamically
     * @param {'light'|'dark'|'auto'} theme
     */
    setTheme(theme) {
      this._ensureInit();
      this.widgetUI.setTheme(theme);
    }
    /**
     * Change launcher position dynamically
     * @param {'bottom-right'|'bottom-left'|'top-right'|'top-left'} position
     */
    setPosition(position) {
      this._ensureInit();
      this.widgetUI.setPosition(position);
    }
    /**
     * Dynamically update host application context for subsequent conversation turns
     * @param {string|null} context Application context string, or null/empty to clear
     */
    setContext(context) {
      this._ensureInit();
      const normalized = serializeContext(context);
      this.config.context = normalized;
      if (this.widgetUI) {
        this.widgetUI.setContext(normalized);
      }
      this.refreshHostIdentity().catch((error) => this.events.emit("error", error));
      this.events.emit("context:updated", { context: normalized });
      return this;
    }
    setGreeting(greeting, suggestedPrompts = []) {
      this._ensureInit();
      const text = typeof greeting === "string" ? greeting : "";
      const prompts = Array.isArray(suggestedPrompts) ? suggestedPrompts.filter((prompt) => typeof prompt === "string") : [];
      this.config.greeting = text;
      this.config.suggestedPrompts = prompts;
      this.widgetUI.setGreeting(text, prompts);
      return this;
    }
    /**
     * Clear active host application context
     */
    clearContext() {
      this._ensureInit();
      if (!this.integration) return this.setContext(null);
      this.widgetUI.contextOverrideSet = false;
      return this.refreshContext();
    }
    async refreshContext() {
      this._ensureInit();
      if (!this.integration) return this.config.context;
      const context = await this.integration.getContext();
      await this.refreshHostIdentity();
      if (!this.widgetUI.contextOverrideSet) {
        this.config.context = context;
        this.widgetUI.setContext(context, false);
      }
      this.events.emit("context:updated", { context });
      return context;
    }
    async refreshHostIdentity() {
      this._ensureInit();
      if (!this.integration || !this.widgetUI) return null;
      const refreshId = ++this.hostIdentityRefreshId;
      const [identity, scope] = await Promise.all([
        this.integration.getIdentity(),
        this.integration.getSessionScope()
      ]);
      if (refreshId !== this.hostIdentityRefreshId || !this.initialized || !this.widgetUI) return null;
      this.widgetUI.setHostIdentity(identity, scope);
      return identity;
    }
    getHostIdentity() {
      this._ensureInit();
      return this.integration?.getIdentity() || Promise.resolve(null);
    }
    getHostPermissions() {
      this._ensureInit();
      return this.integration?.getPermissions() || Promise.resolve([]);
    }
    getAvailableActions() {
      this._ensureInit();
      return this.integration?.getAvailableActions() || Promise.resolve([]);
    }
    /**
     * Get current active host application context
     * @returns {string|null}
     */
    getContext() {
      return this.config?.context ?? null;
    }
    /**
     * Register event listener
     * Supported events: 'ready', 'open', 'close', 'message:sent', 'message:received', 'error', 'conversation:cleared', 'context:updated'
     */
    on(event, handler) {
      return this.events.on(event, handler);
    }
    /**
     * Remove event listener
     */
    off(event, handler) {
      this.events.off(event, handler);
    }
    /**
     * Get current state
     */
    getState() {
      return {
        initialized: this.initialized,
        isOpen: this.widgetUI?.isOpen || false,
        isGenerating: this.widgetUI?.isGenerating || false,
        conversationId: this.widgetUI?.activeConversationId || null,
        messageCount: this.widgetUI?.messages?.length || 0,
        context: this.config?.context ?? null,
        config: this.config ? { ...this.config } : null
      };
    }
    /**
     * Clean up widget from DOM and reset SDK state
     */
    destroy() {
      this.initializing = false;
      this.hostIdentityRefreshId += 1;
      if (this.widgetUI) {
        this.widgetUI.unmount();
        this.widgetUI = null;
      }
      this.events.clear();
      this.integrationUnsubscribe?.();
      this.integrationUnsubscribe = null;
      this.integrationCancelUnsubscribe?.();
      this.integrationCancelUnsubscribe = null;
      for (const unsubscribe of this.integrationHookUnsubscribes) unsubscribe();
      this.integrationHookUnsubscribes = [];
      this.integration = null;
      this.actionHandlers.clear();
      this.storage = null;
      this.storageNamespace = null;
      this.apiClient = null;
      this.config = null;
      this.initialized = false;
    }
    _ensureInit() {
      if (!this.initialized) {
        throw new Error("[AssistantSDK] SDK is not initialized. Please call AssistantSDK.init() first.");
      }
      if (this.config?.assistantId === "hirepool" && typeof window !== "undefined" && !isHirePoolPublicSiteUrl(window.location.href)) {
        throw new Error("The HirePool assistant is unavailable on this page");
      }
    }
    _detectApiUrl() {
      if (typeof window === "undefined") return "";
      const scripts = document.querySelectorAll('script[src*="assistant.js"]');
      if (scripts.length > 0) {
        const src = scripts[scripts.length - 1].getAttribute("src");
        try {
          const parsed = new URL(src, window.location.href);
          return parsed.origin;
        } catch {
        }
      }
      return window.location.origin;
    }
  };
  var sdkInstance = new AssistantSDK();
  if (typeof window !== "undefined") {
    let autoInitFromScriptTag = function() {
      const scripts = document.querySelectorAll('script[src*="assistant.js"]');
      if (!scripts || scripts.length === 0) return;
      const currentScript = scripts[scripts.length - 1];
      const assistantId = currentScript.getAttribute("data-assistant-id");
      const autoload = currentScript.getAttribute("data-autoload");
      const appId = currentScript.getAttribute("data-app-id");
      const hostIntegration = appId && window.__HIREPOOL_ASSISTANT_HOST__;
      if (assistantId || appId || autoload === "true") {
        const options = {
          assistantId: assistantId || "default",
          apiUrl: currentScript.getAttribute("data-api-url") || void 0,
          theme: currentScript.getAttribute("data-theme") || void 0,
          primaryColor: currentScript.getAttribute("data-primary-color") || void 0,
          position: currentScript.getAttribute("data-position") || void 0,
          greeting: currentScript.getAttribute("data-greeting") || void 0,
          context: currentScript.getAttribute("data-context") || void 0,
          integration: appId ? {
            version: 1,
            application: { id: appId, name: appId },
            ...typeof hostIntegration?.getAuthHeaders === "function" ? { getAuthHeaders: () => hostIntegration.getAuthHeaders() } : {},
            ...typeof hostIntegration?.getSessionScope === "function" ? { getSessionScope: () => hostIntegration.getSessionScope() } : {}
          } : void 0
        };
        Object.keys(options).forEach((k) => options[k] === void 0 && delete options[k]);
        sdkInstance.init(options).catch((err) => {
          console.error("[AssistantSDK] Auto-initialization failed:", err);
        });
      }
    };
    window.AssistantSDK = sdkInstance;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", autoInitFromScriptTag);
    } else {
      autoInitFromScriptTag();
    }
  }
  var sdk_default = sdkInstance;
  return __toCommonJS(sdk_exports);
})();
//# sourceMappingURL=assistant.js.map
