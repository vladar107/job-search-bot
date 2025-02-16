import { KVNamespace } from '@cloudflare/workers-types';
import { ExecutionContext } from '@cloudflare/workers-types';

interface Env {
  JOB_KV: KVNamespace;
  API_KEY: string; 
}

interface JobSource {
  id: string;
  name: string;
  type: 'greenhouse' | 'lever' | 'workday';  
  baseUrl: string;
  companyId: string;
}

interface Profession {
  id: string;
  name: string;
  keywords: string[];
}

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  posted_at: string;
  source: string;
  profession: string | null;
}

interface LastCheck {
  lastJobId: string;
  lastCheckTime: string;
}

// Helper functions for KV operations
async function getSources(kv: KVNamespace): Promise<JobSource[]> {
  console.log({
    level: 'info',
    message: 'Fetching sources from KV',
    timestamp: new Date().toISOString()
  });

  const sourcesData = await kv.get('config:sources');
  if (!sourcesData) {
    console.log({
      level: 'warn',
      message: 'No sources found in KV',
      timestamp: new Date().toISOString()
    });
    return [];
  }

  const data = JSON.parse(sourcesData);
  const sources = data.sources; // Extract the sources array from the wrapper object

  console.log({
    level: 'info',
    message: 'Sources fetched successfully',
    sourcesCount: sources.length,
    timestamp: new Date().toISOString()
  });

  return sources;
}

async function getProfessions(kv: KVNamespace): Promise<Profession[]> {
  const professionsData = await kv.get('config:professions');
  return professionsData ? JSON.parse(professionsData) : [];
}

async function getLastCheck(kv: KVNamespace, sourceId: string): Promise<LastCheck | null> {
  const data = await kv.get(`lastcheck:${sourceId}`);
  return data ? JSON.parse(data) : null;
}

async function updateLastCheck(kv: KVNamespace, sourceId: string, jobId: string) {
  const lastCheck: LastCheck = {
    lastJobId: jobId,
    lastCheckTime: new Date().toISOString()
  };
  await kv.put(`lastcheck:${sourceId}`, JSON.stringify(lastCheck));
}

async function fetchGreenhouseJobs(source: JobSource, lastJobId: string | null): Promise<Job[]> {
  console.log({
    level: 'info',
    message: 'Fetching Greenhouse jobs',
    source: source.id,
    lastJobId,
    timestamp: new Date().toISOString()
  });

  // If no lastJobId, get today's jobs
  const today = new Date().toISOString().split('T')[0];
  const updatedAfter = lastJobId ? undefined : today;
  
  const url = new URL(`${source.baseUrl}/boards/${source.companyId}/jobs`);
  if (updatedAfter) {
    url.searchParams.append('updated_after', updatedAfter);
  }
  
  const response = await fetch(url.toString());
  const jobs = await response.json();
  
  let foundLastJob = false;
  const newJobs: Job[] = [];
  
  for (const job of jobs) {
    // If we have a lastJobId and haven't found it yet, keep looking
    if (lastJobId) {
      if (job.id === lastJobId) {
        foundLastJob = true;
        continue;
      }
      if (!foundLastJob) {
        continue;
      }
    }
    
    newJobs.push({
      id: `${source.id}-${job.id}`,
      title: job.title,
      company: source.name,
      location: job.location.name,
      url: job.absolute_url,
      posted_at: job.updated_at,
      source: source.id,
      profession: null
    });
  }
  
  console.log({
    level: 'info',
    message: 'Greenhouse jobs fetched',
    source: source.id,
    jobsCount: newJobs.length,
    timestamp: new Date().toISOString()
  });
  
  return newJobs;
}

async function fetchLeverJobs(source: JobSource): Promise<Job[]> {
  console.log({
    level: 'info',
    message: 'Fetching Lever jobs',
    source: source.id,
    timestamp: new Date().toISOString()
  });

  const response = await fetch(`${source.baseUrl}/v0/postings/${source.companyId}`);
  const jobs = await response.json();
  
  return jobs.map((job: any) => ({
    id: `${source.id}-${job.id}`,
    title: job.text,
    company: source.name,
    location: job.categories.location || 'Unknown',
    url: job.hostedUrl,
    posted_at: job.createdAt,
    source: source.id,
    profession: null
  }));
}

async function fetchJobs(source: JobSource, lastJobId: string | null): Promise<Job[]> {
  switch (source.type) {
    case 'greenhouse':
      return fetchGreenhouseJobs(source, lastJobId);
    case 'lever':
      return fetchLeverJobs(source);
    default:
      throw new Error(`Unsupported source type: ${source.type}`);
  }
}

function matchProfession(title: string, professions: Profession[]): string | null {
  const normalizedTitle = title.toLowerCase();
  
  for (const profession of professions) {
    if (profession.keywords.some(keyword => 
      normalizedTitle.includes(keyword.toLowerCase())
    )) {
      return profession.name;
    }
  }
  
  return null;
}

// Add authentication middleware
function authenticateRequest(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.split('Bearer ')[1];
  return token === env.API_KEY;
}

