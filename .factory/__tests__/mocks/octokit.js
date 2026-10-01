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
    }
  }
};
