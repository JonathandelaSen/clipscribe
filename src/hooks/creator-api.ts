interface ApiErrorResponse {
  ok?: false;
  error?: string;
}

export async function postJson<TResponse>(url: string, payload: unknown, headers?: HeadersInit): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as TResponse | ApiErrorResponse;
  if (!response.ok) {
    const message = (data as ApiErrorResponse).error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as TResponse;
}
