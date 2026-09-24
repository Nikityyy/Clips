import type { Page } from 'playwright-core';

export type FlowRpcErrorCode =
  | 'NO_FLOW_TAB'
  | 'SESSION_EXPIRED'
  | 'MISSING_AT_TOKEN'
  | 'CAPTCHA_FAILED'
  | 'QUOTA_REACHED'
  | 'MODEL_ACCESS_DENIED'
  | 'TRANSPORT_DISCONNECTED'
  | 'PROTOCOL_CHANGED'
  | 'FLOW_TIMEOUT'
  | 'FLOW_REJECTED';

export class FlowRpcError extends Error {
  constructor(readonly code: FlowRpcErrorCode, message: string, readonly retryable = false) {
    super(message);
    this.name = 'FlowRpcError';
  }
}

export interface FlowRpcRequest {
  rpcId: string;
  payload: unknown;
  captchaAction?: string;
  sourcePath?: string;
}

export interface FlowRpcResponse {
  status: number;
  text: string;
}

export function encodeFlowRpcEnvelope(rpcId: string, payload: unknown): string {
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(rpcId)) throw new TypeError('Invalid Flow RPC identifier.');
  const inner = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return JSON.stringify([[[rpcId, inner, null, 'generic']]]);
}

export function parseFlowBatchResponse(body: string): Array<{ rpcId: string; payload: unknown; error: unknown }> {
  const text = body.startsWith(")]}'") ? body.slice(body.indexOf('\n') + 1) : body;
  const decoder = new JsonChunkDecoder(text);
  const results: Array<{ rpcId: string; payload: unknown; error: unknown }> = [];
  const visit = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node[0] === 'wrb.fr') {
      const frame = node;
      const rpcId = typeof frame[1] === 'string' ? frame[1] : '?';
      const raw = frame[2];
      let payload: unknown = raw;
      if (typeof raw === 'string') {
        try { payload = JSON.parse(raw); } catch { payload = raw; }
      }
      results.push({ rpcId, payload, error: raw == null ? frame[5] ?? true : null });
      return;
    }
    for (const child of node) visit(child);
  };
  for (const chunk of decoder.chunks()) visit(chunk);
  return results;
}

class JsonChunkDecoder {
  private readonly decoder = new JSONDecoderShim();
  constructor(private readonly source: string) {}
  *chunks(): Generator<unknown> {
    let offset = 0;
    while (offset < this.source.length) {
      const start = this.source.indexOf('[', offset);
      if (start < 0) return;
      const parsed = this.decoder.decode(this.source, start);
      if (!parsed) { offset = start + 1; continue; }
      offset = parsed.end;
      yield parsed.value;
    }
  }
}

class JSONDecoderShim {
  decode(source: string, start: number): { value: unknown; end: number } | null {
    // batchexecute prefixes each JSON chunk with a byte count. Parsing from the
    // first opening bracket is resilient to incorrect lengths around escapes.
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === '[') depth += 1;
      else if (char === ']') {
        depth -= 1;
        if (depth === 0) {
          try { return { value: JSON.parse(source.slice(start, i + 1)) as unknown, end: i + 1 }; }
          catch { return null; }
        }
      }
    }
    return null;
  }
}

const FLOW_PAGE_RPC = async (request: FlowRpcRequest & { encodedEnvelope: string }): Promise<FlowRpcResponse> => {
  const wiz = (window as typeof window & { WIZ_global_data?: Record<string, unknown> }).WIZ_global_data ?? {};
  const at = typeof wiz.SNlM0e === 'string' ? wiz.SNlM0e : '';
  if (!at) throw new Error('MISSING_AT_TOKEN');
  const sessionId = typeof wiz.FdrFJe === 'string' ? wiz.FdrFJe : '';
  const buildLabel = typeof wiz.cfb2h === 'string' ? wiz.cfb2h : '';
  let envelope = request.encodedEnvelope;
  if (request.captchaAction) {
    const recaptcha = (window as typeof window & { grecaptcha?: { enterprise?: { execute?: (key: string, options: { action: string }) => Promise<string> } } }).grecaptcha;
    if (!recaptcha?.enterprise?.execute) throw new Error('CAPTCHA_API_UNAVAILABLE');
    const token = await recaptcha.enterprise.execute('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', { action: request.captchaAction });
    if (!token) throw new Error('CAPTCHA_TOKEN_EMPTY');
    envelope = envelope.replaceAll('__CLIPS_CAPTCHA__', token);
  }
  const url = new URL('/_/AiSandboxAngularFrontend/data/batchexecute', location.origin);
  url.searchParams.set('rpcids', request.rpcId);
  url.searchParams.set('source-path', request.sourcePath || location.pathname || '/');
  url.searchParams.set('bl', buildLabel);
  url.searchParams.set('f.sid', sessionId);
  url.searchParams.set('hl', (document.documentElement.lang || navigator.language || 'en').split('-')[0]);
  url.searchParams.set('_reqid', String(Math.floor(Math.random() * 900000) + 100000));
  url.searchParams.set('rt', 'c');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-same-domain': '1' },
      body: new URLSearchParams({ 'f.req': envelope, at }),
      signal: controller.signal,
    });
    return { status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
};

