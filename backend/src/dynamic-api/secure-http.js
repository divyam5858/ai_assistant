import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_SPEC_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 15000;
const MAX_SPEC_BYTES = 5 * 1024 * 1024;

const defaultHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 10,
  timeout: 30000,
  keepAliveMsecs: 15000
});

const defaultHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 10,
  timeout: 30000,
  keepAliveMsecs: 15000
});
const IPV4_NON_PUBLIC_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
].map(([address, prefix]) => [ipv4ToBigInt(address), prefix]);

function ipv4ToBigInt(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null;
  }
  return octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

function isWithinCidr(value, network, prefix, bits) {
  const shift = BigInt(bits - prefix);
  return (value >> shift) === (network >> shift);
}

function isPublicIpv4(address) {
  const value = ipv4ToBigInt(address);
  if (value === null) return false;
  return IPV4_NON_PUBLIC_RANGES.every(([network, prefix]) =>
    !isWithinCidr(value, network, prefix, 32)
  );
}

function ipv6ToBigInt(address) {
  if (address.includes('%')) return null;
  let normalized = address.toLowerCase();
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const ipv4Part = normalized.slice(lastColon + 1);
    const ipv4Value = ipv4ToBigInt(ipv4Part);
    if (lastColon < 0 || ipv4Value === null) return null;
    normalized = `${normalized.slice(0, lastColon)}:${((ipv4Value >> 16n) & 0xffffn).toString(16)}:${(ipv4Value & 0xffffn).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

  const groups = [...left, ...Array(Math.max(missing, 0)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function isPublicIpv6(address) {
  const value = ipv6ToBigInt(address);
  if (value === null) return false;

  const globalUnicast = 0x2000n << 112n;
  const ietfProtocolAssignments = 0x2001n << 112n;
  const documentation = 0x20010db8n << 96n;
  const sixToFour = 0x2002n << 112n;
  const documentation3fff = 0x3fffn << 112n;
  return isWithinCidr(value, globalUnicast, 3, 128) &&
    !isWithinCidr(value, ietfProtocolAssignments, 23, 128) &&
    !isWithinCidr(value, documentation, 32, 128) &&
    !isWithinCidr(value, sixToFour, 16, 128) &&
    !isWithinCidr(value, documentation3fff, 20, 128);
}

export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export function getDynamicApiLimits(env = process.env) {
  const timeoutMs = env.API_DISCOVERY_TIMEOUT_MS === undefined
    ? DEFAULT_TIMEOUT_MS
    : Number(env.API_DISCOVERY_TIMEOUT_MS);
  const maxSpecBytes = env.API_DISCOVERY_MAX_SPEC_BYTES === undefined
    ? DEFAULT_MAX_SPEC_BYTES
    : Number(env.API_DISCOVERY_MAX_SPEC_BYTES);

  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`API_DISCOVERY_TIMEOUT_MS must be an integer between 100 and ${MAX_TIMEOUT_MS}`);
  }
  if (!Number.isInteger(maxSpecBytes) || maxSpecBytes < 1024 || maxSpecBytes > MAX_SPEC_BYTES) {
    throw new Error(`API_DISCOVERY_MAX_SPEC_BYTES must be an integer between 1024 and ${MAX_SPEC_BYTES}`);
  }

  return { timeoutMs, maxSpecBytes };
}

export function getAllowedApiHosts(env = process.env) {
  return new Set(
    String(env.API_DISCOVERY_ALLOWED_HOSTS || '')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function validateApiUrl(value, allowedHosts, { allowLocalDevelopment = false, allowedPorts = [] } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Dynamic API URLs must be valid HTTP or HTTPS URLs');
  }
  const hostname = url.hostname.toLowerCase();
  const isAllowedLocalUrl = allowLocalDevelopment &&
    url.protocol === 'http:' &&
    hostname === 'localhost' &&
    allowedPorts.includes(Number(url.port)) &&
    !url.username &&
    !url.password &&
    !url.hash &&
    allowedHosts.has(hostname);
  if (isAllowedLocalUrl) return url;

  if (url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !allowedHosts.has(hostname) ||
      net.isIP(hostname)) {
    throw new Error('Dynamic API URL is outside the configured HTTPS host allowlist');
  }
  return url;
}

export async function lookupPublicAddress(hostname) {
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Dynamic API host could not be resolved');
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Dynamic API host resolves to a non-public address');
  }
  return addresses[0];
}

function readResponse(response, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let ended = false;
    let settled = false;
    const cleanup = () => {
      response.removeListener('data', onData);
      response.removeListener('end', onEnd);
      response.removeListener('error', onError);
      response.removeListener('close', onClose);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onData = chunk => {
      length += chunk.length;
      if (length > maxBytes) {
        const error = new Error('Dynamic API response exceeded the configured size limit');
        error.code = 'RESPONSE_TOO_LARGE';
        response.destroy();
        finish(error);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      ended = true;
      finish(null, Buffer.concat(chunks).toString('utf8'));
    };
    const onError = () => finish(new Error('Dynamic API response could not be read'));
    const onClose = () => {
      if (!ended) onError();
    };

    response.on('data', onData);
    response.once('end', onEnd);
    response.once('error', onError);
    response.once('close', onClose);
  });
}

export async function requestText(
  value,
  {
    allowedHosts = getAllowedApiHosts(),
    headers = {},
    method = 'GET',
    body,
    rawBody = false,
    maxRequestBytes = 64 * 1024,
    contentType = 'application/json',
    timeoutMs = getDynamicApiLimits().timeoutMs,
    maxBytes = getDynamicApiLimits().maxSpecBytes,
    signal,
    allowYaml = false,
    resolveAddress = lookupPublicAddress,
    requestFactory,
    allowLocalDevelopment = false,
    allowedPorts = [],
    agent
  } = {}
) {
  if (!['GET', 'POST', 'PUT'].includes(method)) {
    throw new Error('Dynamic API request method is not supported');
  }
  if (method === 'GET' && body !== undefined) {
    throw new Error('GET requests cannot include a request body');
  }
  const requestBody = body === undefined
    ? undefined
    : rawBody
      ? Buffer.isBuffer(body) ? body : null
      : JSON.stringify(body);
  if (body !== undefined && requestBody === null) {
    throw new Error('Raw dynamic API request bodies must be buffers');
  }
  if (!Number.isInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 10 * 1024 * 1024) {
    throw new Error('Dynamic API request size limit is invalid');
  }
  if (requestBody !== undefined && Buffer.byteLength(requestBody) > maxRequestBytes) {
    throw new Error('Dynamic API request body exceeded the configured size limit');
  }
  const url = validateApiUrl(value, allowedHosts, { allowLocalDevelopment, allowedPorts });
  const isLocalHttp = url.protocol === 'http:' &&
    allowLocalDevelopment &&
    url.hostname === 'localhost' &&
    allowedPorts.includes(Number(url.port));
  const makeRequest = requestFactory || (isLocalHttp ? http.request : https.request);
  const resolvedAgent = agent !== undefined
    ? agent
    : (requestFactory ? undefined : (isLocalHttp ? defaultHttpAgent : defaultHttpsAgent));
  if (signal?.aborted) {
    const err = new Error('Request aborted');
    err.name = 'AbortError';
    err.code = 'REQUEST_ABORTED';
    err.statusCode = 499;
    throw err;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    let response;
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        response?.destroy();
        request?.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const onAbort = () => {
      const abortError = new Error('Request aborted');
      abortError.name = 'AbortError';
      abortError.code = 'REQUEST_ABORTED';
      abortError.statusCode = 499;
      finish(abortError);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(() => {
      const timeoutError = new Error('Dynamic API request timed out');
      timeoutError.name = 'DynamicApiTimeoutError';
      timeoutError.code = 'DYNAMIC_API_TIMEOUT';
      timeoutError.statusCode = 504;
      timeoutError.isTimeout = true;
      timeoutError.timeoutMs = timeoutMs;
      timeoutError.url = url.href;
      timeoutError.method = method;
      finish(timeoutError);
    }, timeoutMs);
    timeout.unref?.();

    Promise.resolve()
      .then(() => isLocalHttp
        ? { address: '127.0.0.1', family: 4 }
        : resolveAddress(url.hostname))
      .then(address => {
        if (settled) return;
        if (isLocalHttp
          ? address?.address !== '127.0.0.1'
          : !address || !isPublicAddress(address.address) || ![4, 6].includes(address.family)) {
          throw new Error('Dynamic API host resolves to a non-public address');
        }

        const requestOptions = {
          protocol: url.protocol,
          hostname: isLocalHttp ? address.address : url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method,
          ...(resolvedAgent ? { agent: resolvedAgent } : {}),
          headers: {
            Accept: allowYaml
              ? 'application/json, application/yaml, application/x-yaml, text/yaml, text/plain'
              : 'application/json',
              ...(requestBody !== undefined ? { 'Content-Type': contentType } : {}),
              ...(isLocalHttp ? { Host: `${url.hostname}:${url.port}` } : {}),
            ...headers
          },
          ...(isLocalHttp ? {} : {
            servername: url.hostname,
            lookup: (_hostname, options, callback) => {
              if (options?.all) callback(null, [address]);
              else callback(null, address.address, address.family);
            }
          })
        };
        request = makeRequest(requestOptions, async incomingResponse => {
          if (settled) {
            incomingResponse.destroy();
            return;
          }
          response = incomingResponse;
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const statusCode = response.statusCode;
            try {
              const text = await readResponse(response, Math.min(maxBytes, 8192));
              let message = `Dynamic API returned HTTP ${statusCode}`;
              try {
                const payload = JSON.parse(text);
                const detail = payload?.detail ?? payload?.error?.message ?? payload?.message;
                if (typeof detail === 'string') {
                  message = detail;
                } else if (Array.isArray(detail)) {
                  const details = detail.map(item => {
                    if (!item || typeof item !== 'object') return '';
                    const location = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : '';
                    const reason = typeof item.msg === 'string' ? item.msg : '';
                    return [location, reason].filter(Boolean).join(': ');
                  }).filter(Boolean);
                  if (details.length) message = details.join('; ');
                }
              } catch {}
              const error = new Error(message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500));
              error.statusCode = statusCode;
              error.code = 'DYNAMIC_API_HTTP_ERROR';
              finish(error);
            } catch {
              const error = new Error(`Dynamic API returned HTTP ${statusCode}`);
              error.statusCode = statusCode;
              error.code = 'DYNAMIC_API_HTTP_ERROR';
              finish(error);
            }
            return;
          }
          const contentType = String(response.headers['content-type'] || '').toLowerCase();
          const isJson = contentType.includes('application/json') || contentType.includes('+json');
          const isYaml = allowYaml && (
            contentType.includes('yaml') ||
            contentType.includes('yml') ||
            contentType.includes('openapi') ||
            contentType.startsWith('text/plain')
          );
          if (!isJson && !isYaml) {
            response.on('error', () => {});
            response.resume();
            finish(new Error('Dynamic API returned an unsupported content type'));
            return;
          }
          try {
            const text = await readResponse(response, maxBytes);
            finish(null, text);
          } catch (error) {
            finish(new Error(error?.code === 'RESPONSE_TOO_LARGE'
              ? 'Dynamic API response exceeded the configured size limit'
              : 'Dynamic API response could not be read'));
          }
        });
        request.on('error', err => {
          const networkError = new Error(err?.message ? `Dynamic API request failed: ${err.message}` : 'Dynamic API request failed');
          networkError.name = 'DynamicApiNetworkError';
          networkError.code = err?.code || 'DYNAMIC_API_NETWORK_ERROR';
          networkError.statusCode = 502;
          networkError.cause = err;
          finish(networkError);
        });
        if (settled) {
          request.destroy();
          return;
        }
        request.end(requestBody);
      })
      .catch(error => finish(error instanceof Error
        ? error
        : new Error('Dynamic API host could not be resolved')));
  });
}

export async function requestJson(value, options = {}) {
  const text = await requestText(value, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Dynamic API returned invalid JSON');
  }
}
