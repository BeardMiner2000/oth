const USERNAME = 'jl';
const PASSWORD = 'jl';
const COOKIE_NAME = 'fit_auth';

export default {
  async fetch(request, env) {
    if (!isAuthorized(request)) {
      return new Response('Authentication required', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Basic realm="Surf/Fit Daily"'
        }
      });
    }

    const response = await env.ASSETS.fetch(request);
    const authedResponse = new Response(response.body, response);
    authedResponse.headers.append(
      'Set-Cookie',
      `${COOKIE_NAME}=1; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`
    );
    return authedResponse;
  }
};

function isAuthorized(request) {
  if (hasAuthCookie(request)) {
    return true;
  }

  const auth = request.headers.get('authorization') || '';
  const [scheme, encoded] = auth.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    return false;
  }

  const credentials = atob(encoded);
  const separatorIndex = credentials.indexOf(':');
  const username = separatorIndex >= 0 ? credentials.slice(0, separatorIndex) : '';
  const password = separatorIndex >= 0 ? credentials.slice(separatorIndex + 1) : '';

  return username === USERNAME && password === PASSWORD;
}

function hasAuthCookie(request) {
  const cookie = request.headers.get('cookie') || '';
  return cookie.split(';').some(part => part.trim() === `${COOKIE_NAME}=1`);
}
