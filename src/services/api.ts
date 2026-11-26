// Session token is held strictly in JS memory (never in localStorage or sessionStorage)
let memoryAuthToken: string | null = null;

export function setMemoryAuthToken(token: string | null) {
  memoryAuthToken = token;
}

export function getMemoryAuthToken(): string | null {
  return memoryAuthToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'BlessedFinance',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (memoryAuthToken) {
    headers.Authorization = `Bearer ${memoryAuthToken}`;
  }

  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    credentials: 'same-origin',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      typeof data.error === 'string' && data.error
        ? data.error
        : 'Não foi possível concluir a operação.';
    throw new ApiError(msg, res.status);
  }

  return data as T;
}

export function subscribeFamilyEvents(onSync: (scope: string) => void): () => void {
  const controller = new AbortController();
  let stopped = false;

  const connect = async () => {
    try {
      const headers: Record<string, string> = {
        'X-Requested-With': 'BlessedFinance',
      };
      if (memoryAuthToken) {
        headers.Authorization = `Bearer ${memoryAuthToken}`;
      }

      const res = await fetch('/api/events', {
        method: 'GET',
        headers,
        credentials: 'same-origin',
        signal: controller.signal,
      });

      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim()) as { type?: string; scope?: string };
            if (evt.type === 'sync') {
              onSync(evt.scope || 'all');
            }
          } catch {
            // ignore malformed event chunk
          }
        }
      }
    } catch {
      // ignore abort or transient reconnect
    }
  };

  void connect();

  return () => {
    stopped = true;
    controller.abort();
  };
}
