import { ExecutionContext } from '@cloudflare/workers-types';
import { Env, JobSource, Profession } from '../shared/types';
import { authenticateRequest, errorResponse } from '../shared/utils';

interface SourcesConfig {
  sources: JobSource[];
}

interface ProfessionsConfig {
  professions: Profession[];
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const requestId = crypto.randomUUID();
    console.log({
      level: 'info',
      message: 'Admin request received',
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      timestamp: new Date().toISOString()
    });

    // Authenticate all requests
    if (!authenticateRequest(request, env)) {
      return errorResponse('Unauthorized', 401);
    }

    try {
      const url = new URL(request.url);
      
      // Get sources configuration
      if (url.pathname === '/sources' && request.method === 'GET') {
        const sourcesData = await env.JOB_KV.get('config:sources');
        return new Response(
          sourcesData || JSON.stringify({ sources: [] }), 
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Update sources configuration
      if (url.pathname === '/sources' && request.method === 'PUT') {
        try {
          const body = await request.json() as SourcesConfig;
          
          console.log({
            level: 'info',
            message: 'Updating sources',
            requestId,
            sourcesCount: body.sources?.length,
            timestamp: new Date().toISOString()
          });

          if (!body.sources || !Array.isArray(body.sources)) {
            return errorResponse('Invalid request body: sources array is required');
          }

          // Validate sources
          for (const source of body.sources) {
            if (!source.id || !source.name || !source.type || !source.baseUrl || !source.companyId) {
              return errorResponse('Invalid source format: each source must have id, name, type, baseUrl, and companyId');
            }
            if (!['greenhouse', 'lever', 'workday'].includes(source.type)) {
              return errorResponse('Invalid source type: must be either "greenhouse", "lever", or "workday"');
            }
          }

          await env.JOB_KV.put('config:sources', JSON.stringify(body));
          
          console.log({
            level: 'info',
            message: 'Sources updated successfully',
            requestId,
            timestamp: new Date().toISOString()
          });

          return new Response(
            JSON.stringify({ message: 'Sources updated successfully' }), 
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (e) {
          return errorResponse('Invalid JSON in request body');
        }
      }

      // Get professions configuration
      if (url.pathname === '/professions' && request.method === 'GET') {
        const professionsData = await env.JOB_KV.get('config:professions');
        return new Response(
          professionsData || JSON.stringify({ professions: [] }), 
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Update professions configuration
      if (url.pathname === '/professions' && request.method === 'PUT') {
        try {
          const body = await request.json() as ProfessionsConfig;
          
          if (!body.professions || !Array.isArray(body.professions)) {
            return errorResponse('Invalid request body: professions array is required');
          }

          // Validate professions
          for (const prof of body.professions) {
            if (!prof.id || !prof.name || !Array.isArray(prof.keywords)) {
              return errorResponse('Invalid profession format: each profession must have id, name, and keywords array');
            }
          }

          await env.JOB_KV.put('config:professions', JSON.stringify(body));
          
          return new Response(
            JSON.stringify({ message: 'Professions updated successfully' }), 
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (e) {
          return errorResponse('Invalid JSON in request body');
        }
      }

      return errorResponse('Not Found', 404);
    } catch (error) {
      console.error('Server error:', error instanceof Error ? error.message : 'Unknown error');
      return errorResponse('Internal Server Error', 500);
    }
  }
}; 