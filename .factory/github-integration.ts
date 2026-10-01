import { Octokit } from '@octokit/rest';

export interface PROptions {
  owner: string;
  repo: string;
  title: string;
  body: string;
  branch: string;
  base?: string;
}

export interface PRStatus {
  prNumber: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  message?: string;
}

export class GitHubAPI {
  private octokit: Octokit;
  private prCache: Map<string, number> = new Map();

  constructor(token?: string) {
    const githubToken = token || process.env.GITHUB_TOKEN;
    if (!githubToken) {
      throw new Error('GITHUB_TOKEN not found in environment or constructor argument');
    }
    this.octokit = new Octokit({ auth: githubToken });
  }

  async createPR(options: PROptions): Promise<number> {
    try {
      const response = await this.octokit.pulls.create({
        owner: options.owner,
        repo: options.repo,
        title: options.title,
        body: options.body,
        head: options.branch,
        base: options.base || 'main'
      });

      const prNumber = response.data.number;
      const cacheKey = `${options.owner}/${options.repo}`;
      this.prCache.set(cacheKey, prNumber);

      return prNumber;
    } catch (error) {
      throw new Error(`Failed to create PR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async updatePRStatus(prNumber: number, status: PRStatus): Promise<void> {
    try {
      const owner = process.env.GITHUB_OWNER || 'moizp';
      const repo = process.env.GITHUB_REPO || 'software-factory';

      await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `**[Factory Status Update]**\n- Status: ${status.status}\n${status.message ? `- Details: ${status.message}` : ''}`
      });
    } catch (error) {
      throw new Error(`Failed to update PR status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async autoMergePR(prNumber: number): Promise<void> {
    try {
      const owner = process.env.GITHUB_OWNER || 'moizp';
      const repo = process.env.GITHUB_REPO || 'software-factory';

      await this.octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: 'squash'
      });
    } catch (error) {
      throw new Error(`Failed to auto-merge PR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async postComment(prNumber: number, comment: string): Promise<void> {
    try {
      const owner = process.env.GITHUB_OWNER || 'moizp';
      const repo = process.env.GITHUB_REPO || 'software-factory';

      await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: comment
      });
    } catch (error) {
      throw new Error(`Failed to post comment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getCachedPRNumber(owner: string, repo: string): number | null {
    const cacheKey = `${owner}/${repo}`;
    return this.prCache.get(cacheKey) || null;
  }
}
