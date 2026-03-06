import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
let testSession;
describe('hello world NUTs', () => {
  before('prepare session', async () => {
    testSession = await TestSession.create();
  });
  after(async () => {
    await testSession?.clean();
  });
  it('should say hello to the world', () => {
    const result = execCmd('hello world --json', { ensureExitCode: 0 }).jsonOutput?.result;
    expect(result?.name).to.equal('World');
  });
  it('should say hello to a given person', () => {
    const result = execCmd('hello world --name Astro --json', {
      ensureExitCode: 0,
    }).jsonOutput?.result;
    expect(result?.name).to.equal('Astro');
  });
});
//# sourceMappingURL=world.nut.js.map
