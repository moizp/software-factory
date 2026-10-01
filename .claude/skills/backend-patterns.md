# Backend Patterns Skill

Reusable code patterns and templates for backend builders. Provides standardized implementations of common features across all supported backends.

## Supported Stacks

- **TypeScript + Node.js** — Express.js, Fastify
- **Python** — FastAPI, Django
- **Go** — Gin, Echo

## Pattern Categories

### 1. Server Setup

#### Express (TypeScript/Node)

```typescript
// src/server.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/error';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/users', userRoutes);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { app };
```

#### FastAPI (Python)

```python
# main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os

# Initialize database
from database import engine, Base, SessionLocal

Base.metadata.create_all(bind=engine)

# Startup/Shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Server starting...")
    yield
    print("Server shutting down...")

app = FastAPI(lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check
@app.get("/health")
async def health_check():
    return {"status": "ok"}

# Routes
from routes import auth, users
app.include_router(auth.router, prefix="/auth")
app.include_router(users.router, prefix="/users")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
```

### 2. Authentication

#### JWT Auth (Express)

```typescript
// src/auth/jwt.ts
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRY = '24h';

export interface JWTPayload {
  userId: string;
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    return null;
  }
}

// Middleware
import { Request, Response, NextFunction } from 'express';

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: { code: 'NO_TOKEN', message: 'Missing authorization token' } });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }

  req.user = payload;
  next();
}
```

#### Auth Endpoints

```typescript
// src/routes/auth.ts
import express, { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword, generateToken } from '../auth/jwt';

const router = Router();
const prisma = new PrismaClient();

// POST /auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Email and password required' }
      });
    }

    // Check if user exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({
        error: { code: 'USER_EXISTS', message: 'Email already registered' }
      });
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash }
    });

    // Generate token
    const token = generateToken({ userId: user.id, email: user.email });

    res.status(201).json({
      user: { id: user.id, email: user.email },
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Registration failed' }
    });
  }
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Email and password required' }
      });
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({
        error: { code: 'AUTH_FAILED', message: 'Invalid credentials' }
      });
    }

    // Verify password
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({
        error: { code: 'AUTH_FAILED', message: 'Invalid credentials' }
      });
    }

    // Generate token
    const token = generateToken({ userId: user.id, email: user.email });

    res.json({
      user: { id: user.id, email: user.email },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Login failed' }
    });
  }
});

export default router;
```

### 3. Error Handling

```typescript
// src/middleware/error.ts
import { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  code?: string;
  status?: number;
}

export class ValidationError extends Error {
  code = 'VALIDATION_ERROR';
  status = 400;
  constructor(message: string, public details?: Record<string, any>) {
    super(message);
  }
}

export class NotFoundError extends Error {
  code = 'NOT_FOUND';
  status = 404;
  constructor(message: string) {
    super(message);
  }
}

export class UnauthorizedError extends Error {
  code = 'UNAUTHORIZED';
  status = 401;
  constructor(message: string = 'Unauthorized') {
    super(message);
  }
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';

  console.error(`[${status}] ${code}: ${err.message}`);

  res.status(status).json({
    error: {
      code,
      message: err.message,
      ...(err instanceof ValidationError && { details: err.details })
    }
  });
}
```

### 4. Database

#### Prisma Setup

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  profile       Profile?
  
  sessions      Session[]
  workspaces    WorkspaceMember[]
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  @@index([email])
}

model Profile {
  id        String   @id @default(cuid())
  userId    String   @unique
  firstName String?
  lastName  String?
  avatar    String?
  
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  createdAt DateTime @default(now())
  
  @@index([userId])
  @@index([expiresAt])
}

model Workspace {
  id            String    @id @default(cuid())
  name          String
  slug          String    @unique
  description   String?
  
  members       WorkspaceMember[]
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model WorkspaceMember {
  id            String   @id @default(cuid())
  userId        String
  workspaceId   String
  role          String   @default("member") // admin, member, viewer
  
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  createdAt     DateTime @default(now())
  
  @@unique([userId, workspaceId])
  @@index([workspaceId])
}
```

### 5. Environment Configuration

```bash
# .env.example
# Database
DATABASE_URL=postgres://user:password@localhost:5432/mydb

# Auth
JWT_SECRET=your-secret-key-change-in-production

# Server
PORT=3000
NODE_ENV=development

# Stripe (if payments enabled)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# External services
GITHUB_TOKEN=ghp_...
SLACK_BOT_TOKEN=xoxb-...
```

### 6. Standard Response Format

```typescript
// All responses follow this format

// Success (2xx)
{
  "data": {...},
  "meta": {
    "timestamp": "2024-01-15T10:30:00Z",
    "version": "1.0"
  }
}

// Error (4xx/5xx)
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required",
    "details": { "field": "email" }
  }
}
```

## Database Migrations

```bash
# Generate migration from schema changes
npx prisma migrate dev --name add_users_table

# Apply migrations
npx prisma migrate deploy

# Reset database (dev only)
npx prisma migrate reset
```

## Testing Patterns

```typescript
// Unit test example
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../auth/jwt';

describe('Password hashing', () => {
  it('hashes password and verifies correctly', async () => {
    const password = 'securepass123';
    const hash = await hashPassword(password);
    
    expect(hash).not.toBe(password);
    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });
});
```

---

**When to use:** Backend builders load this skill based on `project.config.json.stack`. Provides boilerplate code that's customized per project architecture.
