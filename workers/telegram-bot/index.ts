import { KVNamespace } from '@cloudflare/workers-types';
import { ExecutionContext } from '@cloudflare/workers-types';
import { Job, TelegramUser, TelegramUpdate } from '../shared/types';

interface Env {
  JOB_KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const update = await request.json() as TelegramUpdate;
    
    if (!update.message) {
      return new Response('OK');
    }

    const chatId = update.message.chat.id;
    const text = update.message.text;

    if (text === '/check') {
      // Fetch new jobs from the job searcher worker
      const jobResponse = await fetch(new URL('/new-jobs', request.url));
      const newJobs = await jobResponse.json() as Job[];
      
      // Get user preferences
      const userData = await env.JOB_KV.get(`user:${chatId}`);
      const user: TelegramUser = userData ? JSON.parse(userData) : { id: chatId, professions: [] };
      
      // Filter and send notifications
      const relevantJobs = newJobs.filter(job => 
        user.professions.includes(job.profession!)
      );

      for (const job of relevantJobs) {
        const message = `
🆕 New Job Alert!

🏢 ${job.company}
👨‍💻 ${job.title}
📍 ${job.location}
🔍 ${job.profession}
🔗 ${job.url}
        `.trim();

        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
          }),
        });
      }
    }

    // Other bot commands implementation...

    return new Response('OK');
  }
};
