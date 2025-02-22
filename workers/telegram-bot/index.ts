import {KVNamespace} from '@cloudflare/workers-types';
import {ExecutionContext} from '@cloudflare/workers-types';
import {TelegramUser, TelegramUpdate, Job} from '../shared/types';

interface Env {
    JOB_KV: KVNamespace;
    TELEGRAM_BOT_TOKEN: string;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        try {
            if (request.method !== 'POST') {
                return new Response('Method not allowed', {status: 405});
            }

            const url = new URL(request.url);
            const update = await request.json() as TelegramUpdate;

            if (!update.message) {
                return new Response('OK');
            }

            const chatId = update.message.chat.id;
            const text = update.message.text;

            if (text === '/start') {
                const message = `
        Welcome to Job Search Bot! Here are the available commands:
        - /start: Show this message
        - /check: Check for new jobs
        - /set-profession: Set your profession
        - /professions: Show your associated professions
              `.trim();

                await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: message,
                        parse_mode: 'HTML',
                    }),
                });

                return new Response('OK');
            }

            if (text === '/professions') {
                const userData = await env.JOB_KV.get(`user:${chatId}`);
                const user: TelegramUser = userData ? JSON.parse(userData) : {
                    id: chatId,
                    professions: []
                };

                const message = user.professions.length > 0
                    ? `Your associated professions:\n- ${user.professions.join('\n- ')}`
                    : 'You have no associated professions. Use /set-profession to add one.';

                await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: message,
                        parse_mode: 'HTML',
                    }),
                });

                return new Response('OK');
            }

            if (text === '/check') {
                const jobSearcherResponse = await fetch(`https://job-searcher-worker.vladar107.workers.dev/search`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                });

                if (!jobSearcherResponse.ok) {
                    return new Response('Error calling job-searcher', {status: jobSearcherResponse.status});
                }

                // Fetch new jobs from KV store newer than last check
                const userData = await env.JOB_KV.get(`user:${chatId}`);
                const user: TelegramUser = userData ? JSON.parse(userData) : {
                    id: chatId,
                    lastCheckTime: new Date(0),
                    professions: []
                };

                const newJobs: Job[] = [];
                const keys = await env.JOB_KV.list({prefix: 'new:'});

                for (const {name} of keys.keys) {
                    const job = await env.JOB_KV.get(name);
                    if (job && JSON.parse(job).posted_at > user.lastCheckTime) {
                        newJobs.push(JSON.parse(job));
                    }
                }

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
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            chat_id: chatId,
                            text: message,
                            parse_mode: 'HTML',
                        }),
                    });
                }

                return new Response('OK');
            }

            if (url.pathname === '/set-profession') {
                const {chatId, profession} = await request.json() as {
                    chatId: number,
                    profession: string
                };

                const userData = await env.JOB_KV.get(`user:${chatId}`);
                const user: TelegramUser = userData ? JSON.parse(userData) : {
                    id: chatId,
                    professions: []
                };

                if (!user.professions.includes(profession)) {
                    user.professions.push(profession);
                    await env.JOB_KV.put(`user:${chatId}`, JSON.stringify(user));
                }

                return new Response('Profession set successfully', {status: 200});
            }

            return new Response('OK');
        } catch (error) {
            console.error('Error in fetch handler:', error);
            return new Response('Internal Server Error', {status: 500});
        }
    }
};