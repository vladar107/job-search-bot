import { KVNamespace } from '@cloudflare/workers-types';
import { ExecutionContext } from '@cloudflare/workers-types';

interface Env {
  JOB_KV: KVNamespace;
  API_KEY: string; 
}

interface JobSource {
  id: string;
  name: string;
  type: 'greenhouse' | 'lever';  // Updated: removed 'workday' as we're not using it yet
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
  const sourcesData = await kv.get('config:sources');
  return sourcesData ? JSON.parse(sourcesData) : [];
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
  
  return newJobs;
}

async function fetchLeverJobs(source: JobSource): Promise<Job[]> {
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Authenticate all requests first
    if (!authenticateRequest(request, env)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const url = new URL(request.url);
    
    // Endpoint to trigger job search
    if (url.pathname === '/search' && request.method === 'POST') {
      const sources = await getSources(env.JOB_KV);
      const professions = await getProfessions(env.JOB_KV);
      
      for (const source of sources) {
        try {
          // Get last check information
          const lastCheck = await getLastCheck(env.JOB_KV, source.id);
          const lastJobId = lastCheck?.lastJobId ?? null;
          
          const jobs = await fetchJobs(source, lastJobId);
          
          if (jobs.length > 0) {
            // Update last check with the newest job ID
            const newestJob = jobs[0]; // Assuming jobs are sorted newest first
            await updateLastCheck(env.JOB_KV, source.id, newestJob.id.split('-')[1]); // Store original job ID
            
            for (const job of jobs) {
              // Filter for Netherlands
              if (!job.location.toLowerCase().includes('netherlands')) {
                continue;
              }
              
              // Match profession
              job.profession = matchProfession(job.title, professions);
              if (!job.profession) {
                continue;
              }
              
              // Store job
              const jobKey = `job:${job.id}`;
              const existing = await env.JOB_KV.get(jobKey);
              
              if (!existing) {
                await env.JOB_KV.put(jobKey, JSON.stringify(job));
                await env.JOB_KV.put(`new:${jobKey}`, JSON.stringify(job), {
                  expirationTtl: 60 * 60 * 2 // 2 hours
                });
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching jobs from ${source.name}:`, error);
        }
      }
      
      return new Response('Job search completed', { status: 200 });
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

    // Admin endpoint to configure sources
    if (url.pathname === '/admin/sources' && request.method === 'PUT') {
      const sources = await request.json();
      await env.JOB_KV.put('config:sources', JSON.stringify(sources));
      return new Response('Sources updated', { status: 200 });
    }

    // Admin endpoint to configure professions
    if (url.pathname === '/admin/professions' && request.method === 'PUT') {
      const professions = await request.json();
      await env.JOB_KV.put('config:professions', JSON.stringify(professions));
      return new Response('Professions updated', { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  }
};
