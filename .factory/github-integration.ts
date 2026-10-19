import { Octokit } from '@octokit/rest';
import { PrInfo } from './policy-engine';
import { WipCounts } from './board';

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
        merge_method: 'merge'
      });
    } catch (error) {
      throw new Error(`Failed to auto-merge PR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Branch, changed files, line count and labels of a PR, for policy evaluation. */
  async getPRInfo(prNumber: number): Promise<PrInfo & { headSha: string }> {
    try {
      const { owner, repo } = this.repoCoordinates();
      const pr = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber });
      const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100
      });
      return {
        branch: pr.data.head.ref,
        headSha: pr.data.head.sha,
        labels: pr.data.labels.map((l: { name?: string }) => l.name ?? ''),
        files: files.map((f: { filename: string }) => f.filename),
        changedLines: files.reduce((n: number, f: { additions: number; deletions: number }) => n + f.additions + f.deletions, 0)
      };
    } catch (error) {
      throw new Error(`Failed to read PR info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Open PRs by board column: drafts are In progress, ready-for-review PRs are In review. */
  async getWipCounts(): Promise<WipCounts> {
    try {
      const { owner, repo } = this.repoCoordinates();
      const open = await this.octokit.paginate(this.octokit.pulls.list, {
        owner,
        repo,
        state: 'open',
        per_page: 100
      });
      const drafts = open.filter((pr: { draft?: boolean }) => pr.draft === true).length;
      return { inProgress: drafts, inReview: open.length - drafts };
    } catch (error) {
      throw new Error(`Failed to read open PRs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Summary of all check runs on a commit: success, failure, pending, or none. */
  async getCheckSummary(ref: string): Promise<'success' | 'failure' | 'pending' | 'none'> {
    try {
      const { owner, repo } = this.repoCoordinates();
      const res = await this.octokit.checks.listForRef({ owner, repo, ref, per_page: 100 });
      const runs = res.data.check_runs;
      if (runs.length === 0) return 'none';
      const bad = ['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure'];
      if (runs.some((r: { conclusion: string | null }) => r.conclusion && bad.includes(r.conclusion))) return 'failure';
      if (runs.some((r: { status: string }) => r.status !== 'completed')) return 'pending';
      return 'success';
    } catch (error) {
      throw new Error(`Failed to read checks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private repoCoordinates(): { owner: string; repo: string } {
    return {
      owner: process.env.GITHUB_OWNER || 'moizp',
      repo: process.env.GITHUB_REPO || 'software-factory'
    };
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

  async addLabel(prNumber: number, label: string): Promise<void> {
    try {
      const owner = process.env.GITHUB_OWNER || 'moizp';
      const repo = process.env.GITHUB_REPO || 'software-factory';

      await this.octokit.issues.addLabels({
        owner,
        repo,
        issue_number: prNumber,
        labels: [label]
      });
    } catch (error) {
      throw new Error(`Failed to add label: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getCachedPRNumber(owner: string, repo: string): number | null {
    const cacheKey = `${owner}/${repo}`;
    return this.prCache.get(cacheKey) || null;
  }
}
