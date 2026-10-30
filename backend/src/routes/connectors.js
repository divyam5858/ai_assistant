import { Router } from 'express';
import { registry } from '../../../connectors/registry.js';
import { ConnectorActionSchema } from '../../../config/schemas.js';

export const connectorsRouter = Router();

/**
 * GET /api/connectors
 * List available connectors and their metadata
 */
connectorsRouter.get('/', (req, res) => {
  res.json({
    connectors: registry.list()
  });
});

/**
 * POST /api/connectors/execute
 * Execute a connector action with server-side authorization check
 */
connectorsRouter.post('/execute', async (req, res, next) => {
  try {
    const validated = ConnectorActionSchema.parse(req.body);
    const { connectorId, action, parameters, authToken } = validated;

    const connector = registry.get(connectorId);
    if (!connector) {
      return res.status(404).json({
        error: {
          code: 'CONNECTOR_NOT_FOUND',
          message: `Connector '${connectorId}' is not registered`
        }
      });
    }

    if (!connector.actions.includes(action)) {
      return res.status(400).json({
        error: {
          code: 'UNSUPPORTED_ACTION',
          message: `Action '${action}' is not supported by connector '${connectorId}'`
        }
      });
    }

    // Enforce authorization server-side
    const authContext = await connector.validateAuthorization(authToken, { action, parameters });

    // Execute the action
    const data = await connector.execute(action, parameters, authContext);

    res.json({
      success: true,
      connectorId,
      action,
      data
    });
  } catch (err) {
    next(err);
  }
});
