import { KVNamespace } from '@cloudflare/workers-types';
import { ExecutionContext } from '@cloudflare/workers-types';
import { Env, Job, JobSource, Profession, LastCheck } from '../shared/types';
import { authenticateRequest, errorResponse } from '../shared/utils';

const NETHERLANDS_VARIATIONS = [
  'netherlands',
  'nederland',
  'nl',
  'holland',
  'dutch',
  'amsterdam',
  'rotterdam',
  'den haag',
  'the hague',
  'utrecht',
  'eindhoven',
  'remote netherlands',
  'remote nl',
  'hybrid netherlands',
  'hybrid nl'
];

function isNetherlands(location: string): boolean {
  const normalizedLocation = location.toLowerCase();
  return NETHERLANDS_VARIATIONS.some(variant => 
    normalizedLocation.includes(variant)
  );
}

// Helper functions for KV operations
async function getSources(kv: KVNamespace): Promise<JobSource[]> {
  const sourcesData = await kv.get('config:sources');
  if (!sourcesData) return [];
  const parsed = JSON.parse(sourcesData);
  return parsed.sources || [];  // Extract the sources array from the object
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

  const url = new URL(`https://boards-api.greenhouse.io/v1/boards/${source.companyId}/jobs`);
  console.log({
    level: 'info',
    message: 'Greenhouse API URL',
    url: url.toString(),
    timestamp: new Date().toISOString()
  });
  
  const response = await fetch(url.toString());
  const data = await response.json() as { jobs: any[] };
  
  let foundLastJob = false;
  const newJobs: Job[] = [];
  
  for (const job of data.jobs) {
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
  const data = await response.json() as any[];
  
  return data.map((job) => ({
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!authenticateRequest(request, env)) {
      return errorResponse('Unauthorized', 401);
    }

    try {
      const url = new URL(request.url);

      // Endpoint to trigger job search
      if (url.pathname === '/search' && request.method === 'POST') {
        try {
          console.log({
            level: 'info',
            message: 'Starting job search',
            requestId: ctx.requestId,
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
                requestId: ctx.requestId,
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
                  if (isNetherlands(job.location)) {
                    job.profession = matchProfession(job.title, professions);
                    if (job.profession) {
                      const jobKey = `job:${job.id}`;
                      const existing = await env.JOB_KV.get(jobKey);
                      
                      if (!existing) {
                        totalJobsStored++;
                        await env.JOB_KV.put(jobKey, JSON.stringify(job));
                        await env.JOB_KV.put(`new:${jobKey}`, JSON.stringify(job), {
                          expirationTtl: 60 * 60 * 20 * 24
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
                requestId: ctx.requestId,
                source: source.id,
                error: error.message,
                timestamp: new Date().toISOString()
              });
            }
          }
          
          console.log({
            level: 'info',
            message: 'Job search completed',
            requestId: ctx.requestId,
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
            requestId: ctx.requestId,
            error: error.message,
            timestamp: new Date().toISOString()
          });
          return errorResponse('Error during job search: ' + error.message, 500);
        }
      }

      return errorResponse('Not Found', 404);
    } catch (error) {
      console.log({
        level: 'error',
        message: 'Server error',
        requestId: ctx.requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
      return errorResponse('Internal Server Error', 500);
    }
  }
};
