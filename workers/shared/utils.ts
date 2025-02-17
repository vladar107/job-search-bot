import { Env } from './types';

export function authenticateRequest(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.split('Bearer ')[1];
  return token === env.API_KEY;
}

export function errorResponse(message: string, status: number = 400) {
  return new Response(
    JSON.stringify({ error: message, status }), 
    { status, headers: { 'Content-Type': 'application/json' } }
  );
} 