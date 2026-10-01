# Testing Patterns Skill

Reusable test templates and patterns for the software factory. Use these to generate consistent, maintainable tests.

## Unit Test Template

```typescript
// tests/unit/myModule.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { myFunction } from '../../src/lib/myModule';

describe('MyModule', () => {
  describe('myFunction', () => {
    it('should return expected result for valid input', () => {
      const input = { data: 'test' };
      const result = myFunction(input);
      expect(result).toEqual({ success: true, data: 'test' });
    });

    it('should handle edge cases', () => {
      expect(myFunction(null)).toThrow('Input required');
      expect(myFunction({})).toEqual({ success: false });
    });

    it('should not mutate input', () => {
      const input = { data: 'original' };
      myFunction(input);
      expect(input.data).toBe('original');
    });
  });
});
```

## Integration Test Template

```typescript
// tests/integration/api.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { request } from 'supertest';
import { app } from '../../src/server';
import { prisma } from '../../src/lib/prisma';

describe('POST /api/endpoint', () => {
  let authToken: string;
  let testUserId: string;

  beforeAll(async () => {
    // Setup: create test user
    const user = await prisma.user.create({
      data: { email: 'test@example.com', passwordHash: 'hashed' }
    });
    testUserId = user.id;

    // Get auth token
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'password' });
    authToken = res.body.token;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.user.delete({ where: { id: testUserId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Reset state before each test
    await prisma.item.deleteMany({});
  });

  it('should create item with valid data', async () => {
    const res = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Test Item', description: 'A test' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Test Item');
  });

  it('should reject invalid data', async () => {
    const res = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: '' }); // Invalid: empty name

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should require authentication', async () => {
    const res = await request(app)
      .post('/api/items')
      .send({ name: 'Test Item' });

    expect(res.status).toBe(401);
  });
});
```

## E2E Test Template

```typescript
// tests/e2e/user-flow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Complete User Flow', () => {
  test('user can sign up and create item', async ({ page }) => {
    // Step 1: Navigate to signup
    await page.goto('/signup');
    expect(await page.title()).toContain('Sign Up');

    // Step 2: Fill signup form
    await page.fill('input[name="email"]', 'newuser@example.com');
    await page.fill('input[name="password"]', 'SecurePass123');
    await page.click('button:has-text("Sign Up")');

    // Step 3: Wait for redirect and verify
    await page.waitForURL('/dashboard');
    await expect(page.locator('text=Welcome')).toBeVisible();

    // Step 4: Create item
    await page.click('button:has-text("New Item")');
    await page.fill('input[name="name"]', 'My First Item');
    await page.click('button:has-text("Save")');

    // Step 5: Verify item appears
    await expect(page.locator('text=My First Item')).toBeVisible();
  });
});
```

## Test Data Fixtures

```typescript
// tests/fixtures/seed.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

export const fixtures = {
  users: {
    async create(data = {}) {
      return prisma.user.create({
        data: {
          email: 'user@example.com',
          passwordHash: await bcrypt.hash('password', 10),
          ...data
        }
      });
    },

    john: {
      email: 'john@example.com',
      password: 'SecurePass123'
    },

    jane: {
      email: 'jane@example.com',
      password: 'SecurePass456'
    }
  },

  items: {
    async create(userId: string, data = {}) {
      return prisma.item.create({
        data: {
          userId,
          name: 'Test Item',
          description: 'A test item',
          ...data
        }
      });
    }
  }
};

// Usage in tests:
// const user = await fixtures.users.create({ email: 'custom@example.com' });
// const item = await fixtures.items.create(user.id);
```

## Mock Patterns

```typescript
// Mock external API
vi.mock('../src/lib/stripe', () => ({
  createPaymentIntent: vi.fn().mockResolvedValue({
    id: 'pi_test_123',
    clientSecret: 'secret_123'
  })
}));

// Mock environment variables
vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123');

// Mock database calls
const mockUser = {
  id: 'user_1',
  email: 'test@example.com'
};
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue(mockUser)
    }
  }
}));
```

## Coverage Strategy

| File Type | Target | Priority |
|-----------|--------|----------|
| Services | > 85% | High |
| Routes | > 80% | High |
| Utils | > 90% | High |
| Types | > 50% | Low |
| Config | > 0% | Skip |

## Test Organization

```
tests/
├── unit/              # Single function tests
│   ├── auth.test.ts
│   ├── crypto.test.ts
│   └── validation.test.ts
├── integration/       # API endpoint tests
│   ├── auth.integration.test.ts
│   ├── items.integration.test.ts
│   └── payments.integration.test.ts
├── e2e/               # Full user workflow tests
│   ├── auth-flow.spec.ts
│   ├── item-creation.spec.ts
│   └── payment-flow.spec.ts
├── fixtures/          # Test data and mocks
│   ├── seed.ts
│   └── mocks.ts
└── setup.ts           # Global test setup
```

## Running Tests

```bash
# All tests
npm test

# Unit only
npm run test:unit

# Integration only
npm run test:integration

# E2E only
npm run test:e2e

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Assertions Checklist

For each test function:
- [ ] Happy path (success case)
- [ ] Error case (invalid input)
- [ ] Edge case (null, empty, very large values)
- [ ] Boundary condition (off-by-one, limits)
- [ ] Side effects (mutations, calls)

## Performance Test Template

```typescript
it('should respond within acceptable time', async () => {
  const start = performance.now();
  await mySlowFunction();
  const duration = performance.now() - start;

  expect(duration).toBeLessThan(500); // ms
});
```

## Error Testing

```typescript
it('should handle errors gracefully', async () => {
  // Simulate error
  vi.mocked(externalAPI).mockRejectedValueOnce(new Error('API down'));

  const result = await myFunction();

  expect(result).toEqual({ success: false, error: 'Retry later' });
});
```
