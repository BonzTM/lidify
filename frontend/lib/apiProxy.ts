const getBackendUrl = (): string => {
    const env = (globalThis as { process?: { env?: Record<string, string> } })
        .process?.env;
    const base =
        env?.BACKEND_URL ||
        "http://127.0.0.1:3006";
    return base.replace(/\/$/, "");
};

const buildTargetUrl = (request: Request, targetPath: string): string => {
    const base = getBackendUrl();
    const normalizedPath = targetPath.replace(/^\/+/, "");
    const url = new URL(`${base}/${normalizedPath}`);
    url.search = new URL(request.url).search;
    return url.toString();
};

const buildProxyHeaders = (request: Request): Headers => {
    const headers = new Headers(request.headers);
    headers.delete("host");

    const host = request.headers.get("host");
    if (host) {
        headers.set("x-forwarded-host", host);
    }
    headers.set(
        "x-forwarded-proto",
        new URL(request.url).protocol.replace(":", "")
    );

    const forwardedFor = request.headers.get("x-forwarded-for");
    const realIp = request.headers.get("x-real-ip");
    if (!forwardedFor && realIp) {
        headers.set("x-forwarded-for", realIp);
    }

    return headers;
};

export const proxyRequest = async (
    request: Request,
    targetPath: string,
    methodOverride?: string
): Promise<Response> => {
    const targetUrl = buildTargetUrl(request, targetPath);
    const headers = buildProxyHeaders(request);
    const method = methodOverride ?? request.method;

    const init: RequestInit = {
        method,
        headers,
        redirect: "manual",
    };

    if (method !== "GET" && method !== "HEAD") {
        init.body = await request.arrayBuffer();
    }

    const upstream = await fetch(targetUrl, init);
    const responseHeaders = new Headers(upstream.headers);

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
    });
};
