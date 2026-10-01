# Testing Suite Skill

Patterns and scaffolds for generating comprehensive test suites across all project layers.

## Test Framework Selection

Based on stack:

| Language | Unit | Integration | E2E |
|----------|------|-------------|-----|
| TypeScript/Node | Vitest or Jest | Supertest | Playwright/Cypress |
| Python | Pytest | Pytest + requests | Pytest + Selenium |
| Go | testing | httptest | testify |

## Test Structure

```
tests/
├── unit/              # Functions, utilities, business logic
├── integration/       # API endpoints, database operations
├── e2e/              # Full user workflows
└── fixtures/         # Test data, mocks
```

## Unit Tests

### Express Auth Module

```typescript
// tests/unit/auth.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken
} from '../../src/auth/jwt';

describe('Authentication Module', () => {
  describe('Password Hashing', () => {
    it('should hash password', async () => {
      const password = 'securepass123';
      const hash = await hashPassword(password);
      
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(20);
    });

    it('should verify correct password', async () => {
      const password = 'securepass123';
      const hash = await hashPassword(password);
      const valid = await verifyPassword(password, hash);
      
      expect(valid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'securepass123';
      const hash = await hashPassword(password);
      const valid = await verifyPassword('wrongpassword', hash);
      
      expect(valid).toBe(false);
    });
  });

  describe('JWT Token', () => {
    it('should generate token', () => {
      const payload = { userId: 'user-123', email: 'test@example.com' };
      const token = generateToken(payload);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT format
    });

    it('should verify token', () => {
      const payload = { userId: 'user-123', email: 'test@example.com' };
      const token = generateToken(payload);
      const verified = verifyToken(token);
      
      expect(verified).toBeDefined();
      expect(verified?.userId).toBe(payload.userId);
      expect(verified?.email).toBe(payload.email);
    });

    it('should reject invalid token', () => {
      const verified = verifyToken('invalid.token.here');
      expect(verified).toBeNull();
    });
  });
});
```

## Integration Tests

### API Endpoint Testing

```typescript
// tests/integration/auth.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Auth Endpoints', () => {
  beforeAll(async () => {
    // Setup: Create test database
    await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS test');
  });

  afterAll(async () => {
    // Teardown: Clean up test data
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  describe('POST /auth/register', () => {
    it('should register new user', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'securepass123'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('user');
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.email).toBe('newuser@example.com');
    });

    it('should reject duplicate email', async () => {
      // First registration
      await request(app)
        .post('/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'pass123'
        });

      // Duplicate attempt
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'pass123'
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('USER_EXISTS');
    });

    it('should validate email format', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'securepass123'
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should require password', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          email: 'user@example.com'
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('password');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'securepass123'
        });
    });

    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'existing@example.com',
          password: 'securepass123'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.email).toBe('existing@example.com');
    });

    it('should reject invalid password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'existing@example.com',
          password: 'wrongpassword'
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_FAILED');
    });

    it('should reject nonexistent user', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'securepass123'
        });

      expect(res.status).toBe(401);
    });
  });
});
```

## E2E Tests

### Full User Workflow

```typescript
// tests/e2e/workflow.test.ts
import { describe, it, expect } from 'vitest';
import { chromium, Browser, Page } from 'playwright';

describe('User Workflow', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('should complete registration and login flow', async () => {
    // 1. Navigate to registration page
    await page.goto('http://localhost:3000/register');
    expect(page.url()).toContain('/register');

    // 2. Register new user
    await page.fill('input[type="email"]', 'e2e@example.com');
    await page.fill('input[type="password"]', 'securepass123');
    await page.click('button:has-text("Register")');

    // 3. Wait for redirect to dashboard
    await page.waitForURL('**/dashboard');
    expect(page.url()).toContain('/dashboard');

    // 4. Verify logged in state
    const welcomeText = await page.textContent('h1');
    expect(welcomeText).toContain('Welcome');

    // 5. Logout
    await page.click('button:has-text("Logout")');

    // 6. Should redirect to login
    await page.waitForURL('**/login');
    expect(page.url()).toContain('/login');
  });

  it('should handle workspace creation', async () => {
    // Login first
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'e2e@example.com');
    await page.fill('input[type="password"]', 'securepass123');
    await page.click('button:has-text("Login")');
    
    // Create workspace
    await page.click('button:has-text("New Workspace")');
    await page.fill('input[name="workspaceName"]', 'My Test Workspace');
    await page.click('button:has-text("Create")');

    // Verify workspace created
    const workspaceName = await page.textContent('[data-testid="workspace-name"]');
    expect(workspaceName).toContain('My Test Workspace');
  });
});
```

## Python Test Example

```python
# tests/test_auth.py
import pytest
from fastapi.testclient import TestClient
from main import app
from database import SessionLocal

client = TestClient(app)

@pytest.fixture
def db():
    db = SessionLocal()
    yield db
    db.close()

def test_register_user(db):
    response = client.post("/auth/register", json={
        "email": "test@example.com",
        "password": "securepass123"
    })
    assert response.status_code == 201
    assert response.json()["user"]["email"] == "test@example.com"
    assert "token" in response.json()

def test_register_duplicate_email(db):
    # First registration
    client.post("/auth/register", json={
        "email": "duplicate@example.com",
        "password": "pass123"
    })
    
    # Duplicate attempt
    response = client.post("/auth/register", json={
        "email": "duplicate@example.com",
        "password": "pass123"
    })
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "USER_EXISTS"

def test_login_success(db):
    # Register first
    client.post("/auth/register", json={
        "email": "test@example.com",
        "password": "securepass123"
    })
    
    # Login
    response = client.post("/auth/login", json={
        "email": "test@example.com",
        "password": "securepass123"
    })
    assert response.status_code == 200
    assert "token" in response.json()

def test_login_invalid_password(db):
    # Register first
    client.post("/auth/register", json={
        "email": "test@example.com",
        "password": "securepass123"
    })
    
    # Wrong password
    response = client.post("/auth/login", json={
        "email": "test@example.com",
        "password": "wrongpassword"
    })
    assert response.status_code == 401
```

## Test Configuration

### package.json (Node/TypeScript)

```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "@vitest/coverage-v8": "^1.0.0",
    "supertest": "^6.3.0",
    "@testing-library/react": "^14.0.0",
    "playwright": "^1.40.0"
  }
}
```

### pytest.ini (Python)

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
asyncio_mode = auto
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      all: true,
      lines: 70,
      functions: 70,
      branches: 70,
      statements: 70
    }
  }
});
```

## Coverage Targets

All projects must meet:

- **Lines:** 70%+
- **Functions:** 70%+
- **Branches:** 65%+
- **Statements:** 70%+

Critical paths require 90%+ coverage.

## Test Execution in CI/CD

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

---

**When to use:** Reviewer agent generates tests using these patterns. Builders reference this skill to create comprehensive test suites before code deployment.
