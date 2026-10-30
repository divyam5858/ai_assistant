// Sample texts for the summarization studio
const SAMPLE_TEXTS = {
  business: `Quarterly Business Performance Review (Q3)

1. Executive Summary:
Total revenue for Q3 reached $14.2M, representing a 28% year-over-year increase, driven primarily by enterprise tier adoption and expansion in international markets (APAC +45%). Net Retention Rate improved from 108% to 116%. Gross margin contracted slightly from 74% to 71% due to accelerated infrastructure investments in AI capabilities.

2. Product & Engineering Milestones:
The engineering team successfully shipped the AI Assistant Plugin SDK v1.0, enabling zero-friction embedding across client web apps. Early customer feedback shows an 80% reduction in first-response times for client support portals. Cloud infrastructure migration was completed on schedule with 99.98% overall uptime.

3. Key Challenges & Headwinds:
Sales cycles in the EMEA region expanded by an average of 14 days due to regulatory reviews under local data sovereignty policies. Marketing CAC increased by 12% in paid acquisition channels.

4. Strategic Next Steps:
- Accelerate SOC2 Type II certification to expedite EMEA enterprise deals.
- Optimize LLM token usage and caching strategies to restore gross margins to 75% by Q4.
- Launch the Partner Connector Marketplace to expand application integration footprint.`,

  tech: `Architecture Decision Record (ADR 024): Transitioning to a Modular Monolith with Event-Driven Connectors

Context:
Our platform has grown to 18 microservices managed by 3 small engineering teams. Over the past 9 months, team velocity has slowed due to high deployment orchestration complexity, distributed tracing overhead, and frequent cross-service contract breakage.

Decision:
We will consolidate our distributed microservices into a unified Modular Monolith using TypeScript/Node.js with clear bounded contexts and internal event buses. External connectors will be isolated behind a documented BaseConnector plugin contract with server-side authorization enforcement.

Consequences:
- Positive: Drastic reduction in local development friction and CI/CD pipeline duration (build times reduced from 18 min to 3 min).
- Positive: Atomic transactions across core bounded contexts without requiring distributed 2PC or complex Saga compensations.
- Positive: Zero network latency for in-process service-to-service communication.
- Trade-off: Requires strict static analysis and linting to prevent developers from bypassing domain module boundaries.`,

  incident: `Incident Post-Mortem: Incident INC-8821 (SSE Connection Degradation)

Date: October 26, 2026
Duration: 42 minutes
Impact: 14% of concurrent users experienced interrupted or stalled streaming chat responses.

Root Cause:
An intermediate reverse proxy had default response buffering enabled for HTTP/1.1 chunked responses, causing Server-Sent Events (SSE) packets to be held in buffer until 8KB of data accumulated or a timeout occurred. This manifested as stuttering and perceived response timeouts on short conversational answers.

Remediation Actions:
1. Added 'X-Accel-Buffering: no' response header across all SSE streaming endpoints in the backend server.
2. Configured aggressive client-side AbortController timeouts and automatic non-streaming fallback when streaming connection stalls.
3. Added end-to-end synthetic monitoring probing SSE stream latency every 60 seconds.`
};

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const eventLog = document.getElementById('eventLog');
  const clearLogBtn = document.getElementById('clearLogBtn');

  const sampleSelect = document.getElementById('sampleSelect');
  const summaryInput = document.getElementById('summaryInput');
  const summaryStyle = document.getElementById('summaryStyle');
  const summaryFocus = document.getElementById('summaryFocus');
  const btnSummarize = document.getElementById('btnSummarize');
  const btnSendToChat = document.getElementById('btnSendToChat');
  const summaryOutput = document.getElementById('summaryOutput');

  // Check Backend Health
  async function checkHealth() {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        statusDot.className = 'status-dot';
        statusText.textContent = `Backend Online (${data.provider?.name}: ${data.provider?.model || 'active'})`;
      } else {
        throw new Error('Status ' + res.status);
      }
    } catch (err) {
      statusDot.className = 'status-dot error';
      statusText.textContent = 'Backend Offline';
    }
  }
  checkHealth();
  setInterval(checkHealth, 15000);

  // Event Log Helper
  function logEvent(name, data) {
    if (!eventLog) return;
    const time = new Date().toLocaleTimeString();
    const row = document.createElement('div');
    row.className = 'event-log-row';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'event-log-time';
    timeSpan.textContent = `[${time}]`;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'event-log-name';
    nameSpan.textContent = name;

    const dataSpan = document.createElement('span');
    dataSpan.className = 'event-log-data';
    dataSpan.textContent = data ? JSON.stringify(data) : '';

    row.appendChild(timeSpan);
    row.appendChild(nameSpan);
    row.appendChild(dataSpan);

    eventLog.appendChild(row);
    eventLog.scrollTop = eventLog.scrollHeight;
  }

  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
      eventLog.innerHTML = '';
    });
  }

  // Subscribe to SDK events once window.AssistantSDK is ready
  function attachSdkListeners() {
    if (!window.AssistantSDK) return;

    window.AssistantSDK.on('ready', (payload) => {
      logEvent('ready', { assistantId: payload.assistantId });
    });

    window.AssistantSDK.on('open', () => {
      logEvent('open');
    });

    window.AssistantSDK.on('close', () => {
      logEvent('close');
    });

    window.AssistantSDK.on('message:sent', (msg) => {
      logEvent('message:sent', { text: msg.content.slice(0, 40) + '...' });
    });

    window.AssistantSDK.on('message:received', (msg) => {
      logEvent('message:received', { text: msg.content.slice(0, 40) + '...' });
    });

    window.AssistantSDK.on('error', (err) => {
      logEvent('error', { message: err.message });
    });

    window.AssistantSDK.on('conversation:cleared', () => {
      logEvent('conversation:cleared');
    });
  }

  if (window.AssistantSDK) {
    attachSdkListeners();
  } else {
    window.addEventListener('load', attachSdkListeners);
  }

  // Programmatic SDK Control Buttons
  document.getElementById('btnOpen')?.addEventListener('click', () => window.AssistantSDK?.open());
  document.getElementById('btnClose')?.addEventListener('click', () => window.AssistantSDK?.close());
  document.getElementById('btnToggle')?.addEventListener('click', () => window.AssistantSDK?.toggle());
  document.getElementById('btnClearConvo')?.addEventListener('click', () => window.AssistantSDK?.clearConversation());

  // Theme Buttons
  document.getElementById('btnThemeLight')?.addEventListener('click', () => window.AssistantSDK?.setTheme('light'));
  document.getElementById('btnThemeDark')?.addEventListener('click', () => window.AssistantSDK?.setTheme('dark'));
  document.getElementById('btnThemeAuto')?.addEventListener('click', () => window.AssistantSDK?.setTheme('auto'));

  // Position Buttons
  document.getElementById('btnPosBR')?.addEventListener('click', () => window.AssistantSDK?.setPosition('bottom-right'));
  document.getElementById('btnPosBL')?.addEventListener('click', () => window.AssistantSDK?.setPosition('bottom-left'));
  document.getElementById('btnPosTR')?.addEventListener('click', () => window.AssistantSDK?.setPosition('top-right'));
  document.getElementById('btnPosTL')?.addEventListener('click', () => window.AssistantSDK?.setPosition('top-left'));

  // Preset Prompts
  document.querySelectorAll('.btn-prompt').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      if (prompt && window.AssistantSDK) {
        window.AssistantSDK.sendMessage(prompt);
      }
    });
  });

  // Persona Switcher
  document.getElementById('personaSelect')?.addEventListener('change', async (e) => {
    const assistantId = e.target.value;
    logEvent('switching_persona', { assistantId });
    if (window.AssistantSDK) {
      window.AssistantSDK.destroy();
      await window.AssistantSDK.init({ assistantId });
      attachSdkListeners();
    }
  });

  // Sample Text Selector
  if (sampleSelect && summaryInput) {
    sampleSelect.addEventListener('change', (e) => {
      const key = e.target.value;
      if (SAMPLE_TEXTS[key]) {
        summaryInput.value = SAMPLE_TEXTS[key];
      }
    });
    // Initial sample
    summaryInput.value = SAMPLE_TEXTS.business;
  }

  // Live Summarize Button
  if (btnSummarize) {
    btnSummarize.addEventListener('click', async () => {
      const text = summaryInput.value.trim();
      if (!text) {
        alert('Please enter or select text to summarize.');
        return;
      }

      const style = summaryStyle.value;
      const focus = summaryFocus.value.trim() || undefined;

      summaryOutput.classList.remove('empty');
      summaryOutput.textContent = 'Generating summary...\n';
      btnSummarize.disabled = true;

      try {
        let accumulated = '';
        await window.AssistantSDK.summarize(text, {
          style,
          focus,
          stream: true,
          onChunk: (chunk) => {
            accumulated += chunk;
            summaryOutput.textContent = accumulated;
          }
        });
        logEvent('summarize_completed', { style, length: text.length });
      } catch (err) {
        summaryOutput.textContent = `Error: ${err.message}`;
        logEvent('summarize_error', { message: err.message });
      } finally {
        btnSummarize.disabled = false;
      }
    });
  }

  // Send to Chat Button
  if (btnSendToChat) {
    btnSendToChat.addEventListener('click', () => {
      const text = summaryInput.value.trim();
      if (!text) return;
      const style = summaryStyle.value;
      const prompt = `Please summarize the following text in ${style.replace('_', ' ')} style:\n\n${text}`;
      window.AssistantSDK.sendMessage(prompt);
    });
  }

  // Code Copy Buttons
  document.querySelectorAll('.code-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const box = btn.closest('.code-box');
      const code = box.querySelector('pre') ? box.querySelector('pre').innerText : box.innerText;
      navigator.clipboard.writeText(code.replace('Copy', '').trim()).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    });
  });
});

