import { RequestBodyTooLargeError } from "./errors";

export async function readJsonBody<T>(request: Request, maxBytes: number): Promise<T> {
	const contentLength = Number(request.headers.get("content-length") ?? 0);
	if (contentLength > maxBytes) throw new RequestBodyTooLargeError("Request body is too large");

	const body = await readBoundedBody(request, maxBytes);
	if (body.byteLength === 0) return {} as T;

	return JSON.parse(new TextDecoder().decode(body)) as T;
}

export function assertRequestSize(request: Request, maxBytes: number): void {
	const contentLength = Number(request.headers.get("content-length") ?? 0);
	if (contentLength > maxBytes) throw new RequestBodyTooLargeError("Request body is too large");
}

export async function readFormDataBody(request: Request, maxBytes: number): Promise<FormData> {
	assertRequestSize(request, maxBytes);
	const body = await readBoundedBody(request, maxBytes);

	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body,
	}).formData();
}

/** Enforce the bound while reading, including chunked requests without Content-Length. */
async function readBoundedBody(
	request: Request,
	maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
	if (!request.body) return new Uint8Array(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw new RequestBodyTooLargeError("Request body is too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}
