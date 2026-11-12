import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOpenApiSpec } from '../backend/src/dynamic-api/openapi.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const fixturePath = path.join(rootDir, 'tests', 'fixtures', 'hirepool-openapi.json');
const inventoryPath = path.join(rootDir, 'docs', 'hirepool-openapi-inventory.json');
const sourceUrl = 'http://127.0.0.1:8000/api/openapi.json';
const reviewCandidates = {
  candidate: [
    'get_current_user_info_api_v1_auth_me_get',
    'get_my_profile_api_v1_candidates_profile_get',
    'search_jobs_api_v1_jobs_search_get',
    'get_my_applications_api_v1_applications_my_applications_get'
  ],
  client: [
    'get_my_user_profile_api_v1_clients_me_get',
    'get_dashboard_stats_api_v1_clients_dashboard_get',
    'get_my_jobs_api_v1_jobs_my_jobs_get'
  ],
  consultancy: [
    'get_my_user_profile_api_v1_consultancies_me_get',
    'get_placement_stats_api_v1_consultancies_placements_stats_get'
  ]
};

async function loadSpecification() {
  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Local OpenAPI endpoint returned HTTP ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 5 * 1024 * 1024) {
      throw new Error('Local OpenAPI document exceeds 5 MiB');
    }
    return { text, source: sourceUrl };
  } catch (error) {
    try {
      return {
        text: await fs.readFile(fixturePath, 'utf8'),
        source: 'tests/fixtures/hirepool-openapi.json'
      };
    } catch {
      throw new Error(`Unable to retrieve local OpenAPI JSON or read its saved fixture: ${error.message}`);
    }
  }
}

function classify(entry) {
  const pathLower = entry.path.toLowerCase();
  if (/\/(admin|super-admin)(\/|$)/.test(pathLower)) return 'administrative-operation';
  if (/(invoice|payroll|commission|finance|contract|offer)/.test(pathLower)) return 'sensitive-or-restricted-operation';
  if (/(upload|resume|recording|document|file|download)/.test(pathLower)) return 'requires-file-or-multipart-review';
  if (/(token|logout|login|password|auth|oauth|webhook|magic-link)/.test(pathLower)) return 'sensitive-authentication-operation';
  if (entry.method !== 'GET') return 'state-changing-operation-not-approved';
  if (entry.parserStatus === 'rejected') return 'unsupported-schema';
  return 'supported-schema-requires-owner-approval';
}

function mapCandidateRoles(operationId) {
  return Object.entries(reviewCandidates)
    .filter(([, operationIds]) => operationIds.includes(operationId))
    .map(([role]) => role);
}

async function main() {
  const { text, source } = await loadSpecification();
  const specification = JSON.parse(text);
  const parsed = parseOpenApiSpec(specification);
  const discovered = new Set(parsed.inventory.map(entry => `${entry.method} ${entry.path}`));
  if (discovered.size !== parsed.inventory.length) {
    throw new Error('OpenAPI inventory contains duplicate method/path entries');
  }

  const operations = parsed.inventory.map(entry => ({
    ...entry,
    category: classify(entry),
    endpointDiscovered: true,
    openApiOperationInventoried: true,
    parameterParserSupported: entry.parserStatus === 'supported',
    eligibleForToolGeneration: false,
    ownerReviewCandidate: mapCandidateRoles(entry.operationId).length > 0,
    candidateRoles: mapCandidateRoles(entry.operationId),
    registrationStatus: 'not-registered',
    mockTestStatus: mapCandidateRoles(entry.operationId).length
      ? 'mock-tested-by-full-spec-fixture-test'
      : 'not-mock-tested',
    liveTested: false,
    eligibilityReason: 'No HirePool integration is registered or enabled; candidate operations still require owner approval and verified authentication.'
  }));
  const counts = {
    discovered: operations.length,
    inventoryParsed: operations.length,
    getOperations: operations.filter(operation => operation.method === 'GET').length,
    getParameterSchemasSupported: operations.filter(operation =>
      operation.method === 'GET' && operation.parameterParserSupported
    ).length,
    getParameterSchemasRejected: operations.filter(operation =>
      operation.method === 'GET' && !operation.parameterParserSupported
    ).length,
    nonGetNotGenerated: operations.filter(operation => operation.method !== 'GET').length,
    ownerReviewCandidates: operations.filter(operation => operation.ownerReviewCandidate).length,
    eligibleForToolGeneration: operations.filter(operation => operation.eligibleForToolGeneration).length,
    registered: operations.filter(operation => operation.registrationStatus !== 'not-registered').length,
    mockTested: operations.filter(operation =>
      operation.mockTestStatus === 'mock-tested-by-full-spec-fixture-test'
    ).length,
    liveTested: operations.filter(operation => operation.liveTested).length,
    byMethod: Object.fromEntries([...new Set(operations.map(operation => operation.method))]
      .sort()
      .map(method => [method, operations.filter(operation => operation.method === method).length])),
    byCategory: Object.fromEntries([...new Set(operations.map(operation => operation.category))]
      .sort()
      .map(category => [category, operations.filter(operation => operation.category === category).length]))
  };
  const inventory = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    source,
    openapiVersion: parsed.version,
    apiTitle: parsed.title,
    counts,
    reviewCandidates,
    diagnostics: parsed.diagnostics,
    operations
  };

  await fs.mkdir(path.dirname(fixturePath), { recursive: true });
  await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
  await fs.writeFile(fixturePath, `${JSON.stringify(specification, null, 2)}\n`, 'utf8');
  await fs.writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ fixturePath, inventoryPath, counts }, null, 2));
}

main().catch(error => {
  console.error(`[HirePool OpenAPI inventory] ${error.message}`);
  process.exitCode = 1;
});
