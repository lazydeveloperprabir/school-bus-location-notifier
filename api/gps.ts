import { resolveGpsLink } from '../shared/gpsResolve.js'

export const config = {
  runtime: 'edge',
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (request.method !== 'GET') {
    return Response.json(
      { ok: false, error: 'Method not allowed' },
      { status: 405, headers: cors },
    )
  }

  const url = new URL(request.url).searchParams.get('url')?.trim() ?? ''
  if (!url) {
    return Response.json(
      { ok: false, error: 'Missing url query parameter.' },
      { status: 400, headers: cors },
    )
  }

  const result = await resolveGpsLink(url)
  return Response.json(result, {
    status: result.ok ? 200 : 422,
    headers: {
      ...cors,
      'Cache-Control': 'no-store',
    },
  })
}
