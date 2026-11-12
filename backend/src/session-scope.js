import { getAssistantApplicationId } from './dynamic-api/catalog.js';
import { AuthorizationError } from './middleware/auth.js';

export function createSessionOptions(user, assistantId) {
  const applicationId = getAssistantApplicationId(assistantId);
  if (user?.assistantId && user.assistantId !== assistantId) {
    throw new AuthorizationError('The authenticated token is not authorized for this assistant', 'ASSISTANT_MISMATCH');
  }
  if (user?.applicationId && user.applicationId !== applicationId) {
    throw new AuthorizationError('The authenticated token is not authorized for this application', 'APPLICATION_MISMATCH');
  }
  return {
    assistantId,
    applicationId,
    userId: user?.id || null,
    tenantId: user?.tenantId || null
  };
}
