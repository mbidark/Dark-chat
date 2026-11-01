export default {
  async fetch(request, env) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return Response.json({ error: 'POST required.' }, { status: 405, headers });

    try {
      const payload = await request.json();
      const filters = [];
      if (payload.externalUserId) {
        filters.push({ field: 'external_user_id', operator: '=', value: payload.externalUserId });
      }
      if (payload.role) {
        filters.push({ field: 'tag', key: 'darkchat_role', relation: '=', value: payload.role });
      }

      const oneSignalPayload = {
        app_id: env.ONESIGNAL_APP_ID,
        headings: { en: payload.title || 'DARKCHAT' },
        contents: { en: payload.body || '' },
        web_url: payload.url || './',
        chrome_web_icon: 'https://mbidark.github.io/Dark-chat/icon.svg'
      };

      if (filters.length) oneSignalPayload.filters = filters;
      else oneSignalPayload.included_segments = ['All'];

      const response = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${env.ONESIGNAL_REST_API_KEY}`
        },
        body: JSON.stringify(oneSignalPayload)
      });
      const result = await response.json();
      if (!response.ok) return Response.json({ error: result.errors?.[0] || result }, { status: response.status, headers });
      return Response.json(result, { status: 200, headers });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers });
    }
  }
};
