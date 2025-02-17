# Job Search Bot

An automated job search system that monitors company career pages and sends notifications about new job opportunities via Telegram. Built with Cloudflare Workers and integrated with multiple job board APIs.

## Features
- 🤖 Automated job scraping from multiple sources (Greenhouse, Lever)
- 🔍 Intelligent job categorization by profession
- 📱 Telegram bot integration for job notifications
- 🌍 Netherlands-focused job filtering
- ⚙️ Admin API for managing sources and professions
- 🔐 Secure API authentication
- 🚀 Automated deployment with GitHub Actions
- ☁️ Infrastructure as Code using Pulumi

## Prerequisites
- Node.js v22 or higher
- npm or yarn
- Cloudflare account
- Telegram Bot Token
- Pulumi CLI (for infrastructure deployment)

## Installation

1. Clone the repository
   ```bash
   git clone https://github.com/vladar107/job-search-bot.git
   cd job-search-bot
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Set up environment variables in your Cloudflare Workers:
- `API_KEY`: For securing admin and job searcher endpoints
- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
- `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID

## Usage

### Worker Endpoints

#### Job Searcher Worker
- `POST /search`: Triggers job search across all configured sources
- `GET /new-jobs`: Retrieves newly found jobs

#### Job Admin Worker
- `GET /sources`: Retrieves configured job sources
- `PUT /sources`: Updates job sources configuration
- `GET /professions`: Retrieves configured professions
- `PUT /professions`: Updates professions configuration

#### Telegram Bot Worker
- `/check`: Command to check for new jobs matching user preferences

### Example Source Configuration
```json
{
  "sources": [
    {
      "id": "gitlab",
      "name": "GitLab",
      "type": "greenhouse",
      "baseUrl": "https://boards-api.greenhouse.io",
      "companyId": "gitlab"
    },
    {
      "id": "databricks",
      "name": "Databricks",
      "type": "greenhouse",
      "baseUrl": "https://boards-api.greenhouse.io",
      "companyId": "databricks"
    }
  ]
}
```

### Example Profession Configuration
```json
{
  "professions": [
    {
      "id": "swe",
      "name": "Software Engineer",
      "keywords": [
        "software engineer",
        "software developer",
        "full stack",
        "backend",
        "developer",
        "engineer"
      ]
    },
    {
      "id": "architect",
      "name": "Software Architect",
      "keywords": [
        "software architect",
        "solution architect",
        "technical architect",
        "lead architect",
        "principal engineer",
        "staff engineer",
        "senior architect"
      ]
    }
  ]
}
```

## Deployment

The project uses GitHub Actions for automated deployment:

1. Workers Deployment (`deploy-workers.yml`):
   - Automatically deploys when changes are made to the `workers/` directory
   - Deploys job searcher, telegram bot, and admin workers

2. Infrastructure Deployment (`deploy-infra.yml`):
   - Manages infrastructure using Pulumi
   - Deploys when changes are made to the `infra/` directory

### Manual Deployment

1. Workers Deployment:
   ```bash
   cd workers/job-searcher
   npx wrangler deploy --var API_KEY=your-api-key

   # Deploy Telegram Bot Worker
   cd ../telegram-bot
   npx wrangler deploy --var TELEGRAM_BOT_TOKEN=your-telegram-token

   # Deploy Job Admin Worker
   cd ../job-admin
   npx wrangler deploy --var API_KEY=your-api-key
   ```

2. Infrastructure Deployment:
   ```bash
   cd infra
   pulumi login --local
   pulumi stack init dev
   
   # Configure Cloudflare credentials
   pulumi config set cloudflareAccountId your-account-id
   pulumi config set cloudflare:apiToken your-api-token --secret

   # Deploy infrastructure
   pulumi up
   ```

### Local Development

1. Start the workers locally:
   ```bash
   cd workers/job-searcher
   npx wrangler dev
   ```

2. Start the Telegram bot locally:
   ```bash
   cd workers/telegram-bot
   npx wrangler dev
   ```

3. Start the Job Admin worker locally:
   ```bash
   cd workers/job-admin
   npx wrangler dev
   ```

## Environment Variables

### GitHub Secrets Required
- `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID
- `API_KEY`: API key for worker authentication
- `TELEGRAM_BOT_TOKEN`: Telegram bot token

### Worker Environment
Each worker requires specific environment variables set in Cloudflare:
- Job Searcher: `API_KEY`
- Telegram Bot: `TELEGRAM_BOT_TOKEN`
- Job Admin: `API_KEY`

## Contributing
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License
This project is licensed under the MIT License - see the LICENSE file for details 