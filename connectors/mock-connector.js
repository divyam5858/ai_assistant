import { BaseConnector } from './base.js';

/**
 * Mock knowledge base & application connector for demonstration and testing.
 */
export class MockConnector extends BaseConnector {
  constructor() {
    super(
      'mock-knowledge',
      'Mock Knowledge Base & CRM Connector',
      'Provides sample article search and protected customer profile lookup for demonstration',
      ['searchKnowledge', 'getCustomerProfile']
    );

    // Mock dataset
    this.articles = [
      {
        id: 'kb-101',
        title: 'How to embed the AI Assistant Widget',
        content: 'To embed the widget, add the script tag pointing to /sdk/assistant.js and specify data-assistant-id.',
        tags: ['embed', 'widget', 'sdk', 'setup']
      },
      {
        id: 'kb-102',
        title: 'Streaming SSE Response Configuration',
        content: 'Streaming uses Server-Sent Events over POST /api/chat/stream or /api/summarize?stream=true with text/event-stream headers.',
        tags: ['streaming', 'sse', 'api']
      },
      {
        id: 'kb-103',
        title: 'Theme & Customization Options',
        content: 'Assistants support light, dark, and auto modes along with custom primary hex colors and launcher positions.',
        tags: ['theme', 'customization', 'ui']
      }
    ];

    this.customers = {
      'cust-001': {
        id: 'cust-001',
        name: 'Jane Doe',
        plan: 'Enterprise',
        status: 'Active',
        assignedRep: 'Alex Rivera'
      }
    };
  }

  /**
   * Validate mock authorization token server-side.
   * Public actions (like searching open articles) might not need a token.
   * Protected actions (like reading customer profiles) require a valid token.
   */
  async validateAuthorization(authToken, context = {}) {
    const { action } = context;

    // Open/public action
    if (action === 'searchKnowledge') {
      return { authorized: true, user: 'anonymous' };
    }

    // Protected action requires mock token "secret-demo-token-123"
    if (!authToken || authToken !== 'secret-demo-token-123') {
      const error = new Error('Unauthorized: Valid connector auth token required for protected data access');
      error.statusCode = 401;
      throw error;
    }

    return {
      authorized: true,
      user: 'admin_user',
      role: 'support_agent'
    };
  }

  /**
   * Execute connector action
   */
  async execute(action, parameters = {}, authContext = {}) {
    switch (action) {
      case 'searchKnowledge': {
        const query = (parameters.query || '').toLowerCase().trim();
        if (!query) {
          return { results: this.articles };
        }
        const matches = this.articles.filter(a =>
          a.title.toLowerCase().includes(query) ||
          a.content.toLowerCase().includes(query) ||
          a.tags.some(t => t.includes(query))
        );
        return {
          query,
          count: matches.length,
          results: matches
        };
      }

      case 'getCustomerProfile': {
        const customerId = parameters.customerId;
        const customer = this.customers[customerId];
        if (!customer) {
          const err = new Error(`Customer '${customerId}' not found`);
          err.statusCode = 404;
          throw err;
        }
        return {
          customer,
          requestedBy: authContext.user
        };
      }

      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }
}