// Helper function for error responses
function errorResponse(message: string, status: number = 400) {
  console.log({
    level: 'error',
    message,
    status,
    timestamp: new Date().toISOString()
  });
  
  return new Response(
    JSON.stringify({ 
      error: message,
      status 
    }), 
    { 
      status,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const requestId = crypto.randomUUID();
    console.log({
      level: 'info',
      message: 'Request received',
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      timestamp: new Date().toISOString()
    });

    // Authenticate all requests first
    if (!authenticateRequest(request, env)) {
      console.log({
        level: 'warn',
        message: 'Authentication failed',
        requestId,
        timestamp: new Date().toISOString()
      });
      return errorResponse('Unauthorized', 401);
    }

    try {
      const url = new URL(request.url);
      
      // Admin endpoint to configure professions
      if (url.pathname === '/admin/professions' && request.method === 'PUT') {
        try {
          const body = await request.json();
          
          if (!body.professions || !Array.isArray(body.professions)) {
            return errorResponse('Invalid request body: professions array is required');
          }

          console.log({
            level: 'info',
            message: 'Updating professions',
            requestId,
            professionsCount: body.professions.length,
            timestamp: new Date().toISOString()
          });

          await env.JOB_KV.put('config:professions', JSON.stringify(body.professions));
          
          console.log({
            level: 'info',
            message: 'Professions updated successfully',
            requestId,
            timestamp: new Date().toISOString()
          });

          return new Response(
            JSON.stringify({ message: 'Professions updated successfully' }), 
            { 
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        } catch (e) {
          console.log({
            level: 'error',
            message: 'Error parsing profession data',
            requestId,
            error: e.message,
            timestamp: new Date().toISOString()
          });
          return errorResponse('Invalid JSON in request body');
        }
      }

      // Admin endpoint to configure sources
      if (url.pathname === '/admin/sources' && request.method === 'PUT') {
        try {
          const body = await request.json();
          
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

          await env.JOB_KV.put('config:sources', JSON.stringify(body.sources));
          
          console.log({
            level: 'info',
            message: 'Sources updated successfully',
            requestId,
            timestamp: new Date().toISOString()
          });

          return new Response(
            JSON.stringify({ message: 'Sources updated successfully' }), 
            { 
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        } catch (e) {
          console.log({
            level: 'error',
            message: 'Error parsing source data',
            requestId,
            error: e.message,
            timestamp: new Date().toISOString()
          });
          return errorResponse('Invalid JSON in request body');
        }
      }

      // Endpoint to trigger job search
      if (url.pathname === '/search' && request.method === 'POST') {
        try {
          console.log({
            level: 'info',
            message: 'Starting job search',
            requestId,
            timestamp: new Date().toISOString()
          });

          const sources = await getSources(env.JOB_KV);
          const professions = await getProfessions(env.JOB_KV);
          
          let totalJobsFound = 0;
          let totalJobsStored = 0;

          for (const source of sources) {
            try {
              const lastCheck = await getLastCheck(env.JOB_KV, source.id);
              const lastJobId = lastCheck?.lastJobId;
              
              console.log({
                level: 'info',
                message: 'Fetching jobs for source',
                requestId,
                source: source.id,
                lastJobId,
                timestamp: new Date().toISOString()
              });

              const jobs = await fetchJobs(source, lastJobId);
              totalJobsFound += jobs.length;
              
              if (jobs.length > 0) {
                const newestJob = jobs[0];
                await updateLastCheck(env.JOB_KV, source.id, newestJob.id.split('-')[1]);
                
                for (const job of jobs) {
                  if (job.location.toLowerCase().includes('netherlands')) {
                    job.profession = matchProfession(job.title, professions);
                    if (job.profession) {
                      const jobKey = `job:${job.id}`;
                      const existing = await env.JOB_KV.get(jobKey);
                      
                      if (!existing) {
                        totalJobsStored++;
                        await env.JOB_KV.put(jobKey, JSON.stringify(job));
                        await env.JOB_KV.put(`new:${jobKey}`, JSON.stringify(job), {
                          expirationTtl: 60 * 60 * 2
                        });
                      }
                    }
                  }
                }
              }
            } catch (error) {
              console.log({
                level: 'error',
                message: 'Error processing source',
                requestId,
                source: source.id,
                error: error.message,
                timestamp: new Date().toISOString()
              });
            }
          }
          
          console.log({
            level: 'info',
            message: 'Job search completed',
            requestId,
            totalJobsFound,
            totalJobsStored,
            timestamp: new Date().toISOString()
          });

          return new Response(
            JSON.stringify({ 
              message: 'Job search completed',
              totalJobsFound,
              totalJobsStored
            }), 
            { 
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        } catch (error) {
          console.log({
            level: 'error',
            message: 'Search error',
            requestId,
            error: error.message,
            timestamp: new Date().toISOString()
          });
          return errorResponse('Error during job search: ' + error.message, 500);
        }
      }

      // Endpoint to get new jobs
      if (url.pathname === '/new-jobs' && request.method === 'GET') {
        const newJobs: Job[] = [];
        const kvList = await env.JOB_KV.list({ prefix: 'new:' });
        
        for (const key of kvList.keys) {
          const jobData = await env.JOB_KV.get(key.name);
          if (jobData) {
            newJobs.push(JSON.parse(jobData));
          }
        }

        return new Response(JSON.stringify(newJobs), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return errorResponse('Not Found', 404);
    } catch (error) {
      console.log({
        level: 'error',
        message: 'Server error',
        requestId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      return errorResponse('Internal Server Error', 500);
    }
  }
};
