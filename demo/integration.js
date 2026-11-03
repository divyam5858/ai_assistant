document.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('integrationStatus');
  const noteOutput = document.getElementById('mockNote');
  const note = {
    id: 'note-1',
    title: 'Quarterly planning',
    text: 'Review customer feedback and prepare the next release plan.'
  };
  const mockUser = {
    id: 'demo-user',
    role: 'editor',
    canUpdateNotes: true
  };

  const renderNote = () => {
    noteOutput.textContent = JSON.stringify(note, null, 2);
  };
  renderNote();

  try {
    await window.AssistantSDK.init({
      assistantId: 'integration-demo',
      apiUrl: window.location.origin,
      integration: {
        version: 1,
        application: {
          id: 'generic-demo',
          name: 'Generic Mock Application'
        },
        contextProvider: () => ({
          page: {
            route: window.location.pathname,
            title: 'Notes'
          },
          user: {
            id: mockUser.id,
            role: mockUser.role
          },
          selectedEntity: {
            type: 'note',
            id: note.id,
            title: note.title
          }
        }),
        canExecuteAction: async (actionId) => {
          return actionId === 'notes:search' ||
            (actionId === 'notes:update' && mockUser.canUpdateNotes);
        },
        executeAction: async ({ actionId, parameters }) => {
          if (actionId === 'notes:search') {
            const query = parameters.query.toLowerCase();
            return {
              message: 'Search completed in mock application.',
              results: note.text.toLowerCase().includes(query) || note.title.toLowerCase().includes(query)
                ? [{ ...note }]
                : []
            };
          }

          if (actionId === 'notes:update') {
            if (parameters.noteId !== note.id) {
              throw new Error('The requested note does not exist in the mock application.');
            }
            note.text = parameters.text;
            renderNote();
            return { message: 'The mock note was updated.', note: { ...note } };
          }

          throw new Error(`Unregistered host action: ${actionId}`);
        }
      }
    });

    window.AssistantSDK.on('action:success', ({ action }) => {
      status.textContent = `Host action completed: ${action}`;
    });
    window.AssistantSDK.on('action:error', ({ error }) => {
      status.textContent = `Host action failed: ${error.message}`;
    });
    status.textContent = 'SDK ready. Ask about the note, then request a change to see confirmation.';
  } catch (error) {
    status.textContent = `SDK initialization failed: ${error.message}`;
  }
});
