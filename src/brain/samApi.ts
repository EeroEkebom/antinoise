/** Server-side SAM 3.1 via Meta Model API (Responses API, SSE). Parses the output lane into text. */

export const SAM_MODEL = 'sam-3.1';
export const META_API_BASE = 'https://api.meta.ai/v1';

export async function segmentImage(
  apiKey: string,
  imageUrl: string,
  prompt: string,
): Promise<{ ok: true; output: string } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await fetch(`${META_API_BASE}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: SAM_MODEL,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: imageUrl },
            ],
          },
        ],
        stream: true,
      }),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status} ${res.statusText}` };
  // SSE: aggregate the output_text lane; a full body read is fine for single-image segmentation
  const body = await res.text();
  let out = '';
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') break;
    try {
      const ev = JSON.parse(payload) as { type?: string; delta?: string };
      if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') out += ev.delta;
    } catch {
      // non-JSON keepalive lines in the stream — ignore
    }
  }
  return { ok: true, output: out };
}