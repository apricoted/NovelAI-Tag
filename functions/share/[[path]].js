'use strict';

import { renderShareResponse } from '../_share.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('method not allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  return renderShareResponse(context);
}
