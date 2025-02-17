export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  posted_at: string;
  source: string;
  profession: string | null;
}

export interface JobSource {
  id: string;
  name: string;
  type: 'greenhouse' | 'lever' | 'workday';  
  baseUrl: string;
  companyId: string;
}

export interface Profession {
  id: string;
  name: string;
  keywords: string[];
}

export interface LastCheck {
  lastJobId: string;
  lastCheckTime: string;
}

export interface TelegramUser {
  id: number;
  professions: string[];
}

export interface TelegramUpdate {
  message?: {
    chat: {
      id: number;
    };
    text?: string;
  };
}

export interface Env {
  JOB_KV: KVNamespace;
  API_KEY: string;
} 