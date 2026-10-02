module.exports = {
  Octokit: class MockOctokit {
    constructor(options) {
      this.rest = {
        pulls: {
          create: jest.fn().mockResolvedValue({ data: { number: 1 } }),
          merge: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({})
        },
        issues: {
          createComment: jest.fn().mockResolvedValue({})
        }
      };
      this.issues = {
        createComment: jest.fn().mockResolvedValue({})
      };
      this.pulls = {
        create: jest.fn().mockResolvedValue({ data: { number: 1 } }),
        merge: jest.fn().mockResolvedValue({}),
        get: jest.fn().mockResolvedValue({
          data: { head: { ref: 'fix/x', sha: 'abc123' }, labels: [{ name: 'agent' }] }
        }),
        listFiles: jest.fn()
      };
      this.checks = {
        listForRef: jest.fn().mockResolvedValue({ data: { check_runs: [] } })
      };
      this.paginate = jest.fn().mockResolvedValue([
        { filename: 'docs/a.md', additions: 3, deletions: 1 },
        { filename: 'README.md', additions: 2, deletions: 0 }
      ]);
    }
  }
};
