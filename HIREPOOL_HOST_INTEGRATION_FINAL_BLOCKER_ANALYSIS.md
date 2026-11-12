# HirePool Host Integration Final Blocker Analysis

## Scope and method

This investigation treats the HirePool repository as read-only and inspects only the actual checked-in Host app code plus the SDK contract in the SDK repo. The conclusion is not based on assumptions; it is based on the actual implementation patterns and the contract exposed by the SDK.

## Executive conclusion

The HirePool app does not expose a verified, production-ready host integration that a standalone SDK can trust for authenticated business actions. The app has a public-site assistant mount and a localhost-only dev assistant bridge, but neither is the same thing as a real host-side authenticated action contract. The SDK has a generic host integration contract (`HostIntegrationAdapter` and `action:execute` handling), but there is no evidence that the actual HirePool frontend implements it.

The blocker is therefore structural: without a trusted host-side identity provider and action executor in the real HirePool app, the SDK cannot safely identify the authenticated user, determine the actual `user_type`, call authorized HirePool APIs, or continue authenticated conversations across login and external assessment steps without inventing an insecure or host-modifying workaround.

## 1) Existing host integration evidence

### 1.1 Public website assistant mount exists, but only as public, unauthenticated context

- The public marketing site includes the widget in the root layout: [D:\talenthub-develop\website\app\layout.tsx](D:/talenthub-develop/website/app/layout.tsx#L147)
- The widget is defined in [D:\talenthub-develop\website\components\LocalAssistantWidget.tsx](D:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L1-L160)
- The component explicitly limits itself to public paths and creates a context object with `authentication: { status: "unavailable", identity: null, role: null }` and `workflow: "public_marketing_site"`: [D:\talenthub-develop\website\components\LocalAssistantWidget.tsx](D:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L17-L44), [D:\talenthub-develop\website\components\LocalAssistantWidget.tsx](D:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L91-L117)
- This is not a real authenticated host integration; it is a public-site context-only mount.

### 1.2 Authenticated dashboard assistant mount exists only as a localhost/dev pattern

- The authenticated app layout mounts the assistant component: [D:\talenthub-develop\frontend\src\components\layout\AppLayout.tsx](D:/talenthub-develop/frontend/src/components/layout/AppLayout.tsx#L1-L31)
- The assistant component is [D:\talenthub-develop\frontend\src\components\assistant\HirePoolAssistant.tsx](D:/talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx#L1-L255)
- It is gated by `if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return`: [D:\talenthub-develop\frontend\src\components\assistant\HirePoolAssistant.tsx](D:/talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx#L72-L79)
- It creates a bridge session by POSTing to a local SDK endpoint and returns `Authorization: Bearer <token>` and `sessionScope` via the SDK integration object: [D:\talenthub-develop\frontend\src\components\assistant\HirePoolAssistant.tsx](D:/talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx#L114-L141), [D:\talenthub-develop\frontend\src\components/assistant/HirePoolAssistant.tsx](D:/talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx#L199-L220)
- That proves a local/dev bridge pattern exists, not a production host contract.

## 2) Authentication flow evidence

- The actual HirePool authenticated API client reads the access token from `localStorage` and attaches it to every request: [D:\talenthub-develop\frontend\src\api\client.ts](D:/talenthub-develop/frontend/src/api/client.ts#L20-L36), [D:\talenthub-develop\frontend\src\api\client.ts](D:/talenthub-develop/frontend/src/api/client.ts#L27-L36)
- The Axios interceptor attaches `Authorization: Bearer <token>` for authenticated API calls: [D:\talenthub-develop\frontend\src\api\client.ts](D:/talenthub-develop/frontend/src/api/client.ts#L27-L38)
- The actual app uses this HTTP client as the trusted auth path; it is not directly exposed to the SDK.

## 3) SDK host contract evidence

The SDK’s generic host contract is defined in [D:\ai-assistant-plugin\widget\src\integration.js](D:/ai-assistant-plugin/widget/src/integration.js#L25-L183).

Relevant host capabilities include:

- `getAuthHeaders` validation and normalization: [D:\ai-assistant-plugin\widget\src\integration.js](D:/ai-assistant-plugin/widget/src/integration.js#L97-L116)
- `getSessionScope` validation: [D:\ai-assistant-plugin\widget\src\integration.js](D:/ai-assistant-plugin/widget/src/integration.js#L118-L125)
- `getIdentity` validation: [D:\ai-assistant-plugin\widget\src\integration.js](D:/ai-assistant-plugin/widget/src/integration.js#L127-L132)
- `executeHostAction(actionId, parameters)` with permission gating: [D:\ai-assistant-plugin\widget\src\integration.js](D:/ai-assistant-plugin/widget/src/integration.js#L173-L183)

This contract is capable of supporting a trusted host integration, but the host must implement it.

## 4) Action listener evidence

The SDK listens for `action:execute` and dispatches either a built-in handler or the host action executor: [D:\ai-assistant-plugin\widget\src\sdk.js](D:/ai-assistant-plugin/widget/src/sdk.js#L211-L240)

The relevant code path is:

- `this.events.on('action:execute', async (request) => { ... })`
- if a built-in action handler exists, use it
- else if `this.integration?.actionExecutor` exists, call `this.integration.executeHostAction(request.action, request.parameters)`

This is a generic SDK event contract. It proves the mechanism exists in the SDK, not that HirePool implements a host listener.

## 5) How the SDK expects a host-side bridge to work

The local bridge logic in the SDK repo shows the intended architecture for a trusted host bridge:

- [D:\ai-assistant-plugin\backend\src\local-integrations\hirepool-auth.js](D:/ai-assistant-plugin/backend/src/local-integrations/hirepool-auth.js#L110-L194)
- `requestHirePoolJson()` is a backend proxy that reads the bearer access token and calls the real HirePool API endpoints.
- `validateHirePoolIdentity()` calls `api/v1/auth/me` and then checks organization membership via `api/v1/clients/me` or `api/v1/consultancies/me`.
- It verifies `identity.user_type` and the role before accepting the identity.

This is a valid host-side pattern. It is not an existing implementation in the checked-in HirePool app itself.

## 6) Exact blocker

The exact blocker is this:

1. The real HirePool app does not expose a trusted authenticated callback or host-side `HostIntegrationAdapter` implementation to the SDK.
2. The actual app auth state is stored in browser/localStorage and consumed by the app’s own Axios client, not exposed as a secure SDK API boundary: [D:\talenthub-develop\frontend\src\api\client.ts](D:/talenthub-develop/frontend/src/api/client.ts#L20-L38)
3. The public website widget explicitly creates an unauthenticated public context: [D:\talenthub-develop\website\components\LocalAssistantWidget.tsx](D:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L29-L44), [D:\talenthub-develop\website\components\LocalAssistantWidget.tsx](D:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L94-L117)
4. The dashboard assistant is restricted to localhost/dev and uses a local bridge, not a production host integration: [D:\talenthub-develop\frontend\src\components\assistant\HirePoolAssistant.tsx](D:/talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx#L72-L88), [D:\talenthub-develop\frontend\src\components\assistant\HirePoolAssistant.tsx](D:/talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx#L199-L220)
5. SDK-only completion is not possible without either reading host browser storage, fabricating a privileged bridge, or modifying the HirePool app to provide the missing contract.

## 7) Answer to the exact questions

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Does the HirePool frontend already mount the assistant? | No, not in a verified authenticated production sense. It mounts a public-site widget and a localhost-only dev assistant, but not a production host-side authenticated integration. | [D:\talenthub-develop\website\app\layout.tsx](D:/talenthub-develop/website/app/layout.tsx#L147), [D:\talenthub-develop\website\components\LocalAssistantWidget.tsx](D:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L91-L153), [D:\talenthub-develop\frontend\src\components\layout\AppLayout.tsx](D:/talenthub-develop/frontend/src/components/layout/AppLayout.tsx#L12-L31), [D:\talenthub-develop\frontend\src\components\assistant\HirePoolAssistant.tsx](D:/talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx#L72-L88) |
| 2 | Does the HirePool frontend already listen for SDK actions? | No evidence of any actual HirePool listener for `action:execute` in the checked-in frontend. The SDK has the listener, not the host app. | [D:\ai-assistant-plugin\widget\src\sdk.js](D:/ai-assistant-plugin/widget/src/sdk.js#L211-L240); no matching `action:execute` listener found in the HirePool frontend source. |
| 3 | Does it already expose a trusted callback or integration interface? | No verified trusted host callback exists in the actual HirePool frontend. The SDK contract exists generically, but the Host app does not implement it. | [D:\ai-assistant-plugin\widget\src\integration.js](D:/ai-assistant-plugin/widget/src/integration.js#L25-L183); [D:\talenthub-develop\frontend\src\components\assistant\HirePoolAssistant.tsx](D:/talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx#L199-L220) |
| 4 | Can that interface access the existing authenticated HirePool API client? | Not as a verified, supported host interface. The actual API client is the app’s own Axios client, and it is only available inside the host app runtime; it is not exposed to the SDK as an API boundary. | [D:\talenthub-develop\frontend\src\api\client.ts](D:/talenthub-develop/frontend/src/api/client.ts#L20-L38); [D:\ai-assistant-plugin\widget\src\integration.js](D:/ai-assistant-plugin/widget/src/integration.js#L97-L183) |
| 5 | Can it identify the actual authenticated user? | Not via a verified host integration. The local bridge pattern can validate a bearer token and return `identity.id`, but that is a local bridge implementation, not actual HirePool frontend behavior. | [D:\ai-assistant-plugin\backend\src\local-integrations\hirepool-auth.js](D:/ai-assistant-plugin/backend/src/local-integrations/hirepool-auth.js#L164-L194) |
| 6 | Can it identify the actual `user_type`? | Only in the local bridge validator, where it checks `identity.user_type` and role membership. There is no real production host implementation exposing this to the SDK. | [D:\ai-assistant-plugin\backend\src\local-integrations\hirepool-auth.js](D:/ai-assistant-plugin/backend/src/local-integrations/hirepool-auth.js#L164-L194) |
| 7 | Can it execute authorized API operations without exposing tokens to the LLM? | Not in the actual HirePool app, because the trusted host-side executor is absent. The SDK can call `executeHostAction`, but that requires the host implementation; the app does not provide it. | [D:\ai-assistant-plugin\widget\src\integration.js](D:/ai-assistant-plugin/widget/src/integration.js#L173-L183), [D:\ai-assistant-plugin\widget\src\sdk.js](D:/ai-assistant-plugin/widget/src/sdk.js#L211-L240) |
| 8 | Can the SDK receive structured API responses? | The contract supports structured return values, but there is no actual HirePool host implementation returning them. The generic contract can carry structured JSON, but no real host endpoint is wired up in the app. | [D:\ai-assistant-plugin\widget\src\integration.js](D:/ai-assistant-plugin/widget/src/integration.js#L173-L183), [D:\ai-assistant-plugin\widget\src\sdk.js](D:/ai-assistant-plugin/widget/src/sdk.js#L211-L240) |
| 9 | Can conversation state survive login and external assessment steps? | Not proven by the checked-in HirePool frontend. The local bridge uses session state in the SDK backend but there is no verified host-managed continuity contract in the app. | [D:\ai-assistant-plugin\backend\src\local-integrations\hirepool-auth.js](D:/ai-assistant-plugin/backend/src/local-integrations/hirepool-auth.js#L195-L220), [D:\talenthub-develop\frontend\src\components\assistant\HirePoolAssistant.tsx](D:/talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx#L85-L172) |
| 10 | Can this entire mechanism work without modifying HirePool? | No. Without a trusted host-side contract in the actual HirePool app, the SDK cannot securely complete the flow. The SDK can only do so if the host app exposes the required interface or a supported bridge is added there. | [D:\ai-assistant-plugin\widget\src\integration.js](D:/ai-assistant-plugin/widget/src/integration.js#L25-L183), [D:\ai-assistant-plugin\widget\src\sdk.js](D:/ai-assistant-plugin/widget/src/sdk.js#L211-L240), [D:\talenthub-develop\frontend\src\api\client.ts](D:/talenthub-develop/frontend/src/api/client.ts#L20-L38) |

## 8) Smallest required next step

The smallest honest next step is not more SDK logic. It is a host-side contract in the actual HirePool app, or a dedicated supported bridge that the actual app implements and verifies.

That contract must provide, at minimum:

- verified authenticated user identity
- actual `user_type` and role metadata
- a secure, host-side `getAuthHeaders` equivalent without exposing raw tokens to the model
- a host-side `executeHostAction` / action pipeline routed through the existing authenticated HirePool API client
- structured return values from the real API responses
- session continuity across login and external assessment states

Until that contract exists, the SDK cannot complete the HirePool assistant flow safely or correctly.

## 9) Final determination

Status: Blocked by missing host integration.

SDK-only completion is not possible while preserving the HirePool app’s security, authenticated identity, and authorization boundaries. The working pattern is host-side integration that reuses the app’s real authenticated API client and verified session state; the SDK must only receive the minimum secure context and action channel that the host intentionally exposes.
