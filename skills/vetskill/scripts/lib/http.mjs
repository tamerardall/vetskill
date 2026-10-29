export class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

export async function getText(fetch, url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new HttpError(res.status);
  return res.text();
}

export async function getJson(fetch, url, headers = {}) {
  const text = await getText(fetch, url, headers);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalid JSON response');
  }
}
