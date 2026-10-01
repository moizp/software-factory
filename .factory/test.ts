import {
  createWorkflowState,
  saveWorkflowState,
  loadWorkflowState,
  listWorkflowStates,
  updatePhase,
  addArtifact,
  addNote
} from './state';
import { FactoryOrchestrator, mockAgentInvoker } from './orchestrator';

async function testStateManagement(): Promise<void> {
  console.log('Testing state management...');

  // Create state
  const state = createWorkflowState(
    'Build a user authentication system',
    123,
    { stack: 'ts-react-node' }
  );
  console.log(`✓ Created workflow: ${state.id}`);

  // Save state
  saveWorkflowState(state);
  console.log(`✓ Saved workflow state`);

  // Load state
  const loaded = loadWorkflowState(state.id);
  if (!loaded) throw new Error('Failed to load state');
  console.log(`✓ Loaded workflow state`);

  // Update phase
  let updated = updatePhase(loaded, 'analyzer', true, { features: ['auth'] });
  console.log(`✓ Updated phase: ${updated.currentPhase}`);

  // Add artifact
  updated = addArtifact(updated, 'analysis', { requirements: ['oauth', 'jwt'] });
  console.log(`✓ Added artifact`);

  // Add note
  updated = addNote(updated, 'Analysis complete');
  console.log(`✓ Added note`);

  // Save updated state
  saveWorkflowState(updated);

  // List states
  const all = listWorkflowStates();
  console.log(`✓ Listed ${all.length} workflow(s)`);
}

async function testOrchestrator(): Promise<void> {
  console.log('\nTesting orchestrator...');

  const orchestrator = new FactoryOrchestrator(mockAgentInvoker, false);
  const finalState = await orchestrator.executeWorkflow(
    'Build a real-time chat application',
    456,
    { stack: 'ts-react-node' }
  );

  console.log(`✓ Workflow executed: ${finalState.id}`);
  console.log(`✓ Final status: ${finalState.status}`);
  console.log(`✓ Completed phases: ${finalState.phases.length}`);
  console.log(`✓ Generated artifacts: ${finalState.artifacts.length}`);

  if (finalState.status !== 'completed') {
    throw new Error(`Workflow did not complete: ${finalState.status}`);
  }
}

async function runTests(): Promise<void> {
  try {
    await testStateManagement();
    await testOrchestrator();
    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error(`\n❌ Test failed: ${error}`);
    process.exit(1);
  }
}

runTests();
