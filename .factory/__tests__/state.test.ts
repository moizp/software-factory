import {
  createWorkflowState,
  updatePhase,
  addArtifact,
  addNote,
  WorkflowState
} from '../state';
import {
  createMockWorkflowState,
  createMockPhaseGate,
  createMockArtifact,
  mockProjectConfig
} from './fixtures';

describe('State Management - CRUD Operations', () => {
  describe('createWorkflowState', () => {
    it('should create workflow with unique ID', () => {
      const state1 = createWorkflowState('Brief 1');
      const state2 = createWorkflowState('Brief 2');

      expect(state1.id).not.toBe(state2.id);
      expect(state1.id).toMatch(/^wf-\d+-[a-z0-9]+$/);
    });

    it('should initialize with correct defaults', () => {
      const brief = 'Test brief';
      const state = createWorkflowState(brief);

      expect(state.issueBrief).toBe(brief);
      expect(state.currentPhase).toBe('product-manager');
      expect(state.status).toBe('running');
      expect(state.phases).toEqual([]);
      expect(state.artifacts).toEqual([]);
      expect(state.notes).toEqual([]);
    });

    it('should set issueNumber when provided', () => {
      const state = createWorkflowState('Brief', 123);

      expect(state.issueNumber).toBe(123);
    });

    it('should set config when provided', () => {
      const state = createWorkflowState('Brief', undefined, mockProjectConfig);

      expect(state.config).toEqual(mockProjectConfig);
    });

    it('should set timestamps on creation', () => {
      const before = new Date();
      const state = createWorkflowState('Brief');
      const after = new Date();

      const startTime = new Date(state.startedAt);
      expect(startTime.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(startTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(state.updatedAt).toBe(state.startedAt);
    });
  });

  describe('updatePhase', () => {
    let baseState: WorkflowState;

    beforeEach(() => {
      baseState = createMockWorkflowState();
    });

    it('should add phase to phases array', () => {
      const updated = updatePhase(baseState, 'product-manager', true);

      expect(updated.phases).toHaveLength(1);
      expect(updated.phases[0].phase).toBe('product-manager');
    });

    it('should track valid phase', () => {
      const updated = updatePhase(baseState, 'analyzer', true, { data: 'test' });

      expect(updated.phases[0].valid).toBe(true);
      expect(updated.phases[0].output).toEqual({ data: 'test' });
    });

    it('should track invalid phase with error', () => {
      const error = 'Phase validation failed';
      const updated = updatePhase(baseState, 'software-architect', false, undefined, error);

      expect(updated.phases[0].valid).toBe(false);
      expect(updated.phases[0].error).toBe(error);
      expect(updated.status).toBe('failed');
    });

    it('should update currentPhase', () => {
      const updated = updatePhase(baseState, 'backend-engineer', true);

      expect(updated.currentPhase).toBe('backend-engineer');
    });

    it('should update timestamp on phase change', () => {
      const before = new Date();
      const updated = updatePhase(baseState, 'analyzer', true);
      const after = new Date();

      const updatedTime = new Date(updated.updatedAt);
      expect(updatedTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updatedTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should support multiple phases in sequence', () => {
      let state = baseState;
      state = updatePhase(state, 'product-manager', true);
      state = updatePhase(state, 'analyzer', true);
      state = updatePhase(state, 'software-architect', true);

      expect(state.phases).toHaveLength(3);
      expect(state.phases[0].phase).toBe('product-manager');
      expect(state.phases[1].phase).toBe('analyzer');
      expect(state.phases[2].phase).toBe('software-architect');
    });

    it('should not modify original state', () => {
      const original = { ...baseState };
      updatePhase(baseState, 'analyzer', true);

      expect(baseState).toEqual(original);
    });
  });

  describe('addArtifact', () => {
    let baseState: WorkflowState;

    beforeEach(() => {
      baseState = createMockWorkflowState();
      baseState.currentPhase = 'analyzer';
    });

    it('should add artifact to artifacts array', () => {
      const content = { requirements: ['auth', 'api'] };
      const updated = addArtifact(baseState, 'requirements', content);

      expect(updated.artifacts).toHaveLength(1);
      expect(updated.artifacts[0].type).toBe('requirements');
    });

    it('should associate artifact with current phase', () => {
      const updated = addArtifact(baseState, 'analysis', {});

      expect(updated.artifacts[0].phase).toBe('analyzer');
    });

    it('should include timestamp', () => {
      const before = new Date();
      const updated = addArtifact(baseState, 'output', {});
      const after = new Date();

      const timestamp = new Date(updated.artifacts[0].timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should support multiple artifacts', () => {
      let state = baseState;
      state = addArtifact(state, 'type1', { data: 1 });
      state = addArtifact(state, 'type2', { data: 2 });
      state = addArtifact(state, 'type3', { data: 3 });

      expect(state.artifacts).toHaveLength(3);
      expect(state.artifacts[0].content).toEqual({ data: 1 });
      expect(state.artifacts[1].content).toEqual({ data: 2 });
      expect(state.artifacts[2].content).toEqual({ data: 3 });
    });

    it('should store artifact path when provided', () => {
      const updated = addArtifact(
        baseState,
        'schema',
        { table: 'users' },
        '/tmp/schema.json'
      );

      expect(updated.artifacts[0].path).toBe('/tmp/schema.json');
    });

    it('should not modify original state', () => {
      const original = { ...baseState };
      addArtifact(baseState, 'test', {});

      expect(baseState).toEqual(original);
    });
  });

  describe('addNote', () => {
    let baseState: WorkflowState;

    beforeEach(() => {
      baseState = createMockWorkflowState();
    });

    it('should add note with timestamp', () => {
      const note = 'Workflow started';
      const updated = addNote(baseState, note);

      expect(updated.notes).toHaveLength(1);
      expect(updated.notes[0]).toContain(note);
      expect(updated.notes[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
    });

    it('should support multiple notes', () => {
      let state = baseState;
      state = addNote(state, 'Note 1');
      state = addNote(state, 'Note 2');
      state = addNote(state, 'Note 3');

      expect(state.notes).toHaveLength(3);
      expect(state.notes[0]).toContain('Note 1');
      expect(state.notes[1]).toContain('Note 2');
      expect(state.notes[2]).toContain('Note 3');
    });

    it('should not modify original state', () => {
      const original = { ...baseState };
      addNote(baseState, 'test');

      expect(baseState).toEqual(original);
    });
  });

  describe('State Serialization', () => {
    it('should serialize phase gates to JSON', () => {
      let state = createMockWorkflowState();
      state = updatePhase(state, 'analyzer', true, { features: ['auth'] });

      const json = JSON.stringify(state);
      expect(json).toContain('analyzer');
      expect(json).toContain('"valid":true');
    });

    it('should preserve artifact content in serialization', () => {
      let state = createMockWorkflowState();
      state.currentPhase = 'analyzer';
      const content = { api: { endpoint: '/users' } };
      state = addArtifact(state, 'schema', content);

      const json = JSON.stringify(state);
      const parsed = JSON.parse(json);

      expect(parsed.artifacts[0].content).toEqual(content);
    });

    it('should handle complex nested structures', () => {
      let state = createMockWorkflowState({
        config: {
          database: {
            host: 'localhost',
            port: 5432,
            tables: ['users', 'posts']
          }
        }
      });

      const json = JSON.stringify(state);
      const parsed = JSON.parse(json);

      expect(parsed.config.database.port).toBe(5432);
      expect(parsed.config.database.tables).toEqual(['users', 'posts']);
    });
  });
});