export class FlowRpcClient {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly page: Page) {}

  call<T = unknown>(request: FlowRpcRequest): Promise<T> {
    const current = this.queue.then(() => this.execute(request));
    this.queue = current.catch(() => undefined);
    return current as Promise<T>;
  }

  private async execute<T>(request: FlowRpcRequest): Promise<T> {
    if (this.page.isClosed()) throw new FlowRpcError('NO_FLOW_TAB', 'The Google Flow tab is closed.', true);
    if (!this.page.url().startsWith('https://flow.google.com/')) {
      throw new FlowRpcError('SESSION_EXPIRED', 'Sign in to Google Flow to continue.', true);
    }
    let result: FlowRpcResponse;
    try {
      const encodedEnvelope = encodeFlowRpcEnvelope(request.rpcId, request.payload);
      result = await this.page.evaluate(FLOW_PAGE_RPC, { ...request, encodedEnvelope });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'MISSING_AT_TOKEN') throw new FlowRpcError('MISSING_AT_TOKEN', 'Flow is still loading or your sign-in has expired.', true);
      if (message.startsWith('CAPTCHA_')) throw new FlowRpcError('CAPTCHA_FAILED', 'Flow could not verify this request. Wait a moment and try again.', false);
      if (/Target closed|Session closed|Execution context was destroyed/i.test(message)) throw new FlowRpcError('TRANSPORT_DISCONNECTED', 'The Google Flow connection was interrupted.', true);
      if (/Timeout|timed out|aborted/i.test(message)) throw new FlowRpcError('FLOW_TIMEOUT', 'Flow did not respond in time. Check the job status before retrying.', false);
      throw new FlowRpcError('TRANSPORT_DISCONNECTED', 'Could not reach the Google Flow tab.', true);
    }
    if (result.status === 403 && /MODEL_ACCESS_DENIED/i.test(result.text)) {
      throw new FlowRpcError('MODEL_ACCESS_DENIED', 'This model is not available on the selected Google account.', false);
    }
    if (result.status === 401 || result.status === 403) {
      throw new FlowRpcError('SESSION_EXPIRED', 'Your Google Flow sign-in has expired. Reconnect your account.', false);
    }
    if (result.status === 429 || /USER_QUOTA_REACHED|quota.{0,16}reached/i.test(result.text)) {
      throw new FlowRpcError('QUOTA_REACHED', 'This Google account has reached its Flow generation limit.', false);
    }
    if (result.status < 200 || result.status >= 300) {
      throw new FlowRpcError('FLOW_REJECTED', `Flow rejected the request (HTTP ${result.status}).`, result.status >= 500);
    }
    const frames = parseFlowBatchResponse(result.text);
    const frame = frames.find((item) => item.rpcId === request.rpcId);
    if (!frame) throw new FlowRpcError('PROTOCOL_CHANGED', 'Flow returned an unrecognized response. The connector may need an update.', false);
    if (frame.error) {
      const code = JSON.stringify(frame.error);
      if (/quota|USER_QUOTA_REACHED/i.test(code)) throw new FlowRpcError('QUOTA_REACHED', 'This Google account has reached its Flow generation limit.', false);
      if (/MODEL_ACCESS_DENIED/i.test(code)) throw new FlowRpcError('MODEL_ACCESS_DENIED', 'This model is not available on the selected Google account.', false);
      throw new FlowRpcError('FLOW_REJECTED', 'Flow could not accept this request.', false);
    }
    return frame.payload as T;
  }
}
