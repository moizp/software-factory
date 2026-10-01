import * as https from 'https';
import { WorkflowState, Phase } from './state';

export interface NotificationConfig {
  slackWebhookUrl?: string;
  githubOwner?: string;
  githubRepo?: string;
  githubToken?: string;
}

export class SlackNotifier {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async notifyFailure(workflow: WorkflowState, phase: Phase, error: string): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }

    const message = {
      text: `❌ Factory Workflow Failed`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Factory Workflow Failure*\n*Workflow ID:* ${workflow.id}\n*Phase:* ${phase}\n*Error:* ${error}`
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Brief:*\n${workflow.issueBrief.substring(0, 100)}`
            },
            {
              type: 'mrkdwn',
              text: `*Status:*\n${workflow.status}`
            }
          ]
        }
      ]
    };

    return this.postToSlack(message);
  }

  async notifyPhaseStart(workflow: WorkflowState, phase: Phase): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }

    const message = {
      text: `🚀 Phase Starting: ${phase}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Phase:* ${phase}\n*Workflow ID:* ${workflow.id}\n*Brief:* ${workflow.issueBrief.substring(0, 50)}...`
          }
        }
      ]
    };

    return this.postToSlack(message);
  }

  async notifyPhaseComplete(workflow: WorkflowState, phase: Phase): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }

    const message = {
      text: `✅ Phase Complete: ${phase}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Phase:* ${phase}\n*Workflow ID:* ${workflow.id}`
          }
        }
      ]
    };

    return this.postToSlack(message);
  }

  private postToSlack(payload: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(payload);
      const url = new URL(this.webhookUrl);

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': postData.length
        }
      };

      const req = https.request(options, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`Slack API returned ${res.statusCode}`));
        }
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }
}

export class GitHubStatusUpdater {
  private owner: string;
  private repo: string;
  private token: string;

  constructor(owner: string, repo: string, token: string) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
  }

  async updatePhaseStatus(
    commit: string,
    phase: Phase,
    status: 'pending' | 'success' | 'failure'
  ): Promise<void> {
    const statusMap = {
      pending: 'pending',
      success: 'success',
      failure: 'failure'
    };

    const payload = {
      state: statusMap[status],
      description: `Phase: ${phase}`,
      context: `factory/phase/${phase}`
    };

    const postData = JSON.stringify(payload);
    const path = `/repos/${this.owner}/${this.repo}/statuses/${commit}`;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        port: 443,
        path,
        method: 'POST',
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'Content-Length': postData.length,
          'User-Agent': 'Factory-Orchestrator'
        }
      };

      const req = https.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`GitHub API returned ${res.statusCode}`));
        }
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }
}
