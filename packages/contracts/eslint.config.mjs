import { library } from '@fabric/config-eslint/library';

// contracts may import zod and @fabric/core only (BUILD_PROMPTS §1.3).
export default library({
  rootDir: import.meta.dirname,
  runtimeDependencies: ['zod', '@fabric/core'],
});
